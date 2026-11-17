import 'dotenv/config';
import express, { Request, Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from './src/db/index.ts';
import {
  auditLogs,
  departments,
  doctors,
  hospitalBranches,
  hospitals,
  laboratories,
  medicalReports,
  notificationPreferences,
  notificationSettings,
  notifications,
  patientConsents,
  patients,
  reportAccessTokens,
  reportApprovals,
  reportAttachments,
  reportShares,
  subscriptions,
  users,
} from './src/db/schema.ts';
import { seedDatabaseIfEmpty } from './src/db/seed.ts';
import { adminAuth } from './src/lib/firebase-admin.ts';
import { extractMedicalReportWithGemini } from './src/lib/gemini.ts';
import {
  ALLOWED_REPORT_CATEGORIES,
  canAccessHospitalResource,
  canReleaseReportToPatient,
  DuplicateMatchRule,
  evaluatePatientDuplicate,
  generatePatientRefNumber,
  generateReportRefNumber,
} from './src/lib/matching.ts';
import {
  getIntegrationCredentialsStatus,
  processDueNotificationRetries,
  retryNotificationById,
  triggerApprovedReportDelivery,
} from './src/lib/notifications.ts';
import { generateAdminSummaryPdf, generateClinicalReportPdf } from './src/lib/pdf-generator.ts';
import { computeSha256, scanUploadedFile, signSessionToken } from './src/lib/security.ts';
import { AuthRequest, requireAuth, requireRoles } from './src/middleware/auth.ts';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: true, limit: '16mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

let seedPromise: Promise<void> | null = null;
async function ensureSeeded() {
  if (!seedPromise) {
    seedPromise = seedDatabaseIfEmpty().catch((err) => {
      console.error('Seed failed:', err);
      seedPromise = null;
    });
  }
  await seedPromise;
}

function getBaseUrl(req: Request): string {
  if (process.env.APP_URL && process.env.APP_URL !== 'MY_APP_URL') {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

async function logAudit(params: {
  hospitalId?: number | null;
  actorUserId?: number | null;
  actorEmail?: string;
  actorRole?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  try {
    await db.insert(auditLogs).values({
      hospitalId: params.hospitalId ?? null,
      actorUserId: params.actorUserId ?? null,
      actorEmail: params.actorEmail || 'system',
      actorRole: params.actorRole || 'system',
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId || '',
      details: params.details || {},
      ipAddress: params.ipAddress || '127.0.0.1',
    });
  } catch (err) {
    console.error('Audit log write failed:', err);
  }
}

// Health check
app.get('/api/health', async (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'MediReport Connect',
    timestamp: new Date().toISOString(),
  });
});

// ==================== AUTHENTICATION ====================

app.post('/api/auth/firebase', async (req: Request, res: Response) => {
  try {
    await ensureSeeded();
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) {
      return res.status(400).json({ error: 'idToken is required' });
    }
    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = decoded.email || `${decoded.uid}@firebase.local`;
    const fullName = decoded.name || email.split('@')[0];

    const [user] = await db
      .insert(users)
      .values({
        uid: decoded.uid,
        email,
        fullName,
        role: 'super_admin',
        mfaEnabled: false,
        language: 'en',
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: { email, lastLoginAt: new Date() },
      })
      .returning();

    const sessionToken = signSessionToken({
      userId: user.id,
      uid: user.uid,
      email: user.email,
      role: user.role,
      hospitalId: user.hospitalId,
      mfaVerified: true,
    });

    await logAudit({
      hospitalId: user.hospitalId,
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'FIREBASE_SSO_LOGIN',
      resourceType: 'user',
      resourceId: String(user.id),
      ipAddress: req.ip,
    });

    return res.json({ user, sessionToken });
  } catch (err) {
    console.error('Firebase auth error:', err);
    return res.status(401).json({ error: 'Invalid Firebase ID token' });
  }
});

app.post('/api/auth/demo-login', async (req: Request, res: Response) => {
  try {
    await ensureSeeded();
    const { role, mfaCode, email } = req.body as {
      role?: string;
      mfaCode?: string;
      email?: string;
    };

    const targetUidMap: Record<string, string> = {
      super_admin: 'demo-super-admin',
      hospital_admin: 'demo-hospital-admin',
      lab_staff: 'demo-lab-staff',
      doctor: 'demo-doctor',
      reception_staff: 'demo-reception',
      patient: 'demo-patient',
    };

    let dbUser;
    if (email) {
      const [found] = await db.select().from(users).where(eq(users.email, email));
      dbUser = found;
    } else if (role && targetUidMap[role]) {
      const [found] = await db.select().from(users).where(eq(users.uid, targetUidMap[role]));
      dbUser = found;
    }

    if (!dbUser) {
      return res.status(404).json({ error: 'Account not found for selected role.' });
    }

    if (dbUser.mfaEnabled) {
      if (!mfaCode) {
        return res.json({
          requiresMfa: true,
          email: dbUser.email,
          fullName: dbUser.fullName,
          role: dbUser.role,
        });
      }
      if (mfaCode.trim() !== dbUser.mfaCode) {
        return res.status(403).json({ error: 'Invalid 6-digit MFA verification code.' });
      }
    }

    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, dbUser.id));

    const sessionToken = signSessionToken({
      userId: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      role: dbUser.role,
      hospitalId: dbUser.hospitalId,
      mfaVerified: true,
    });

    await logAudit({
      hospitalId: dbUser.hospitalId,
      actorUserId: dbUser.id,
      actorEmail: dbUser.email,
      actorRole: dbUser.role,
      action: 'USER_LOGIN',
      resourceType: 'user',
      resourceId: String(dbUser.id),
      details: { mfaVerified: dbUser.mfaEnabled },
      ipAddress: req.ip,
    });

    return res.json({ user: dbUser, sessionToken });
  } catch (err) {
    console.error('Demo login error:', err);
    return res.status(500).json({ error: 'Authentication failed' });
  }
});

