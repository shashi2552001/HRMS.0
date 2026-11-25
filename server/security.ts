import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { computeEffectivePermissions } from '../src/shared/rbac.ts';
import {
  RolePermissionsMap,
  StaffRole,
  StaffUser,
} from '../src/shared/types.ts';

const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

function getSessionSecret(): string {
  return process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : EPHEMERAL_FALLBACK_SECRET;
}

export interface SessionPayload {
  sub: string;
  sid?: string;
  jti: string;
  loginId: string;
  email: string;
  fullName: string;
  role: StaffRole;
  type: 'session';
  iat: number;
  exp: number;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

export function signToken(
  payload: Omit<SessionPayload, 'iat' | 'exp' | 'jti'>,
  expiresInSeconds = 60 * 60 * 8
): string {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: SessionPayload = {
    ...payload,
    jti: crypto.randomBytes(12).toString('hex'),
    iat: now,
    exp: now + expiresInSeconds,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', getSessionSecret()).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', getSessionSecret()).update(`${header}.${body}`).digest()
  );
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(base64UrlDecode(body)) as SessionPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function hashPasswordSync(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

export function hashTokenSha256(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateSecureOnboardingToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const specials = '@#$!';
  let pwd = '9HR';
  for (let i = 0; i < 7; i++) {
    pwd += chars[crypto.randomInt(0, chars.length)];
  }
  pwd += specials[crypto.randomInt(0, specials.length)];
  pwd += String(crypto.randomInt(10, 99));
  return pwd;
}

export function sanitizeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/[<>]/g, '')
    .trim();
}

export function sanitizeRecordStrings<T>(obj: T): T {
  if (typeof obj === 'string') {
    return sanitizeText(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeRecordStrings(item)) as unknown as T;
  }
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = sanitizeRecordStrings(v);
    }
    return out as T;
  }
  return obj;
}

export interface StaffUserRecord extends StaffUser {
  passwordHash: string;
  resetTokenHash?: string;
  resetTokenExpiresAt?: string;
  activationTokenHash?: string;
  activationTokenExpiresAt?: string;
}

export function toPublicStaffUser(
  user: StaffUserRecord,
  rolePermissions?: RolePermissionsMap
): StaffUser {
  const {
    passwordHash: _ph,
    resetTokenHash: _rth,
    resetTokenExpiresAt: _rte,
    activationTokenHash: _ath,
    activationTokenExpiresAt: _ate,
    ...safe
  } = user;

  // Strip any legacy 2FA properties if present on older stored objects
  const cleanSafe = { ...(safe as Record<string, unknown>) };
  delete cleanSafe.twoFactorEnabled;
  delete cleanSafe.twoFactorMethods;
  delete cleanSafe.recoveryCodesCount;
  delete cleanSafe.twoFactorSecret;
  delete cleanSafe.pendingTwoFactorSecret;
  delete cleanSafe.usedTotpSteps;
  delete cleanSafe.recoveryCodeHashes;

  const effectivePermissions = computeEffectivePermissions(
    user.role,
    rolePermissions,
    user.customPermissions
  );

  return {
    ...(cleanSafe as unknown as StaffUser),
    effectivePermissions,
  };
}

export function validateMagicBytes(
  buffer: Buffer,
  ext: string,
  mimeType: string
): { valid: boolean; reason?: string } {
  const normalizedExt = ext.toLowerCase();
  const allowedExts = ['.pdf', '.jpg', '.jpeg', '.png'];
  const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];

  if (!allowedExts.includes(normalizedExt)) {
    return { valid: false, reason: 'Only PDF, JPG, JPEG, and PNG files are allowed.' };
  }
  if (!allowedMimes.includes(mimeType.toLowerCase())) {
    return { valid: false, reason: 'Unsupported file MIME type.' };
  }
  if (buffer.length < 8) {
    return { valid: false, reason: 'File appears empty or corrupted.' };
  }

  if (normalizedExt === '.pdf') {
    const header = buffer.subarray(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      return { valid: false, reason: 'Invalid PDF file signature.' };
    }
    if (mimeType.toLowerCase() !== 'application/pdf') {
      return { valid: false, reason: 'File extension does not match MIME type.' };
    }
    return { valid: true };
  }

  if (normalizedExt === '.jpg' || normalizedExt === '.jpeg') {
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (!isJpeg) {
      return { valid: false, reason: 'Invalid JPEG file signature.' };
    }
    if (mimeType.toLowerCase() !== 'image/jpeg') {
      return { valid: false, reason: 'File extension does not match MIME type.' };
    }
    return { valid: true };
  }

  if (normalizedExt === '.png') {
    const isPng =
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a;
    if (!isPng) {
      return { valid: false, reason: 'Invalid PNG file signature.' };
    }
    if (mimeType.toLowerCase() !== 'image/png') {
      return { valid: false, reason: 'File extension does not match MIME type.' };
    }
    return { valid: true };
  }

  return { valid: false, reason: 'Unsupported file format.' };
}

export function escapeCsvCell(value: unknown): string {
  const str = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
