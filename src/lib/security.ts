import crypto from 'node:crypto';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(process.env.GEMINI_API_KEY || 'medireport-dev-secret-key').digest('hex');

export interface SessionPayload {
  userId: number;
  uid: string;
  email: string;
  role: string;
  hospitalId: number | null;
  mfaVerified: boolean;
  exp: number;
}

export function signSessionToken(payload: Omit<SessionPayload, 'exp'>, ttlMinutes = 120): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + ttlMinutes * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `mr_sess_${encoded}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token.startsWith('mr_sess_')) return null;
  const raw = token.slice('mr_sess_'.length);
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function generateSecureReportToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'text/plain',
]);

export function scanUploadedFile(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): { safe: boolean; status: 'clean' | 'quarantined'; reason?: string } {
  if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    return {
      safe: false,
      status: 'quarantined',
      reason: `Unsupported MIME type: ${mimeType}. Allowed: PDF, JPG, PNG, TXT.`,
    };
  }

  if (buffer.length > 15 * 1024 * 1024) {
    return {
      safe: false,
      status: 'quarantined',
      reason: 'File exceeds 15 MB security upload limit.',
    };
  }

  const headHex = buffer.subarray(0, 8).toString('hex').toLowerCase();
  const headText = buffer.subarray(0, 256).toString('utf8').toLowerCase();

  // Block PE/ELF executables or embedded script payloads
  if (headHex.startsWith('4d5a') || headHex.startsWith('7f454c46')) {
    return {
      safe: false,
      status: 'quarantined',
      reason: `Executable binary header detected in ${fileName}.`,
    };
  }
  if (headText.includes('<script') || headText.includes('javascript:')) {
    return {
      safe: false,
      status: 'quarantined',
      reason: `Active script payload detected in ${fileName}.`,
    };
  }

  return { safe: true, status: 'clean' };
}