app.post('/api/auth/patient-register', async (req: Request, res: Response) => {
  try {
    await ensureSeeded();
    const {
      fullName,
      email,
      dateOfBirth,
      gender,
      mobileCountryCode,
      mobileNumber,
      hospitalId,
      hospitalRegNumber,
    } = req.body as Record<string, string | number>;

    if (!fullName || !email || !dateOfBirth || !mobileNumber) {
      return res.status(400).json({
        error: 'Full name, email, date of birth, and mobile number are required.',
      });
    }

    const [firstHosp] = await db.select().from(hospitals).limit(1);
    const targetHospId = Number(hospitalId) || firstHosp?.id;
    if (!targetHospId) {
      return res.status(400).json({ error: 'No active hospital found for registration.' });
    }

    const [hosp] = await db.select().from(hospitals).where(eq(hospitals.id, targetHospId));
    const uid = `pat-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const [newUser] = await db
      .insert(users)
      .values({
        uid,
        email: String(email).trim().toLowerCase(),
        fullName: String(fullName).trim(),
        role: 'patient',
        hospitalId: targetHospId,
        mfaEnabled: false,
        language: 'en',
        lastLoginAt: new Date(),
      })
      .returning();

    const patientRefNumber = generatePatientRefNumber(hosp?.code || 'MEDI');
    const [newPatient] = await db
      .insert(patients)
      .values({
        patientRefNumber,
        hospitalRegNumber:
          String(hospitalRegNumber || '').trim() || `MRN-SELF-${Date.now().toString().slice(-5)}`,
        fullName: String(fullName).trim(),
        dateOfBirth: String(dateOfBirth),
        gender: String(gender || 'Unspecified'),
        email: String(email).trim().toLowerCase(),
        mobileCountryCode: String(mobileCountryCode || '+971'),
        mobileNumber: String(mobileNumber).trim(),
        hospitalId: targetHospId,
        userId: newUser.id,
        consentStatus: 'granted',
      })
      .returning();

    await db.insert(notificationPreferences).values({
      patientId: newPatient.id,
      emailEnabled: true,
      whatsappEnabled: true,
      smsEnabled: false,
      preferredChannel: 'email',
      preferredLanguage: 'en',
    });

    await db.insert(patientConsents).values({
      patientId: newPatient.id,
      hospitalId: targetHospId,
      consentType: 'digital_report_delivery',
      status: 'granted',
      notes: 'Self-service patient portal registration consent.',
      recordedByUserId: newUser.id,
    });

    const sessionToken = signSessionToken({
      userId: newUser.id,
      uid: newUser.uid,
      email: newUser.email,
      role: newUser.role,
      hospitalId: newUser.hospitalId,
      mfaVerified: true,
    });

    return res.status(201).json({ user: newUser, patient: newPatient, sessionToken });
  } catch (err) {
    console.error('Patient registration error:', err);
    return res.status(500).json({ error: 'Failed to register patient account.' });
  }
});

app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureSeeded();
    const user = req.authUser!;
    let hospital = null;
    if (user.hospitalId) {
      const [h] = await db.select().from(hospitals).where(eq(hospitals.id, user.hospitalId));
      hospital = h || null;
    }
    let patientProfile = null;
    let preferences = null;
    if (user.role === 'patient') {
      const [p] = await db.select().from(patients).where(eq(patients.userId, user.id));
      patientProfile = p || null;
      if (p) {
        const [pref] = await db
          .select()
          .from(notificationPreferences)
          .where(eq(notificationPreferences.patientId, p.id));
        preferences = pref || null;
      }
    }
    return res.json({ user, hospital, patientProfile, preferences });
  } catch (err) {
    console.error('Auth me error:', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

app.put('/api/auth/language', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { language } = req.body as { language?: string };
    const lang = language === 'ar' ? 'ar' : 'en';
    await db.update(users).set({ language: lang }).where(eq(users.id, req.authUser!.id));
    return res.json({ language: lang });
  } catch {
    return res.status(500).json({ error: 'Failed to update language preference' });
  }
});

// ==================== HOSPITALS, BRANCHES, DEPTS, LABS, DOCTORS, STAFF ====================

app.get('/api/hospitals', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureSeeded();
    const user = req.authUser!;
    if (user.role === 'super_admin') {
      const list = await db.select().from(hospitals).orderBy(hospitals.id);
      return res.json(list);
    }
    if (!user.hospitalId) return res.json([]);
    const list = await db.select().from(hospitals).where(eq(hospitals.id, user.hospitalId));
    return res.json(list);
  } catch (err) {
    console.error('Get hospitals error:', err);
    return res.status(500).json({ error: 'Failed to load hospitals' });
  }
});

app.post(
  '/api/hospitals',
  requireAuth,
  requireRoles('super_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, nameAr, code, licenseNumber, emiratesJurisdiction, city, phone, email, planTier } =
        req.body as Record<string, string>;

      if (!name || !code || !licenseNumber) {
        return res.status(400).json({ error: 'Hospital name, code, and license number are required.' });
      }

      const [hosp] = await db
        .insert(hospitals)
        .values({
          name: name.trim(),
          nameAr: (nameAr || '').trim(),
          code: code.trim().toUpperCase(),
          licenseNumber: licenseNumber.trim(),
          emiratesJurisdiction: emiratesJurisdiction || 'UAE-DOH',
          city: city || 'Abu Dhabi',
          phone: phone || '',
          email: email || '',
        })
        .returning();

      await db.insert(hospitalBranches).values({
        hospitalId: hosp.id,
        name: `${hosp.name} Main Campus`,
        nameAr: hosp.nameAr || hosp.name,
        code: `${hosp.code}-MAIN`,
        city: hosp.city,
        address: `${hosp.city} Healthcare District`,
        phone: hosp.phone,
      });

      const priceMap: Record<string, { price: number; limit: number }> = {
        starter: { price: 1800, limit: 2500 },
        clinical_pro: { price: 4500, limit: 10000 },
        enterprise_network: { price: 9800, limit: 50000 },
      };
      const tier = priceMap[planTier] ? planTier : 'clinical_pro';

      await db.insert(subscriptions).values({
        hospitalId: hosp.id,
        planTier: tier,
        monthlyPriceAed: priceMap[tier].price,
        maxReportsPerMonth: priceMap[tier].limit,
      });

      await db.insert(notificationSettings).values({
        hospitalId: hosp.id,
      });

      await logAudit({
        hospitalId: hosp.id,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        action: 'HOSPITAL_CREATED',
        resourceType: 'hospital',
        resourceId: String(hosp.id),
      });

      return res.status(201).json(hosp);
    } catch (err) {
      console.error('Create hospital error:', err);
      return res.status(500).json({ error: 'Failed to create hospital. Code may already exist.' });
    }
  }
);

app.put(
  '/api/hospitals/:id',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!canAccessHospitalResource(req.authUser!, id)) {
        return res.status(403).json({ error: 'Forbidden: Cross-hospital modification denied.' });
      }
      const { name, city, phone, email, duplicateMatchRule, retentionDays } = req.body as Record<
        string,
        string | number
      >;

      const [updated] = await db
        .update(hospitals)
        .set({
          ...(name ? { name: String(name) } : {}),
          ...(city ? { city: String(city) } : {}),
          ...(phone !== undefined ? { phone: String(phone) } : {}),
          ...(email !== undefined ? { email: String(email) } : {}),
          ...(duplicateMatchRule ? { duplicateMatchRule: String(duplicateMatchRule) } : {}),
          ...(retentionDays ? { retentionDays: Number(retentionDays) } : {}),
        })
        .where(eq(hospitals.id, id))
        .returning();

      return res.json(updated);
    } catch (err) {
      console.error('Update hospital error:', err);
      return res.status(500).json({ error: 'Failed to update hospital' });
    }
  }
);

app.get('/api/hospital-directory', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureSeeded();
    const user = req.authUser!;
    const requestedHospId = req.query.hospitalId ? Number(req.query.hospitalId) : user.hospitalId;

    if (user.role !== 'super_admin' && requestedHospId && !canAccessHospitalResource(user, requestedHospId)) {
      return res.status(403).json({ error: 'Forbidden: Cross-hospital directory access denied.' });
    }

    const filterHospId = user.role === 'super_admin' ? requestedHospId : user.hospitalId;

    const branches = filterHospId
      ? await db.select().from(hospitalBranches).where(eq(hospitalBranches.hospitalId, filterHospId))
      : await db.select().from(hospitalBranches);

    const depts = filterHospId
      ? await db.select().from(departments).where(eq(departments.hospitalId, filterHospId))
      : await db.select().from(departments);

    const labs = filterHospId
      ? await db.select().from(laboratories).where(eq(laboratories.hospitalId, filterHospId))
      : await db.select().from(laboratories);

    const docs = filterHospId
      ? await db.select().from(doctors).where(eq(doctors.hospitalId, filterHospId))
      : await db.select().from(doctors);

    return res.json({ branches, departments: depts, laboratories: labs, doctors: docs });
  } catch (err) {
    console.error('Directory fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch hospital directory' });
  }
});

app.post(
  '/api/hospitals/:id/branches',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hospitalId = Number(req.params.id);
      if (!canAccessHospitalResource(req.authUser!, hospitalId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const { name, nameAr, code, city, address, phone } = req.body as Record<string, string>;
      if (!name || !code || !city || !address) {
        return res.status(400).json({ error: 'Branch name, code, city, and address are required.' });
      }
      const [branch] = await db
        .insert(hospitalBranches)
        .values({
          hospitalId,
          name,
          nameAr: nameAr || '',
          code: code.toUpperCase(),
          city,
          address,
          phone: phone || '',
        })
        .returning();
      return res.status(201).json(branch);
    } catch {
      return res.status(500).json({ error: 'Failed to create branch' });
    }
  }
);

app.post(
  '/api/hospitals/:id/departments',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hospitalId = Number(req.params.id);
      if (!canAccessHospitalResource(req.authUser!, hospitalId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const { name, nameAr, code, branchId, headDoctorName } = req.body as Record<string, string | number>;
      if (!name || !code) {
        return res.status(400).json({ error: 'Department name and code are required.' });
      }
      const [dept] = await db
        .insert(departments)
        .values({
          hospitalId,
          branchId: branchId ? Number(branchId) : null,
          name: String(name),
          nameAr: String(nameAr || ''),
          code: String(code).toUpperCase(),
          headDoctorName: String(headDoctorName || ''),
        })
        .returning();
      return res.status(201).json(dept);
    } catch {
      return res.status(500).json({ error: 'Failed to create department' });
    }
  }
);

app.post(
  '/api/hospitals/:id/laboratories',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hospitalId = Number(req.params.id);
      if (!canAccessHospitalResource(req.authUser!, hospitalId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const { name, code, branchId, accreditation, limsIntegrationType } = req.body as Record<
        string,
        string | number
      >;
      if (!name || !code) {
        return res.status(400).json({ error: 'Laboratory name and code are required.' });
      }
      const [lab] = await db
        .insert(laboratories)
        .values({
          hospitalId,
          branchId: branchId ? Number(branchId) : null,
          name: String(name),
          code: String(code).toUpperCase(),
          accreditation: String(accreditation || 'CAP / ISO 15189'),
          limsIntegrationType: String(limsIntegrationType || 'HL7 FHIR R4 REST'),
          apiKeyPrefix: `mr_${String(code).toLowerCase().slice(0, 6)}_`,
        })
        .returning();
      return res.status(201).json(lab);
    } catch {
      return res.status(500).json({ error: 'Failed to register laboratory' });
    }
  }
);

app.get(
  '/api/staff',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const list =
        user.role === 'super_admin'
          ? await db.select().from(users).orderBy(desc(users.createdAt))
          : await db
              .select()
              .from(users)
              .where(eq(users.hospitalId, user.hospitalId!))
              .orderBy(desc(users.createdAt));

      return res.json(
        list.map((u) => ({
          id: u.id,
          email: u.email,
          fullName: u.fullName,
          role: u.role,
          hospitalId: u.hospitalId,
          branchId: u.branchId,
          departmentId: u.departmentId,
          mfaEnabled: u.mfaEnabled,
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt,
        }))
      );
    } catch {
      return res.status(500).json({ error: 'Failed to load staff accounts' });
    }
  }
);

app.post(
  '/api/staff',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = req.authUser!;
      const { email, fullName, role, hospitalId, branchId, departmentId, licenseNumber, specialty } =
        req.body as Record<string, string | number>;

      if (!email || !fullName || !role) {
        return res.status(400).json({ error: 'Email, full name, and role are required.' });
      }
      if (actor.role !== 'super_admin' && role === 'super_admin') {
        return res.status(403).json({ error: 'Only Super Administrators can create super_admin users.' });
      }

      const targetHospitalId =
        actor.role === 'super_admin' ? Number(hospitalId) || null : actor.hospitalId;

      const [newUser] = await db
        .insert(users)
        .values({
          uid: `staff-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          email: String(email).trim().toLowerCase(),
          fullName: String(fullName).trim(),
          role: String(role),
          hospitalId: targetHospitalId,
          branchId: branchId ? Number(branchId) : null,
          departmentId: departmentId ? Number(departmentId) : null,
          mfaEnabled: ['super_admin', 'hospital_admin', 'doctor'].includes(String(role)),
        })
        .returning();

      if (role === 'doctor' && targetHospitalId) {
        await db.insert(doctors).values({
          userId: newUser.id,
          hospitalId: targetHospitalId,
          branchId: branchId ? Number(branchId) : null,
          departmentId: departmentId ? Number(departmentId) : null,
          fullName: String(fullName).trim(),
          licenseNumber: String(licenseNumber || `DOH-MD-${Date.now().toString().slice(-5)}`),
          specialty: String(specialty || 'General Medicine'),
          email: String(email).trim().toLowerCase(),
        });
      }

      await logAudit({
        hospitalId: targetHospitalId,
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'STAFF_ACCOUNT_CREATED',
        resourceType: 'user',
        resourceId: String(newUser.id),
        details: { createdRole: role },
      });

      return res.status(201).json(newUser);
    } catch {
      return res.status(500).json({ error: 'Failed to create staff account' });
    }
  }
);

