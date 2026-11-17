import { db } from './index.ts';
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
  subscriptions,
  users,
} from './schema.ts';
import { generateClinicalReportPdf } from '../lib/pdf-generator.ts';
import { computeSha256 } from '../lib/security.ts';

export async function seedDatabaseIfEmpty() {
  try {
    const existingHospitals = await db.select().from(hospitals).limit(1);
    if (existingHospitals.length > 0) {
      return;
    }

    console.log('Seeding synthetic MediReport Connect UAE clinical environment...');

    // 1. Hospitals
    const [alNoor, crescent] = await db
      .insert(hospitals)
      .values([
        {
          name: 'Al Noor Specialist Hospital',
          nameAr: 'مستشفى النور التخصصي',
          code: 'ALNOOR',
          licenseNumber: 'DOH-AUH-1042',
          emiratesJurisdiction: 'UAE-DOH (Abu Dhabi)',
          city: 'Abu Dhabi',
          phone: '+971-2-626-5000',
          email: 'records@alnoor-demo.ae',
          duplicateMatchRule: 'strict_id_and_dob',
          retentionDays: 3650,
        },
        {
          name: 'Crescent Diagnostic Medical Centre',
          nameAr: 'مركز الهلال التشخيصي الطبي',
          code: 'CRESCENT',
          licenseNumber: 'DHA-DXB-2088',
          emiratesJurisdiction: 'UAE-DHA (Dubai)',
          city: 'Dubai',
          phone: '+971-4-349-8800',
          email: 'info@crescent-demo.ae',
          duplicateMatchRule: 'fuzzy_name_and_phone',
          retentionDays: 3650,
        },
      ])
      .returning();

    // 2. Subscriptions & Notification Settings
    await db.insert(subscriptions).values([
      {
        hospitalId: alNoor.id,
        planTier: 'enterprise_network',
        monthlyPriceAed: 9800,
        maxReportsPerMonth: 50000,
        reportsUsedThisMonth: 1428,
        billingCycle: 'monthly',
        status: 'active',
        nextBillingDate: '2026-12-01',
      },
      {
        hospitalId: crescent.id,
        planTier: 'clinical_pro',
        monthlyPriceAed: 4500,
        maxReportsPerMonth: 10000,
        reportsUsedThisMonth: 412,
        billingCycle: 'monthly',
        status: 'active',
        nextBillingDate: '2026-12-01',
      },
    ]);

    await db.insert(notificationSettings).values([
      {
        hospitalId: alNoor.id,
        emailProvider: 'sandbox',
        whatsappEnabled: true,
        smsProvider: 'sandbox',
        maxRetries: 3,
        retryDelayMinutes: 15,
        pendingReminderHours: 12,
        sandboxMode: true,
      },
      {
        hospitalId: crescent.id,
        emailProvider: 'sandbox',
        whatsappEnabled: true,
        smsProvider: 'sandbox',
        maxRetries: 3,
        retryDelayMinutes: 15,
        pendingReminderHours: 12,
        sandboxMode: true,
      },
    ]);

    // 3. Branches
    const [auhMain, auhAlAin, dxbJumeirah] = await db
      .insert(hospitalBranches)
      .values([
        {
          hospitalId: alNoor.id,
          name: 'Khalifa Street Main Campus',
          nameAr: 'المقر الرئيسي - شارع خليفة',
          code: 'AUH-MAIN',
          city: 'Abu Dhabi',
          address: 'Khalifa Bin Zayed St, Al Markaziyah, Abu Dhabi',
          phone: '+971-2-626-5001',
        },
        {
          hospitalId: alNoor.id,
          name: 'Al Ain Diagnostic Wing',
          nameAr: 'جناح العين التشخيصي',
          code: 'AUH-ALAIN',
          city: 'Al Ain',
          address: 'Zayed Bin Sultan St, Al Ain',
          phone: '+971-3-764-2200',
        },
        {
          hospitalId: crescent.id,
          name: 'Jumeirah Medical Plaza',
          nameAr: 'بلازا جميرا الطبي',
          code: 'DXB-JUM',
          city: 'Dubai',
          address: 'Al Wasl Rd, Jumeirah 1, Dubai',
          phone: '+971-4-349-8810',
        },
      ])
      .returning();

    // 4. Departments
    const [deptHema, deptRadio, deptCardio, deptPath, deptCresGen] = await db
      .insert(departments)
      .values([
        {
          hospitalId: alNoor.id,
          branchId: auhMain.id,
          name: 'Hematology & Clinical Chemistry',
          nameAr: 'أمراض الدم والكيمياء السريرية',
          code: 'HEMA',
          headDoctorName: 'Dr. Evelyn Reed',
        },
        {
          hospitalId: alNoor.id,
          branchId: auhMain.id,
          name: 'Diagnostic Radiology & MRI',
          nameAr: 'الأشعة التشخيصية والرنين المغناطيسي',
          code: 'RADIO',
          headDoctorName: 'Dr. Tariq Al-Mansoori',
        },
        {
          hospitalId: alNoor.id,
          branchId: auhMain.id,
          name: 'Cardiology & Electrophysiology',
          nameAr: 'أمراض القلب وتخطيط القلب',
          code: 'CARD',
          headDoctorName: 'Dr. Evelyn Reed',
        },
        {
          hospitalId: alNoor.id,
          branchId: auhAlAin.id,
          name: 'Histopathology & Cytology',
          nameAr: 'علم الأنسجة المرضية',
          code: 'HISTO',
          headDoctorName: 'Dr. Fatima Al-Hashemi',
        },
        {
          hospitalId: crescent.id,
          branchId: dxbJumeirah.id,
          name: 'General Diagnostics & Ultrasound',
          nameAr: 'التشخيص العام والموجات فوق الصوتية',
          code: 'GENDX',
          headDoctorName: 'Dr. Omar Al-Suwaidi',
        },
      ])
      .returning();

    // 5. Laboratories
    const [labCore, labImaging, labCres] = await db
      .insert(laboratories)
      .values([
        {
          hospitalId: alNoor.id,
          branchId: auhMain.id,
          name: 'Al Noor Central Automated Lab',
          code: 'LAB-AUH-01',
          accreditation: 'CAP / ISO 15189',
          limsIntegrationType: 'HL7 FHIR R4 REST',
          apiKeyPrefix: 'mr_alnoor_01',
        },
        {
          hospitalId: alNoor.id,
          branchId: auhMain.id,
          name: 'Al Noor PACS Imaging Center',
          code: 'IMG-AUH-02',
          accreditation: 'DOH Imaging Tier-1',
          limsIntegrationType: 'DICOM / PACS Webhook',
          apiKeyPrefix: 'mr_alnoor_02',
        },
        {
          hospitalId: crescent.id,
          branchId: dxbJumeirah.id,
          name: 'Crescent Reference Lab',
          code: 'LAB-DXB-01',
          accreditation: 'ISO 15189',
          limsIntegrationType: 'LIMS REST Bridge',
          apiKeyPrefix: 'mr_cresc_01',
        },
      ])
      .returning();

    // 6. Demo Users across all 6 roles
    const [superAdminUser, hospAdminUser, labUser, doctorUser, receptionUser, patientUser, crescentAdminUser] =
      await db
        .insert(users)
        .values([
          {
            uid: 'demo-super-admin',
            email: 'platform.admin@medireport-demo.ae',
            fullName: 'Layla Al-Qasimi (Platform Director)',
            role: 'super_admin',
            hospitalId: null,
            mfaEnabled: true,
            mfaCode: '482910',
            language: 'en',
          },
          {
            uid: 'demo-hospital-admin',
            email: 'admin@alnoor-demo.ae',
            fullName: 'Khalid Al-Dhaheri (Hospital Admin)',
            role: 'hospital_admin',
            hospitalId: alNoor.id,
            branchId: auhMain.id,
            mfaEnabled: true,
            mfaCode: '482910',
            language: 'en',
          },
          {
            uid: 'demo-lab-staff',
            email: 'lab.jensen@alnoor-demo.ae',
            fullName: 'Sarah Jensen (Senior Lab Technologist)',
            role: 'lab_staff',
            hospitalId: alNoor.id,
            branchId: auhMain.id,
            departmentId: deptHema.id,
            mfaEnabled: false,
            language: 'en',
          },
          {
            uid: 'demo-doctor',
            email: 'dr.reed@alnoor-demo.ae',
            fullName: 'Dr. Evelyn Reed, MD (Chief Medical Officer)',
            role: 'doctor',
            hospitalId: alNoor.id,
            branchId: auhMain.id,
            departmentId: deptHema.id,
            mfaEnabled: true,
            mfaCode: '482910',
            language: 'en',
          },
          {
            uid: 'demo-reception',
            email: 'records@alnoor-demo.ae',
            fullName: 'Mariam Al-Mazrouei (Medical Records)',
            role: 'reception_staff',
            hospitalId: alNoor.id,
            branchId: auhMain.id,
            mfaEnabled: false,
            language: 'en',
          },
          {
            uid: 'demo-patient',
            email: 'rashid.mansoor@patient-demo.ae',
            fullName: 'Rashid Saif Al-Mansoor',
            role: 'patient',
            hospitalId: alNoor.id,
            branchId: auhMain.id,
            mfaEnabled: false,
            language: 'en',
          },
          {
            uid: 'demo-crescent-admin',
            email: 'admin@crescent-demo.ae',
            fullName: 'Nadia Al-Balooshi (Crescent Admin)',
            role: 'hospital_admin',
            hospitalId: crescent.id,
            branchId: dxbJumeirah.id,
            mfaEnabled: true,
            mfaCode: '482910',
            language: 'en',
          },
        ])
        .returning();

    // 7. Doctors
    const [drReed, drTariq, drFatima, drOmar] = await db
      .insert(doctors)
      .values([
        {
          userId: doctorUser.id,
          hospitalId: alNoor.id,
          branchId: auhMain.id,
          departmentId: deptHema.id,
          fullName: 'Dr. Evelyn Reed, MD',
          licenseNumber: 'DOH-MD-88412',
          specialty: 'Internal Medicine & Pathology',
          email: 'dr.reed@alnoor-demo.ae',
          phone: '+971-50-441-1001',
        },
        {
          hospitalId: alNoor.id,
          branchId: auhMain.id,
          departmentId: deptRadio.id,
          fullName: 'Dr. Tariq Al-Mansoori, FRCR',
          licenseNumber: 'DOH-MD-71209',
          specialty: 'Diagnostic Neuroradiology',
          email: 'dr.tariq@alnoor-demo.ae',
          phone: '+971-50-441-1002',
        },
        {
          hospitalId: alNoor.id,
          branchId: auhAlAin.id,
          departmentId: deptPath.id,
          fullName: 'Dr. Fatima Al-Hashemi, FCAP',
          licenseNumber: 'DOH-MD-65310',
          specialty: 'Anatomical Histopathology',
          email: 'dr.fatima@alnoor-demo.ae',
          phone: '+971-50-441-1003',
        },
        {
          hospitalId: crescent.id,
          branchId: dxbJumeirah.id,
          departmentId: deptCresGen.id,
          fullName: 'Dr. Omar Al-Suwaidi, MD',
          licenseNumber: 'DHA-MD-51904',
          specialty: 'Family & Diagnostic Medicine',
          email: 'dr.omar@crescent-demo.ae',
          phone: '+971-50-882-3300',
        },
      ])
      .returning();

    // 8. Synthetic Patients (UAE-style synthetic profiles)
    const [patRashid, patAmina, patYusuf, patHessa, patZaydUncertain, patCrescent] = await db
      .insert(patients)
      .values([
        {
          patientRefNumber: 'PAT-ALNO-100421',
          hospitalRegNumber: 'MRN-AUH-90412',
          fullName: 'Rashid Saif Al-Mansoor',
          dateOfBirth: '1984-05-14',
          gender: 'Male',
          email: 'rashid.mansoor@patient-demo.ae',
          mobileCountryCode: '+971',
          mobileNumber: '501122334',
          hospitalId: alNoor.id,
          branchId: auhMain.id,
          departmentId: deptHema.id,
          userId: patientUser.id,
          consentStatus: 'granted',
          needsManualVerification: false,
        },
        {
          patientRefNumber: 'PAT-ALNO-100422',
          hospitalRegNumber: 'MRN-AUH-90488',
          fullName: 'Amina Nasser Al-Ketbi',
          dateOfBirth: '1991-11-02',
          gender: 'Female',
          email: 'amina.ketbi@patient-demo.ae',
          mobileCountryCode: '+971',
          mobileNumber: '554433221',
          hospitalId: alNoor.id,
          branchId: auhMain.id,
          departmentId: deptRadio.id,
          consentStatus: 'granted',
          needsManualVerification: false,
        },
        {
          patientRefNumber: 'PAT-ALNO-100423',
          hospitalRegNumber: 'MRN-AUH-90510',
          fullName: 'Yusuf Kareem Haddad',
          dateOfBirth: '1976-02-23',
          gender: 'Male',
          email: 'yusuf.haddad@patient-demo.ae',
          mobileCountryCode: '+971',
          mobileNumber: '528877665',
          hospitalId: alNoor.id,
          branchId: auhMain.id,
          departmentId: deptCardio.id,
          consentStatus: 'granted',
          needsManualVerification: false,
        },
        {
          patientRefNumber: 'PAT-ALNO-100424',
          hospitalRegNumber: 'MRN-AUH-90545',
          fullName: 'Hessa Sultan Al-Nuaimi',
          dateOfBirth: '1968-09-19',
          gender: 'Female',
          email: 'hessa.nuaimi@patient-demo.ae',
          mobileCountryCode: '+971',
          mobileNumber: '567788990',
          hospitalId: alNoor.id,
          branchId: auhAlAin.id,
          departmentId: deptPath.id,
          consentStatus: 'granted',
          needsManualVerification: false,
        },
        {
          patientRefNumber: 'PAT-ALNO-100425',
          hospitalRegNumber: 'MRN-AUH-90599',
          fullName: 'Rashid S. Al-Mansoor (Pending Match)',
          dateOfBirth: '1984-05-14',
          gender: 'Male',
          email: '',
          mobileCountryCode: '+971',
          mobileNumber: '501122334',
          hospitalId: alNoor.id,
          branchId: auhMain.id,
          departmentId: deptHema.id,
          consentStatus: 'pending',
          needsManualVerification: true,
          duplicateCandidateId: null,
        },
        {
          patientRefNumber: 'PAT-CRES-200110',
          hospitalRegNumber: 'MRN-DXB-44102',
          fullName: 'Noura Majid Al-Falasi',
          dateOfBirth: '1994-07-08',
          gender: 'Female',
          email: 'noura.falasi@patient-demo.ae',
          mobileCountryCode: '+971',
          mobileNumber: '509988771',
          hospitalId: crescent.id,
          branchId: dxbJumeirah.id,
          departmentId: deptCresGen.id,
          consentStatus: 'granted',
          needsManualVerification: false,
        },
      ])
      .returning();

    // Update duplicate candidate link for uncertain patient
    await db.insert(patientConsents).values([
      {
        patientId: patRashid.id,
        hospitalId: alNoor.id,
        consentType: 'digital_report_delivery',
        status: 'granted',
        notes: 'Signed electronic consent at Khalifa Street reception desk.',
        recordedByUserId: receptionUser.id,
      },
      {
        patientId: patAmina.id,
        hospitalId: alNoor.id,
        consentType: 'digital_report_delivery',
        status: 'granted',
        notes: 'Patient opted in for Email & WhatsApp notifications.',
        recordedByUserId: receptionUser.id,
      },
      {
        patientId: patCrescent.id,
        hospitalId: crescent.id,
        consentType: 'digital_report_delivery',
        status: 'granted',
        notes: 'DHA Digital Consent Form #2088-91.',
        recordedByUserId: crescentAdminUser.id,
      },
    ]);

    await db.insert(notificationPreferences).values([
      {
        patientId: patRashid.id,
        emailEnabled: true,
        whatsappEnabled: true,
        smsEnabled: true,
        preferredChannel: 'email',
        preferredLanguage: 'en',
      },
      {
        patientId: patAmina.id,
        emailEnabled: true,
        whatsappEnabled: true,
        smsEnabled: false,
        preferredChannel: 'whatsapp',
        preferredLanguage: 'ar',
      },
      {
        patientId: patYusuf.id,
        emailEnabled: true,
        whatsappEnabled: false,
        smsEnabled: true,
        preferredChannel: 'sms',
        preferredLanguage: 'en',
      },
      {
        patientId: patHessa.id,
        emailEnabled: true,
        whatsappEnabled: true,
        smsEnabled: false,
        preferredChannel: 'email',
        preferredLanguage: 'en',
      },
      {
        patientId: patCrescent.id,
        emailEnabled: true,
        whatsappEnabled: true,
        smsEnabled: false,
        preferredChannel: 'email',
        preferredLanguage: 'en',
      },
    ]);

    // 9. Seed Medical Reports across statuses & categories
    const seedReports = [
      {
        reportRefNumber: 'MR-BLO-20261101',
        patientId: patRashid.id,
        hospitalId: alNoor.id,
        branchId: auhMain.id,
        departmentId: deptHema.id,
        laboratoryId: labCore.id,
        reviewingDoctorId: drReed.id,
        uploadedByUserId: labUser.id,
        category: 'Blood test reports',
        title: 'Comprehensive Metabolic & CBC Panel',
        examinationDate: '2026-11-12',
        sourceChannel: 'lims_integration',
        status: 'delivered',
        aiAdministrativeSummary:
          'Automated LIMS ingestion of 6 hematology and lipid parameters for Rashid Saif Al-Mansoor. All mandatory administrative fields verified.',
        aiMissingFields: [] as string[],
        aiConfidenceScore: 98,
        labValues: [
          { parameter: 'Hemoglobin (Hb)', value: '14.6', unit: 'g/dL', referenceRange: '13.5 - 17.5', flag: 'Normal' },
          { parameter: 'White Blood Cell Count', value: '6.8', unit: '10^9/L', referenceRange: '4.0 - 11.0', flag: 'Normal' },
          { parameter: 'Platelets', value: '248', unit: '10^9/L', referenceRange: '150 - 400', flag: 'Normal' },
          { parameter: 'Fasting Glucose', value: '5.3', unit: 'mmol/L', referenceRange: '3.9 - 5.6', flag: 'Normal' },
          { parameter: 'LDL Cholesterol', value: '3.6', unit: 'mmol/L', referenceRange: '< 3.4', flag: 'High' },
          { parameter: 'HbA1c', value: '5.5', unit: '%', referenceRange: '< 5.7', flag: 'Normal' },
        ],
        clinicalNotes: 'Reviewed and verified. Mildly elevated LDL noted; routine dietary follow-up recommended at next outpatient visit.',
        version: 1,
        isDuplicateFlagged: false,
        patientMatchedUncertain: false,
      },
      {
        reportRefNumber: 'MR-ECG-20261102',
        patientId: patRashid.id,
        hospitalId: alNoor.id,
        branchId: auhMain.id,
        departmentId: deptCardio.id,
        laboratoryId: labCore.id,
        reviewingDoctorId: drReed.id,
        uploadedByUserId: labUser.id,
        category: 'ECG reports',
        title: '12-Lead Resting Electrocardiogram',
        examinationDate: '2026-11-15',
        sourceChannel: 'pdf_upload',
        status: 'delivered',
        aiAdministrativeSummary:
          '12-lead ECG PDF parsed with sinus rhythm parameters and interval measurements.',
        aiMissingFields: [] as string[],
        aiConfidenceScore: 96,
        labValues: [
          { parameter: 'Heart Rate', value: '71', unit: 'bpm', referenceRange: '60 - 100', flag: 'Normal' },
          { parameter: 'PR Interval', value: '158', unit: 'ms', referenceRange: '120 - 200', flag: 'Normal' },
          { parameter: 'QRS Duration', value: '88', unit: 'ms', referenceRange: '70 - 100', flag: 'Normal' },
          { parameter: 'QTc Interval', value: '412', unit: 'ms', referenceRange: '< 450', flag: 'Normal' },
        ],
        clinicalNotes: 'Normal sinus rhythm. No acute ST-T wave changes observed.',
        version: 1,
        isDuplicateFlagged: false,
        patientMatchedUncertain: false,
      },
      {
        reportRefNumber: 'MR-MRI-20261103',
        patientId: patRashid.id,
        hospitalId: alNoor.id,
        branchId: auhMain.id,
        departmentId: deptRadio.id,
        laboratoryId: labImaging.id,
        reviewingDoctorId: drTariq.id,
        uploadedByUserId: labUser.id,
        category: 'MRI reports',
        title: 'Lumbar Spine MRI Without Contrast',
        examinationDate: '2026-11-16',
        sourceChannel: 'hms_integration',
        status: 'pending_verification',
        aiAdministrativeSummary:
          'PACS radiology report extracted for Lumbar Spine MRI. Awaiting reviewing physician sign-off before patient release.',
        aiMissingFields: [] as string[],
        aiConfidenceScore: 94,
        labValues: [
          { parameter: 'L4-L5 Disc Space', value: 'Mild bulge', unit: 'Imaging', referenceRange: 'Intact', flag: 'Review' },
          { parameter: 'Conus Medullaris', value: 'Terminates L1', unit: 'Imaging', referenceRange: 'T12-L1', flag: 'Normal' },
        ],
        clinicalNotes: '',
        version: 1,
        isDuplicateFlagged: false,
        patientMatchedUncertain: false,
      },
      {
        reportRefNumber: 'MR-URI-20261104',
        patientId: patAmina.id,
        hospitalId: alNoor.id,
        branchId: auhMain.id,
        departmentId: deptHema.id,
        laboratoryId: labCore.id,
        reviewingDoctorId: drReed.id,
        uploadedByUserId: labUser.id,
        category: 'Urine test reports',
        title: 'Complete Urinalysis & Microscopy',
        examinationDate: '2026-11-14',
        sourceChannel: 'pdf_upload',
        status: 'approved',
        aiAdministrativeSummary:
          'Urinalysis chemistry and microscopy fields extracted cleanly. Approved by Dr. Evelyn Reed.',
        aiMissingFields: [] as string[],
        aiConfidenceScore: 97,
        labValues: [
          { parameter: 'Specific Gravity', value: '1.018', unit: 'ratio', referenceRange: '1.005 - 1.030', flag: 'Normal' },
          { parameter: 'Urine pH', value: '6.0', unit: 'pH', referenceRange: '5.0 - 8.0', flag: 'Normal' },
          { parameter: 'Leukocyte Esterase', value: 'Negative', unit: 'qual', referenceRange: 'Negative', flag: 'Normal' },
        ],
        clinicalNotes: 'Normal urinalysis findings.',
        version: 1,
        isDuplicateFlagged: false,
        patientMatchedUncertain: false,
      },
      {
        reportRefNumber: 'MR-CT-20261105',
        patientId: patYusuf.id,
        hospitalId: alNoor.id,
        branchId: auhMain.id,
        departmentId: deptRadio.id,
        laboratoryId: labImaging.id,
        reviewingDoctorId: drTariq.id,
        uploadedByUserId: labUser.id,
        category: 'CT scan reports',
        title: 'Chest High-Resolution CT Scan',
        examinationDate: '2026-11-16',
        sourceChannel: 'scanned_document',
        status: 'pending_verification',
        aiAdministrativeSummary:
          'Scanned radiology report OCR processed. High-resolution thoracic CT parameters recorded.',
        aiMissingFields: ['patientDobOnScan'],
        aiConfidenceScore: 89,
        labValues: [
          { parameter: 'Parenchyma Attenuation', value: 'Clear', unit: 'CT', referenceRange: 'Clear', flag: 'Normal' },
          { parameter: 'Mediastinal Nodes', value: 'Sub-centimeter', unit: 'mm', referenceRange: '< 10 mm', flag: 'Normal' },
        ],
        clinicalNotes: '',
        version: 1,
        isDuplicateFlagged: false,
        patientMatchedUncertain: false,
      },
      {
        reportRefNumber: 'MR-HIS-20261106',
        patientId: patHessa.id,
        hospitalId: alNoor.id,
        branchId: auhAlAin.id,
        departmentId: deptPath.id,
        laboratoryId: labCore.id,
        reviewingDoctorId: drFatima.id,
        uploadedByUserId: labUser.id,
        category: 'Histopathology reports',
        title: 'Gastric Antral Biopsy Histopathology',
        examinationDate: '2026-11-13',
        sourceChannel: 'manual_entry',
        status: 'correction_requested',
        aiAdministrativeSummary:
          'Histopathology specimen record submitted from Al Ain wing. Reviewing pathologist requested stain clarification.',
        aiMissingFields: ['immunohistochemistryLot'],
        aiConfidenceScore: 91,
        labValues: [
          { parameter: 'Specimen Blocks', value: '2 blocks', unit: 'count', referenceRange: 'Verified', flag: 'Normal' },
          { parameter: 'H. pylori Stain', value: 'Pending Giemsa', unit: 'qual', referenceRange: 'Negative', flag: 'Review' },
        ],
        clinicalNotes: 'Please attach the supplemental Giemsa stain confirmation sheet before final sign-off.',
        version: 1,
        isDuplicateFlagged: false,
        patientMatchedUncertain: false,
      },
      {
        reportRefNumber: 'MR-XRY-20261107',
        patientId: null,
        hospitalId: alNoor.id,
        branchId: auhMain.id,
        departmentId: deptRadio.id,
        laboratoryId: labImaging.id,
        reviewingDoctorId: drTariq.id,
        uploadedByUserId: labUser.id,
        category: 'X-ray reports',
        title: 'Right Wrist AP/Lateral Radiograph (Unmatched)',
        examinationDate: '2026-11-17',
        sourceChannel: 'image_upload',
        status: 'manual_matching',
        aiAdministrativeSummary:
          'Radiograph scan OCR detected partial name "Rashid Mansoor" without MRN. Routed to Medical Records for manual patient matching.',
        aiMissingFields: ['hospitalRegNumber', 'patientId'],
        aiConfidenceScore: 76,
        labValues: [
          { parameter: 'Distal Radius Cortex', value: 'Intact', unit: 'Radiograph', referenceRange: 'Intact', flag: 'Normal' },
        ],
        clinicalNotes: '',
        version: 1,
        isDuplicateFlagged: false,
        patientMatchedUncertain: true,
      },
      {
        reportRefNumber: 'MR-ULT-20261108',
        patientId: patCrescent.id,
        hospitalId: crescent.id,
        branchId: dxbJumeirah.id,
        departmentId: deptCresGen.id,
        laboratoryId: labCres.id,
        reviewingDoctorId: drOmar.id,
        uploadedByUserId: crescentAdminUser.id,
        category: 'Ultrasound reports',
        title: 'Abdominal & Hepatobiliary Ultrasound',
        examinationDate: '2026-11-15',
        sourceChannel: 'pdf_upload',
        status: 'delivered',
        aiAdministrativeSummary:
          'Crescent Diagnostic ultrasound report verified by Dr. Omar Al-Suwaidi.',
        aiMissingFields: [] as string[],
        aiConfidenceScore: 99,
        labValues: [
          { parameter: 'Liver Span', value: '13.2', unit: 'cm', referenceRange: '< 15.0', flag: 'Normal' },
          { parameter: 'Common Bile Duct', value: '4.1', unit: 'mm', referenceRange: '< 6.0', flag: 'Normal' },
        ],
        clinicalNotes: 'Unremarkable abdominal ultrasound.',
        version: 1,
        isDuplicateFlagged: false,
        patientMatchedUncertain: false,
      },
    ];

    const insertedReports = [];
    for (const r of seedReports) {
      const [inserted] = await db.insert(medicalReports).values(r).returning();
      insertedReports.push(inserted);

      const hosp = r.hospitalId === alNoor.id ? alNoor : crescent;
      const pat =
        [patRashid, patAmina, patYusuf, patHessa, patCrescent].find((p) => p.id === r.patientId) ||
        patRashid;
      const doc = [drReed, drTariq, drFatima, drOmar].find((d) => d.id === r.reviewingDoctorId) || drReed;

      const pdfBuffer = await generateClinicalReportPdf({
        reportRefNumber: inserted.reportRefNumber,
        title: inserted.title,
        category: inserted.category,
        status: inserted.status,
        version: inserted.version,
        examinationDate: inserted.examinationDate,
        uploadDate: new Date().toISOString().slice(0, 10),
        hospitalName: hosp.name,
        hospitalLicense: hosp.licenseNumber,
        branchName: r.branchId === auhAlAin.id ? auhAlAin.name : hosp.city,
        departmentName: 'Clinical Diagnostics',
        patientName: r.patientId ? pat.fullName : 'Pending Manual Patient Match',
        patientRefNumber: r.patientId ? pat.patientRefNumber : 'UNMATCHED',
        hospitalRegNumber: r.patientId ? pat.hospitalRegNumber : 'PENDING',
        patientDob: r.patientId ? pat.dateOfBirth : 'N/A',
        reviewingDoctorName: doc.fullName,
        reviewingDoctorLicense: doc.licenseNumber,
        clinicalNotes: inserted.clinicalNotes,
        administrativeSummary: inserted.aiAdministrativeSummary,
        labValues: inserted.labValues || [],
      });

      await db.insert(reportAttachments).values({
        reportId: inserted.id,
        version: 1,
        fileName: `${inserted.reportRefNumber}.pdf`,
        mimeType: 'application/pdf',
        fileSizeBytes: pdfBuffer.length,
        sha256Checksum: computeSha256(pdfBuffer),
        malwareScanStatus: 'clean',
        fileDataBase64: pdfBuffer.toString('base64'),
      });
    }

    // 10. Approvals & Notifications
    const [cbcReport, ecgReport, , urineReport, , histoReport, , crescentReport] = insertedReports;

    await db.insert(reportApprovals).values([
      {
        reportId: cbcReport.id,
        reviewerUserId: doctorUser.id,
        reviewerDoctorId: drReed.id,
        action: 'approved',
        clinicalComments: 'Verified and released for patient delivery.',
        version: 1,
      },
      {
        reportId: ecgReport.id,
        reviewerUserId: doctorUser.id,
        reviewerDoctorId: drReed.id,
        action: 'approved',
        clinicalComments: 'Normal sinus rhythm verified.',
        version: 1,
      },
      {
        reportId: urineReport.id,
        reviewerUserId: doctorUser.id,
        reviewerDoctorId: drReed.id,
        action: 'approved',
        clinicalComments: 'Normal urinalysis.',
        version: 1,
      },
      {
        reportId: histoReport.id,
        reviewerUserId: doctorUser.id,
        reviewerDoctorId: drFatima.id,
        action: 'correction_requested',
        clinicalComments: 'Attach Giemsa stain confirmation sheet.',
        version: 1,
      },
    ]);

    const tok1 = 'demo-secure-tok-cbc-9910';
    const tok2 = 'demo-secure-tok-ecg-9911';
    const tok3 = 'demo-secure-tok-uri-9912';

    await db.insert(reportAccessTokens).values([
      {
        reportId: cbcReport.id,
        patientId: patRashid.id,
        token: tok1,
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        accessCount: 1,
        lastAccessedAt: new Date(),
      },
      {
        reportId: ecgReport.id,
        patientId: patRashid.id,
        token: tok2,
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        accessCount: 0,
      },
      {
        reportId: urineReport.id,
        patientId: patAmina.id,
        token: tok3,
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        accessCount: 0,
      },
    ]);

    await db.insert(notifications).values([
      {
        reportId: cbcReport.id,
        patientId: patRashid.id,
        hospitalId: alNoor.id,
        channel: 'email',
        recipient: patRashid.email,
        messageBody: `Dear ${patRashid.fullName},\n\nYour medical report from ${alNoor.name} is now available.\n\nPlease log in to your secure MediReport Connect account to view and download your report.`,
        secureAccessUrl: `/?access_token=${tok1}`,
        status: 'delivered',
        providerMessageId: 'sandbox-email-1001',
        sentAt: new Date(Date.now() - 3600 * 1000),
        deliveredAt: new Date(Date.now() - 3590 * 1000),
        patientAccessedAt: new Date(Date.now() - 1800 * 1000),
      },
      {
        reportId: ecgReport.id,
        patientId: patRashid.id,
        hospitalId: alNoor.id,
        channel: 'whatsapp',
        recipient: '+971501122334',
        messageBody: `Dear ${patRashid.fullName},\n\nYour medical report from ${alNoor.name} is now available.`,
        secureAccessUrl: `/?access_token=${tok2}`,
        status: 'delivered',
        providerMessageId: 'sandbox-wa-1002',
        sentAt: new Date(Date.now() - 1200 * 1000),
        deliveredAt: new Date(Date.now() - 1190 * 1000),
      },
      {
        reportId: urineReport.id,
        patientId: patAmina.id,
        hospitalId: alNoor.id,
        channel: 'whatsapp',
        recipient: '+971554433221',
        messageBody: `Dear ${patAmina.fullName},\n\nYour medical report from ${alNoor.name} is now available.`,
        secureAccessUrl: `/?access_token=${tok3}`,
        status: 'failed',
        retryCount: 1,
        maxRetries: 3,
        nextRetryAt: new Date(Date.now() + 600 * 1000),
        errorMessage: 'WhatsApp Gateway 504: Upstream carrier transient timeout (queued for retry)',
        sentAt: new Date(Date.now() - 900 * 1000),
      },
      {
        reportId: crescentReport.id,
        patientId: patCrescent.id,
        hospitalId: crescent.id,
        channel: 'email',
        recipient: patCrescent.email,
        messageBody: `Dear ${patCrescent.fullName},\n\nYour medical report from ${crescent.name} is now available.`,
        secureAccessUrl: '/?access_token=demo-crescent',
        status: 'delivered',
        providerMessageId: 'sandbox-email-1004',
        sentAt: new Date(Date.now() - 7200 * 1000),
        deliveredAt: new Date(Date.now() - 7190 * 1000),
      },
    ]);

    await db.insert(auditLogs).values([
      {
        hospitalId: alNoor.id,
        actorUserId: superAdminUser.id,
        actorEmail: superAdminUser.email,
        actorRole: 'super_admin',
        action: 'HOSPITAL_REGISTERED',
        resourceType: 'hospital',
        resourceId: String(alNoor.id),
        details: { license: alNoor.licenseNumber, jurisdiction: alNoor.emiratesJurisdiction },
      },
      {
        hospitalId: alNoor.id,
        actorUserId: hospAdminUser.id,
        actorEmail: hospAdminUser.email,
        actorRole: 'hospital_admin',
        action: 'LABORATORY_CONFIGURED',
        resourceType: 'laboratory',
        resourceId: String(labCore.id),
        details: { limsType: labCore.limsIntegrationType },
      },
      {
        hospitalId: alNoor.id,
        actorUserId: doctorUser.id,
        actorEmail: doctorUser.email,
        actorRole: 'doctor',
        action: 'REPORT_APPROVED_AND_RELEASED',
        resourceType: 'medical_report',
        resourceId: cbcReport.reportRefNumber,
        details: { version: 1, automaticDelivery: true },
      },
    ]);

    console.log('MediReport Connect synthetic seed complete.');
  } catch (err) {
    console.error('Seed error (non-fatal):', err);
  }
}
