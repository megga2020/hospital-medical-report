import { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { adminAuth } from '../lib/firebase-admin.ts';
import { verifySessionToken } from '../lib/security.ts';
import { db } from '../db/index.ts';
import { users } from '../db/schema.ts';

export interface AuthenticatedUser {
  id: number;
  uid: string;
  email: string;
  fullName: string;
  role: string;
  hospitalId: number | null;
  branchId: number | null;
  departmentId: number | null;
  mfaEnabled: boolean;
  language: string;
}

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
  mfaVerified?: boolean;
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.auth === 'string' ? req.query.auth : undefined;
  const rawToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : queryToken;

  if (!rawToken) {
    return res.status(401).json({ error: 'Unauthorized: Missing authentication token' });
  }

  try {
    // 1. Check server-signed session token
    if (rawToken.startsWith('mr_sess_')) {
      const payload = verifySessionToken(rawToken);
      if (!payload) {
        return res.status(401).json({ error: 'Unauthorized: Session expired or invalid' });
      }
      const [dbUser] = await db.select().from(users).where(eq(users.id, payload.userId));
      if (!dbUser || !dbUser.isActive) {
        return res.status(401).json({ error: 'Unauthorized: Account disabled or missing' });
      }
      req.authUser = {
        id: dbUser.id,
        uid: dbUser.uid,
        email: dbUser.email,
        fullName: dbUser.fullName,
        role: dbUser.role,
        hospitalId: dbUser.hospitalId,
        branchId: dbUser.branchId,
        departmentId: dbUser.departmentId,
        mfaEnabled: dbUser.mfaEnabled,
        language: dbUser.language,
      };
      req.mfaVerified = payload.mfaVerified;
      return next();
    }

    // 2. Verify Firebase Auth ID Token
    const decoded = await adminAuth.verifyIdToken(rawToken);
    const email = decoded.email || `${decoded.uid}@firebase.local`;
    const displayName = decoded.name || email.split('@')[0];

    const [existing] = await db.select().from(users).where(eq(users.uid, decoded.uid));
    let dbUser = existing;
    if (!dbUser) {
      const [inserted] = await db
        .insert(users)
        .values({
          uid: decoded.uid,
          email,
          fullName: displayName,
          role: 'super_admin',
          mfaEnabled: false,
          language: 'en',
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: { email, lastLoginAt: new Date() },
        })
        .returning();
      dbUser = inserted;
    }

    req.authUser = {
      id: dbUser.id,
      uid: dbUser.uid,
      email: dbUser.email,
      fullName: dbUser.fullName,
      role: dbUser.role,
      hospitalId: dbUser.hospitalId,
      branchId: dbUser.branchId,
      departmentId: dbUser.departmentId,
      mfaEnabled: dbUser.mfaEnabled,
      language: dbUser.language,
    };
    req.mfaVerified = true;
    return next();
  } catch (err) {
    console.error('Authentication error:', err);
    return res.status(401).json({ error: 'Unauthorized: Invalid authentication token' });
  }
};

export function requireRoles(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      return res.status(403).json({
        error: `Forbidden: Role '${req.authUser.role}' lacks permission for this action.`,
      });
    }
    return next();
  };
}