// ==================== PATIENTS & DUPLICATE DETECTION ====================

app.get(
  '/api/patients',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin', 'reception_staff', 'lab_staff', 'doctor'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

      const baseWhere =
        user.role === 'super_admin' ? undefined : eq(patients.hospitalId, user.hospitalId!);

      const searchWhere = q
        ? or(
            ilike(patients.patientRefNumber, `%${q}%`),
            ilike(patients.hospitalRegNumber, `%${q}%`),
            ilike(patients.fullName, `%${q}%`),
            ilike(patients.mobileNumber, `%${q}%`),
            ilike(patients.email, `%${q}%`)
          )
        : undefined;

      const combinedWhere =
        baseWhere && searchWhere ? and(baseWhere, searchWhere) : baseWhere || searchWhere;

      const rows = combinedWhere
        ? await db.select().from(patients).where(combinedWhere).orderBy(desc(patients.createdAt))
        : await db.select().from(patients).orderBy(desc(patients.createdAt));

      return res.json(rows);
    } catch (err) {
      console.error('List patients error:', err);
      return res.status(500).json({ error: 'Failed to fetch patients' });
    }
  }
);

app.post(
  '/api/patients',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin', 'reception_staff', 'lab_staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const {
        fullName,
        hospitalRegNumber,
        dateOfBirth,
        gender,
        email,
        mobileCountryCode,
        mobileNumber,
        hospitalId,
        branchId,
        departmentId,
        consentStatus,
        forceCreateUncertain,
      } = req.body as Record<string, string | number | boolean>;

      const targetHospitalId =
        user.role === 'super_admin' ? Number(hospitalId) || user.hospitalId : user.hospitalId;

      if (!targetHospitalId || !canAccessHospitalResource(user, targetHospitalId)) {
        return res.status(403).json({ error: 'Forbidden: Invalid hospital scope.' });
      }

      if (!fullName || !hospitalRegNumber || !dateOfBirth || !mobileNumber) {
        return res.status(400).json({
          error: 'Full name, hospital registration number, date of birth, and mobile number are required.',
        });
      }

      const [hosp] = await db.select().from(hospitals).where(eq(hospitals.id, targetHospitalId));
      if (!hosp) return res.status(404).json({ error: 'Hospital not found' });

      const existing = await db
        .select()
        .from(patients)
        .where(eq(patients.hospitalId, targetHospitalId));

      const dupCheck = evaluatePatientDuplicate(
        {
          hospitalRegNumber: String(hospitalRegNumber),
          fullName: String(fullName),
          dateOfBirth: String(dateOfBirth),
          email: String(email || ''),
          mobileCountryCode: String(mobileCountryCode || '+971'),
          mobileNumber: String(mobileNumber),
          hospitalId: targetHospitalId,
        },
        existing,
        hosp.duplicateMatchRule as DuplicateMatchRule
      );

      if (dupCheck.exactDuplicate) {
        return res.status(409).json({
          error: dupCheck.reason,
          duplicatePatient: dupCheck.exactDuplicate,
        });
      }

      const isUncertain = Boolean(dupCheck.uncertainMatch);
      if (isUncertain && !forceCreateUncertain) {
        // Create flagged for manual verification rather than merging automatically
        const patientRefNumber = generatePatientRefNumber(hosp.code);
        const [flaggedPatient] = await db
          .insert(patients)
          .values({
            patientRefNumber,
            hospitalRegNumber: String(hospitalRegNumber).trim(),
            fullName: String(fullName).trim(),
            dateOfBirth: String(dateOfBirth),
            gender: String(gender || 'Unspecified'),
            email: String(email || '').trim().toLowerCase(),
            mobileCountryCode: String(mobileCountryCode || '+971'),
            mobileNumber: String(mobileNumber).trim(),
            hospitalId: targetHospitalId,
            branchId: branchId ? Number(branchId) : null,
            departmentId: departmentId ? Number(departmentId) : null,
            consentStatus: String(consentStatus || 'granted'),
            needsManualVerification: true,
            duplicateCandidateId: dupCheck.uncertainMatch!.id,
          })
          .returning();

        await db.insert(notificationPreferences).values({
          patientId: flaggedPatient.id,
          emailEnabled: true,
          whatsappEnabled: true,
          smsEnabled: false,
        });

        await logAudit({
          hospitalId: targetHospitalId,
          actorUserId: user.id,
          actorEmail: user.email,
          actorRole: user.role,
          action: 'PATIENT_FLAGGED_MANUAL_VERIFICATION',
          resourceType: 'patient',
          resourceId: flaggedPatient.patientRefNumber,
          details: { reason: dupCheck.reason, candidateId: dupCheck.uncertainMatch!.id },
        });

        return res.status(201).json({
          patient: flaggedPatient,
          uncertainMatchWarning: dupCheck.reason,
          candidate: dupCheck.uncertainMatch,
        });
      }

      const patientRefNumber = generatePatientRefNumber(hosp.code);
      const [created] = await db
        .insert(patients)
        .values({
          patientRefNumber,
          hospitalRegNumber: String(hospitalRegNumber).trim(),
          fullName: String(fullName).trim(),
          dateOfBirth: String(dateOfBirth),
          gender: String(gender || 'Unspecified'),
          email: String(email || '').trim().toLowerCase(),
          mobileCountryCode: String(mobileCountryCode || '+971'),
          mobileNumber: String(mobileNumber).trim(),
          hospitalId: targetHospitalId,
          branchId: branchId ? Number(branchId) : null,
          departmentId: departmentId ? Number(departmentId) : null,
          consentStatus: String(consentStatus || 'granted'),
          needsManualVerification: false,
        })
        .returning();

      await db.insert(notificationPreferences).values({
        patientId: created.id,
        emailEnabled: true,
        whatsappEnabled: true,
        smsEnabled: false,
      });

      await db.insert(patientConsents).values({
        patientId: created.id,
        hospitalId: targetHospitalId,
        consentType: 'digital_report_delivery',
        status: created.consentStatus,
        notes: 'Recorded during hospital patient registration.',
        recordedByUserId: user.id,
      });

      await logAudit({
        hospitalId: targetHospitalId,
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'PATIENT_REGISTERED',
        resourceType: 'patient',
        resourceId: created.patientRefNumber,
      });

      return res.status(201).json({ patient: created });
    } catch (err) {
      console.error('Create patient error:', err);
      return res.status(500).json({ error: 'Failed to register patient' });
    }
  }
);

app.put(
  '/api/patients/:id',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin', 'reception_staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [existing] = await db.select().from(patients).where(eq(patients.id, id));
      if (!existing) return res.status(404).json({ error: 'Patient not found' });
      if (!canAccessHospitalResource(req.authUser!, existing.hospitalId)) {
        return res.status(403).json({ error: 'Forbidden: Cross-hospital patient edit denied.' });
      }

      const { fullName, email, mobileCountryCode, mobileNumber, dateOfBirth, gender, consentStatus } =
        req.body as Record<string, string>;

      const [updated] = await db
        .update(patients)
        .set({
          ...(fullName ? { fullName } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(mobileCountryCode ? { mobileCountryCode } : {}),
          ...(mobileNumber ? { mobileNumber } : {}),
          ...(dateOfBirth ? { dateOfBirth } : {}),
          ...(gender ? { gender } : {}),
          ...(consentStatus ? { consentStatus } : {}),
          updatedAt: new Date(),
        })
        .where(eq(patients.id, id))
        .returning();

      return res.json(updated);
    } catch {
      return res.status(500).json({ error: 'Failed to update patient' });
    }
  }
);

app.post(
  '/api/patients/:id/resolve-duplicate',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin', 'reception_staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      const { resolution, targetPatientId } = req.body as {
        resolution: 'confirm_distinct' | 'merge_into_target';
        targetPatientId?: number;
      };

      const [pat] = await db.select().from(patients).where(eq(patients.id, id));
      if (!pat) return res.status(404).json({ error: 'Patient not found' });
      if (!canAccessHospitalResource(req.authUser!, pat.hospitalId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (resolution === 'merge_into_target' && targetPatientId) {
        await db
          .update(medicalReports)
          .set({ patientId: targetPatientId })
          .where(eq(medicalReports.patientId, id));
        await db.delete(patients).where(eq(patients.id, id));
        await logAudit({
          hospitalId: pat.hospitalId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: req.authUser!.role,
          action: 'PATIENT_MANUALLY_MERGED',
          resourceType: 'patient',
          resourceId: String(targetPatientId),
          details: { mergedFrom: pat.patientRefNumber },
        });
        return res.json({ merged: true, targetPatientId });
      }

      const [resolved] = await db
        .update(patients)
        .set({ needsManualVerification: false, duplicateCandidateId: null, updatedAt: new Date() })
        .where(eq(patients.id, id))
        .returning();

      return res.json({ resolved: true, patient: resolved });
    } catch {
      return res.status(500).json({ error: 'Failed to resolve patient verification' });
    }
  }
);

app.put('/api/patients/:id/preferences', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const patientId = Number(req.params.id);
    const [pat] = await db.select().from(patients).where(eq(patients.id, patientId));
    if (!pat) return res.status(404).json({ error: 'Patient not found' });

    const user = req.authUser!;
    if (user.role === 'patient' && pat.userId !== user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (user.role !== 'patient' && !canAccessHospitalResource(user, pat.hospitalId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { emailEnabled, whatsappEnabled, smsEnabled, preferredChannel, preferredLanguage } =
      req.body as Record<string, boolean | string>;

    const [updated] = await db
      .insert(notificationPreferences)
      .values({
        patientId,
        emailEnabled: Boolean(emailEnabled ?? true),
        whatsappEnabled: Boolean(whatsappEnabled ?? true),
        smsEnabled: Boolean(smsEnabled ?? false),
        preferredChannel: String(preferredChannel || 'email'),
        preferredLanguage: String(preferredLanguage || 'en'),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: notificationPreferences.patientId,
        set: {
          emailEnabled: Boolean(emailEnabled ?? true),
          whatsappEnabled: Boolean(whatsappEnabled ?? true),
          smsEnabled: Boolean(smsEnabled ?? false),
          preferredChannel: String(preferredChannel || 'email'),
          preferredLanguage: String(preferredLanguage || 'en'),
          updatedAt: new Date(),
        },
      })
      .returning();

    return res.json(updated);
  } catch {
    return res.status(500).json({ error: 'Failed to save notification preferences' });
  }
});

// ==================== REPORTS, AI EXTRACTION, APPROVAL & DELIVERY ====================

app.get('/api/reports', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureSeeded();
    const user = req.authUser!;
    const { category, status, departmentId, hospitalId, q } = req.query as Record<string, string>;

    const allHospitals = await db.select().from(hospitals);
    const allBranches = await db.select().from(hospitalBranches);
    const allDepts = await db.select().from(departments);
    const allDoctors = await db.select().from(doctors);
    const allPatients = await db.select().from(patients);

    const hospMap = new Map(allHospitals.map((h) => [h.id, h]));
    const branchMap = new Map(allBranches.map((b) => [b.id, b]));
    const deptMap = new Map(allDepts.map((d) => [d.id, d]));
    const docMap = new Map(allDoctors.map((d) => [d.id, d]));
    const patMap = new Map(allPatients.map((p) => [p.id, p]));

    let rows;
    if (user.role === 'patient') {
      const [pat] = await db.select().from(patients).where(eq(patients.userId, user.id));
      if (!pat) return res.json({ reports: [], pendingCount: 0 });
      const allPatientReports = await db
        .select()
        .from(medicalReports)
        .where(eq(medicalReports.patientId, pat.id))
        .orderBy(desc(medicalReports.uploadDate));

      const pendingCount = allPatientReports.filter(
        (r) => !canReleaseReportToPatient(r.status)
      ).length;

      // NEVER return unverified report details or attachments to patients
      rows = allPatientReports.filter((r) => canReleaseReportToPatient(r.status));

      const enriched = rows
        .filter((r) => (!category || r.category === category))
        .filter((r) => (!departmentId || r.departmentId === Number(departmentId)))
        .filter((r) => (!hospitalId || r.hospitalId === Number(hospitalId)))
        .filter(
          (r) =>
            !q ||
            r.title.toLowerCase().includes(q.toLowerCase()) ||
            r.reportRefNumber.toLowerCase().includes(q.toLowerCase())
        )
        .map((r) => ({
          ...r,
          hospitalName: hospMap.get(r.hospitalId)?.name || '',
          branchName: r.branchId ? branchMap.get(r.branchId)?.name || '' : '',
          departmentName: r.departmentId ? deptMap.get(r.departmentId)?.name || '' : '',
          doctorName: r.reviewingDoctorId ? docMap.get(r.reviewingDoctorId)?.fullName || '' : '',
          patientName: pat.fullName,
          patientRefNumber: pat.patientRefNumber,
        }));

      return res.json({ reports: enriched, pendingCount });
    }

    // Staff / Doctor / Admin
    if (user.role !== 'super_admin' && !user.hospitalId) {
      return res.json({ reports: [], pendingCount: 0 });
    }

    const conditions = [];
    if (user.role !== 'super_admin') {
      conditions.push(eq(medicalReports.hospitalId, user.hospitalId!));
    } else if (hospitalId) {
      conditions.push(eq(medicalReports.hospitalId, Number(hospitalId)));
    }
    if (category) conditions.push(eq(medicalReports.category, category));
    if (status) conditions.push(eq(medicalReports.status, status));
    if (departmentId) conditions.push(eq(medicalReports.departmentId, Number(departmentId)));

    rows =
      conditions.length > 0
        ? await db
            .select()
            .from(medicalReports)
            .where(and(...conditions))
            .orderBy(desc(medicalReports.uploadDate))
        : await db.select().from(medicalReports).orderBy(desc(medicalReports.uploadDate));

    const enriched = rows
      .map((r) => {
        const pat = r.patientId ? patMap.get(r.patientId) : undefined;
        return {
          ...r,
          hospitalName: hospMap.get(r.hospitalId)?.name || '',
          branchName: r.branchId ? branchMap.get(r.branchId)?.name || '' : '',
          departmentName: r.departmentId ? deptMap.get(r.departmentId)?.name || '' : '',
          doctorName: r.reviewingDoctorId ? docMap.get(r.reviewingDoctorId)?.fullName || '' : '',
          patientName: pat?.fullName || 'Unmatched / Pending Records Review',
          patientRefNumber: pat?.patientRefNumber || 'UNMATCHED',
          hospitalRegNumber: pat?.hospitalRegNumber || '',
        };
      })
      .filter(
        (r) =>
          !q ||
          r.title.toLowerCase().includes(q.toLowerCase()) ||
          r.reportRefNumber.toLowerCase().includes(q.toLowerCase()) ||
          r.patientName.toLowerCase().includes(q.toLowerCase()) ||
          r.patientRefNumber.toLowerCase().includes(q.toLowerCase())
      );

    return res.json({ reports: enriched, pendingCount: 0 });
  } catch (err) {
    console.error('Get reports error:', err);
    return res.status(500).json({ error: 'Failed to load medical reports' });
  }
});

app.post(
  '/api/reports/ai-extract',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin', 'lab_staff', 'reception_staff', 'doctor'),
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const file = req.file;
      const rawText = typeof req.body.rawText === 'string' ? req.body.rawText : '';

      if (!file && !rawText.trim()) {
        return res.status(400).json({
          error: 'Upload a PDF/image scan or provide text content for Gemini AI extraction.',
        });
      }

      if (file) {
        const scan = scanUploadedFile(file.buffer, file.mimetype, file.originalname);
        if (!scan.safe) {
          return res.status(400).json({ error: scan.reason || 'File failed security scan.' });
        }
      }

      const extracted = await extractMedicalReportWithGemini({
        fileBase64: file ? file.buffer.toString('base64') : undefined,
        mimeType: file?.mimetype,
        rawText: rawText || undefined,
        fileName: file?.originalname,
      });

      // Match candidate patient in hospital scope
      const user = req.authUser!;
      const hospId = user.hospitalId || Number(req.body.hospitalId) || null;
      let matchedPatient = null;
      let duplicateReport = null;

      if (hospId) {
        const hospPatients = await db
          .select()
          .from(patients)
          .where(eq(patients.hospitalId, hospId));

        matchedPatient =
          hospPatients.find(
            (p) =>
              (extracted.hospitalRegNumber &&
                p.hospitalRegNumber.toLowerCase() === extracted.hospitalRegNumber.toLowerCase()) ||
              (extracted.patientIdHint &&
                p.patientRefNumber.toLowerCase() === extracted.patientIdHint.toLowerCase())
          ) ||
          hospPatients.find(
            (p) =>
              extracted.patientName &&
              p.fullName.toLowerCase().includes(extracted.patientName.toLowerCase())
          ) ||
          null;

        if (extracted.reportRefNumber) {
          const [dup] = await db
            .select()
            .from(medicalReports)
            .where(eq(medicalReports.reportRefNumber, extracted.reportRefNumber));
          duplicateReport = dup || null;
        }
      }

      return res.json({
        extracted,
        matchedPatient,
        duplicateReport,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gemini AI extraction failed';
      console.error('Gemini AI extract error:', err);
      return res.status(502).json({ error: msg });
    }
  }
);

app.post(
  '/api/reports',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin', 'lab_staff', 'reception_staff'),
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const file = req.file;

      const {
        patientId,
        hospitalId,
        branchId,
        departmentId,
        laboratoryId,
        reviewingDoctorId,
        category,
        title,
        examinationDate,
        reportRefNumber,
        sourceChannel,
        clinicalNotes,
        aiAdministrativeSummary,
        aiConfidenceScore,
        aiMissingFields,
        labValues,
        patientMatchedUncertain,
      } = req.body as Record<string, string>;

      const targetHospitalId =
        user.role === 'super_admin' ? Number(hospitalId) || user.hospitalId : user.hospitalId;

      if (!targetHospitalId || !canAccessHospitalResource(user, targetHospitalId)) {
        return res.status(403).json({ error: 'Forbidden: Invalid hospital scope.' });
      }

      if (file) {
        const scan = scanUploadedFile(file.buffer, file.mimetype, file.originalname);
        if (!scan.safe) {
          await logAudit({
            hospitalId: targetHospitalId,
            actorUserId: user.id,
            actorEmail: user.email,
            actorRole: user.role,
            action: 'UPLOAD_QUARANTINED_MALWARE',
            resourceType: 'file_upload',
            details: { fileName: file.originalname, reason: scan.reason },
          });
          return res.status(400).json({ error: scan.reason });
        }
      }

      const normalizedCategory = ALLOWED_REPORT_CATEGORIES.includes(
        category as (typeof ALLOWED_REPORT_CATEGORIES)[number]
      )
        ? category
        : 'General laboratory reports';

      const ref = (reportRefNumber || '').trim() || generateReportRefNumber(normalizedCategory);
      const parsedPatientId = patientId ? Number(patientId) : null;
      const isUncertain = patientMatchedUncertain === 'true' || !parsedPatientId;

      // Check potential duplicate upload
      let isDuplicateFlagged = false;
      let duplicateOfReportId: number | null = null;
      if (parsedPatientId && examinationDate) {
        const existingDup = await db
          .select()
          .from(medicalReports)
          .where(
            and(
              eq(medicalReports.patientId, parsedPatientId),
              eq(medicalReports.category, normalizedCategory),
              eq(medicalReports.examinationDate, examinationDate)
            )
          )
          .limit(1);
        if (existingDup.length > 0) {
          isDuplicateFlagged = true;
          duplicateOfReportId = existingDup[0].id;
        }
      }

      let parsedLabValues: Array<{
        parameter: string;
        value: string;
        unit: string;
        referenceRange: string;
        flag?: string;
      }> = [];
      if (labValues) {
        try {
          parsedLabValues = typeof labValues === 'string' ? JSON.parse(labValues) : labValues;
        } catch {
          parsedLabValues = [];
        }
      }

      let parsedMissingFields: string[] = [];
      if (aiMissingFields) {
        try {
          parsedMissingFields =
            typeof aiMissingFields === 'string' ? JSON.parse(aiMissingFields) : aiMissingFields;
        } catch {
          parsedMissingFields = [];
        }
      }

      const initialStatus = isUncertain ? 'manual_matching' : 'pending_verification';

      const [report] = await db
        .insert(medicalReports)
        .values({
          reportRefNumber: ref,
          patientId: parsedPatientId,
          hospitalId: targetHospitalId,
          branchId: branchId ? Number(branchId) : null,
          departmentId: departmentId ? Number(departmentId) : null,
          laboratoryId: laboratoryId ? Number(laboratoryId) : null,
          reviewingDoctorId: reviewingDoctorId ? Number(reviewingDoctorId) : null,
          uploadedByUserId: user.id,
          category: normalizedCategory,
          title: (title || normalizedCategory).trim(),
          examinationDate: examinationDate || new Date().toISOString().slice(0, 10),
          sourceChannel: sourceChannel || (file ? 'pdf_upload' : 'manual_entry'),
          status: initialStatus,
          aiAdministrativeSummary: aiAdministrativeSummary || '',
          aiConfidenceScore: Number(aiConfidenceScore) || 0,
          aiMissingFields: parsedMissingFields,
          labValues: parsedLabValues,
          clinicalNotes: clinicalNotes || '',
          isDuplicateFlagged,
          duplicateOfReportId,
          patientMatchedUncertain: isUncertain,
        })
        .returning();

      // Store attachment or generate clean PDF attachment
      const [hosp] = await db.select().from(hospitals).where(eq(hospitals.id, targetHospitalId));
      const [pat] = parsedPatientId
        ? await db.select().from(patients).where(eq(patients.id, parsedPatientId))
        : [];
      const [doc] = reviewingDoctorId
        ? await db.select().from(doctors).where(eq(doctors.id, Number(reviewingDoctorId)))
        : [];

      if (file) {
        await db.insert(reportAttachments).values({
          reportId: report.id,
          version: 1,
          fileName: file.originalname,
          mimeType: file.mimetype,
          fileSizeBytes: file.size,
          sha256Checksum: computeSha256(file.buffer),
          malwareScanStatus: 'clean',
          fileDataBase64: file.buffer.toString('base64'),
        });
      } else {
        const pdfBuf = await generateClinicalReportPdf({
          reportRefNumber: report.reportRefNumber,
          title: report.title,
          category: report.category,
          status: report.status,
          version: 1,
          examinationDate: report.examinationDate,
          uploadDate: new Date().toISOString().slice(0, 10),
          hospitalName: hosp?.name || 'MediReport Hospital',
          hospitalLicense: hosp?.licenseNumber || '',
          branchName: 'Main Branch',
          departmentName: 'Diagnostics',
          patientName: pat?.fullName || 'Pending Patient Match',
          patientRefNumber: pat?.patientRefNumber || 'UNMATCHED',
          hospitalRegNumber: pat?.hospitalRegNumber || 'PENDING',
          patientDob: pat?.dateOfBirth || 'N/A',
          reviewingDoctorName: doc?.fullName || 'Assigned Physician',
          reviewingDoctorLicense: doc?.licenseNumber || '',
          clinicalNotes: report.clinicalNotes,
          administrativeSummary: report.aiAdministrativeSummary,
          labValues: parsedLabValues,
        });

        await db.insert(reportAttachments).values({
          reportId: report.id,
          version: 1,
          fileName: `${report.reportRefNumber}.pdf`,
          mimeType: 'application/pdf',
          fileSizeBytes: pdfBuf.length,
          sha256Checksum: computeSha256(pdfBuf),
          malwareScanStatus: 'clean',
          fileDataBase64: pdfBuf.toString('base64'),
        });
      }

      // Increment subscription monthly usage
      await db
        .update(subscriptions)
        .set({ reportsUsedThisMonth: sql`${subscriptions.reportsUsedThisMonth} + 1` })
        .where(eq(subscriptions.hospitalId, targetHospitalId));

      await logAudit({
        hospitalId: targetHospitalId,
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'REPORT_UPLOADED',
        resourceType: 'medical_report',
        resourceId: report.reportRefNumber,
        details: { status: initialStatus, isDuplicateFlagged, sourceChannel: report.sourceChannel },
      });

      return res.status(201).json({ report, isDuplicateFlagged });
    } catch (err) {
      console.error('Upload report error:', err);
      return res.status(500).json({ error: 'Failed to create medical report' });
    }
  }
);

// LIMS / HMS REST Integration Endpoint
app.post('/api/integrations/lims/reports', async (req: Request, res: Response) => {
  try {
    await ensureSeeded();
    const { hospitalCode, patientRefNumber, hospitalRegNumber, category, title, examinationDate, labValues } =
      req.body as {
        hospitalCode?: string;
        patientRefNumber?: string;
        hospitalRegNumber?: string;
        category?: string;
        title?: string;
        examinationDate?: string;
        labValues?: Array<{ parameter: string; value: string; unit: string; referenceRange: string; flag?: string }>;
      };

    if (!hospitalCode || !title) {
      return res.status(400).json({ error: 'hospitalCode and title are required for LIMS ingestion.' });
    }

    const [hosp] = await db
      .select()
      .from(hospitals)
      .where(eq(hospitals.code, hospitalCode.toUpperCase()));
    if (!hosp) return res.status(404).json({ error: 'Hospital code not recognized' });

    const hospPatients = await db.select().from(patients).where(eq(patients.hospitalId, hosp.id));
    const matched = hospPatients.find(
      (p) =>
        (patientRefNumber && p.patientRefNumber === patientRefNumber) ||
        (hospitalRegNumber && p.hospitalRegNumber === hospitalRegNumber)
    );

    const ref = generateReportRefNumber(category || 'General laboratory reports');
    const [report] = await db
      .insert(medicalReports)
      .values({
        reportRefNumber: ref,
        patientId: matched?.id || null,
        hospitalId: hosp.id,
        category: category || 'General laboratory reports',
        title,
        examinationDate: examinationDate || new Date().toISOString().slice(0, 10),
        sourceChannel: 'lims_integration',
        status: matched ? 'pending_verification' : 'manual_matching',
        patientMatchedUncertain: !matched,
        labValues: labValues || [],
        aiAdministrativeSummary: `Ingested via LIMS REST API (${hosp.code}). ${
          matched ? 'Matched to patient record.' : 'Patient match uncertain — queued for records review.'
        }`,
      })
      .returning();

    return res.status(201).json({ ingested: true, report });
  } catch {
    return res.status(500).json({ error: 'LIMS integration ingestion failed' });
  }
});

app.post(
  '/api/reports/:id/match-patient',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin', 'reception_staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const reportId = Number(req.params.id);
      const { patientId } = req.body as { patientId?: number };
      const [report] = await db.select().from(medicalReports).where(eq(medicalReports.id, reportId));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      if (!canAccessHospitalResource(req.authUser!, report.hospitalId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      if (!patientId) return res.status(400).json({ error: 'patientId is required' });

      const [pat] = await db.select().from(patients).where(eq(patients.id, Number(patientId)));
      if (!pat || pat.hospitalId !== report.hospitalId) {
        return res.status(400).json({ error: 'Patient must belong to the same hospital.' });
      }

      const [updated] = await db
        .update(medicalReports)
        .set({
          patientId: pat.id,
          patientMatchedUncertain: false,
          status: 'pending_verification',
          updatedAt: new Date(),
        })
        .where(eq(medicalReports.id, reportId))
        .returning();

      await logAudit({
        hospitalId: report.hospitalId,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        action: 'REPORT_MATCHED_TO_PATIENT',
        resourceType: 'medical_report',
        resourceId: report.reportRefNumber,
        details: { patientRefNumber: pat.patientRefNumber },
      });

      return res.json(updated);
    } catch {
      return res.status(500).json({ error: 'Failed to match report to patient' });
    }
  }
);

app.post(
  '/api/reports/:id/verify',
  requireAuth,
  requireRoles('doctor', 'super_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const reportId = Number(req.params.id);
      const { action, clinicalComments } = req.body as {
        action: 'approved' | 'rejected' | 'correction_requested';
        clinicalComments?: string;
      };

      const [report] = await db.select().from(medicalReports).where(eq(medicalReports.id, reportId));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      if (!canAccessHospitalResource(req.authUser!, report.hospitalId)) {
        return res.status(403).json({ error: 'Forbidden: Cross-hospital report verification denied.' });
      }

      if (action === 'approved' && !report.patientId) {
        return res.status(400).json({
          error: 'Cannot approve and release a report without a verified patient match.',
        });
      }

      const [doctorRecord] = await db
        .select()
        .from(doctors)
        .where(eq(doctors.userId, req.authUser!.id));

      await db.insert(reportApprovals).values({
        reportId: report.id,
        reviewerUserId: req.authUser!.id,
        reviewerDoctorId: doctorRecord?.id || report.reviewingDoctorId || null,
        action,
        clinicalComments: clinicalComments || '',
        version: report.version,
      });

      const nextStatus = action === 'approved' ? 'approved' : action;
      const [updatedReport] = await db
        .update(medicalReports)
        .set({
          status: nextStatus,
          clinicalNotes: clinicalComments ?? report.clinicalNotes,
          reviewingDoctorId: doctorRecord?.id || report.reviewingDoctorId,
          updatedAt: new Date(),
        })
        .where(eq(medicalReports.id, reportId))
        .returning();

      let deliveryResult = null;
      if (action === 'approved' && report.patientId) {
        deliveryResult = await triggerApprovedReportDelivery({
          reportId: report.id,
          patientId: report.patientId,
          hospitalId: report.hospitalId,
          baseUrl: getBaseUrl(req),
        });

        await db
          .update(medicalReports)
          .set({ status: 'delivered', updatedAt: new Date() })
          .where(eq(medicalReports.id, report.id));
      }

      await logAudit({
        hospitalId: report.hospitalId,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        action: `REPORT_${action.toUpperCase()}`,
        resourceType: 'medical_report',
        resourceId: report.reportRefNumber,
        details: { clinicalComments, automaticDeliveryTriggered: Boolean(deliveryResult) },
      });

      return res.json({
        report: { ...updatedReport, status: action === 'approved' ? 'delivered' : nextStatus },
        deliveryResult,
      });
    } catch (err) {
      console.error('Verify report error:', err);
      return res.status(500).json({ error: 'Failed to process report verification' });
    }
  }
);

app.post(
  '/api/reports/:id/resubmit',
  requireAuth,
  requireRoles('lab_staff', 'hospital_admin', 'super_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const reportId = Number(req.params.id);
      const { clinicalNotes, labValues } = req.body as {
        clinicalNotes?: string;
        labValues?: Array<{ parameter: string; value: string; unit: string; referenceRange: string; flag?: string }>;
      };

      const [report] = await db.select().from(medicalReports).where(eq(medicalReports.id, reportId));
      if (!report) return res.status(404).json({ error: 'Report not found' });
      if (!canAccessHospitalResource(req.authUser!, report.hospitalId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const nextVersion = report.version + 1;
      const [updated] = await db
        .update(medicalReports)
        .set({
          version: nextVersion,
          status: 'pending_verification',
          ...(clinicalNotes !== undefined ? { clinicalNotes } : {}),
          ...(labValues ? { labValues } : {}),
          updatedAt: new Date(),
        })
        .where(eq(medicalReports.id, reportId))
        .returning();

      await db.insert(reportApprovals).values({
        reportId: report.id,
        reviewerUserId: req.authUser!.id,
        action: 'resubmitted',
        clinicalComments: 'Corrections applied and resubmitted for physician verification.',
        version: nextVersion,
      });

      return res.json(updated);
    } catch {
      return res.status(500).json({ error: 'Failed to resubmit report' });
    }
  }
);

app.get('/api/reports/:id/history', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const reportId = Number(req.params.id);
    const [report] = await db.select().from(medicalReports).where(eq(medicalReports.id, reportId));
    if (!report) return res.status(404).json({ error: 'Report not found' });

    if (req.authUser!.role === 'patient') {
      const [pat] = await db.select().from(patients).where(eq(patients.userId, req.authUser!.id));
      if (!pat || report.patientId !== pat.id || !canReleaseReportToPatient(report.status)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else if (!canAccessHospitalResource(req.authUser!, report.hospitalId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const history = await db
      .select()
      .from(reportApprovals)
      .where(eq(reportApprovals.reportId, reportId))
      .orderBy(desc(reportApprovals.createdAt));

    return res.json(history);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch report version history' });
  }
});

app.post(
  '/api/reports/:id/share',
  requireAuth,
  requireRoles('patient', 'super_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const reportId = Number(req.params.id);
      const { sharedWithEmail } = req.body as { sharedWithEmail?: string };
      if (!sharedWithEmail) return res.status(400).json({ error: 'Doctor email is required.' });

      const [report] = await db.select().from(medicalReports).where(eq(medicalReports.id, reportId));
      if (!report || !canReleaseReportToPatient(report.status)) {
        return res.status(400).json({ error: 'Only verified reports can be shared.' });
      }

      const [pat] = await db.select().from(patients).where(eq(patients.userId, req.authUser!.id));
      const patientId = pat?.id || report.patientId!;

      const [share] = await db
        .insert(reportShares)
        .values({
          reportId: report.id,
          patientId,
          sharedWithEmail: sharedWithEmail.trim().toLowerCase(),
          expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
        })
        .returning();

      await logAudit({
        hospitalId: report.hospitalId,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        action: 'PATIENT_SHARED_REPORT',
        resourceType: 'medical_report',
        resourceId: report.reportRefNumber,
        details: { sharedWithEmail },
      });

      return res.status(201).json(share);
    } catch {
      return res.status(500).json({ error: 'Failed to share report' });
    }
  }
);

app.get('/api/reports/:id/download', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const reportId = Number(req.params.id);
    const [report] = await db.select().from(medicalReports).where(eq(medicalReports.id, reportId));
    if (!report) return res.status(404).json({ error: 'Report not found' });

    const user = req.authUser!;
    if (user.role === 'patient') {
      const [pat] = await db.select().from(patients).where(eq(patients.userId, user.id));
      if (!pat || report.patientId !== pat.id) {
        return res.status(403).json({ error: 'Forbidden: Report belongs to another patient.' });
      }
      if (!canReleaseReportToPatient(report.status)) {
        return res.status(403).json({
          error: 'Unverified medical reports cannot be accessed or downloaded by patients.',
        });
      }
      await db
        .update(notifications)
        .set({ patientDownloadedAt: new Date(), patientAccessedAt: new Date() })
        .where(and(eq(notifications.reportId, report.id), eq(notifications.patientId, pat.id)));
    } else if (!canAccessHospitalResource(user, report.hospitalId)) {
      return res.status(403).json({ error: 'Forbidden: Cross-hospital report download denied.' });
    }

    await logAudit({
      hospitalId: report.hospitalId,
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'REPORT_PDF_DOWNLOADED',
      resourceType: 'medical_report',
      resourceId: report.reportRefNumber,
    });

    const [attachment] = await db
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, report.id))
      .orderBy(desc(reportAttachments.version))
      .limit(1);

    if (attachment && attachment.fileDataBase64 && attachment.mimeType === 'application/pdf') {
      const buf = Buffer.from(attachment.fileDataBase64, 'base64');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${report.reportRefNumber}.pdf"`);
      return res.send(buf);
    }

    const [hosp] = await db.select().from(hospitals).where(eq(hospitals.id, report.hospitalId));
    const [pat] = report.patientId
      ? await db.select().from(patients).where(eq(patients.id, report.patientId))
      : [];
    const [doc] = report.reviewingDoctorId
      ? await db.select().from(doctors).where(eq(doctors.id, report.reviewingDoctorId))
      : [];

    const pdfBuf = await generateClinicalReportPdf({
      reportRefNumber: report.reportRefNumber,
      title: report.title,
      category: report.category,
      status: report.status,
      version: report.version,
      examinationDate: report.examinationDate,
      uploadDate: new Date(report.uploadDate).toISOString().slice(0, 10),
      hospitalName: hosp?.name || 'MediReport Hospital',
      hospitalLicense: hosp?.licenseNumber || '',
      branchName: hosp?.city || 'Main',
      departmentName: 'Clinical Diagnostics',
      patientName: pat?.fullName || 'Patient',
      patientRefNumber: pat?.patientRefNumber || 'N/A',
      hospitalRegNumber: pat?.hospitalRegNumber || 'N/A',
      patientDob: pat?.dateOfBirth || 'N/A',
      reviewingDoctorName: doc?.fullName || 'Assigned Physician',
      reviewingDoctorLicense: doc?.licenseNumber || '',
      clinicalNotes: report.clinicalNotes,
      administrativeSummary: report.aiAdministrativeSummary,
      labValues: report.labValues || [],
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${report.reportRefNumber}.pdf"`);
    return res.send(pdfBuf);
  } catch (err) {
    console.error('Download PDF error:', err);
    return res.status(500).json({ error: 'Failed to download report PDF' });
  }
});

// Secure Expiring Link Verification for Patient Notification Access
app.post('/api/access/verify', async (req: Request, res: Response) => {
  try {
    await ensureSeeded();
    const { token, dateOfBirth } = req.body as { token?: string; dateOfBirth?: string };
    if (!token) return res.status(400).json({ error: 'Access token is required' });

    const [accessRow] = await db
      .select()
      .from(reportAccessTokens)
      .where(eq(reportAccessTokens.token, token));

    if (!accessRow) {
      return res.status(404).json({ error: 'Invalid or revoked secure report link.' });
    }
    if (new Date() > new Date(accessRow.expiresAt)) {
      return res.status(410).json({ error: 'This secure report link has expired.' });
    }

    const [pat] = await db.select().from(patients).where(eq(patients.id, accessRow.patientId));
    const [report] = await db
      .select()
      .from(medicalReports)
      .where(eq(medicalReports.id, accessRow.reportId));

    if (!pat || !report || !canReleaseReportToPatient(report.status)) {
      return res.status(403).json({ error: 'Report is not approved for patient release.' });
    }

    if (!dateOfBirth) {
      return res.json({
        requiresVerification: true,
        patientHint: pat.fullName.split(' ')[0] + ' ***',
        reportRefNumber: report.reportRefNumber,
      });
    }

    if (dateOfBirth.trim() !== pat.dateOfBirth) {
      return res.status(403).json({ error: 'Date of birth verification did not match.' });
    }

    await db
      .update(reportAccessTokens)
      .set({ accessCount: accessRow.accessCount + 1, lastAccessedAt: new Date() })
      .where(eq(reportAccessTokens.id, accessRow.id));

    await db
      .update(notifications)
      .set({ patientAccessedAt: new Date() })
      .where(and(eq(notifications.reportId, report.id), eq(notifications.patientId, pat.id)));

    const [hosp] = await db.select().from(hospitals).where(eq(hospitals.id, report.hospitalId));

    // Issue temporary patient session if linked or ephemeral viewer token
    const viewerToken = pat.userId
      ? signSessionToken(
          {
            userId: pat.userId,
            uid: `token-pat-${pat.id}`,
            email: pat.email || `${pat.patientRefNumber}@patient.local`,
            role: 'patient',
            hospitalId: pat.hospitalId,
            mfaVerified: true,
          },
          30
        )
      : null;

    return res.json({
      verified: true,
      report: {
        ...report,
        hospitalName: hosp?.name || '',
        patientName: pat.fullName,
        patientRefNumber: pat.patientRefNumber,
      },
      viewerToken,
    });
  } catch (err) {
    console.error('Token verify error:', err);
    return res.status(500).json({ error: 'Failed to verify secure report link' });
  }
});

// ==================== NOTIFICATIONS, RETRIES, SETTINGS, SUBSCRIPTIONS, ANALYTICS ====================

app.get('/api/notifications', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.authUser!;
    let rows;
    if (user.role === 'patient') {
      const [pat] = await db.select().from(patients).where(eq(patients.userId, user.id));
      if (!pat) return res.json([]);
      rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.patientId, pat.id))
        .orderBy(desc(notifications.createdAt));
    } else if (user.role === 'super_admin') {
      rows = await db.select().from(notifications).orderBy(desc(notifications.createdAt));
    } else {
      rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.hospitalId, user.hospitalId!))
        .orderBy(desc(notifications.createdAt));
    }
    return res.json(rows);
  } catch {
    return res.status(500).json({ error: 'Failed to load notifications' });
  }
});

app.post(
  '/api/notifications/:id/retry',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin', 'reception_staff'),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = Number(req.params.id);
      const [existing] = await db.select().from(notifications).where(eq(notifications.id, id));
      if (!existing) return res.status(404).json({ error: 'Notification not found' });
      if (!canAccessHospitalResource(req.authUser!, existing.hospitalId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const updated = await retryNotificationById(id, true);
      return res.json(updated);
    } catch {
      return res.status(500).json({ error: 'Failed to retry notification' });
    }
  }
);

app.post(
  '/api/reports/send-reminders',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const pending =
        user.role === 'super_admin'
          ? await db
              .select()
              .from(medicalReports)
              .where(eq(medicalReports.status, 'pending_verification'))
          : await db
              .select()
              .from(medicalReports)
              .where(
                and(
                  eq(medicalReports.hospitalId, user.hospitalId!),
                  eq(medicalReports.status, 'pending_verification')
                )
              );

      for (const r of pending) {
        await db
          .update(medicalReports)
          .set({ reminderSentAt: new Date() })
          .where(eq(medicalReports.id, r.id));
      }

      await logAudit({
        hospitalId: user.hospitalId,
        actorUserId: user.id,
        actorEmail: user.email,
        actorRole: user.role,
        action: 'PENDING_VERIFICATION_REMINDERS_SENT',
        resourceType: 'medical_report',
        details: { count: pending.length },
      });

      return res.json({ remindedCount: pending.length });
    } catch {
      return res.status(500).json({ error: 'Failed to dispatch reminders' });
    }
  }
);

app.get('/api/settings/integrations', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const credentials = getIntegrationCredentialsStatus();
    const hospId = req.authUser!.hospitalId;
    const [settings] = hospId
      ? await db
          .select()
          .from(notificationSettings)
          .where(eq(notificationSettings.hospitalId, hospId))
      : await db.select().from(notificationSettings).limit(1);

    return res.json({ credentials, settings: settings || null });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch integration status' });
  }
});

app.put(
  '/api/settings/integrations',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hospId = Number(req.body.hospitalId) || req.authUser!.hospitalId;
      if (!hospId) return res.status(400).json({ error: 'hospitalId required' });
      if (!canAccessHospitalResource(req.authUser!, hospId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const { maxRetries, retryDelayMinutes, pendingReminderHours, whatsappEnabled, sandboxMode } =
        req.body as Record<string, number | boolean>;

      const [updated] = await db
        .insert(notificationSettings)
        .values({
          hospitalId: hospId,
          maxRetries: Number(maxRetries ?? 3),
          retryDelayMinutes: Number(retryDelayMinutes ?? 15),
          pendingReminderHours: Number(pendingReminderHours ?? 12),
          whatsappEnabled: Boolean(whatsappEnabled ?? true),
          sandboxMode: Boolean(sandboxMode ?? true),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: notificationSettings.hospitalId,
          set: {
            maxRetries: Number(maxRetries ?? 3),
            retryDelayMinutes: Number(retryDelayMinutes ?? 15),
            pendingReminderHours: Number(pendingReminderHours ?? 12),
            whatsappEnabled: Boolean(whatsappEnabled ?? true),
            sandboxMode: Boolean(sandboxMode ?? true),
            updatedAt: new Date(),
          },
        })
        .returning();

      return res.json(updated);
    } catch {
      return res.status(500).json({ error: 'Failed to update notification settings' });
    }
  }
);

app.get(
  '/api/subscriptions',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const allSubs = await db.select().from(subscriptions);
      const allHosps = await db.select().from(hospitals);
      const hospMap = new Map(allHosps.map((h) => [h.id, h]));

      const filtered =
        user.role === 'super_admin'
          ? allSubs
          : allSubs.filter((s) => s.hospitalId === user.hospitalId);

      return res.json(
        filtered.map((s) => ({
          ...s,
          hospitalName: hospMap.get(s.hospitalId)?.name || '',
          hospitalCode: hospMap.get(s.hospitalId)?.code || '',
        }))
      );
    } catch {
      return res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
  }
);

app.put(
  '/api/subscriptions/:hospitalId',
  requireAuth,
  requireRoles('super_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const hospitalId = Number(req.params.hospitalId);
      const { planTier, status, billingCycle } = req.body as Record<string, string>;
      const tierMap: Record<string, { price: number; limit: number }> = {
        starter: { price: 1800, limit: 2500 },
        clinical_pro: { price: 4500, limit: 10000 },
        enterprise_network: { price: 9800, limit: 50000 },
      };
      const cfg = tierMap[planTier] || tierMap.clinical_pro;

      const [updated] = await db
        .update(subscriptions)
        .set({
          planTier: planTier || 'clinical_pro',
          monthlyPriceAed: cfg.price,
          maxReportsPerMonth: cfg.limit,
          ...(status ? { status } : {}),
          ...(billingCycle ? { billingCycle } : {}),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.hospitalId, hospitalId))
        .returning();

      return res.json(updated);
    } catch {
      return res.status(500).json({ error: 'Failed to update subscription' });
    }
  }
);

app.get('/api/analytics/dashboard', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureSeeded();
    const user = req.authUser!;
    const isSuper = user.role === 'super_admin';

    const allPatients = isSuper
      ? await db.select().from(patients)
      : await db.select().from(patients).where(eq(patients.hospitalId, user.hospitalId!));

    const allReports = isSuper
      ? await db.select().from(medicalReports)
      : await db.select().from(medicalReports).where(eq(medicalReports.hospitalId, user.hospitalId!));

    const allNotifs = isSuper
      ? await db.select().from(notifications)
      : await db.select().from(notifications).where(eq(notifications.hospitalId, user.hospitalId!));

    const todayStr = new Date().toISOString().slice(0, 10);
    const monthPrefix = todayStr.slice(0, 7);

    const kpis = {
      totalPatients: allPatients.length,
      totalReports: allReports.length,
      awaitingVerification: allReports.filter((r) => r.status === 'pending_verification').length,
      manualMatching: allReports.filter((r) => r.status === 'manual_matching').length,
      approvedReports: allReports.filter((r) => r.status === 'approved' || r.status === 'delivered').length,
      deliveredReports: allReports.filter((r) => r.status === 'delivered').length,
      failedNotifications: allNotifs.filter((n) => n.status === 'failed').length,
      uploadedToday: allReports.filter(
        (r) => new Date(r.uploadDate).toISOString().slice(0, 10) === todayStr
      ).length,
      uploadedThisMonth: allReports.filter((r) =>
        new Date(r.uploadDate).toISOString().slice(0, 7).startsWith(monthPrefix)
      ).length,
    };

    // Category distribution
    const catMap = new Map<string, number>();
    for (const r of allReports) {
      catMap.set(r.category, (catMap.get(r.category) || 0) + 1);
    }
    const categoryBreakdown = Array.from(catMap.entries()).map(([category, count]) => ({
      category,
      count,
    }));

    // Channel delivery stats
    const channelStats = ['email', 'whatsapp', 'sms'].map((ch) => {
      const items = allNotifs.filter((n) => n.channel === ch);
      return {
        channel: ch,
        delivered: items.filter((n) => n.status === 'delivered').length,
        failed: items.filter((n) => n.status === 'failed').length,
        total: items.length,
      };
    });

    // 7-day trend
    const dailyTrend: Array<{ date: string; uploaded: number; delivered: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const uploaded = allReports.filter(
        (r) => new Date(r.uploadDate).toISOString().slice(0, 10) === d
      ).length;
      const delivered = allReports.filter(
        (r) =>
          r.status === 'delivered' &&
          new Date(r.updatedAt).toISOString().slice(0, 10) === d
      ).length;
      dailyTrend.push({ date: d.slice(5), uploaded, delivered });
    }

    return res.json({ kpis, categoryBreakdown, channelStats, dailyTrend });
  } catch (err) {
    console.error('Analytics error:', err);
    return res.status(500).json({ error: 'Failed to compute analytics' });
  }
});

app.get(
  '/api/analytics/export',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const format = req.query.format === 'pdf' ? 'pdf' : 'csv';
      const isSuper = user.role === 'super_admin';

      const rows = isSuper
        ? await db.select().from(medicalReports).orderBy(desc(medicalReports.uploadDate))
        : await db
            .select()
            .from(medicalReports)
            .where(eq(medicalReports.hospitalId, user.hospitalId!))
            .orderBy(desc(medicalReports.uploadDate));

      const pats = await db.select().from(patients);
      const patMap = new Map(pats.map((p) => [p.id, p.fullName]));

      if (format === 'csv') {
        const header = 'ReportRef,PatientName,Category,ExaminationDate,Status,Version\n';
        const body = rows
          .map(
            (r) =>
              `"${r.reportRefNumber}","${r.patientId ? patMap.get(r.patientId) || '' : 'Unmatched'}","${r.category}","${r.examinationDate}","${r.status}",${r.version}`
          )
          .join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="medireport-admin-export.csv"');
        return res.send(header + body);
      }

      const [hosp] = user.hospitalId
        ? await db.select().from(hospitals).where(eq(hospitals.id, user.hospitalId))
        : [];
      const pdfBuf = await generateAdminSummaryPdf({
        title: 'MediReport Connect — Administrative Delivery Audit',
        hospitalName: hosp?.name || 'All Network Hospitals',
        generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
        metrics: [
          { label: 'Total Reports', value: String(rows.length) },
          {
            label: 'Delivered Reports',
            value: String(rows.filter((r) => r.status === 'delivered').length),
          },
          {
            label: 'Awaiting Verification',
            value: String(rows.filter((r) => r.status === 'pending_verification').length),
          },
        ],
        rows: rows.map((r) => ({
          ref: r.reportRefNumber,
          patient: r.patientId ? patMap.get(r.patientId) || 'N/A' : 'Unmatched',
          category: r.category,
          status: r.status,
          date: r.examinationDate,
        })),
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="medireport-admin-export.pdf"');
      return res.send(pdfBuf);
    } catch {
      return res.status(500).json({ error: 'Failed to export administrative report' });
    }
  }
);

app.get(
  '/api/audit-logs',
  requireAuth,
  requireRoles('super_admin', 'hospital_admin'),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const rows =
        user.role === 'super_admin'
          ? await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100)
          : await db
              .select()
              .from(auditLogs)
              .where(eq(auditLogs.hospitalId, user.hospitalId!))
              .orderBy(desc(auditLogs.createdAt))
              .limit(100);

      return res.json(rows);
    } catch {
      return res.status(500).json({ error: 'Failed to load audit logs' });
    }
  }
);

// Background retry interval (runs safely on interval without blocking startup)
const retryTimer = setInterval(() => {
  processDueNotificationRetries().catch(() => {});
}, 60000);
retryTimer.unref();

// ==================== FRONTEND SERVING (VITE DEV OR DIST PROD) ====================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MediReport Connect server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
