import cors from 'cors';
import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import helmet from 'helmet';
import multer from 'multer';
import path from 'path';
import {
  ALL_MODULES,
  ALL_PERMISSION_ACTIONS,
  ALL_STAFF_ROLES,
  computeEffectivePermissions,
  DEFAULT_ROLE_PERMISSIONS,
  getDashboardPathForRole,
  hasPermission,
} from '../src/shared/rbac.ts';
import {
  AccountStatus,
  AnalyticsSummary,
  AppModule,
  AuditLog,
  Candidate,
  CandidateDocument,
  DOCUMENT_CATEGORIES,
  Employee,
  ModulePermissions,
  ONBOARDING_STATUSES,
  OnboardingStatus,
  OnboardingToken,
  PayrollEntry,
  PayrollRun,
  PermissionAction,
  REQUIRED_DOCUMENT_CATEGORIES,
  StaffRole,
} from '../src/shared/types.ts';
import {
  addressInfoSchema,
  attendanceSchema,
  bankDetailsSchema,
  calculateCompletionPercentage,
  createCandidateSchema,
  createStaffSchema,
  declarationSchema,
  documentCategorySchema,
  educationInfoSchema,
  employeeSelfUpdateSchema,
  employmentInfoSchema,
  familyInfoSchema,
  leaveRequestSchema,
  loginSchema,
  meetingCreateSchema,
  messageCreateSchema,
  payrollCreateSchema,
  personalInfoSchema,
  statusUpdateSchema,
  strongPasswordSchema,
} from '../src/shared/validation.ts';
import {
  getOptionalFirebaseConfig,
  getRuntimeSecurityConfig,
  isFirebaseConfigured,
} from './config.ts';
import { dispatchNotificationEmail, isSmtpConfigured } from './mailer.ts';
import {
  escapeCsvCell,
  generateSecureOnboardingToken,
  generateTempPassword,
  hashPassword,
  hashPasswordSync,
  hashTokenSha256,
  sanitizeRecordStrings,
  sanitizeText,
  signToken,
  StaffUserRecord,
  toPublicStaffUser,
  validateMagicBytes,
  verifyPassword,
  verifyToken,
} from './security.ts';
import {
  buildSeedDatabase,
  PortalDatabase,
  PortalStore,
  ServerSession,
} from './store.ts';

interface AuthStaffContext {
  id: string;
  sid: string;
  loginId: string;
  email: string;
  fullName: string;
  role: StaffRole;
  department: string;
  isDemo: boolean;
  mustChangePassword: boolean;
  employeeId?: string;
  effectivePermissions: ModulePermissions;
  usedBearerAuth: boolean;
}

interface AuthRequest extends Request {
  staffUser?: AuthStaffContext;
}

const SESSION_COOKIE_NAME = 'ninehr_session';
const REFRESH_COOKIE_NAME = 'ninehr_refresh';

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      try {
        result[k] = decodeURIComponent(v);
      } catch {
        result[k] = v;
      }
    }
  }
  return result;
}

function isSecureCookieRequest(req: Request): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https'
  );
}

function setAuthCookies(
  req: Request,
  res: Response,
  accessToken: string,
  refreshToken: string,
  rememberMe: boolean
): void {
  const secure = isSecureCookieRequest(req);
  const rt = getRuntimeSecurityConfig();
  const maxAgeMs = rememberMe
    ? 7 * 24 * 60 * 60 * 1000
    : rt.sessionMaxLifetimeHours * 60 * 60 * 1000;

  res.cookie(SESSION_COOKIE_NAME, accessToken, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    ...(secure ? { partitioned: true } : {}),
    maxAge: maxAgeMs,
    path: '/',
  });
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    sameSite: secure ? 'none' : 'lax',
    secure,
    ...(secure ? { partitioned: true } : {}),
    maxAge: maxAgeMs,
    path: '/api/auth',
  });
}

function clearAuthCookies(res: Response): void {
  const secure = res.req ? isSecureCookieRequest(res.req) : false;
  const opts = secure
    ? { httpOnly: true, sameSite: 'none' as const, secure: true, partitioned: true }
    : { httpOnly: true, sameSite: 'lax' as const, secure: false };
  res.clearCookie(SESSION_COOKIE_NAME, { ...opts, path: '/' });
  res.clearCookie(REFRESH_COOKIE_NAME, { ...opts, path: '/api/auth' });
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || '127.0.0.1';
}

function getUserAgent(req: Request): string {
  return sanitizeText(req.headers['user-agent'] || 'Unknown Client').slice(0, 180);
}

function appendAudit(
  db: PortalDatabase,
  params: {
    actorId: string;
    actorName: string;
    actorRole: string;
    action: string;
    targetType: AuditLog['targetType'];
    targetId: string;
    result?: AuditLog['result'];
    details: string;
    ipAddress: string;
    metadata?: Record<string, string | number | boolean>;
  }
) {
  db.auditLogs.unshift({
    id: `aud-${crypto.randomBytes(6).toString('hex')}`,
    result: params.result || 'SUCCESS',
    ...params,
    timestamp: new Date().toISOString(),
  });
  if (db.auditLogs.length > 2000) {
    db.auditLogs.length = 2000;
  }
}

function appendLoginHistory(
  db: PortalDatabase,
  params: {
    userId: string;
    loginId: string;
    email: string;
    fullName: string;
    role: string;
    method: 'PASSWORD' | 'GOOGLE_SSO' | 'ACTIVATION';
    status: 'SUCCESS' | 'FAILED' | 'LOCKED';
    reason?: string;
    ipAddress: string;
    userAgent: string;
  }
) {
  db.loginHistory.unshift({
    id: `lh-${crypto.randomBytes(6).toString('hex')}`,
    ...params,
    timestamp: new Date().toISOString(),
  });
  if (db.loginHistory.length > 2000) {
    db.loginHistory.length = 2000;
  }
}

function isRecordAllowedForUser(
  user: Pick<AuthStaffContext, 'isDemo'>,
  record: { isDemo?: boolean; createdByIsDemo?: boolean }
): boolean {
  if (!user.isDemo) return true;
  return Boolean(record.isDemo || record.createdByIsDemo);
}

function isActiveTokenRecord(t: OnboardingToken): boolean {
  return !t.isRevoked && !t.consumedAt && new Date(t.expiresAt).getTime() > Date.now();
}

function serializeTokenMeta(t: OnboardingToken) {
  return {
    id: t.id,
    candidateId: t.candidateId,
    tokenPrefix: t.tokenPrefix,
    expiresAt: t.expiresAt,
    isRevoked: t.isRevoked,
    consumedAt: t.consumedAt,
    firstAccessedAt: t.firstAccessedAt,
    redemptionCount: t.redemptionCount ?? 0,
    createdAt: t.createdAt,
    createdByName: t.createdByName,
    lastAccessedAt: t.lastAccessedAt,
  };
}

function redactCandidateForRole(candidate: Candidate, role: StaffRole): Candidate {
  if (role !== 'RECRUITER') return candidate;
  return {
    ...candidate,
    employmentInfo: {
      ...candidate.employmentInfo,
      previousSalary: candidate.employmentInfo.previousSalary ? '[Restricted]' : '',
    },
    bankDetails: {
      accountHolderName: candidate.bankDetails.accountHolderName ? '[Restricted]' : '',
      bankName: candidate.bankDetails.bankName ? '[Restricted]' : '',
      accountNumber: '',
      ifscCode: '',
    },
  };
}

function redactEmployeeForRole(employee: Employee, role: StaffRole, isSelf: boolean): Employee {
  if (['SUPER_ADMIN', 'ADMIN', 'HR', 'PAYROLL', 'FINANCE'].includes(role) || isSelf) {
    return employee;
  }
  const copy = { ...employee };
  delete copy.bankDetails;
  delete copy.monthlyCtc;
  copy.employmentInfo = {
    ...copy.employmentInfo,
    previousSalary: undefined,
  };
  return copy;
}

function maskAccountNumber(acc: string): string {
  const clean = (acc || '').trim();
  if (clean.length <= 4) return '••••';
  return `••••••••${clean.slice(-4)}`;
}

function getManagedEmployeeIds(db: PortalDatabase, managerUserId: string): Set<string> {
  const ids = new Set<string>();
  for (const e of db.employees) {
    if (e.reportingManagerId === managerUserId) {
      ids.add(e.id);
    }
  }
  for (const u of db.users) {
    if (u.reportingManagerId === managerUserId && u.employeeId) {
      ids.add(u.employeeId);
    }
  }
  return ids;
}

function createSessionForUser(
  tx: PortalDatabase,
  user: StaffUserRecord,
  req: Request,
  rememberMe: boolean
): { session: ServerSession; accessToken: string; refreshToken: string } {
  const rt = getRuntimeSecurityConfig();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const maxLifetimeMs = rememberMe
    ? Math.max(rt.sessionMaxLifetimeHours, 24 * 7) * 3600 * 1000
    : rt.sessionMaxLifetimeHours * 3600 * 1000;
  const sid = `ses-${crypto.randomBytes(12).toString('hex')}`;

  const accessToken = signToken(
    {
      sub: user.id,
      sid,
      loginId: user.loginId,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      type: 'session',
    },
    Math.floor(maxLifetimeMs / 1000)
  );
  const refreshToken = crypto.randomBytes(32).toString('hex');

  const session: ServerSession = {
    id: sid,
    userId: user.id,
    tokenHash: hashTokenSha256(accessToken),
    refreshTokenHash: hashTokenSha256(refreshToken),
    rememberMe,
    ipAddress: getClientIp(req),
    userAgent: getUserAgent(req),
    createdAt: nowIso,
    lastActivityAt: nowIso,
    expiresAt: new Date(now + maxLifetimeMs).toISOString(),
  };
  tx.sessions.unshift(session);
  if (tx.sessions.length > 2000) {
    tx.sessions.length = 2000;
  }
  return { session, accessToken, refreshToken };
}

function revokeUserSessions(
  tx: PortalDatabase,
  userId: string,
  reason: string,
  exceptSessionId?: string
): number {
  const nowIso = new Date().toISOString();
  let count = 0;
  for (const s of tx.sessions) {
    if (s.userId === userId && !s.revokedAt && s.id !== exceptSessionId) {
      s.revokedAt = nowIso;
      s.revokedReason = reason;
      count += 1;
    }
  }
  return count;
}

export function createApp(options?: {
  store?: PortalStore;
  disableRateLimit?: boolean;
}) {
  const store = options?.store ?? new PortalStore();
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    })
  );

  app.use(
    cors({
      origin: (origin, cb) => cb(null, origin || true),
      credentials: true,
    })
  );

  app.use(express.json({ limit: '2mb' }));

  const authLimiter = options?.disableRateLimit
    ? (_req: Request, _res: Response, next: NextFunction) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 40,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
      });

  const apiLimiter = options?.disableRateLimit
    ? (_req: Request, _res: Response, next: NextFunction) => next()
    : rateLimit({
        windowMs: 60 * 1000,
        limit: 300,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Rate limit exceeded. Please slow down requests.' },
      });

  app.use('/api', apiLimiter);

  // CSRF check for cookie-authenticated mutations
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const cookies = parseCookies(req);
    const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
    const hasSessionCookie = Boolean(cookies[SESSION_COOKIE_NAME] || cookies[REFRESH_COOKIE_NAME]);
    if (hasSessionCookie && !hasBearer) {
      const xrw = req.headers['x-requested-with'];
      const origin = req.headers.origin;
      const host = req.get('host');
      const originMatches =
        typeof origin === 'string' &&
        host &&
        (() => {
          try {
            return new URL(origin).host === host;
          } catch {
            return false;
          }
        })();
      if (xrw !== 'XMLHttpRequest' && !originMatches) {
        return res.status(403).json({ error: 'CSRF validation failed.' });
      }
    }
    return next();
  });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 5 * 1024 * 1024,
      files: 1,
    },
  });

  // ---------------------------------------------------------------------------
  // Authentication & RBAC Middlewares (Server-Side Deny-By-Default)
  // ---------------------------------------------------------------------------
  const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const cookies = parseCookies(req);
    const usedBearerAuth = Boolean(authHeader && authHeader.startsWith('Bearer '));
    const rawToken = usedBearerAuth
      ? authHeader!.slice(7).trim()
      : cookies[SESSION_COOKIE_NAME];

    if (!rawToken) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }

    const payload = verifyToken(rawToken);
    if (!payload || payload.type !== 'session' || !payload.sid) {
      return res.status(401).json({ error: 'Session invalid or expired. Please sign in again.' });
    }

    const db = store.getSnapshot();
    const session = db.sessions.find((s) => s.id === payload.sid && s.userId === payload.sub);
    if (!session || session.revokedAt) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Session has been revoked or signed out.' });
    }

    const tokenHash = hashTokenSha256(rawToken);
    if (session.tokenHash !== tokenHash) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Session token is no longer active.' });
    }

    const nowMs = Date.now();
    if (new Date(session.expiresAt).getTime() <= nowMs) {
      await store.withTransaction((tx) => {
        const s = tx.sessions.find((item) => item.id === session.id);
        if (s && !s.revokedAt) {
          s.revokedAt = new Date(nowMs).toISOString();
          s.revokedReason = 'SESSION_EXPIRED';
        }
      });
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

    const idleLimitMs = (db.config.sessionIdleTimeoutMinutes || 30) * 60 * 1000;
    const lastActivityMs = new Date(session.lastActivityAt).getTime();
    if (nowMs - lastActivityMs > idleLimitMs) {
      await store.withTransaction((tx) => {
        const s = tx.sessions.find((item) => item.id === session.id);
        if (s && !s.revokedAt) {
          s.revokedAt = new Date(nowMs).toISOString();
          s.revokedReason = 'IDLE_TIMEOUT';
        }
      });
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Session timed out due to inactivity. Please sign in again.' });
    }

    const user = db.users.find((u) => u.id === payload.sub);
    if (!user) {
      return res.status(401).json({ error: 'Account no longer exists.' });
    }
    const status: AccountStatus = user.status || (user.isActive ? 'ACTIVE' : 'DEACTIVATED');
    if (status === 'SUSPENDED') {
      clearAuthCookies(res);
      return res.status(403).json({ error: 'Your account is suspended. Contact your Super Admin.' });
    }
    if (status === 'DEACTIVATED' || !user.isActive) {
      clearAuthCookies(res);
      return res.status(403).json({ error: 'Your account has been deactivated by an administrator.' });
    }
    if (status === 'PENDING_ACTIVATION') {
      clearAuthCookies(res);
      return res.status(403).json({ error: 'Account activation is pending. Use your activation link.' });
    }

    if (
      user.mustChangePassword &&
      user.tempPasswordExpiresAt &&
      new Date(user.tempPasswordExpiresAt).getTime() <= nowMs
    ) {
      return res.status(403).json({
        error: 'Temporary password expired. Request an activation link or password reset from Admin.',
        code: 'TEMP_PASSWORD_EXPIRED',
      });
    }

    // Update lastActivityAt when > 2s stale
    if (nowMs - lastActivityMs > 2000) {
      await store.withTransaction((tx) => {
        const s = tx.sessions.find((item) => item.id === session.id);
        if (s && !s.revokedAt) {
          s.lastActivityAt = new Date(nowMs).toISOString();
        }
      });
    }

    // Enforce mandatory password change before accessing portal APIs
    const passwordChangeAllowedPaths = [
      '/api/auth/me',
      '/api/auth/change-password',
      '/api/auth/logout',
      '/api/auth/logout-all',
      '/api/auth/sessions',
    ];
    if (user.mustChangePassword && !passwordChangeAllowedPaths.includes(req.path)) {
      return res.status(403).json({
        error: 'First-login password change is required before accessing portal resources.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    const effectivePermissions = computeEffectivePermissions(
      user.role,
      db.rolePermissions,
      user.customPermissions
    );

    req.staffUser = {
      id: user.id,
      sid: session.id,
      loginId: user.loginId,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      department: user.department,
      isDemo: Boolean(user.isDemo),
      mustChangePassword: Boolean(user.mustChangePassword),
      employeeId: user.employeeId,
      effectivePermissions,
      usedBearerAuth,
    };

    return next();
  };

  const requirePermission = (module: AppModule, action: PermissionAction = 'view') => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
      if (!req.staffUser) {
        return res.status(401).json({ error: 'Authentication required.' });
      }
      if (!hasPermission(req.staffUser.effectivePermissions, module, action)) {
        await store.withTransaction((tx) => {
          appendAudit(tx, {
            actorId: req.staffUser!.id,
            actorName: req.staffUser!.fullName,
            actorRole: req.staffUser!.role,
            action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
            targetType: 'RBAC',
            targetId: `${module}:${action}`,
            result: 'DENIED',
            details: `Denied ${req.method} ${req.originalUrl} — missing permission ${module}:${action}.`,
            ipAddress: getClientIp(req),
          });
        });
        return res.status(403).json({
          error: `Access denied. Required permission: ${module} (${action}).`,
        });
      }
      return next();
    };
  };

  const requireRole = (...allowedRoles: StaffRole[]) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
      if (!req.staffUser) {
        return res.status(401).json({ error: 'Authentication required.' });
      }
      if (!allowedRoles.includes(req.staffUser.role)) {
        await store.withTransaction((tx) => {
          appendAudit(tx, {
            actorId: req.staffUser!.id,
            actorName: req.staffUser!.fullName,
            actorRole: req.staffUser!.role,
            action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
            targetType: 'RBAC',
            targetId: req.originalUrl,
            result: 'DENIED',
            details: `Role ${req.staffUser!.role} denied access to ${req.method} ${req.originalUrl}.`,
            ipAddress: getClientIp(req),
          });
        });
        return res.status(403).json({
          error: `Access denied. Required role: ${allowedRoles.join(' or ')}.`,
        });
      }
      return next();
    };
  };

  // ---------------------------------------------------------------------------
  // Health Check
  // ---------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    const db = store.getSnapshot();
    res.json({
      status: 'ok',
      service: '9HR India Onboarding Portal',
      storageEngine: 'local-json',
      firebaseConfigured: isFirebaseConfigured(),
      smtpConfigured: isSmtpConfigured(),
      demoModeEnabled: db.config.demoModeEnabled,
    });
  });

  // ---------------------------------------------------------------------------
  // Authentication, Brute-Force Protection, Sessions & Account Lifecycle
  // ---------------------------------------------------------------------------
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid login credentials format.',
        });
      }

      const identifier = parsed.data.identifier.trim().toLowerCase();
      const password = parsed.data.password;
      const rememberMe = Boolean(parsed.data.rememberMe);
      const ipAddress = getClientIp(req);
      const userAgent = getUserAgent(req);
      const rt = getRuntimeSecurityConfig();

      const attemptKeyId = `id:${identifier}`;
      const attemptKeyIp = `ip:${ipAddress}:${identifier}`;
      const db = store.getSnapshot();

      const nowMs = Date.now();
      const idTracker = db.loginAttempts[attemptKeyId];
      const ipTracker = db.loginAttempts[attemptKeyIp];
      const lockedTracker = [idTracker, ipTracker].find(
        (tr) => tr?.lockedUntil && new Date(tr.lockedUntil).getTime() > nowMs
      );
      if (lockedTracker) {
        await store.withTransaction((tx) => {
          appendAudit(tx, {
            actorId: 'anonymous',
            actorName: identifier,
            actorRole: 'UNKNOWN',
            action: 'LOGIN_LOCKED_BLOCKED',
            targetType: 'AUTH',
            targetId: identifier,
            result: 'DENIED',
            details: `Blocked locked login attempt for "${identifier}".`,
            ipAddress,
          });
        });
        return res.status(429).json({
          error: `Too many failed attempts. Account sign-in temporarily locked for ${rt.loginLockoutMinutes} minutes.`,
          locked: true,
        });
      }

      const user = db.users.find(
        (u) =>
          u.loginId.toLowerCase() === identifier || u.email.toLowerCase() === identifier
      );

      // Block demo users if runtime demo mode was disabled
      if (user?.isDemo && (rt.isProduction || !db.config.demoModeEnabled)) {
        return res.status(401).json({ error: 'Invalid Login ID / Email or Password.' });
      }

      const recordFailure = async (failedUser?: StaffUserRecord, reason = 'Invalid credentials') => {
        return store.withTransaction((tx) => {
          const maxAttempts = tx.config.loginMaxAttempts || rt.loginMaxAttempts;
          const lockoutMinutes = tx.config.loginLockoutMinutes || rt.loginLockoutMinutes;
          let lockedNow = false;

          for (const key of [attemptKeyId, attemptKeyIp]) {
            const cur = tx.loginAttempts[key];
            const expiredWindow =
              !cur || nowMs - new Date(cur.firstFailedAt).getTime() > lockoutMinutes * 60 * 1000;
            const nextCount = expiredWindow ? 1 : cur.failedCount + 1;
            const lockedUntil =
              nextCount >= maxAttempts
                ? new Date(nowMs + lockoutMinutes * 60 * 1000).toISOString()
                : undefined;
            if (lockedUntil) lockedNow = true;
            tx.loginAttempts[key] = {
              failedCount: nextCount,
              firstFailedAt: expiredWindow ? new Date(nowMs).toISOString() : cur.firstFailedAt,
              lockedUntil,
            };
          }

          appendLoginHistory(tx, {
            userId: failedUser?.id || 'anonymous',
            loginId: failedUser?.loginId || identifier,
            email: failedUser?.email || identifier,
            fullName: failedUser?.fullName || identifier,
            role: failedUser?.role || 'UNKNOWN',
            method: 'PASSWORD',
            status: lockedNow ? 'LOCKED' : 'FAILED',
            reason,
            ipAddress,
            userAgent,
          });

          appendAudit(tx, {
            actorId: failedUser?.id || 'anonymous',
            actorName: failedUser?.fullName || identifier,
            actorRole: failedUser?.role || 'UNKNOWN',
            action: lockedNow ? 'LOGIN_LOCKOUT_TRIGGERED' : 'LOGIN_FAILED',
            targetType: 'AUTH',
            targetId: failedUser?.loginId || identifier,
            result: 'FAILURE',
            details: `${reason} for "${failedUser?.loginId || identifier}".`,
            ipAddress,
          });
          return lockedNow;
        });
      };

      if (!user) {
        const locked = await recordFailure(undefined, 'Unknown identifier');
        if (locked) {
          return res.status(429).json({
            error: `Too many failed attempts. Please wait ${rt.loginLockoutMinutes} minutes before trying again.`,
            locked: true,
          });
        }
        return res.status(401).json({ error: 'Invalid Login ID / Email or Password.' });
      }

      const validPwd = await verifyPassword(password, user.passwordHash);
      if (!validPwd) {
        const locked = await recordFailure(user, 'Invalid password');
        if (locked) {
          return res.status(429).json({
            error: `Too many failed attempts. Account temporarily locked for ${rt.loginLockoutMinutes} minutes.`,
            locked: true,
          });
        }
        return res.status(401).json({ error: 'Invalid Login ID / Email or Password.' });
      }

      const status: AccountStatus = user.status || (user.isActive ? 'ACTIVE' : 'DEACTIVATED');
      if (status === 'PENDING_ACTIVATION') {
        return res.status(403).json({
          error: 'This account is pending activation. Open your activation link to set your password.',
        });
      }
      if (status === 'SUSPENDED') {
        return res.status(403).json({
          error: 'This account is suspended. Contact your Super Admin.',
        });
      }
      if (status === 'DEACTIVATED' || !user.isActive) {
        return res.status(403).json({
          error: 'This account has been deactivated. Contact your Super Admin.',
        });
      }

      if (
        user.mustChangePassword &&
        user.tempPasswordExpiresAt &&
        new Date(user.tempPasswordExpiresAt).getTime() <= nowMs
      ) {
        return res.status(403).json({
          error: 'Temporary password has expired. Ask an administrator for a fresh activation link or reset.',
        });
      }

      // Clear failed attempts on valid primary credentials
      await store.withTransaction((tx) => {
        delete tx.loginAttempts[attemptKeyId];
        delete tx.loginAttempts[attemptKeyIp];
      });

      // Direct credential login -> issue session and redirect to role dashboard
      const loginResult = await store.withTransaction((tx) => {
        const target = tx.users.find((u) => u.id === user.id)!;
        target.lastLoginAt = new Date().toISOString();
        const { accessToken, refreshToken } = createSessionForUser(tx, target, req, rememberMe);
        appendLoginHistory(tx, {
          userId: target.id,
          loginId: target.loginId,
          email: target.email,
          fullName: target.fullName,
          role: target.role,
          method: 'PASSWORD',
          status: 'SUCCESS',
          ipAddress,
          userAgent,
        });
        appendAudit(tx, {
          actorId: target.id,
          actorName: target.fullName,
          actorRole: target.role,
          action: 'LOGIN_SUCCESS',
          targetType: 'AUTH',
          targetId: target.loginId,
          details: `Staff user ${target.loginId} signed in via credentials.`,
          ipAddress,
        });
        return {
          token: accessToken,
          refreshToken,
          user: toPublicStaffUser(target, tx.rolePermissions),
        };
      });

      setAuthCookies(req, res, loginResult.token, loginResult.refreshToken, rememberMe);
      return res.json({
        token: loginResult.token,
        user: loginResult.user,
        dashboardPath: getDashboardPathForRole(loginResult.user.role),
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Unable to complete login right now.' });
    }
  });

  // Optional Google Sign-In bridge (only active when optional Firebase env vars are configured)
  app.post('/api/auth/google', authLimiter, async (req, res) => {
    try {
      const fb = getOptionalFirebaseConfig();
      if (!fb.configured || (!fb.projectId && !fb.oAuthClientId)) {
        return res.status(503).json({
          error:
            'Google SSO is optional and not configured on this server. Sign in using your Login ID and Password.',
        });
      }

      const idToken = typeof req.body?.idToken === 'string' ? req.body.idToken.trim() : '';
      if (!idToken) {
        return res.status(400).json({ error: 'Missing Google ID token.' });
      }

      const verifyResp = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
      );
      if (!verifyResp.ok) {
        return res.status(401).json({ error: 'Invalid or expired Google Sign-In token.' });
      }

      const info = (await verifyResp.json()) as {
        aud?: string;
        email?: string;
        email_verified?: string | boolean;
        name?: string;
      };

      const validAud = Boolean(
        info.aud &&
          ((fb.projectId && info.aud === fb.projectId) ||
            (fb.oAuthClientId && info.aud === fb.oAuthClientId))
      );
      if (!validAud || !info.email || (info.email_verified !== 'true' && info.email_verified !== true)) {
        return res.status(401).json({ error: 'Google account verification failed.' });
      }

      const emailLower = info.email.toLowerCase();
      const db = store.getSnapshot();
      const existing = db.users.find((u) => u.email.toLowerCase() === emailLower);

      if (!existing && emailLower !== 'itsdemoid00@gmail.com') {
        return res.status(403).json({
          error:
            'Your Google email is not registered as an authorized 9HR staff member. Ask your Super Admin to invite your account.',
        });
      }

      if (existing && (!existing.isActive || (existing.status && existing.status !== 'ACTIVE'))) {
        return res.status(403).json({ error: 'This staff account is not active.' });
      }

      const result = await store.withTransaction((tx) => {
        let user = tx.users.find((u) => u.email.toLowerCase() === emailLower);
        if (!user) {
          tx.counters.staffSeq += 1;
          user = {
            id: `usr-${crypto.randomBytes(6).toString('hex')}`,
            loginId: `9HR-SA-${String(tx.counters.staffSeq).padStart(3, '0')}`,
            email: emailLower,
            fullName: sanitizeText(info.name || '9HR Super Admin'),
            role: 'SUPER_ADMIN',
            department: 'Executive Management',
            status: 'ACTIVE',
            isActive: true,
            isDemo: false,
            passwordHash: hashPasswordSync(generateTempPassword()),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
          };
          tx.users.push(user);
        } else {
          user.lastLoginAt = new Date().toISOString();
          if (info.name && user.fullName === '9HR Portal Owner') {
            user.fullName = sanitizeText(info.name);
          }
        }
        const { accessToken, refreshToken } = createSessionForUser(tx, user, req, false);
        appendLoginHistory(tx, {
          userId: user.id,
          loginId: user.loginId,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          method: 'GOOGLE_SSO',
          status: 'SUCCESS',
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
        });
        appendAudit(tx, {
          actorId: user.id,
          actorName: user.fullName,
          actorRole: user.role,
          action: 'LOGIN_GOOGLE_SSO',
          targetType: 'AUTH',
          targetId: user.loginId,
          details: `Signed in via Google SSO (${user.email}).`,
          ipAddress: getClientIp(req),
        });
        return {
          token: accessToken,
          refreshToken,
          user: toPublicStaffUser(user, tx.rolePermissions),
        };
      });

      setAuthCookies(req, res, result.token, result.refreshToken, false);
      return res.json({
        token: result.token,
        user: result.user,
        dashboardPath: getDashboardPathForRole(result.user.role),
      });
    } catch (err) {
      console.error('Google auth error:', err);
      return res.status(500).json({ error: 'Google authentication failed.' });
    }
  });

  // Refresh session token rotation
  app.post('/api/auth/refresh', async (req, res) => {
    try {
      const cookies = parseCookies(req);
      const rawRefresh = cookies[REFRESH_COOKIE_NAME];
      if (!rawRefresh) {
        return res.status(401).json({ error: 'No refresh token present.' });
      }
      const refreshHash = hashTokenSha256(rawRefresh);
      const db = store.getSnapshot();
      const session = db.sessions.find((s) => s.refreshTokenHash === refreshHash && !s.revokedAt);
      if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
        clearAuthCookies(res);
        return res.status(401).json({ error: 'Refresh token invalid or expired.' });
      }

      const idleLimitMs = (db.config.sessionIdleTimeoutMinutes || 30) * 60 * 1000;
      if (Date.now() - new Date(session.lastActivityAt).getTime() > idleLimitMs) {
        clearAuthCookies(res);
        return res.status(401).json({ error: 'Session timed out due to inactivity.' });
      }

      const user = db.users.find((u) => u.id === session.userId);
      if (!user || !user.isActive || user.status !== 'ACTIVE') {
        clearAuthCookies(res);
        return res.status(403).json({ error: 'Account is not active.' });
      }

      const rotated = await store.withTransaction((tx) => {
        const s = tx.sessions.find((item) => item.id === session.id)!;
        const remainingSec = Math.max(
          60,
          Math.floor((new Date(s.expiresAt).getTime() - Date.now()) / 1000)
        );
        const newAccess = signToken(
          {
            sub: user.id,
            sid: s.id,
            loginId: user.loginId,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
            type: 'session',
          },
          remainingSec
        );
        const newRefresh = crypto.randomBytes(32).toString('hex');
        s.tokenHash = hashTokenSha256(newAccess);
        s.refreshTokenHash = hashTokenSha256(newRefresh);
        s.lastActivityAt = new Date().toISOString();
        return {
          token: newAccess,
          refreshToken: newRefresh,
          rememberMe: s.rememberMe,
          user: toPublicStaffUser(user, tx.rolePermissions),
        };
      });

      setAuthCookies(req, res, rotated.token, rotated.refreshToken, rotated.rememberMe);
      return res.json({ token: rotated.token, user: rotated.user });
    } catch (err) {
      console.error('Refresh error:', err);
      return res.status(500).json({ error: 'Session refresh failed.' });
    }
  });

  app.post('/api/auth/logout', async (req: AuthRequest, res) => {
    const authHeader = req.headers.authorization;
    const cookies = parseCookies(req);
    const rawToken =
      authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : cookies[SESSION_COOKIE_NAME];

    if (rawToken) {
      const payload = verifyToken(rawToken);
      if (payload?.sid) {
        await store.withTransaction((tx) => {
          const s = tx.sessions.find((item) => item.id === payload.sid);
          if (s && !s.revokedAt) {
            s.revokedAt = new Date().toISOString();
            s.revokedReason = 'USER_LOGOUT';
          }
          appendAudit(tx, {
            actorId: payload.sub,
            actorName: payload.fullName,
            actorRole: payload.role,
            action: 'LOGOUT',
            targetType: 'AUTH',
            targetId: payload.loginId,
            details: `User ${payload.loginId} logged out of session ${payload.sid}.`,
            ipAddress: getClientIp(req),
          });
        });
      }
    }
    clearAuthCookies(res);
    res.json({ success: true });
  });

  app.post('/api/auth/logout-all', requireAuth, async (req: AuthRequest, res) => {
    const revokedCount = await store.withTransaction((tx) => {
      const count = revokeUserSessions(tx, req.staffUser!.id, 'LOGOUT_ALL_DEVICES');
      appendAudit(tx, {
        actorId: req.staffUser!.id,
        actorName: req.staffUser!.fullName,
        actorRole: req.staffUser!.role,
        action: 'LOGOUT_ALL_DEVICES',
        targetType: 'AUTH',
        targetId: req.staffUser!.loginId,
        details: `Revoked ${count} active session(s) across all devices.`,
        ipAddress: getClientIp(req),
      });
      return count;
    });
    clearAuthCookies(res);
    return res.json({ success: true, revokedCount });
  });

  app.get('/api/auth/sessions', requireAuth, (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const now = Date.now();
    const sessions = db.sessions
      .filter(
        (s) =>
          s.userId === req.staffUser!.id &&
          !s.revokedAt &&
          new Date(s.expiresAt).getTime() > now
      )
      .map((s) => ({
        id: s.id,
        userId: s.userId,
        rememberMe: s.rememberMe,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastActivityAt: s.lastActivityAt,
        expiresAt: s.expiresAt,
        isCurrent: s.id === req.staffUser!.sid,
      }));
    res.json({ sessions });
  });

  app.delete('/api/auth/sessions/:sid', requireAuth, async (req: AuthRequest, res) => {
    const sid = req.params.sid;
    const db = store.getSnapshot();
    const session = db.sessions.find((s) => s.id === sid && s.userId === req.staffUser!.id);
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    await store.withTransaction((tx) => {
      const s = tx.sessions.find((item) => item.id === sid);
      if (s && !s.revokedAt) {
        s.revokedAt = new Date().toISOString();
        s.revokedReason = 'USER_REVOKED_SESSION';
      }
      appendAudit(tx, {
        actorId: req.staffUser!.id,
        actorName: req.staffUser!.fullName,
        actorRole: req.staffUser!.role,
        action: 'SESSION_REVOKED',
        targetType: 'AUTH',
        targetId: sid,
        details: `User revoked session ${sid}.`,
        ipAddress: getClientIp(req),
      });
    });

    if (sid === req.staffUser!.sid) {
      clearAuthCookies(res);
    }
    return res.json({ success: true });
  });

  app.get('/api/auth/login-history', requireAuth, (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const items = db.loginHistory.filter((h) => h.userId === req.staffUser!.id).slice(0, 100);
    res.json({ items });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const user = db.users.find((u) => u.id === req.staffUser!.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }
    return res.json({
      user: toPublicStaffUser(user, db.rolePermissions),
      dashboardPath: getDashboardPathForRole(user.role),
    });
  });

  app.post('/api/auth/password-reset/request', authLimiter, async (req, res) => {
    try {
      const identifier = sanitizeText(req.body?.identifier).toLowerCase();
      if (!identifier) {
        return res.status(400).json({ error: 'Enter your Login ID or Email address.' });
      }
      const db = store.getSnapshot();
      const user = db.users.find(
        (u) => u.loginId.toLowerCase() === identifier || u.email.toLowerCase() === identifier
      );

      if (!user) {
        return res.json({
          message: 'If a matching staff account exists, a password reset instruction has been generated.',
          smtpConfigured: isSmtpConfigured(),
        });
      }

      const rawResetToken = crypto.randomBytes(24).toString('hex');
      const tokenHash = hashTokenSha256(rawResetToken);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      await store.withTransaction((tx) => {
        const target = tx.users.find((u) => u.id === user.id)!;
        target.resetTokenHash = tokenHash;
        target.resetTokenExpiresAt = expiresAt;
        appendAudit(tx, {
          actorId: target.id,
          actorName: target.fullName,
          actorRole: target.role,
          action: 'PASSWORD_RESET_REQUESTED',
          targetType: 'AUTH',
          targetId: target.loginId,
          details: `Password reset token issued for ${target.loginId}.`,
          ipAddress: getClientIp(req),
        });
      });

      const emailResult = await dispatchNotificationEmail({
        to: user.email,
        subject: '9HR India Portal — Password Reset Token',
        body: `Your temporary reset token is: ${rawResetToken} (expires in 15 minutes).`,
      });

      return res.json({
        message:
          emailResult.deliveryStatus === 'SENT_SMTP'
            ? 'Password reset instructions sent to your email.'
            : 'Email has NOT been sent (SMTP is not configured). Use the temporary reset code below within 15 minutes.',
        smtpConfigured: isSmtpConfigured(),
        deliveryStatus: emailResult.deliveryStatus,
        demoResetToken: db.config.demoModeEnabled && !isSmtpConfigured() ? rawResetToken : undefined,
      });
    } catch (err) {
      console.error('Reset request error:', err);
      return res.status(500).json({ error: 'Failed to process password reset request.' });
    }
  });

  app.post('/api/auth/password-reset/confirm', authLimiter, async (req, res) => {
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      const pwdCheck = strongPasswordSchema.safeParse(req.body?.newPassword);
      if (!token || !pwdCheck.success) {
        return res.status(400).json({
          error: pwdCheck.success
            ? 'Valid reset token is required.'
            : pwdCheck.error.issues[0]?.message || 'Strong password required (min 8 chars with letters and numbers).',
        });
      }

      const tokenHash = hashTokenSha256(token);
      const db = store.getSnapshot();
      const user = db.users.find(
        (u) =>
          u.resetTokenHash === tokenHash &&
          u.resetTokenExpiresAt &&
          new Date(u.resetTokenExpiresAt).getTime() > Date.now()
      );

      if (!user) {
        return res.status(400).json({ error: 'Reset token is invalid or has expired.' });
      }

      const newHash = await hashPassword(pwdCheck.data);
      await store.withTransaction((tx) => {
        const target = tx.users.find((u) => u.id === user.id)!;
        target.passwordHash = newHash;
        target.mustChangePassword = false;
        target.tempPasswordExpiresAt = undefined;
        target.resetTokenHash = undefined;
        target.resetTokenExpiresAt = undefined;
        target.updatedAt = new Date().toISOString();

        // Invalidate ALL active sessions & clear brute-force lockouts
        revokeUserSessions(tx, target.id, 'PASSWORD_RESET');
        delete tx.loginAttempts[`id:${target.loginId.toLowerCase()}`];
        delete tx.loginAttempts[`id:${target.email.toLowerCase()}`];

        appendAudit(tx, {
          actorId: target.id,
          actorName: target.fullName,
          actorRole: target.role,
          action: 'PASSWORD_RESET_COMPLETED',
          targetType: 'AUTH',
          targetId: target.loginId,
          details: `Password updated via reset token for ${target.loginId}; all existing sessions revoked.`,
          ipAddress: getClientIp(req),
        });
      });

      clearAuthCookies(res);
      return res.json({ success: true, message: 'Password updated successfully. You may now sign in.' });
    } catch (err) {
      console.error('Reset confirm error:', err);
      return res.status(500).json({ error: 'Unable to reset password.' });
    }
  });

  app.post('/api/auth/change-password', requireAuth, async (req: AuthRequest, res) => {
    try {
      const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
      const pwdCheck = strongPasswordSchema.safeParse(req.body?.newPassword);
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required.' });
      }
      if (!pwdCheck.success) {
        return res.status(400).json({
          error: pwdCheck.error.issues[0]?.message || 'Strong new password required.',
        });
      }

      const db = store.getSnapshot();
      const user = db.users.find((u) => u.id === req.staffUser!.id);
      if (!user) return res.status(404).json({ error: 'Account not found.' });

      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        return res.status(400).json({ error: 'Current password is incorrect.' });
      }
      if (currentPassword === pwdCheck.data) {
        return res.status(400).json({ error: 'New password must differ from current password.' });
      }

      const newHash = await hashPassword(pwdCheck.data);
      const rotated = await store.withTransaction((tx) => {
        const target = tx.users.find((u) => u.id === user.id)!;
        target.passwordHash = newHash;
        target.mustChangePassword = false;
        target.tempPasswordExpiresAt = undefined;
        target.updatedAt = new Date().toISOString();

        // Revoke other sessions and rotate current session
        revokeUserSessions(tx, target.id, 'PASSWORD_CHANGED', req.staffUser!.sid);
        const curSession = tx.sessions.find((s) => s.id === req.staffUser!.sid);
        const rememberMe = Boolean(curSession?.rememberMe);
        if (curSession) {
          curSession.revokedAt = new Date().toISOString();
          curSession.revokedReason = 'SESSION_ROTATED';
        }
        const { accessToken, refreshToken } = createSessionForUser(tx, target, req, rememberMe);

        appendAudit(tx, {
          actorId: target.id,
          actorName: target.fullName,
          actorRole: target.role,
          action: 'PASSWORD_CHANGED',
          targetType: 'AUTH',
          targetId: target.loginId,
          details: 'User changed password; other device sessions revoked and active session rotated.',
          ipAddress: getClientIp(req),
        });
        return {
          token: accessToken,
          refreshToken,
          rememberMe,
          user: toPublicStaffUser(target, tx.rolePermissions),
        };
      });

      setAuthCookies(req, res, rotated.token, rotated.refreshToken, rotated.rememberMe);
      return res.json({ success: true, token: rotated.token, user: rotated.user });
    } catch (err) {
      console.error('Change password error:', err);
      return res.status(500).json({ error: 'Failed to change password.' });
    }
  });

  // Account Activation endpoints (single-use activation link)
  app.get('/api/auth/activate/:token', (req, res) => {
    const tokenHash = hashTokenSha256(req.params.token.trim());
    const db = store.getSnapshot();
    const record = db.activationTokens.find((t) => t.tokenHash === tokenHash);
    if (!record || record.usedAt || new Date(record.expiresAt).getTime() <= Date.now()) {
      return res.status(400).json({ error: 'Activation link is invalid, expired, or has already been used.' });
    }
    const user = db.users.find((u) => u.id === record.userId);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    return res.json({
      loginId: user.loginId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      expiresAt: record.expiresAt,
    });
  });

  app.post('/api/auth/activate/:token', authLimiter, async (req, res) => {
    try {
      const pwdCheck = strongPasswordSchema.safeParse(req.body?.password);
      if (!pwdCheck.success) {
        return res.status(400).json({
          error: pwdCheck.error.issues[0]?.message || 'Strong password required (min 8 chars with letters and numbers).',
        });
      }

      const tokenHash = hashTokenSha256(req.params.token.trim());
      const db = store.getSnapshot();
      const record = db.activationTokens.find((t) => t.tokenHash === tokenHash);
      if (!record || record.usedAt || new Date(record.expiresAt).getTime() <= Date.now()) {
        return res.status(400).json({ error: 'Activation link is invalid, expired, or has already been used.' });
      }
      const user = db.users.find((u) => u.id === record.userId);
      if (!user) return res.status(404).json({ error: 'Account not found.' });

      const passwordHash = await hashPassword(pwdCheck.data);
      const result = await store.withTransaction((tx) => {
        const nowIso = new Date().toISOString();
        const act = tx.activationTokens.find((t) => t.id === record.id)!;
        act.usedAt = nowIso;

        const target = tx.users.find((u) => u.id === user.id)!;
        target.passwordHash = passwordHash;
        target.status = 'ACTIVE';
        target.isActive = true;
        target.mustChangePassword = false;
        target.tempPasswordExpiresAt = undefined;
        target.updatedAt = nowIso;

        appendLoginHistory(tx, {
          userId: target.id,
          loginId: target.loginId,
          email: target.email,
          fullName: target.fullName,
          role: target.role,
          method: 'ACTIVATION',
          status: 'SUCCESS',
          reason: 'Account activated and initial password configured.',
          ipAddress: getClientIp(req),
          userAgent: getUserAgent(req),
        });
        appendAudit(tx, {
          actorId: target.id,
          actorName: target.fullName,
          actorRole: target.role,
          action: 'ACCOUNT_ACTIVATED',
          targetType: 'AUTH',
          targetId: target.loginId,
          details: `Account ${target.loginId} activated via secure single-use activation link.`,
          ipAddress: getClientIp(req),
        });
        return toPublicStaffUser(target, tx.rolePermissions);
      });

      return res.json({
        success: true,
        user: result,
        message: 'Account activated successfully. You may now sign in.',
      });
    } catch (err) {
      console.error('Activate account error:', err);
      return res.status(500).json({ error: 'Failed to activate account.' });
    }
  });

  // ---------------------------------------------------------------------------
  // Dashboard Analytics & Role-Specific Summaries
  // ---------------------------------------------------------------------------
  app.get('/api/analytics', requireAuth, requirePermission('dashboard', 'view'), (req: AuthRequest, res) => {
    const scope = (req.query.scope as string) || 'all';
    const db = store.getSnapshot();

    const scopedCandidates = db.candidates.filter((c) => {
      if (!isRecordAllowedForUser(req.staffUser!, c)) return false;
      if (scope === 'live') return !c.isDemo;
      if (scope === 'demo') return c.isDemo;
      return true;
    });

    const scopedIds = new Set(scopedCandidates.map((c) => c.id));
    const scopedDocs = db.documents.filter((d) => scopedIds.has(d.candidateId));

    const kpis = {
      totalCandidates: scopedCandidates.length,
      newApplications: scopedCandidates.filter((c) =>
        ['Draft', 'Link Sent'].includes(c.status)
      ).length,
      pendingOnboarding: scopedCandidates.filter((c) =>
        ['In Progress', 'Submitted', 'Under Review', 'Correction Required'].includes(c.status)
      ).length,
      documentsPending: scopedDocs.filter((d) => d.verificationStatus === 'Pending').length,
      documentsVerified: scopedDocs.filter((d) => d.verificationStatus === 'Approved').length,
      onboardingCompleted: scopedCandidates.filter(
        (c) => c.status === 'Onboarding Completed'
      ).length,
      rejectedApplications: scopedCandidates.filter((c) => c.status === 'Rejected').length,
    };

    const monthBuckets = new Map<string, { registered: number; completed: number }>();
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      monthBuckets.set(label, { registered: 0, completed: 0 });
    }
    for (const c of scopedCandidates) {
      const d = new Date(c.createdAt);
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      if (monthBuckets.has(label)) {
        const entry = monthBuckets.get(label)!;
        entry.registered += 1;
        if (c.status === 'Onboarding Completed' || c.status === 'Approved') {
          entry.completed += 1;
        }
      }
    }
    const monthlyStats = Array.from(monthBuckets.entries()).map(([month, v]) => ({
      month,
      ...v,
    }));

    const deptMap = new Map<string, { count: number; completed: number }>();
    for (const dept of db.config.departments) {
      deptMap.set(dept, { count: 0, completed: 0 });
    }
    for (const c of scopedCandidates) {
      const existing = deptMap.get(c.department) || { count: 0, completed: 0 };
      existing.count += 1;
      if (c.status === 'Onboarding Completed' || c.status === 'Approved') {
        existing.completed += 1;
      }
      deptMap.set(c.department, existing);
    }
    const departmentStats = Array.from(deptMap.entries())
      .map(([department, v]) => ({ department, ...v }))
      .filter((d) => d.count > 0);

    const statusMap = new Map<string, number>();
    for (const s of ONBOARDING_STATUSES) {
      statusMap.set(s, 0);
    }
    for (const c of scopedCandidates) {
      statusMap.set(c.status, (statusMap.get(c.status) || 0) + 1);
    }
    const statusDistribution = Array.from(statusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .filter((s) => s.count > 0);

    const total = Math.max(1, scopedCandidates.length);
    const linkSentOrBeyond = scopedCandidates.filter((c) => c.status !== 'Draft').length;
    const submittedOrBeyond = scopedCandidates.filter((c) =>
      [
        'Submitted',
        'Under Review',
        'Documents Pending',
        'Correction Required',
        'Approved',
        'Onboarding Completed',
      ].includes(c.status)
    ).length;
    const approvedOrDone = scopedCandidates.filter((c) =>
      ['Approved', 'Onboarding Completed'].includes(c.status)
    ).length;
    const completed = kpis.onboardingCompleted;

    const conversionFunnel = [
      { stage: 'Registered', count: scopedCandidates.length, rate: scopedCandidates.length ? 100 : 0 },
      { stage: 'Link Activated', count: linkSentOrBeyond, rate: Math.round((linkSentOrBeyond / total) * 100) },
      { stage: 'Submitted', count: submittedOrBeyond, rate: Math.round((submittedOrBeyond / total) * 100) },
      { stage: 'Approved', count: approvedOrDone, rate: Math.round((approvedOrDone / total) * 100) },
      { stage: 'Employee Created', count: completed, rate: Math.round((completed / total) * 100) },
    ];

    const summary: AnalyticsSummary = {
      kpis,
      monthlyStats,
      departmentStats,
      statusDistribution,
      conversionFunnel,
    };

    res.json(summary);
  });

  app.get('/api/dashboard/summary', requireAuth, requirePermission('dashboard', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const allowedEmployees = db.employees.filter((e) => isRecordAllowedForUser(user, e));
    const allowedPayroll = db.payrollRuns.filter((p) => isRecordAllowedForUser(user, p));
    const allowedLeave = db.leaveRequests.filter((l) => isRecordAllowedForUser(user, l));
    const allowedAttendance = db.attendance.filter((a) => isRecordAllowedForUser(user, a));
    const allowedMeetings = db.meetings.filter((m) => isRecordAllowedForUser(user, m));

    const managedIds = getManagedEmployeeIds(db, user.id);

    const teamEmployees =
      user.role === 'MANAGER'
        ? allowedEmployees.filter((e) => managedIds.has(e.id))
        : user.role === 'EMPLOYEE'
          ? allowedEmployees.filter((e) => e.id === user.employeeId || e.userId === user.id)
          : allowedEmployees;

    const scopedLeave =
      user.role === 'MANAGER'
        ? allowedLeave.filter((l) => managedIds.has(l.employeeId) || l.userId === user.id)
        : user.role === 'EMPLOYEE'
          ? allowedLeave.filter((l) => l.userId === user.id)
          : allowedLeave;

    const scopedAttendance =
      user.role === 'MANAGER'
        ? allowedAttendance.filter((a) => managedIds.has(a.employeeId) || a.userId === user.id)
        : user.role === 'EMPLOYEE'
          ? allowedAttendance.filter((a) => a.userId === user.id)
          : allowedAttendance;

    const myPayslips =
      user.role === 'EMPLOYEE'
        ? allowedPayroll.flatMap((run) =>
            run.entries
              .filter((e) => e.employeeId === user.employeeId || e.userId === user.id)
              .map((e) => ({ ...e, monthLabel: run.monthLabel, period: run.period }))
          )
        : [];

    return res.json({
      role: user.role,
      counts: {
        activeUsers: db.users.filter((u) => u.isActive && isRecordAllowedForUser(user, u)).length,
        employees: teamEmployees.length,
        pendingLeave: scopedLeave.filter((l) => l.status === 'PENDING').length,
        attendanceRecords: scopedAttendance.length,
        payrollRuns: allowedPayroll.length,
        pendingPayrollApprovals: allowedPayroll.filter((p) => ['SUBMITTED', 'FINANCE_APPROVED'].includes(p.status)).length,
        upcomingMeetings: allowedMeetings.filter(
          (m) => m.status === 'SCHEDULED' && (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' || m.organizerId === user.id || m.participantIds.includes(user.id))
        ).length,
        myPayslipsCount: myPayslips.length,
      },
      latestPayroll: ['SUPER_ADMIN', 'PAYROLL', 'FINANCE'].includes(user.role)
        ? allowedPayroll[0] || null
        : null,
      recentLeave: scopedLeave.slice(0, 6),
      recentMeetings: allowedMeetings
        .filter(
          (m) =>
            user.role === 'SUPER_ADMIN' ||
            user.role === 'ADMIN' ||
            m.organizerId === user.id ||
            m.participantIds.includes(user.id)
        )
        .slice(0, 5),
      myPayslips: myPayslips.slice(0, 4),
    });
  });

  // ---------------------------------------------------------------------------
  // Staff, RBAC & User Management
  // ---------------------------------------------------------------------------
  app.get('/api/staff/recruiters', requireAuth, (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const recruiters = db.users
      .filter(
        (u) =>
          u.isActive &&
          ['SUPER_ADMIN', 'ADMIN', 'HR', 'RECRUITER'].includes(u.role) &&
          isRecordAllowedForUser(req.staffUser!, u)
      )
      .map((u) => toPublicStaffUser(u, db.rolePermissions));
    res.json({ recruiters });
  });

  app.get('/api/staff/directory', requireAuth, (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const directory = db.users
      .filter((u) => u.isActive && isRecordAllowedForUser(req.staffUser!, u))
      .map((u) => ({
        id: u.id,
        loginId: u.loginId,
        fullName: u.fullName,
        role: u.role,
        department: u.department,
      }));
    res.json({ directory });
  });

  app.get('/api/staff', requireAuth, requirePermission('users', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const users = db.users
      .filter((u) => isRecordAllowedForUser(req.staffUser!, u))
      .map((u) => toPublicStaffUser(u, db.rolePermissions));
    res.json({ users });
  });

  app.post('/api/staff', requireAuth, requirePermission('users', 'create'), async (req: AuthRequest, res) => {
    try {
      const sanitized = sanitizeRecordStrings(req.body);
      const parsed = createStaffSchema.safeParse({
        ...sanitized,
        password: req.body?.password,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid staff payload.' });
      }

      const data = parsed.data;
      if (data.password) {
        const strongCheck = strongPasswordSchema.safeParse(data.password);
        if (!strongCheck.success) {
          return res.status(400).json({
            error: strongCheck.error.issues[0]?.message || 'Temporary password does not meet complexity rules.',
          });
        }
      }

      // Admin cannot create ADMIN or SUPER_ADMIN accounts
      if (['SUPER_ADMIN', 'ADMIN'].includes(data.role) && req.staffUser!.role !== 'SUPER_ADMIN') {
        return res.status(403).json({
          error: 'Only Super Admin can create Admin or Super Admin accounts.',
        });
      }

      const db = store.getSnapshot();
      const emailLower = data.email.toLowerCase();
      if (db.users.some((u) => u.email.toLowerCase() === emailLower)) {
        return res.status(409).json({ error: 'A staff account with this email already exists.' });
      }

      const manager = data.reportingManagerId
        ? db.users.find((u) => u.id === data.reportingManagerId)
        : undefined;

      const tempPassword = data.password || generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);
      const rolePrefixMap: Record<StaffRole, string> = {
        SUPER_ADMIN: 'SA',
        ADMIN: 'ADM',
        HR: 'HR',
        RECRUITER: 'REC',
        PAYROLL: 'PAY',
        MANAGER: 'MGR',
        FINANCE: 'FIN',
        EMPLOYEE: 'EMP',
      };

      const created = await store.withTransaction(async (tx) => {
        tx.counters.staffSeq += 1;
        const prefix = rolePrefixMap[data.role] || 'STF';
        const loginId = (
          data.loginId || `9HR-${prefix}-${String(tx.counters.staffSeq).padStart(3, '0')}`
        ).toUpperCase();

        if (tx.users.some((u) => u.loginId.toLowerCase() === loginId.toLowerCase())) {
          throw new Error('DUPLICATE_LOGIN_ID');
        }

        const nowIso = new Date().toISOString();
        const isPendingActivation = Boolean(data.sendActivationLink);
        const newUser: StaffUserRecord = {
          id: `usr-${crypto.randomBytes(6).toString('hex')}`,
          loginId,
          email: emailLower,
          fullName: data.fullName,
          role: data.role,
          department: data.department,
          status: isPendingActivation ? 'PENDING_ACTIVATION' : 'ACTIVE',
          isActive: !isPendingActivation,
          mustChangePassword: true,
          tempPasswordExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          reportingManagerId: manager?.id,
          reportingManagerName: manager?.fullName,
          isDemo: false,
          createdByIsDemo: Boolean(req.staffUser!.isDemo),
          passwordHash,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        tx.users.push(newUser);

        let activationUrl: string | undefined;
        if (isPendingActivation) {
          const rawActToken = crypto.randomBytes(24).toString('hex');
          activationUrl = `/activate/${rawActToken}`;
          tx.activationTokens.unshift({
            id: `act-${crypto.randomBytes(6).toString('hex')}`,
            userId: newUser.id,
            tokenHash: hashTokenSha256(rawActToken),
            expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
            createdAt: nowIso,
          });
          await dispatchNotificationEmail({
            to: newUser.email,
            subject: 'Activate Your 9HR India Portal Account',
            body: `Hello ${newUser.fullName}, activate your 9HR account using Login ID ${newUser.loginId} at ${activationUrl}`,
          });
        }

        appendAudit(tx, {
          actorId: req.staffUser!.id,
          actorName: req.staffUser!.fullName,
          actorRole: req.staffUser!.role,
          action: 'STAFF_CREATED',
          targetType: 'STAFF',
          targetId: newUser.loginId,
          details: `Created ${newUser.role} account ${newUser.loginId} (${newUser.email}).`,
          ipAddress: getClientIp(req),
        });

        return { user: toPublicStaffUser(newUser, tx.rolePermissions), activationUrl };
      });

      return res.status(201).json({
        user: created.user,
        activationUrl: created.activationUrl,
        temporaryCredentials: data.sendActivationLink
          ? undefined
          : {
              loginId: created.user.loginId,
              email: created.user.email,
              temporaryPassword: tempPassword,
            },
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'DUPLICATE_LOGIN_ID') {
        return res.status(409).json({ error: 'This Login ID is already taken.' });
      }
      console.error('Create staff error:', err);
      return res.status(500).json({ error: 'Failed to create staff member.' });
    }
  });

  app.patch('/api/staff/:id', requireAuth, requirePermission('users', 'edit'), async (req: AuthRequest, res) => {
    try {
      const targetId = req.params.id;
      const db = store.getSnapshot();
      const target = db.users.find((u) => u.id === targetId);
      if (!target) return res.status(404).json({ error: 'Staff user not found.' });
      if (!isRecordAllowedForUser(req.staffUser!, target)) {
        return res.status(403).json({ error: 'Demo accounts cannot modify non-demo users.' });
      }

      if (['SUPER_ADMIN', 'ADMIN'].includes(target.role) && req.staffUser!.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Only Super Admin can modify Admin or Super Admin accounts.' });
      }
      if (
        req.body?.role &&
        ['SUPER_ADMIN', 'ADMIN'].includes(req.body.role) &&
        req.staffUser!.role !== 'SUPER_ADMIN'
      ) {
        return res.status(403).json({ error: 'Only Super Admin can assign Admin or Super Admin roles.' });
      }

      const nextStatusRequested: AccountStatus | undefined = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'PENDING_ACTIVATION'].includes(
        req.body?.status
      )
        ? req.body.status
        : typeof req.body?.isActive === 'boolean'
          ? req.body.isActive
            ? 'ACTIVE'
            : 'DEACTIVATED'
          : undefined;

      if (target.id === req.staffUser!.id && nextStatusRequested && nextStatusRequested !== 'ACTIVE') {
        return res.status(400).json({ error: 'You cannot suspend or deactivate your own active session account.' });
      }

      let resetTempPassword: string | undefined;
      let nextHash: string | undefined;
      if (req.body?.resetPassword === true) {
        resetTempPassword = generateTempPassword();
        nextHash = await hashPassword(resetTempPassword);
      }

      const updated = await store.withTransaction((tx) => {
        const u = tx.users.find((item) => item.id === targetId)!;
        const prevRole = u.role;
        const prevStatus = u.status;

        if (nextStatusRequested) {
          u.status = nextStatusRequested;
          u.isActive = nextStatusRequested === 'ACTIVE';
        }
        if (typeof req.body?.department === 'string' && req.body.department.trim()) {
          u.department = sanitizeText(req.body.department);
        }
        if (typeof req.body?.fullName === 'string' && req.body.fullName.trim()) {
          u.fullName = sanitizeText(req.body.fullName);
        }
        if (typeof req.body?.reportingManagerId === 'string') {
          const mgr = tx.users.find((m) => m.id === req.body.reportingManagerId);
          u.reportingManagerId = mgr?.id;
          u.reportingManagerName = mgr?.fullName;
        }
        if (
          req.staffUser!.role === 'SUPER_ADMIN' &&
          ALL_STAFF_ROLES.includes(req.body?.role)
        ) {
          u.role = req.body.role;
        }
        if (req.staffUser!.role === 'SUPER_ADMIN' && req.body?.customPermissions !== undefined) {
          u.customPermissions = req.body.customPermissions || undefined;
        }
        if (nextHash) {
          u.passwordHash = nextHash;
          u.mustChangePassword = true;
          u.tempPasswordExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        }
        u.updatedAt = new Date().toISOString();

        // Immediately revoke active sessions on suspension, deactivation, role change, permission change, or password reset
        let revokedSessions = 0;
        if (
          u.status !== 'ACTIVE' ||
          prevRole !== u.role ||
          req.body?.customPermissions !== undefined ||
          nextHash
        ) {
          revokedSessions = revokeUserSessions(tx, u.id, 'ACCOUNT_SECURITY_UPDATE');
        }

        const actionName =
          prevStatus !== u.status && u.status === 'SUSPENDED'
            ? 'ACCOUNT_SUSPENDED'
            : prevStatus !== u.status && u.status === 'DEACTIVATED'
              ? 'ACCOUNT_DEACTIVATED'
              : prevRole !== u.role
                ? 'ROLE_CHANGED'
                : 'STAFF_UPDATED';

        appendAudit(tx, {
          actorId: req.staffUser!.id,
          actorName: req.staffUser!.fullName,
          actorRole: req.staffUser!.role,
          action: actionName,
          targetType: 'STAFF',
          targetId: u.loginId,
          details: `Updated staff account ${u.loginId} (status=${u.status}, role=${u.role}, revokedSessions=${revokedSessions}).`,
          ipAddress: getClientIp(req),
        });
        return toPublicStaffUser(u, tx.rolePermissions);
      });

      return res.json({
        user: updated,
        temporaryPassword: resetTempPassword,
      });
    } catch (err) {
      console.error('Update staff error:', err);
      return res.status(500).json({ error: 'Failed to update staff account.' });
    }
  });

  app.post('/api/staff/:id/revoke-sessions', requireAuth, requirePermission('users', 'manage'), async (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const target = db.users.find((u) => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Staff user not found.' });
    if (['SUPER_ADMIN', 'ADMIN'].includes(target.role) && req.staffUser!.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Only Super Admin can revoke sessions for Admin accounts.' });
    }

    const count = await store.withTransaction((tx) => {
      const c = revokeUserSessions(tx, target.id, 'ADMIN_REVOKED');
      appendAudit(tx, {
        actorId: req.staffUser!.id,
        actorName: req.staffUser!.fullName,
        actorRole: req.staffUser!.role,
        action: 'ADMIN_SESSIONS_REVOKED',
        targetType: 'STAFF',
        targetId: target.loginId,
        details: `Admin revoked ${c} active session(s) for ${target.loginId}.`,
        ipAddress: getClientIp(req),
      });
      return c;
    });

    return res.json({ success: true, revokedCount: count });
  });

  app.post('/api/staff/:id/activation-link', requireAuth, requirePermission('users', 'edit'), async (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const target = db.users.find((u) => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Staff user not found.' });

    const rawToken = crypto.randomBytes(24).toString('hex');
    const activationUrl = `/activate/${rawToken}`;

    await store.withTransaction(async (tx) => {
      const nowIso = new Date().toISOString();
      for (const act of tx.activationTokens) {
        if (act.userId === target.id && !act.usedAt) act.usedAt = nowIso;
      }
      tx.activationTokens.unshift({
        id: `act-${crypto.randomBytes(6).toString('hex')}`,
        userId: target.id,
        tokenHash: hashTokenSha256(rawToken),
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        createdAt: nowIso,
      });
      await dispatchNotificationEmail({
        to: target.email,
        subject: '9HR India Portal — Account Activation Link',
        body: `Activate your 9HR account (${target.loginId}) at ${activationUrl}`,
      });
      appendAudit(tx, {
        actorId: req.staffUser!.id,
        actorName: req.staffUser!.fullName,
        actorRole: req.staffUser!.role,
        action: 'ACTIVATION_LINK_ISSUED',
        targetType: 'STAFF',
        targetId: target.loginId,
        details: `Generated single-use activation link for ${target.loginId}.`,
        ipAddress: getClientIp(req),
      });
    });

    return res.json({ activationUrl });
  });

  app.get('/api/staff/:id/login-history', requireAuth, requirePermission('users', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const target = db.users.find((u) => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    const items = db.loginHistory.filter((h) => h.userId === target.id).slice(0, 100);
    return res.json({ items });
  });

  // Role & Permission Matrix Configuration (Super Admin only)
  app.get('/api/rbac/permissions', requireAuth, requirePermission('roles_permissions', 'view'), (_req, res) => {
    const db = store.getSnapshot();
    res.json({
      rolePermissions: db.rolePermissions || DEFAULT_ROLE_PERMISSIONS,
      roles: ALL_STAFF_ROLES,
      modules: ALL_MODULES,
      actions: ALL_PERMISSION_ACTIONS,
    });
  });

  app.patch('/api/rbac/permissions', requireAuth, requirePermission('roles_permissions', 'edit'), async (req: AuthRequest, res) => {
    try {
      const role = req.body?.role as StaffRole;
      const permissions = req.body?.permissions as ModulePermissions;
      if (!ALL_STAFF_ROLES.includes(role) || !permissions || typeof permissions !== 'object') {
        return res.status(400).json({ error: 'Valid role and module permissions map are required.' });
      }
      if (role === 'SUPER_ADMIN') {
        return res.status(400).json({ error: 'Super Admin baseline permissions cannot be restricted.' });
      }

      const updated = await store.withTransaction((tx) => {
        const sanitizedPerms: ModulePermissions = {};
        for (const mod of ALL_MODULES) {
          const acts = permissions[mod];
          if (Array.isArray(acts)) {
            const validActs = acts.filter((a) => ALL_PERMISSION_ACTIONS.includes(a));
            if (validActs.length > 0) sanitizedPerms[mod] = Array.from(new Set(validActs));
          }
        }
        tx.rolePermissions[role] = sanitizedPerms;

        // Revoke active sessions for affected role so updated permissions apply immediately
        for (const u of tx.users) {
          if (u.role === role) {
            revokeUserSessions(tx, u.id, 'ROLE_PERMISSIONS_UPDATED');
          }
        }

        appendAudit(tx, {
          actorId: req.staffUser!.id,
          actorName: req.staffUser!.fullName,
          actorRole: req.staffUser!.role,
          action: 'PERMISSIONS_MODIFIED',
          targetType: 'RBAC',
          targetId: role,
          details: `Updated module permissions matrix for role ${role}.`,
          ipAddress: getClientIp(req),
        });

        return tx.rolePermissions;
      });

      return res.json({ rolePermissions: updated });
    } catch (err) {
      console.error('Update RBAC permissions error:', err);
      return res.status(500).json({ error: 'Failed to update role permissions.' });
    }
  });

  // ---------------------------------------------------------------------------
  // Candidate Management (RBAC + Demo Isolation + Redaction)
  // ---------------------------------------------------------------------------
  app.get('/api/candidates/export/csv', requireAuth, requirePermission('candidates', 'export'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const status = (req.query.status as string) || 'ALL';
    const department = (req.query.department as string) || 'ALL';
    const scope = (req.query.scope as string) || 'all';

    const filtered = db.candidates.filter((c) => {
      if (!isRecordAllowedForUser(req.staffUser!, c)) return false;
      if (scope === 'live' && c.isDemo) return false;
      if (scope === 'demo' && !c.isDemo) return false;
      if (status !== 'ALL' && c.status !== status) return false;
      if (department !== 'ALL' && c.department !== department) return false;
      if (search) {
        const hay = `${c.candidateCode} ${c.fullName} ${c.email} ${c.position} ${c.department}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const headers = [
      'Candidate ID',
      'Candidate Name',
      'Email',
      'Mobile',
      'Position',
      'Department',
      'Recruiter',
      'Application Date',
      'Joining Date',
      'Completion %',
      'Status',
      'Record Type',
      'Employee ID',
    ];

    const rows = filtered.map((c) =>
      [
        c.candidateCode,
        c.fullName,
        c.email,
        c.mobile,
        c.position,
        c.department,
        c.assignedRecruiterName,
        c.createdAt.slice(0, 10),
        c.joiningDate,
        `${c.completionPct}%`,
        c.status,
        c.isDemo ? 'Demo' : 'Live',
        c.employeeCode || '',
      ]
        .map(escapeCsvCell)
        .join(',')
    );

    const csv = [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="9hr-candidates-export.csv"');
    res.send(csv);
  });

  app.get('/api/candidates', requireAuth, requirePermission('candidates', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const status = (req.query.status as string) || 'ALL';
    const department = (req.query.department as string) || 'ALL';
    const recruiterId = (req.query.recruiterId as string) || 'ALL';
    const scope = (req.query.scope as string) || 'all';
    const sortBy = (req.query.sortBy as string) || 'createdAt';
    const sortDir = ((req.query.sortDir as string) || 'desc') === 'asc' ? 1 : -1;
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 10)));

    let list = db.candidates.filter((c) => {
      if (!isRecordAllowedForUser(req.staffUser!, c)) return false;
      if (scope === 'live' && c.isDemo) return false;
      if (scope === 'demo' && !c.isDemo) return false;
      if (status !== 'ALL' && c.status !== status) return false;
      if (department !== 'ALL' && c.department !== department) return false;
      if (recruiterId !== 'ALL' && c.assignedRecruiterId !== recruiterId) return false;
      if (search) {
        const hay = `${c.candidateCode} ${c.fullName} ${c.email} ${c.position} ${c.department} ${c.assignedRecruiterName}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      if (sortBy === 'fullName') return a.fullName.localeCompare(b.fullName) * sortDir;
      if (sortBy === 'joiningDate') return a.joiningDate.localeCompare(b.joiningDate) * sortDir;
      if (sortBy === 'completionPct') return (a.completionPct - b.completionPct) * sortDir;
      if (sortBy === 'status') return a.status.localeCompare(b.status) * sortDir;
      return a.createdAt.localeCompare(b.createdAt) * sortDir;
    });

    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const items = list.slice((safePage - 1) * pageSize, safePage * pageSize).map((c) => {
      const activeToken = db.tokens.find((t) => t.candidateId === c.id && isActiveTokenRecord(t));
      const docs = db.documents.filter((d) => d.candidateId === c.id);
      return {
        ...redactCandidateForRole(c, req.staffUser!.role),
        hasActiveLink: Boolean(activeToken),
        tokenPrefix: activeToken?.tokenPrefix,
        tokenExpiresAt: activeToken?.expiresAt,
        documentCount: docs.length,
        verifiedDocCount: docs.filter((d) => d.verificationStatus === 'Approved').length,
      };
    });

    res.json({
      items,
      total,
      page: safePage,
      pageSize,
      totalPages,
    });
  });

  app.post('/api/candidates', requireAuth, requirePermission('candidates', 'create'), async (req: AuthRequest, res) => {
    try {
      const sanitized = sanitizeRecordStrings(req.body);
      const parsed = createCandidateSchema.safeParse(sanitized);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid candidate data.' });
      }

      const data = parsed.data;
      const db = store.getSnapshot();
      const recruiter = db.users.find((u) => u.id === data.assignedRecruiterId);
      if (!recruiter) {
        return res.status(400).json({ error: 'Selected recruiter does not exist.' });
      }

      const emailLower = data.email.toLowerCase();
      if (db.candidates.some((c) => c.email.toLowerCase() === emailLower && c.status !== 'Rejected')) {
        return res.status(409).json({
          error: 'An active onboarding application already exists for this email address.',
        });
      }

      const result = await store.withTransaction(async (tx) => {
        tx.counters.candidateSeq += 1;
        const nowIso = new Date().toISOString();
        const candId = `cand-${crypto.randomBytes(6).toString('hex')}`;
        const candidateCode = `9HR-CND-${tx.counters.candidateSeq}`;

        const candidate: Candidate = {
          id: candId,
          candidateCode,
          fullName: data.fullName,
          email: emailLower,
          mobile: data.mobile,
          position: data.position,
          department: data.department,
          joiningDate: data.joiningDate,
          assignedRecruiterId: recruiter.id,
          assignedRecruiterName: recruiter.fullName,
          status: 'Link Sent',
          completionPct: 0,
          isDemo: Boolean(data.isDemo),
          createdByIsDemo: Boolean(req.staffUser!.isDemo),
          createdAt: nowIso,
          updatedAt: nowIso,
          personalInfo: {
            fullName: data.fullName,
            dateOfBirth: '',
            gender: '',
            mobileNumber: data.mobile,
            email: emailLower,
            maritalStatus: '',
          },
          addressInfo: {
            currentAddress: '',
            permanentAddress: '',
            sameAsCurrent: false,
            city: '',
            state: '',
            pinCode: '',
          },
          familyInfo: {
            fatherName: '',
            motherName: '',
            spouseName: '',
            emergencyContactName: '',
            emergencyContactRelation: '',
            emergencyContactPhone: '',
          },
          educationInfo: {
            highestQualification: '',
            collegeUniversity: '',
            passingYear: '',
            percentageOrCgpa: '',
          },
          employmentInfo: {
            isFresher: false,
            previousCompany: '',
            previousDesignation: '',
            previousExperience: '',
            lastWorkingDate: '',
            previousSalary: '',
          },
          bankDetails: {
            accountHolderName: '',
            bankName: '',
            accountNumber: '',
            ifscCode: '',
          },
          declaration: {
            accepted: false,
            digitalSignature: '',
          },
        };

        const tokenStr = generateSecureOnboardingToken();
        const expiryHours = tx.config.defaultLinkExpiryHours || 72;
        const tokenRecord: OnboardingToken = {
          id: `tok-${crypto.randomBytes(6).toString('hex')}`,
          candidateId: candId,
          tokenHash: hashTokenSha256(tokenStr),
          tokenPrefix: tokenStr.slice(0, 10),
          expiresAt: new Date(Date.now() + expiryHours * 3600 * 1000).toISOString(),
          isRevoked: false,
          createdAt: nowIso,
          createdByName: req.staffUser!.fullName,
        };

        tx.candidates.unshift(candidate);
        tx.tokens.unshift(tokenRecord);

        tx.statusHistory.unshift({
          id: `sh-${crypto.randomBytes(6).toString('hex')}`,
          candidateId: candId,
          fromStatus: null,
          toStatus: 'Link Sent',
          changedById: req.staffUser!.id,
          changedByName: req.staffUser!.fullName,
          changedByRole: req.staffUser!.role,
          note: `Candidate profile registered and onboarding link generated (expires in ${expiryHours}h).`,
          timestamp: nowIso,
        });

        const onboardingUrl = `/onboard/${tokenStr}`;
        const emailDispatch = await dispatchNotificationEmail({
          to: candidate.email,
          subject: 'Welcome to 9HR India Pvt. Ltd. — Complete Your Onboarding',
          body: `Hello ${candidate.fullName}, please complete your onboarding at ${onboardingUrl}`,
        });

        tx.notifications.unshift({
          id: `notif-${crypto.randomBytes(6).toString('hex')}`,
          type: 'ONBOARDING_INVITATION',
          title: `Onboarding Link Generated: ${candidate.fullName}`,
          message: `Unique onboarding link created for ${candidate.fullName} (${candidate.position}).`,
          recipientEmail: candidate.email,
          recipientName: candidate.fullName,
          candidateId: candidate.id,
          candidateCode: candidate.candidateCode,
          onboardingUrl,
          deliveryStatus: emailDispatch.deliveryStatus,
          deliveryNote: emailDispatch.deliveryNote,
          isRead: false,
          createdAt: nowIso,
        });

        appendAudit(tx, {
          actorId: req.staffUser!.id,
          actorName: req.staffUser!.fullName,
          actorRole: req.staffUser!.role,
          action: 'CANDIDATE_REGISTERED',
          targetType: 'CANDIDATE',
          targetId: candidate.candidateCode,
          details: `Registered candidate ${candidate.fullName} (${candidate.position}) and generated onboarding token.`,
          ipAddress: getClientIp(req),
        });

        return {
          candidate,
          token: { ...serializeTokenMeta(tokenRecord), token: tokenStr },
          onboardingUrl,
          emailDispatch,
        };
      });

      return res.status(201).json(result);
    } catch (err) {
      console.error('Create candidate error:', err);
      return res.status(500).json({ error: 'Failed to register candidate.' });
    }
  });

  app.get('/api/candidates/:id', requireAuth, requirePermission('candidates', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const candidate = db.candidates.find((c) => c.id === req.params.id);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate record not found.' });
    }
    if (!isRecordAllowedForUser(req.staffUser!, candidate)) {
      return res.status(403).json({ error: 'Demo accounts cannot access real candidate records.' });
    }

    const tokens = db.tokens
      .filter((t) => t.candidateId === candidate.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(serializeTokenMeta);
    const documents = db.documents
      .filter((d) => d.candidateId === candidate.id)
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    const statusHistory = db.statusHistory
      .filter((h) => h.candidateId === candidate.id)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const employee = candidate.employeeId
      ? db.employees.find((e) => e.id === candidate.employeeId) || null
      : null;

    return res.json({
      candidate: redactCandidateForRole(candidate, req.staffUser!.role),
      tokens,
      documents,
      statusHistory,
      employee: employee ? redactEmployeeForRole(employee, req.staffUser!.role, false) : null,
      smtpConfigured: isSmtpConfigured(),
    });
  });

  app.patch('/api/candidates/:id', requireAuth, requirePermission('candidates', 'edit'), async (req: AuthRequest, res) => {
    try {
      const candidateId = req.params.id;
      const sanitized = sanitizeRecordStrings(req.body);
      const db = store.getSnapshot();
      const existing = db.candidates.find((c) => c.id === candidateId);
      if (!existing) return res.status(404).json({ error: 'Candidate not found.' });
      if (!isRecordAllowedForUser(req.staffUser!, existing)) {
        return res.status(403).json({ error: 'Demo accounts cannot modify real candidate records.' });
      }

      if (
        typeof sanitized.assignedRecruiterId === 'string' &&
        sanitized.assignedRecruiterId !== existing.assignedRecruiterId &&
        !hasPermission(req.staffUser!.effectivePermissions, 'candidates', 'assign')
      ) {
        return res.status(403).json({
          error: 'Only Admin or Super Admin can reassign candidates to another recruiter.',
        });
      }

      const updated = await store.withTransaction((tx) => {
        const cand = tx.candidates.find((c) => c.id === candidateId)!;
        if (typeof sanitized.fullName === 'string' && sanitized.fullName.length >= 2) {
          cand.fullName = sanitized.fullName;
          cand.personalInfo.fullName = sanitized.fullName;
        }
        if (typeof sanitized.position === 'string' && sanitized.position.length >= 2) {
          cand.position = sanitized.position;
        }
        if (typeof sanitized.department === 'string' && sanitized.department.length >= 2) {
          cand.department = sanitized.department;
        }
        if (typeof sanitized.joiningDate === 'string' && sanitized.joiningDate.length >= 4) {
          cand.joiningDate = sanitized.joiningDate;
        }
        if (typeof sanitized.assignedRecruiterId === 'string') {
          const rec = tx.users.find((u) => u.id === sanitized.assignedRecruiterId);
          if (rec) {
            cand.assignedRecruiterId = rec.id;
            cand.assignedRecruiterName = rec.fullName;
          }
        }
        cand.updatedAt = new Date().toISOString();

        appendAudit(tx, {
          actorId: req.staffUser!.id,
          actorName: req.staffUser!.fullName,
          actorRole: req.staffUser!.role,
          action: 'CANDIDATE_UPDATED',
          targetType: 'CANDIDATE',
          targetId: cand.candidateCode,
          details: `Updated candidate profile metadata for ${cand.fullName}.`,
          ipAddress: getClientIp(req),
        });
        return redactCandidateForRole(cand, req.staffUser!.role);
      });

      return res.json({ candidate: updated });
    } catch (err) {
      console.error('Update candidate error:', err);
      return res.status(500).json({ error: 'Failed to update candidate.' });
    }
  });

  const handleGenerateCandidateToken = async (req: AuthRequest, res: Response) => {
    try {
      const candidateId = req.params.id;
      const db = store.getSnapshot();
      const existing = db.candidates.find((c) => c.id === candidateId);
      if (!existing) return res.status(404).json({ error: 'Candidate not found.' });
      if (!isRecordAllowedForUser(req.staffUser!, existing)) {
        return res.status(403).json({ error: 'Demo accounts cannot manage tokens for real candidates.' });
      }

      const expiryHours = Math.min(
        720,
        Math.max(1, Number(req.body?.expiryHours || db.config.defaultLinkExpiryHours || 72))
      );

      const result = await store.withTransaction(async (tx) => {
        const cand = tx.candidates.find((c) => c.id === candidateId)!;
        const nowIso = new Date().toISOString();

        for (const t of tx.tokens) {
          if (t.candidateId === candidateId && !t.isRevoked) {
            t.isRevoked = true;
          }
        }

        const tokenStr = generateSecureOnboardingToken();
        const newToken: OnboardingToken = {
          id: `tok-${crypto.randomBytes(6).toString('hex')}`,
          candidateId,
          tokenHash: hashTokenSha256(tokenStr),
          tokenPrefix: tokenStr.slice(0, 10),
          expiresAt: new Date(Date.now() + expiryHours * 3600 * 1000).toISOString(),
          isRevoked: false,
          createdAt: nowIso,
          createdByName: req.staffUser!.fullName,
        };
        tx.tokens.unshift(newToken);

        if (cand.status === 'Draft') {
          const prev = cand.status;
          cand.status = 'Link Sent';
          cand.updatedAt = nowIso;
          tx.statusHistory.unshift({
            id: `sh-${crypto.randomBytes(6).toString('hex')}`,
            candidateId,
            fromStatus: prev,
            toStatus: 'Link Sent',
            changedById: req.staffUser!.id,
            changedByName: req.staffUser!.fullName,
            changedByRole: req.staffUser!.role,
            note: 'Generated new onboarding link.',
            timestamp: nowIso,
          });
        }

        const onboardingUrl = `/onboard/${tokenStr}`;
        const emailDispatch = await dispatchNotificationEmail({
          to: cand.email,
          subject: '9HR India Onboarding Link',
          body: `Complete your onboarding here: ${onboardingUrl}`,
        });

        tx.notifications.unshift({
          id: `notif-${crypto.randomBytes(6).toString('hex')}`,
          type: 'ONBOARDING_INVITATION',
          title: `Onboarding Link Regenerated: ${cand.fullName}`,
          message: `New onboarding link generated (valid ${expiryHours}h) for ${cand.fullName}.`,
          recipientEmail: cand.email,
          recipientName: cand.fullName,
          candidateId: cand.id,
          candidateCode: cand.candidateCode,
          onboardingUrl,
          deliveryStatus: emailDispatch.deliveryStatus,
          deliveryNote: emailDispatch.deliveryNote,
          isRead: false,
          createdAt: nowIso,
        });

        appendAudit(tx, {
          actorId: req.staffUser!.id,
          actorName: req.staffUser!.fullName,
          actorRole: req.staffUser!.role,
          action: 'TOKEN_GENERATED',
          targetType: 'TOKEN',
          targetId: cand.candidateCode,
          details: `Generated new onboarding token (expiry ${expiryHours}h) for ${cand.fullName}; prior active tokens revoked.`,
          ipAddress: getClientIp(req),
        });

        return {
          token: { ...serializeTokenMeta(newToken), token: tokenStr },
          onboardingUrl,
          emailDispatch,
        };
      });

      return res.json(result);
    } catch (err) {
      console.error('Generate token error:', err);
      return res.status(500).json({ error: 'Failed to generate onboarding link.' });
    }
  };

  app.post('/api/candidates/:id/token', requireAuth, requirePermission('candidates', 'edit'), handleGenerateCandidateToken);
  app.post('/api/candidates/:id/token/resend', requireAuth, requirePermission('candidates', 'edit'), handleGenerateCandidateToken);

  app.post('/api/candidates/:id/token/revoke', requireAuth, requirePermission('candidates', 'edit'), async (req: AuthRequest, res) => {
    try {
      const candidateId = req.params.id;
      const db = store.getSnapshot();
      const cand = db.candidates.find((c) => c.id === candidateId);
      if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
      if (!isRecordAllowedForUser(req.staffUser!, cand)) {
        return res.status(403).json({ error: 'Demo accounts cannot revoke real candidate links.' });
      }

      await store.withTransaction((tx) => {
        for (const t of tx.tokens) {
          if (t.candidateId === candidateId) t.isRevoked = true;
        }
        appendAudit(tx, {
          actorId: req.staffUser!.id,
          actorName: req.staffUser!.fullName,
          actorRole: req.staffUser!.role,
          action: 'TOKEN_REVOKED',
          targetType: 'TOKEN',
          targetId: cand.candidateCode,
          details: `Revoked all active onboarding links for ${cand.fullName}.`,
          ipAddress: getClientIp(req),
        });
      });

      return res.json({ success: true });
    } catch (err) {
      console.error('Revoke token error:', err);
      return res.status(500).json({ error: 'Failed to revoke onboarding links.' });
    }
  });

  app.patch('/api/candidates/:id/status', requireAuth, requirePermission('candidates', 'edit'), async (req: AuthRequest, res) => {
    try {
      const parsed = statusUpdateSchema.safeParse(sanitizeRecordStrings(req.body));
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid status.' });
      }

      const candidateId = req.params.id;
      const nextStatus: OnboardingStatus = parsed.data.status;
      const note = parsed.data.note || '';

      if (
        (nextStatus === 'Approved' || nextStatus === 'Rejected' || nextStatus === 'Onboarding Completed') &&
        !hasPermission(req.staffUser!.effectivePermissions, 'candidates', 'approve')
      ) {
        return res.status(403).json({
          error: 'Only Admin or Super Admin can approve, complete, or reject an onboarding application.',
        });
      }

      const db = store.getSnapshot();
      const existing = db.candidates.find((c) => c.id === candidateId);
      if (!existing) return res.status(404).json({ error: 'Candidate not found.' });
      if (!isRecordAllowedForUser(req.staffUser!, existing)) {
        return res.status(403).json({ error: 'Demo accounts cannot update real candidate statuses.' });
      }

      const updated = await store.withTransaction(async (tx) => {
        const cand = tx.candidates.find((c) => c.id === candidateId)!;
        const prevStatus = cand.status;
        const nowIso = new Date().toISOString();
        cand.status = nextStatus;
        cand.updatedAt = nowIso;
        if (nextStatus === 'Correction Required' && note) {
          cand.correctionNotes = note;
        }

        tx.statusHistory.unshift({
          id: `sh-${crypto.randomBytes(6).toString('hex')}`,
          candidateId: cand.id,
          fromStatus: prevStatus,
          toStatus: nextStatus,
          changedById: req.staffUser!.id,
          changedByName: req.staffUser!.fullName,
          changedByRole: req.staffUser!.role,
          note: note || `Status changed from ${prevStatus} to ${nextStatus}.`,
          timestamp: nowIso,
        });

        if (['Documents Pending', 'Correction Required', 'Approved', 'Onboarding Completed'].includes(nextStatus)) {
          const emailRes = await dispatchNotificationEmail({
            to: cand.email,
            subject: `9HR India Onboarding Update: ${nextStatus}`,
            body: note || `Your onboarding status is now ${nextStatus}.`,
          });

          const notifType =
            nextStatus === 'Documents Pending'
              ? 'DOCUMENTS_PENDING'
              : nextStatus === 'Correction Required'
                ? 'CORRECTION_REQUESTED'
                : nextStatus === 'Approved'
                  ? 'FINAL_APPROVAL'
                  : 'ONBOARDING_COMPLETED';

          tx.notifications.unshift({
            id: `notif-${crypto.randomBytes(6).toString('hex')}`,
            type: notifType,
            title: `${nextStatus}: ${cand.fullName}`,
            message: note || `Application status updated to ${nextStatus}.`,
            recipientEmail: cand.email,
            recipientName: cand.fullName,
            candidateId: cand.id,
            candidateCode: cand.candidateCode,
            deliveryStatus: emailRes.deliveryStatus,
            deliveryNote: emailRes.deliveryNote,
            isRead: false,
            createdAt: nowIso,
          });
        }

        appendAudit(tx, {
          actorId: req.staffUser!.id,
          actorName: req.staffUser!.fullName,
          actorRole: req.staffUser!.role,
          action: 'STATUS_UPDATED',
          targetType: 'CANDIDATE',
          targetId: cand.candidateCode,
          details: `Changed ${cand.fullName} status from ${prevStatus} to ${nextStatus}. ${note}`,
          ipAddress: getClientIp(req),
        });

        return cand;
      });

      return res.json({ candidate: redactCandidateForRole(updated, req.staffUser!.role) });
    } catch (err) {
      console.error('Status update error:', err);
      return res.status(500).json({ error: 'Failed to update status.' });
    }
  });

  app.post('/api/candidates/:id/request-correction', requireAuth, requirePermission('candidates', 'edit'), async (req: AuthRequest, res) => {
    try {
      const note = sanitizeText(req.body?.note);
      if (note.length < 5) {
        return res.status(400).json({ error: 'Provide clear correction instructions (min 5 characters).' });
      }

      const candidateId = req.params.id;
      const db = store.getSnapshot();
      const existing = db.candidates.find((c) => c.id === candidateId);
      if (!existing) return res.status(404).json({ error: 'Candidate not found.' });
      if (!isRecordAllowedForUser(req.staffUser!, existing)) {
        return res.status(403).json({ error: 'Demo accounts cannot request corrections for real candidates.' });
      }

      const result = await store.withTransaction(async (tx) => {
        const cand = tx.candidates.find((c) => c.id === candidateId)!;
        const prev = cand.status;
        const nowIso = new Date().toISOString();
        cand.status = 'Correction Required';
        cand.correctionNotes = note;
        cand.updatedAt = nowIso;

        // Reopen existing non-revoked unexpired token if consumed on submit, else generate a fresh token
        let activeTok = tx.tokens.find(
          (t) => t.candidateId === candidateId && !t.isRevoked && new Date(t.expiresAt).getTime() > Date.now()
        );
        let generatedUrl: string | undefined;
        if (activeTok) {
          activeTok.consumedAt = undefined;
        } else {
          const tokenStr = generateSecureOnboardingToken();
          activeTok = {
            id: `tok-${crypto.randomBytes(6).toString('hex')}`,
            candidateId,
            tokenHash: hashTokenSha256(tokenStr),
            tokenPrefix: tokenStr.slice(0, 10),
            expiresAt: new Date(Date.now() + (tx.config.defaultLinkExpiryHours || 72) * 3600 * 1000).toISOString(),
            isRevoked: false,
            createdAt: nowIso,
            createdByName: req.staffUser!.fullName,
          };
          tx.tokens.unshift(activeTok);
          generatedUrl = `/onboard/${tokenStr}`;
        }

        tx.statusHistory.unshift({
          id: `sh-${crypto.randomBytes(6).toString('hex')}`,
          candidateId,
          fromStatus: prev,
          toStatus: 'Correction Required',
          changedById: req.staffUser!.id,
          changedByName: req.staffUser!.fullName,
          changedByRole: req.staffUser!.role,
          note,
          timestamp: nowIso,
        });

        const emailDispatch = await dispatchNotificationEmail({
          to: cand.email,
          subject: 'Action Required: 9HR India Onboarding Correction Request',
          body: generatedUrl
            ? `${note} — Update your application at ${generatedUrl}`
            : `${note} — Please reopen your existing onboarding link to make corrections and resubmit.`,
        });

        tx.notifications.unshift({
          id: `notif-${crypto.randomBytes(6).toString('hex')}`,
          type: 'CORRECTION_REQUESTED',
          title: `Correction Requested: ${cand.fullName}`,
          message: note,
          recipientEmail: cand.email,
          recipientName: cand.fullName,
          candidateId: cand.id,
          candidateCode: cand.candidateCode,
          onboardingUrl: generatedUrl,
          deliveryStatus: emailDispatch.deliveryStatus,
          deliveryNote: emailDispatch.deliveryNote,
          isRead: false,
          createdAt: nowIso,
        });

        appendAudit(tx, {
          actorId: req.staffUser!.id,
          actorName: req.staffUser!.fullName,
          actorRole: req.staffUser!.role,
          action: 'CORRECTION_REQUESTED',
          targetType: 'CANDIDATE',
          targetId: cand.candidateCode,
          details: `Requested corrections for ${cand.fullName}: ${note}`,
          ipAddress: getClientIp(req),
        });

        return { candidate: cand, onboardingUrl: generatedUrl, tokenReopened: !generatedUrl, emailDispatch };
      });

      return res.json(result);
    } catch (err) {
      console.error('Request correction error:', err);
      return res.status(500).json({ error: 'Failed to send correction request.' });
    }
  });

  // Transactional Approve & Create Employee Record + Pending Activation Employee Account
  app.post(
    '/api/candidates/:id/approve-and-convert',
    requireAuth,
    requirePermission('candidates', 'approve'),
    async (req: AuthRequest, res) => {
      try {
        const candidateId = req.params.id;
        const db = store.getSnapshot();
        const existingCand = db.candidates.find((c) => c.id === candidateId);
        if (!existingCand) {
          return res.status(404).json({ error: 'Candidate not found.' });
        }
        if (!isRecordAllowedForUser(req.staffUser!, existingCand)) {
          return res.status(403).json({ error: 'Demo accounts cannot convert real candidates.' });
        }

        const result = await store.withTransaction(async (tx) => {
          const cand = tx.candidates.find((c) => c.id === candidateId);
          if (!cand) {
            throw Object.assign(new Error('Candidate not found.'), { statusCode: 404 });
          }
          if (cand.status === 'Rejected') {
            throw Object.assign(new Error('Cannot convert a rejected candidate.'), { statusCode: 400 });
          }
          const existingEmployee = tx.employees.find(
            (e) => e.candidateId === cand.id || (cand.employeeId && e.id === cand.employeeId)
          );
          if (existingEmployee) {
            throw Object.assign(
              new Error(`Duplicate prevented: Employee ${existingEmployee.employeeCode} already exists for this candidate.`),
              { statusCode: 409 }
            );
          }

          const nowIso = new Date().toISOString();
          const year = new Date().getFullYear();
          tx.counters.employeeSeq += 1;
          const employeeCode = `9HR-EMP-${year}-${String(tx.counters.employeeSeq).padStart(4, '0')}`;
          const employeeId = `emp-${crypto.randomBytes(6).toString('hex')}`;

          const reportingManagerId =
            typeof req.body?.reportingManagerId === 'string' && req.body.reportingManagerId
              ? req.body.reportingManagerId
              : 'usr-mgr-001';
          const managerUser = tx.users.find((u) => u.id === reportingManagerId);

          // Create or link EMPLOYEE user account with PENDING_ACTIVATION & single-use activation link
          let empUser = tx.users.find((u) => u.email.toLowerCase() === cand.email.toLowerCase());
          let activationUrl: string | undefined;
          if (!empUser) {
            tx.counters.staffSeq += 1;
            const userId = `usr-${crypto.randomBytes(6).toString('hex')}`;
            const loginId = `9HR-EMP-${String(tx.counters.staffSeq).padStart(3, '0')}`;
            empUser = {
              id: userId,
              loginId,
              email: cand.email.toLowerCase(),
              fullName: cand.personalInfo.fullName || cand.fullName,
              role: 'EMPLOYEE',
              department: cand.department,
              status: 'PENDING_ACTIVATION',
              isActive: false,
              mustChangePassword: true,
              reportingManagerId: managerUser?.id,
              reportingManagerName: managerUser?.fullName,
              employeeId,
              employeeCode,
              isDemo: cand.isDemo,
              passwordHash: hashPasswordSync(crypto.randomBytes(24).toString('hex')),
              createdAt: nowIso,
              updatedAt: nowIso,
            };
            tx.users.push(empUser);

            const rawActToken = crypto.randomBytes(24).toString('hex');
            activationUrl = `/activate/${rawActToken}`;
            tx.activationTokens.unshift({
              id: `act-${crypto.randomBytes(6).toString('hex')}`,
              userId: empUser.id,
              tokenHash: hashTokenSha256(rawActToken),
              expiresAt: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
              createdAt: nowIso,
            });
          } else {
            empUser.employeeId = employeeId;
            empUser.employeeCode = employeeCode;
          }

          const { confirmAccountNumber: _c, ...safeBank } = cand.bankDetails;
          const monthlyCtc =
            typeof req.body?.monthlyCtc === 'number' && req.body.monthlyCtc > 0
              ? Math.round(req.body.monthlyCtc)
              : 120000;

          const employee: Employee = {
            id: employeeId,
            employeeCode,
            candidateId: cand.id,
            candidateCode: cand.candidateCode,
            userId: empUser.id,
            reportingManagerId: managerUser?.id,
            reportingManagerName: managerUser?.fullName,
            fullName: cand.personalInfo.fullName || cand.fullName,
            email: cand.personalInfo.email || cand.email,
            mobile: cand.personalInfo.mobileNumber || cand.mobile,
            position: cand.position,
            department: cand.department,
            joiningDate: cand.joiningDate,
            assignedRecruiterName: cand.assignedRecruiterName,
            personalInfo: cand.personalInfo,
            addressInfo: cand.addressInfo,
            familyInfo: cand.familyInfo,
            educationInfo: cand.educationInfo,
            employmentInfo: cand.employmentInfo,
            bankDetails: safeBank,
            monthlyCtc,
            isDemo: cand.isDemo,
            createdByIsDemo: Boolean(req.staffUser!.isDemo || cand.createdByIsDemo),
            createdById: req.staffUser!.id,
            createdByName: req.staffUser!.fullName,
            createdAt: nowIso,
            updatedAt: nowIso,
          };

          const prevStatus = cand.status;
          cand.status = 'Onboarding Completed';
          cand.employeeId = employeeId;
          cand.employeeCode = employeeCode;
          cand.updatedAt = nowIso;

          for (const t of tx.tokens) {
            if (t.candidateId === cand.id) t.isRevoked = true;
          }

          tx.employees.unshift(employee);

          tx.statusHistory.unshift({
            id: `sh-${crypto.randomBytes(6).toString('hex')}`,
            candidateId: cand.id,
            fromStatus: prevStatus,
            toStatus: 'Onboarding Completed',
            changedById: req.staffUser!.id,
            changedByName: req.staffUser!.fullName,
            changedByRole: req.staffUser!.role,
            note: `Approved onboarding and created Employee ID ${employeeCode} and Employee portal account ${empUser.loginId}.`,
            timestamp: nowIso,
          });

          const emailDispatch = await dispatchNotificationEmail({
            to: cand.email,
            subject: `Congratulations! Your 9HR India Employee ID is ${employeeCode}`,
            body: activationUrl
              ? `Welcome aboard 9HR India Pvt. Ltd.! Your employee record ${employeeCode} (${empUser.loginId}) is ready. Activate your account and set your password at ${activationUrl}`
              : `Welcome aboard 9HR India Pvt. Ltd.! Your employee record ${employeeCode} has been activated.`,
          });

          tx.notifications.unshift({
            id: `notif-${crypto.randomBytes(6).toString('hex')}`,
            type: 'ONBOARDING_COMPLETED',
            title: `Employee Created: ${employeeCode} (${employee.fullName})`,
            message: `Onboarding approved and employee profile ${employeeCode} created in ${employee.department}.`,
            recipientEmail: employee.email,
            recipientName: employee.fullName,
            candidateId: cand.id,
            candidateCode: cand.candidateCode,
            deliveryStatus: emailDispatch.deliveryStatus,
            deliveryNote: emailDispatch.deliveryNote,
            isRead: false,
            createdAt: nowIso,
          });

          appendAudit(tx, {
            actorId: req.staffUser!.id,
            actorName: req.staffUser!.fullName,
            actorRole: req.staffUser!.role,
            action: 'EMPLOYEE_CREATED',
            targetType: 'EMPLOYEE',
            targetId: employeeCode,
            details: `Converted candidate ${cand.candidateCode} (${cand.fullName}) into Employee ${employeeCode} (Login ID ${empUser.loginId}).`,
            ipAddress: getClientIp(req),
          });

          return {
            candidate: cand,
            employee,
            employeeAccount: toPublicStaffUser(empUser, tx.rolePermissions),
            activationUrl,
            emailDispatch,
          };
        });

        return res.status(201).json(result);
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode || 500;
        const message = err instanceof Error ? err.message : 'Failed to convert candidate to employee.';
        return res.status(status).json({ error: message });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Document Verification & Authorized File Serving
  // ---------------------------------------------------------------------------
  app.get('/api/documents/queue', requireAuth, requirePermission('documents', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const statusFilter = (req.query.status as string) || 'ALL';
    const user = req.staffUser!;

    const ownEmployee = user.role === 'EMPLOYEE'
      ? db.employees.find((e) => e.id === user.employeeId || e.userId === user.id)
      : undefined;

    const items = db.documents
      .filter((d) => (statusFilter === 'ALL' ? true : d.verificationStatus === statusFilter))
      .map((d) => {
        const cand = db.candidates.find((c) => c.id === d.candidateId);
        return { d, cand };
      })
      .filter(({ cand }) => {
        if (!cand) return false;
        if (!isRecordAllowedForUser(user, cand)) return false;
        if (user.role === 'EMPLOYEE') {
          return ownEmployee ? cand.id === ownEmployee.candidateId : false;
        }
        return true;
      })
      .map(({ d, cand }) => ({
        ...d,
        candidateCode: cand?.candidateCode || '',
        candidateName: cand?.fullName || 'Unknown',
        candidateDepartment: cand?.department || '',
        candidateStatus: cand?.status || 'Draft',
        isDemo: cand?.isDemo ?? false,
      }))
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

    res.json({ items });
  });

  app.get('/api/documents/:docId/file', requireAuth, requirePermission('documents', 'download'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const doc = db.documents.find((d) => d.id === req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    const cand = db.candidates.find((c) => c.id === doc.candidateId);
    if (cand && !isRecordAllowedForUser(req.staffUser!, cand)) {
      return res.status(403).json({ error: 'Demo accounts cannot access real candidate documents.' });
    }
    if (req.staffUser!.role === 'EMPLOYEE') {
      const ownEmp = db.employees.find(
        (e) => e.id === req.staffUser!.employeeId || e.userId === req.staffUser!.id
      );
      if (!ownEmp || ownEmp.candidateId !== doc.candidateId) {
        return res.status(403).json({ error: 'Employees may only access their own documents.' });
      }
    }

    const safeKey = path.basename(doc.storageKey);
    const fullPath = path.join(store.uploadDir, safeKey);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Document binary file missing from private storage.' });
    }

    const download = req.query.download === '1' || req.query.download === 'true';
    const disposition = download ? 'attachment' : 'inline';
    const safeFileName = doc.originalName.replace(/["\\\r\n]/g, '_');

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${safeFileName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(fullPath);
  });

  app.post('/api/documents/:docId/verify', requireAuth, requirePermission('documents', 'approve'), async (req: AuthRequest, res) => {
    try {
      const status = req.body?.status;
      const reason = sanitizeText(req.body?.reason || '');
      if (status !== 'Approved' && status !== 'Rejected') {
        return res.status(400).json({ error: 'Verification status must be Approved or Rejected.' });
      }
      if (status === 'Rejected' && reason.length < 3) {
        return res.status(400).json({ error: 'Provide a clear rejection reason.' });
      }

      const docId = req.params.docId;
      const db = store.getSnapshot();
      const existing = db.documents.find((d) => d.id === docId);
      if (!existing) return res.status(404).json({ error: 'Document not found.' });
      const existingCand = db.candidates.find((c) => c.id === existing.candidateId);
      if (existingCand && !isRecordAllowedForUser(req.staffUser!, existingCand)) {
        return res.status(403).json({ error: 'Demo accounts cannot verify real candidate documents.' });
      }

      const updatedDoc = await store.withTransaction(async (tx) => {
        const doc = tx.documents.find((d) => d.id === docId)!;
        const cand = tx.candidates.find((c) => c.id === doc.candidateId);
        const nowIso = new Date().toISOString();

        doc.verificationStatus = status;
        doc.rejectionReason = status === 'Rejected' ? reason : undefined;
        doc.verifiedAt = nowIso;
        doc.verifiedByName = req.staffUser!.fullName;
        doc.history.unshift({
          id: `vh-${crypto.randomBytes(6).toString('hex')}`,
          status,
          reviewedById: req.staffUser!.id,
          reviewedByName: req.staffUser!.fullName,
          reason: reason || undefined,
          timestamp: nowIso,
        });

        if (cand) {
          const candDocs = tx.documents.filter((d) => d.candidateId === cand.id);
          cand.completionPct = calculateCompletionPercentage(cand, candDocs);
          cand.updatedAt = nowIso;

          if (status === 'Rejected') {
            const emailDispatch = await dispatchNotificationEmail({
              to: cand.email,
              subject: `9HR India Document Rejected: ${doc.category}`,
              body: `Your ${doc.category} was rejected: ${reason}`,
            });

            tx.notifications.unshift({
              id: `notif-${crypto.randomBytes(6).toString('hex')}`,
              type: 'DOCUMENT_REJECTED',
              title: `Document Rejected (${doc.category}): ${cand.fullName}`,
              message: `Reason: ${reason}`,
              recipientEmail: cand.email,
              recipientName: cand.fullName,
              candidateId: cand.id,
              candidateCode: cand.candidateCode,
              deliveryStatus: emailDispatch.deliveryStatus,
              deliveryNote: emailDispatch.deliveryNote,
              isRead: false,
              createdAt: nowIso,
            });
          }
        }

        appendAudit(tx, {
          actorId: req.staffUser!.id,
          actorName: req.staffUser!.fullName,
          actorRole: req.staffUser!.role,
          action: status === 'Approved' ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED',
          targetType: 'DOCUMENT',
          targetId: doc.id,
          details: `${status} ${doc.category} for candidate ${cand?.candidateCode || doc.candidateId}${reason ? `: ${reason}` : ''}`,
          ipAddress: getClientIp(req),
        });

        return doc;
      });

      return res.json({ document: updatedDoc });
    } catch (err) {
      console.error('Document verify error:', err);
      return res.status(500).json({ error: 'Failed to update document verification.' });
    }
  });

  // ---------------------------------------------------------------------------
  // Employees (Record-Level Ownership + Department/Manager Scoping + Redaction)
  // ---------------------------------------------------------------------------
  app.get('/api/employees', requireAuth, requirePermission('employees', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const scope = (req.query.scope as string) || 'all';
    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const department = (req.query.department as string) || 'ALL';
    const managedIds = getManagedEmployeeIds(db, user.id);

    const items = db.employees
      .filter((e) => {
        if (!isRecordAllowedForUser(user, e)) return false;
        if (user.role === 'EMPLOYEE' && e.id !== user.employeeId && e.userId !== user.id) {
          return false;
        }
        if (user.role === 'MANAGER' && !managedIds.has(e.id)) {
          return false;
        }
        if (scope === 'live' && e.isDemo) return false;
        if (scope === 'demo' && !e.isDemo) return false;
        if (department !== 'ALL' && e.department !== department) return false;
        if (search) {
          const hay = `${e.employeeCode} ${e.fullName} ${e.email} ${e.position} ${e.department}`.toLowerCase();
          if (!hay.includes(search)) return false;
        }
        return true;
      })
      .map((e) => redactEmployeeForRole(e, user.role, e.id === user.employeeId || e.userId === user.id));

    res.json({ items });
  });

  app.get('/api/employees/:id', requireAuth, requirePermission('employees', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const employee = db.employees.find((e) => e.id === req.params.id);
    if (!employee) return res.status(404).json({ error: 'Employee not found.' });
    if (!isRecordAllowedForUser(user, employee)) {
      return res.status(403).json({ error: 'Demo accounts cannot access real employee records.' });
    }
    const isSelf = employee.id === user.employeeId || employee.userId === user.id;
    if (user.role === 'EMPLOYEE' && !isSelf) {
      return res.status(403).json({ error: 'Employees may only view their own profile.' });
    }
    if (user.role === 'MANAGER') {
      const managed = getManagedEmployeeIds(db, user.id);
      if (!managed.has(employee.id)) {
        return res.status(403).json({ error: 'Managers may only access their assigned direct reports.' });
      }
    }
    return res.json({ employee: redactEmployeeForRole(employee, user.role, isSelf) });
  });

  app.patch('/api/employees/:id', requireAuth, requirePermission('employees', 'edit'), async (req: AuthRequest, res) => {
    try {
      const db = store.getSnapshot();
      const user = req.staffUser!;
      const employee = db.employees.find((e) => e.id === req.params.id);
      if (!employee) return res.status(404).json({ error: 'Employee not found.' });
      if (!isRecordAllowedForUser(user, employee)) {
        return res.status(403).json({ error: 'Demo accounts cannot modify real employee records.' });
      }

      const isSelf = employee.id === user.employeeId || employee.userId === user.id;
      if (user.role === 'EMPLOYEE' && !isSelf) {
        return res.status(403).json({ error: 'Employees may only update their own profile.' });
      }

      const sanitized = sanitizeRecordStrings(req.body || {});
      if (user.role === 'EMPLOYEE') {
        const selfParsed = employeeSelfUpdateSchema.safeParse(sanitized);
        if (!selfParsed.success) {
          return res.status(400).json({ error: selfParsed.error.issues[0]?.message || 'Invalid profile update.' });
        }
        const d = selfParsed.data;
        const updated = await store.withTransaction((tx) => {
          const emp = tx.employees.find((e) => e.id === employee.id)!;
          if (d.mobile) {
            emp.mobile = d.mobile;
            emp.personalInfo.mobileNumber = d.mobile;
          }
          if (d.currentAddress) emp.addressInfo.currentAddress = d.currentAddress;
          if (d.permanentAddress) emp.addressInfo.permanentAddress = d.permanentAddress;
          if (d.city) emp.addressInfo.city = d.city;
          if (d.state) emp.addressInfo.state = d.state;
          if (d.pinCode) emp.addressInfo.pinCode = d.pinCode;
          if (d.emergencyContactName) emp.familyInfo.emergencyContactName = d.emergencyContactName;
          if (d.emergencyContactRelation) emp.familyInfo.emergencyContactRelation = d.emergencyContactRelation;
          if (d.emergencyContactPhone) emp.familyInfo.emergencyContactPhone = d.emergencyContactPhone;
          emp.updatedAt = new Date().toISOString();
          appendAudit(tx, {
            actorId: user.id,
            actorName: user.fullName,
            actorRole: user.role,
            action: 'EMPLOYEE_SELF_UPDATED',
            targetType: 'EMPLOYEE',
            targetId: emp.employeeCode,
            details: `Employee ${emp.employeeCode} updated personal contact details.`,
            ipAddress: getClientIp(req),
          });
          return emp;
        });
        return res.json({ employee: updated });
      }

      const updated = await store.withTransaction((tx) => {
        const emp = tx.employees.find((e) => e.id === employee.id)!;
        if (typeof sanitized.position === 'string' && sanitized.position) emp.position = sanitized.position;
        if (typeof sanitized.department === 'string' && sanitized.department) emp.department = sanitized.department;
        if (typeof sanitized.mobile === 'string' && sanitized.mobile) emp.mobile = sanitized.mobile;
        if (typeof sanitized.reportingManagerId === 'string') {
          const mgr = tx.users.find((u) => u.id === sanitized.reportingManagerId);
          emp.reportingManagerId = mgr?.id;
          emp.reportingManagerName = mgr?.fullName;
        }
        if (typeof req.body?.monthlyCtc === 'number' && req.body.monthlyCtc > 0 && ['SUPER_ADMIN', 'ADMIN'].includes(user.role)) {
          emp.monthlyCtc = Math.round(req.body.monthlyCtc);
        }
        emp.updatedAt = new Date().toISOString();
        appendAudit(tx, {
          actorId: user.id,
          actorName: user.fullName,
          actorRole: user.role,
          action: 'EMPLOYEE_UPDATED',
          targetType: 'EMPLOYEE',
          targetId: emp.employeeCode,
          details: `Updated employee record ${emp.employeeCode}.`,
          ipAddress: getClientIp(req),
        });
        return emp;
      });
      return res.json({ employee: updated });
    } catch (err) {
      console.error('Update employee error:', err);
      return res.status(500).json({ error: 'Failed to update employee.' });
    }
  });

  // ---------------------------------------------------------------------------
  // Departments, Attendance & Leave Management
  // ---------------------------------------------------------------------------
  app.get('/api/departments', requireAuth, requirePermission('departments', 'view'), (_req, res) => {
    const db = store.getSnapshot();
    res.json({ departments: db.config.departments });
  });

  app.post('/api/departments', requireAuth, requirePermission('departments', 'create'), async (req: AuthRequest, res) => {
    const name = sanitizeText(req.body?.name);
    if (name.length < 2) return res.status(400).json({ error: 'Department name required.' });
    const updated = await store.withTransaction((tx) => {
      if (!tx.config.departments.some((d) => d.toLowerCase() === name.toLowerCase())) {
        tx.config.departments.push(name);
      }
      tx.config.updatedAt = new Date().toISOString();
      appendAudit(tx, {
        actorId: req.staffUser!.id,
        actorName: req.staffUser!.fullName,
        actorRole: req.staffUser!.role,
        action: 'DEPARTMENT_CREATED',
        targetType: 'SYSTEM',
        targetId: name,
        details: `Added department "${name}".`,
        ipAddress: getClientIp(req),
      });
      return tx.config.departments;
    });
    res.status(201).json({ departments: updated });
  });

  app.get('/api/attendance', requireAuth, requirePermission('attendance', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const managedIds = getManagedEmployeeIds(db, user.id);

    const items = db.attendance.filter((a) => {
      if (!isRecordAllowedForUser(user, a)) return false;
      if (user.role === 'EMPLOYEE') return a.userId === user.id || a.employeeId === user.employeeId;
      if (user.role === 'MANAGER') return managedIds.has(a.employeeId) || a.userId === user.id;
      return true;
    });
    res.json({ items });
  });

  app.post('/api/attendance', requireAuth, requirePermission('attendance', 'create'), async (req: AuthRequest, res) => {
    const parsed = attendanceSchema.safeParse(sanitizeRecordStrings(req.body || {}));
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid attendance data.' });
    }
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const targetEmpId =
      user.role === 'EMPLOYEE' || !parsed.data.employeeId ? user.employeeId : parsed.data.employeeId;
    const emp = db.employees.find((e) => e.id === targetEmpId || e.userId === user.id);
    if (!emp) {
      return res.status(400).json({ error: 'Employee profile not found for attendance logging.' });
    }
    if (user.role === 'EMPLOYEE' && emp.id !== user.employeeId && emp.userId !== user.id) {
      return res.status(403).json({ error: 'Employees may only log their own attendance.' });
    }

    const record = await store.withTransaction((tx) => {
      const rec = {
        id: `att-${crypto.randomBytes(6).toString('hex')}`,
        employeeId: emp.id,
        employeeCode: emp.employeeCode,
        employeeName: emp.fullName,
        userId: emp.userId || user.id,
        department: emp.department,
        reportingManagerId: emp.reportingManagerId,
        date: parsed.data.date,
        status: parsed.data.status,
        checkIn: new Date().toTimeString().slice(0, 5),
        approvalStatus: ['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user.role)
          ? ('APPROVED' as const)
          : ('PENDING' as const),
        isDemo: emp.isDemo,
        createdByIsDemo: Boolean(user.isDemo || emp.createdByIsDemo),
        createdAt: new Date().toISOString(),
      };
      tx.attendance.unshift(rec);
      appendAudit(tx, {
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: 'ATTENDANCE_LOGGED',
        targetType: 'ATTENDANCE',
        targetId: rec.id,
        details: `Logged ${rec.status} attendance for ${emp.employeeCode} on ${rec.date}.`,
        ipAddress: getClientIp(req),
      });
      return rec;
    });
    return res.status(201).json({ record });
  });

  app.get('/api/leave', requireAuth, requirePermission('leave', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const managedIds = getManagedEmployeeIds(db, user.id);
    const items = db.leaveRequests.filter((l) => {
      if (!isRecordAllowedForUser(user, l)) return false;
      if (user.role === 'EMPLOYEE') return l.userId === user.id || l.employeeId === user.employeeId;
      if (user.role === 'MANAGER') return managedIds.has(l.employeeId) || l.userId === user.id;
      return true;
    });
    res.json({ items });
  });

  app.post('/api/leave', requireAuth, requirePermission('leave', 'create'), async (req: AuthRequest, res) => {
    const parsed = leaveRequestSchema.safeParse({
      ...sanitizeRecordStrings(req.body || {}),
      days: Number(req.body?.days || 1),
    });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid leave request.' });
    }
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const emp = db.employees.find((e) => e.id === user.employeeId || e.userId === user.id);
    const leaveRecord = await store.withTransaction((tx) => {
      const nowIso = new Date().toISOString();
      const item = {
        id: `lv-${crypto.randomBytes(6).toString('hex')}`,
        employeeId: emp?.id || user.id,
        employeeCode: emp?.employeeCode || user.loginId,
        employeeName: emp?.fullName || user.fullName,
        userId: user.id,
        department: emp?.department || user.department,
        reportingManagerId: emp?.reportingManagerId,
        leaveType: parsed.data.leaveType,
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        days: parsed.data.days,
        reason: parsed.data.reason,
        status: 'PENDING' as const,
        isDemo: Boolean(emp?.isDemo ?? user.isDemo),
        createdByIsDemo: Boolean(user.isDemo),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      tx.leaveRequests.unshift(item);
      appendAudit(tx, {
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: 'LEAVE_APPLIED',
        targetType: 'LEAVE',
        targetId: item.id,
        details: `${user.fullName} applied for ${item.days} day(s) ${item.leaveType} leave.`,
        ipAddress: getClientIp(req),
      });
      return item;
    });
    return res.status(201).json({ leaveRequest: leaveRecord });
  });

  app.patch('/api/leave/:id/decision', requireAuth, requirePermission('leave', 'approve'), async (req: AuthRequest, res) => {
    const decision = req.body?.status;
    const reviewNote = sanitizeText(req.body?.note || '');
    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      return res.status(400).json({ error: 'Leave decision must be APPROVED or REJECTED.' });
    }
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const leave = db.leaveRequests.find((l) => l.id === req.params.id);
    if (!leave) return res.status(404).json({ error: 'Leave request not found.' });
    if (!isRecordAllowedForUser(user, leave)) {
      return res.status(403).json({ error: 'Demo accounts cannot approve real leave requests.' });
    }

    // Cannot approve own leave
    if (leave.userId === user.id || (user.employeeId && leave.employeeId === user.employeeId)) {
      return res.status(403).json({ error: 'You cannot approve or reject your own leave request.' });
    }
    // Managers can only approve leave for their assigned team members
    if (user.role === 'MANAGER') {
      const managedIds = getManagedEmployeeIds(db, user.id);
      if (!managedIds.has(leave.employeeId) && leave.reportingManagerId !== user.id) {
        return res.status(403).json({ error: 'Managers may only approve leave requests for their direct reports.' });
      }
    }

    const updated = await store.withTransaction((tx) => {
      const item = tx.leaveRequests.find((l) => l.id === leave.id)!;
      item.status = decision;
      item.reviewedById = user.id;
      item.reviewedByName = user.fullName;
      item.reviewNote = reviewNote || undefined;
      item.updatedAt = new Date().toISOString();
      appendAudit(tx, {
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: `LEAVE_${decision}`,
        targetType: 'LEAVE',
        targetId: item.id,
        details: `${user.role} ${decision.toLowerCase()} leave request ${item.id} for ${item.employeeName}.`,
        ipAddress: getClientIp(req),
      });
      return item;
    });
    return res.json({ leaveRequest: updated });
  });

  // ---------------------------------------------------------------------------
  // Payroll & Finance Workflows (Strict Segregation of Duties)
  // ---------------------------------------------------------------------------
  app.get('/api/payroll', requireAuth, requirePermission('payroll', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const runs = db.payrollRuns
      .filter((r) => isRecordAllowedForUser(user, r))
      .map((r) => {
        if (user.role === 'EMPLOYEE') {
          const ownEntries = r.entries.filter(
            (e) => e.employeeId === user.employeeId || e.userId === user.id
          );
          return {
            ...r,
            entries: ownEntries,
          };
        }
        return r;
      })
      .filter((r) => (user.role === 'EMPLOYEE' ? r.entries.length > 0 : true));

    res.json({ runs });
  });

  app.post('/api/payroll', requireAuth, requirePermission('payroll', 'create'), async (req: AuthRequest, res) => {
    const parsed = payrollCreateSchema.safeParse(sanitizeRecordStrings(req.body || {}));
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid payroll run data.' });
    }
    const db = store.getSnapshot();
    const user = req.staffUser!;
    if (db.payrollRuns.some((r) => r.period === parsed.data.period && isRecordAllowedForUser(user, r))) {
      return res.status(409).json({ error: `A payroll run for period ${parsed.data.period} already exists.` });
    }

    const eligibleEmployees = db.employees.filter((e) => {
      if (!isRecordAllowedForUser(user, e)) return false;
      if (parsed.data.scope === 'demo') return e.isDemo;
      if (parsed.data.scope === 'live') return !e.isDemo;
      return true;
    });

    const run = await store.withTransaction((tx) => {
      const nowIso = new Date().toISOString();
      const runId = `pay-${parsed.data.period}-${crypto.randomBytes(3).toString('hex')}`;
      const entries: PayrollEntry[] = eligibleEmployees.map((emp) => {
        const gross = emp.monthlyCtc || 120000;
        const basicSalary = Math.round(gross * 0.5);
        const hra = Math.round(gross * 0.25);
        const allowances = gross - basicSalary - hra;
        const lopDays = tx.attendance.filter(
          (a) => a.employeeId === emp.id && a.status === 'LOP' && a.date.startsWith(parsed.data.period)
        ).length;
        const lopDeduction = Math.round((gross / 30) * lopDays);
        const pfDeduction = Math.round(basicSalary * 0.12);
        const esiDeduction = gross <= 21000 ? Math.round(gross * 0.0075) : 0;
        const professionalTax = 200;
        const tdsDeduction = Math.round(Math.max(0, gross - 50000) * 0.1);
        const totalDeductions = lopDeduction + pfDeduction + esiDeduction + professionalTax + tdsDeduction;
        const netPay = Math.max(0, gross - totalDeductions);

        return {
          id: `pe-${crypto.randomBytes(5).toString('hex')}`,
          payrollRunId: runId,
          employeeId: emp.id,
          employeeCode: emp.employeeCode,
          employeeName: emp.fullName,
          userId: emp.userId,
          department: emp.department,
          bankAccountMasked: maskAccountNumber(emp.bankDetails?.accountNumber || ''),
          ifscCode: emp.bankDetails?.ifscCode || 'PENDING',
          basicSalary,
          hra,
          allowances,
          lopDays,
          lopDeduction,
          pfDeduction,
          esiDeduction,
          professionalTax,
          tdsDeduction,
          grossEarnings: gross,
          totalDeductions,
          netPay,
          paymentStatus: 'PENDING',
          isDemo: emp.isDemo,
        };
      });

      const payrollRun: PayrollRun = {
        id: runId,
        monthLabel: parsed.data.monthLabel,
        period: parsed.data.period,
        status: 'DRAFT',
        locked: false,
        totalGross: entries.reduce((s, e) => s + e.grossEarnings, 0),
        totalDeductions: entries.reduce((s, e) => s + e.totalDeductions, 0),
        totalNetPay: entries.reduce((s, e) => s + e.netPay, 0),
        employeeCount: entries.length,
        createdById: user.id,
        createdByName: user.fullName,
        entries,
        isDemo: Boolean(user.isDemo),
        createdByIsDemo: Boolean(user.isDemo),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      tx.payrollRuns.unshift(payrollRun);
      appendAudit(tx, {
        actorId: user.id,
        actorName: user.fullName,
        actorRole: user.role,
        action: 'PAYROLL_DRAFT_CREATED',
        targetType: 'PAYROLL',
        targetId: payrollRun.id,
        details: `Generated payroll draft for ${payrollRun.monthLabel} (${payrollRun.employeeCount} employees).`,
        ipAddress: getClientIp(req),
      });
      return payrollRun;
    });

    return res.status(201).json({ run });
  });

  // Update draft payroll entry (blocked once locked or submitted, and Finance cannot modify calculations)
  app.patch('/api/payroll/:id/entries/:entryId', requireAuth, requirePermission('payroll', 'edit'), async (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const run = db.payrollRuns.find((r) => r.id === req.params.id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
    if (!isRecordAllowedForUser(req.staffUser!, run)) {
      return res.status(403).json({ error: 'Demo accounts cannot edit real payroll runs.' });
    }
    if (run.locked || run.status !== 'DRAFT') {
      return res.status(403).json({ error: 'Locked or submitted payroll calculations cannot be modified.' });
    }

    const updated = await store.withTransaction((tx) => {
      const r = tx.payrollRuns.find((item) => item.id === run.id)!;
      const entry = r.entries.find((e) => e.id === req.params.entryId);
      if (!entry) return null;

      if (typeof req.body?.allowances === 'number' && req.body.allowances >= 0) {
        entry.allowances = Math.round(req.body.allowances);
      }
      if (typeof req.body?.tdsDeduction === 'number' && req.body.tdsDeduction >= 0) {
        entry.tdsDeduction = Math.round(req.body.tdsDeduction);
      }
      entry.grossEarnings = entry.basicSalary + entry.hra + entry.allowances;
      entry.totalDeductions =
        entry.lopDeduction +
        entry.pfDeduction +
        entry.esiDeduction +
        entry.professionalTax +
        entry.tdsDeduction;
      entry.netPay = Math.max(0, entry.grossEarnings - entry.totalDeductions);

      r.totalGross = r.entries.reduce((s, e) => s + e.grossEarnings, 0);
      r.totalDeductions = r.entries.reduce((s, e) => s + e.totalDeductions, 0);
      r.totalNetPay = r.entries.reduce((s, e) => s + e.netPay, 0);
      r.updatedAt = new Date().toISOString();

      appendAudit(tx, {
        actorId: req.staffUser!.id,
        actorName: req.staffUser!.fullName,
        actorRole: req.staffUser!.role,
        action: 'PAYROLL_ENTRY_UPDATED',
        targetType: 'PAYROLL',
        targetId: r.id,
        details: `Updated payroll calculation for ${entry.employeeCode} in ${r.period}.`,
        ipAddress: getClientIp(req),
      });
      return r;
    });

    if (!updated) return res.status(404).json({ error: 'Payroll entry not found.' });
    return res.json({ run: updated });
  });

  app.post('/api/payroll/:id/submit', requireAuth, requirePermission('payroll', 'edit'), async (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const run = db.payrollRuns.find((r) => r.id === req.params.id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
    if (!isRecordAllowedForUser(req.staffUser!, run)) {
      return res.status(403).json({ error: 'Demo accounts cannot submit real payroll runs.' });
    }
    if (run.status !== 'DRAFT') {
      return res.status(400).json({ error: 'Only DRAFT payroll runs can be submitted for approval.' });
    }

    const updated = await store.withTransaction((tx) => {
      const r = tx.payrollRuns.find((item) => item.id === run.id)!;
      const nowIso = new Date().toISOString();
      r.status = 'SUBMITTED';
      r.locked = true;
      r.submittedById = req.staffUser!.id;
      r.submittedByName = req.staffUser!.fullName;
      r.submittedAt = nowIso;
      r.updatedAt = nowIso;
      appendAudit(tx, {
        actorId: req.staffUser!.id,
        actorName: req.staffUser!.fullName,
        actorRole: req.staffUser!.role,
        action: 'PAYROLL_SUBMITTED',
        targetType: 'PAYROLL',
        targetId: r.id,
        details: `Submitted and locked payroll ${r.monthLabel} for Finance & Super Admin approval.`,
        ipAddress: getClientIp(req),
      });
      return r;
    });

    return res.json({ run: updated });
  });

  app.post('/api/payroll/:id/finance-review', requireAuth, requirePermission('finance', 'approve'), async (req: AuthRequest, res) => {
    const decision = req.body?.decision === 'REJECT' ? 'REJECT' : 'APPROVE';
    const note = sanitizeText(req.body?.note || '');
    const db = store.getSnapshot();
    const run = db.payrollRuns.find((r) => r.id === req.params.id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
    if (!isRecordAllowedForUser(req.staffUser!, run)) {
      return res.status(403).json({ error: 'Demo accounts cannot review real payroll runs.' });
    }
    if (run.status !== 'SUBMITTED') {
      return res.status(400).json({ error: 'Payroll run must be in SUBMITTED status for Finance review.' });
    }
    if (run.submittedById === req.staffUser!.id && req.staffUser!.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Segregation of duties: submitter cannot approve their own payroll run.' });
    }

    const updated = await store.withTransaction((tx) => {
      const r = tx.payrollRuns.find((item) => item.id === run.id)!;
      const nowIso = new Date().toISOString();
      r.status = decision === 'REJECT' ? 'REJECTED' : 'FINANCE_APPROVED';
      if (decision === 'REJECT') r.locked = false;
      r.financeReviewedById = req.staffUser!.id;
      r.financeReviewedByName = req.staffUser!.fullName;
      r.financeReviewedAt = nowIso;
      r.financeNote = note || undefined;
      r.updatedAt = nowIso;
      appendAudit(tx, {
        actorId: req.staffUser!.id,
        actorName: req.staffUser!.fullName,
        actorRole: req.staffUser!.role,
        action: decision === 'REJECT' ? 'PAYROLL_FINANCE_REJECTED' : 'PAYROLL_FINANCE_APPROVED',
        targetType: 'FINANCE',
        targetId: r.id,
        details: `Finance ${decision.toLowerCase()}ed payroll ${r.monthLabel}. ${note}`,
        ipAddress: getClientIp(req),
      });
      return r;
    });

    return res.json({ run: updated });
  });

  app.post('/api/payroll/:id/final-approve', requireAuth, requirePermission('payroll', 'approve'), async (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const run = db.payrollRuns.find((r) => r.id === req.params.id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
    if (!isRecordAllowedForUser(req.staffUser!, run)) {
      return res.status(403).json({ error: 'Demo accounts cannot approve real payroll runs.' });
    }
    if (!['SUBMITTED', 'FINANCE_APPROVED'].includes(run.status)) {
      return res.status(400).json({ error: 'Payroll must be submitted or finance-approved before final approval.' });
    }
    if (run.submittedById === req.staffUser!.id && req.staffUser!.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Cannot approve your own payroll submission.' });
    }

    const updated = await store.withTransaction((tx) => {
      const r = tx.payrollRuns.find((item) => item.id === run.id)!;
      const nowIso = new Date().toISOString();
      r.status = 'FINAL_APPROVED';
      r.locked = true;
      r.finalApprovedById = req.staffUser!.id;
      r.finalApprovedByName = req.staffUser!.fullName;
      r.finalApprovedAt = nowIso;
      r.updatedAt = nowIso;
      appendAudit(tx, {
        actorId: req.staffUser!.id,
        actorName: req.staffUser!.fullName,
        actorRole: req.staffUser!.role,
        action: 'PAYROLL_FINAL_APPROVED',
        targetType: 'PAYROLL',
        targetId: r.id,
        details: `Super Admin gave final approval for payroll ${r.monthLabel}.`,
        ipAddress: getClientIp(req),
      });
      return r;
    });

    return res.json({ run: updated });
  });

  app.post('/api/payroll/:id/release-payment', requireAuth, requirePermission('finance', 'manage'), async (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const run = db.payrollRuns.find((r) => r.id === req.params.id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
    if (!isRecordAllowedForUser(req.staffUser!, run)) {
      return res.status(403).json({ error: 'Demo accounts cannot release real payroll payments.' });
    }
    if (run.status !== 'FINAL_APPROVED' && run.status !== 'FINANCE_APPROVED') {
      return res.status(400).json({ error: 'Payroll must be approved before releasing bank payments.' });
    }

    const updated = await store.withTransaction((tx) => {
      const r = tx.payrollRuns.find((item) => item.id === run.id)!;
      const nowIso = new Date().toISOString();
      r.status = 'PAID';
      r.locked = true;
      r.paymentReleasedById = req.staffUser!.id;
      r.paymentReleasedByName = req.staffUser!.fullName;
      r.paymentReleasedAt = nowIso;
      r.updatedAt = nowIso;
      for (const e of r.entries) {
        e.paymentStatus = 'PAID';
        e.paymentReference = `NEFT9HR${r.period.replace('-', '')}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      }
      appendAudit(tx, {
        actorId: req.staffUser!.id,
        actorName: req.staffUser!.fullName,
        actorRole: req.staffUser!.role,
        action: 'PAYROLL_PAYMENT_RELEASED',
        targetType: 'FINANCE',
        targetId: r.id,
        details: `Released bank payout for ${r.monthLabel} totaling INR ${r.totalNetPay}.`,
        ipAddress: getClientIp(req),
      });
      return r;
    });

    return res.json({ run: updated });
  });

  app.get('/api/payroll/:id/bank-export', requireAuth, requirePermission('payroll', 'export'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const run = db.payrollRuns.find((r) => r.id === req.params.id);
    if (!run) return res.status(404).json({ error: 'Payroll run not found.' });
    if (!isRecordAllowedForUser(req.staffUser!, run)) {
      return res.status(403).json({ error: 'Demo accounts cannot export real payroll records.' });
    }
    if (req.staffUser!.role === 'EMPLOYEE') {
      return res.status(403).json({ error: 'Employees cannot export organization-wide bank transfer files.' });
    }

    const headers = ['Employee ID', 'Employee Name', 'Department', 'Bank Account', 'IFSC', 'Net Pay (INR)', 'Payment Status', 'Reference'];
    const rows = run.entries.map((e) =>
      [
        e.employeeCode,
        e.employeeName,
        e.department,
        e.bankAccountMasked,
        e.ifscCode,
        e.netPay,
        e.paymentStatus,
        e.paymentReference || '',
      ]
        .map(escapeCsvCell)
        .join(',')
    );
    const csv = [headers.map(escapeCsvCell).join(','), ...rows].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="9hr-bank-transfer-${run.period}.csv"`);
    res.send(csv);
  });

  app.get('/api/payroll/payslips/:entryId', requireAuth, requirePermission('payroll', 'download'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const user = req.staffUser!;
    let foundRun: PayrollRun | undefined;
    let foundEntry: PayrollEntry | undefined;

    for (const run of db.payrollRuns) {
      const match = run.entries.find((e) => e.id === req.params.entryId);
      if (match) {
        foundRun = run;
        foundEntry = match;
        break;
      }
    }

    if (!foundRun || !foundEntry) {
      return res.status(404).json({ error: 'Payslip not found.' });
    }
    if (!isRecordAllowedForUser(user, foundRun)) {
      return res.status(403).json({ error: 'Demo accounts cannot access real employee payslips.' });
    }
    if (
      user.role === 'EMPLOYEE' &&
      foundEntry.employeeId !== user.employeeId &&
      foundEntry.userId !== user.id
    ) {
      return res.status(403).json({ error: 'Employees may only download their own payslips.' });
    }

    return res.json({
      payslip: {
        ...foundEntry,
        period: foundRun.period,
        monthLabel: foundRun.monthLabel,
        runStatus: foundRun.status,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Meetings & Internal Communications
  // ---------------------------------------------------------------------------
  app.get('/api/meetings', requireAuth, requirePermission('meetings', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const items = db.meetings.filter((m) => {
      if (!isRecordAllowedForUser(user, m)) return false;
      if (['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user.role)) return true;
      return m.organizerId === user.id || m.participantIds.includes(user.id);
    });
    res.json({ items });
  });

  app.post('/api/meetings', requireAuth, requirePermission('meetings', 'create'), async (req: AuthRequest, res) => {
    const parsed = meetingCreateSchema.safeParse({
      ...sanitizeRecordStrings(req.body || {}),
      durationMinutes: Number(req.body?.durationMinutes || 30),
    });
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid meeting details.' });
    }
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const participantUsers = db.users.filter((u) => parsed.data.participantIds.includes(u.id));
    const meeting = await store.withTransaction((tx) => {
      const m = {
        id: `mtg-${crypto.randomBytes(6).toString('hex')}`,
        title: parsed.data.title,
        type: parsed.data.type,
        scheduledAt: parsed.data.scheduledAt,
        durationMinutes: parsed.data.durationMinutes,
        organizerId: user.id,
        organizerName: user.fullName,
        organizerRole: user.role,
        participantIds: Array.from(new Set([user.id, ...participantUsers.map((p) => p.id)])),
        participantNames: Array.from(new Set([user.fullName, ...participantUsers.map((p) => p.fullName)])),
        candidateId: parsed.data.candidateId,
        meetingLink: `/meetings/room-${crypto.randomBytes(4).toString('hex')}`,
        notes: parsed.data.notes,
        status: 'SCHEDULED' as const,
        isDemo: Boolean(user.isDemo),
        createdByIsDemo: Boolean(user.isDemo),
        createdAt: new Date().toISOString(),
      };
      tx.meetings.unshift(m);
      return m;
    });
    return res.status(201).json({ meeting });
  });

  app.get('/api/messages', requireAuth, requirePermission('communications', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const items = db.messages.filter((msg) => {
      if (!isRecordAllowedForUser(user, msg)) return false;
      return msg.senderId === user.id || msg.recipientId === user.id || user.role === 'SUPER_ADMIN';
    });
    res.json({ items });
  });

  app.post('/api/messages', requireAuth, requirePermission('communications', 'create'), async (req: AuthRequest, res) => {
    const parsed = messageCreateSchema.safeParse(sanitizeRecordStrings(req.body || {}));
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid message payload.' });
    }
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const recipient = db.users.find((u) => u.id === parsed.data.recipientId);
    if (!recipient) return res.status(404).json({ error: 'Recipient not found.' });

    const message = await store.withTransaction((tx) => {
      const m = {
        id: `msg-${crypto.randomBytes(6).toString('hex')}`,
        channel: parsed.data.channel,
        senderId: user.id,
        senderName: user.fullName,
        senderRole: user.role,
        recipientId: recipient.id,
        recipientName: recipient.fullName,
        subject: parsed.data.subject,
        body: parsed.data.body,
        isDemo: Boolean(user.isDemo),
        createdByIsDemo: Boolean(user.isDemo),
        createdAt: new Date().toISOString(),
      };
      tx.messages.unshift(m);
      return m;
    });
    return res.status(201).json({ message });
  });

  // ---------------------------------------------------------------------------
  // Notifications, Audit Logs, Config & Demo Reset
  // ---------------------------------------------------------------------------
  app.get('/api/notifications', requireAuth, (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const user = req.staffUser!;
    const items = db.notifications.filter((n) => {
      if (['SUPER_ADMIN', 'ADMIN', 'HR'].includes(user.role)) return true;
      return n.recipientEmail.toLowerCase() === user.email.toLowerCase();
    });
    res.json({
      items,
      unreadCount: items.filter((n) => !n.isRead).length,
      smtpConfigured: isSmtpConfigured(),
    });
  });

  app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
    await store.withTransaction((tx) => {
      if (req.params.id === 'all') {
        for (const n of tx.notifications) n.isRead = true;
      } else {
        const n = tx.notifications.find((item) => item.id === req.params.id);
        if (n) n.isRead = true;
      }
    });
    res.json({ success: true });
  });

  app.get('/api/audit-logs', requireAuth, requirePermission('audit_logs', 'view'), (req: AuthRequest, res) => {
    const db = store.getSnapshot();
    const targetType = (req.query.targetType as string) || 'ALL';
    const search = ((req.query.search as string) || '').trim().toLowerCase();

    const items = db.auditLogs.filter((l) => {
      if (targetType !== 'ALL' && l.targetType !== targetType) return false;
      if (search) {
        const hay = `${l.actorName} ${l.action} ${l.targetId} ${l.details}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
    res.json({ items });
  });

  app.get('/api/config', requireAuth, (_req, res) => {
    const db = store.getSnapshot();
    res.json({
      config: {
        ...db.config,
        smtpConfigured: isSmtpConfigured(),
        firebaseConfigured: isFirebaseConfigured(),
      },
    });
  });

  app.patch('/api/config', requireAuth, requirePermission('settings', 'edit'), async (req: AuthRequest, res) => {
    try {
      const updated = await store.withTransaction((tx) => {
        if (typeof req.body?.defaultLinkExpiryHours === 'number') {
          tx.config.defaultLinkExpiryHours = Math.min(720, Math.max(1, req.body.defaultLinkExpiryHours));
        }
        if (typeof req.body?.sessionIdleTimeoutMinutes === 'number') {
          tx.config.sessionIdleTimeoutMinutes = Math.min(1440, Math.max(5, req.body.sessionIdleTimeoutMinutes));
        }
        if (typeof req.body?.demoModeEnabled === 'boolean') {
          const rt = getRuntimeSecurityConfig();
          if (!rt.isProduction) {
            tx.config.demoModeEnabled = req.body.demoModeEnabled;
          }
        }
        if (Array.isArray(req.body?.departments)) {
          const depts = req.body.departments
            .map((d: unknown) => sanitizeText(d))
            .filter((d: string) => d.length >= 2);
          if (depts.length > 0) tx.config.departments = depts;
        }
        tx.config.updatedAt = new Date().toISOString();

        appendAudit(tx, {
          actorId: req.staffUser!.id,
          actorName: req.staffUser!.fullName,
          actorRole: req.staffUser!.role,
          action: 'CONFIG_UPDATED',
          targetType: 'SYSTEM',
          targetId: 'config',
          details: 'Updated system configuration settings.',
          ipAddress: getClientIp(req),
        });
        return tx.config;
      });
      return res.json({ config: updated });
    } catch (err) {
      console.error('Config update error:', err);
      return res.status(500).json({ error: 'Failed to update configuration.' });
    }
  });

  app.post('/api/demo/reset', requireAuth, requireRole('SUPER_ADMIN'), async (req: AuthRequest, res) => {
    try {
      const rt = getRuntimeSecurityConfig();
      if (rt.isProduction) {
        return res.status(403).json({ error: 'Demo reset is disabled in production.' });
      }
      await store.withTransaction((tx) => {
        const fresh = buildSeedDatabase(store.uploadDir);
        const liveUsers = tx.users.filter((u) => !u.isDemo);
        const liveCandidates = tx.candidates.filter((c) => !c.isDemo);
        const liveCandIds = new Set(liveCandidates.map((c) => c.id));
        const liveTokens = tx.tokens.filter((t) => liveCandIds.has(t.candidateId));
        const liveDocs = tx.documents.filter((d) => liveCandIds.has(d.candidateId));
        const liveEmployees = tx.employees.filter((e) => !e.isDemo);

        tx.users = [...liveUsers, ...fresh.users.filter((fu) => !liveUsers.some((lu) => lu.email === fu.email))];
        tx.candidates = [...liveCandidates, ...fresh.candidates];
        tx.tokens = [...liveTokens, ...fresh.tokens];
        tx.documents = [...liveDocs, ...fresh.documents];
        tx.employees = [...liveEmployees, ...fresh.employees];
        tx.attendance = [...tx.attendance.filter((a) => !a.isDemo), ...fresh.attendance];
        tx.leaveRequests = [...tx.leaveRequests.filter((l) => !l.isDemo), ...fresh.leaveRequests];
        tx.payrollRuns = [...tx.payrollRuns.filter((p) => !p.isDemo), ...fresh.payrollRuns];
        tx.meetings = [...tx.meetings.filter((m) => !m.isDemo), ...fresh.meetings];
        tx.messages = [...tx.messages.filter((m) => !m.isDemo), ...fresh.messages];
        tx.statusHistory = fresh.statusHistory;
        tx.notifications = fresh.notifications;
        tx.auditLogs = [
          {
            id: `aud-${crypto.randomBytes(6).toString('hex')}`,
            actorId: req.staffUser!.id,
            actorName: req.staffUser!.fullName,
            actorRole: req.staffUser!.role,
            action: 'DEMO_DATA_RESET',
            targetType: 'SYSTEM',
            targetId: 'demo',
            result: 'SUCCESS',
            details: 'Restored demo dataset while preserving live records.',
            ipAddress: getClientIp(req),
            timestamp: new Date().toISOString(),
          },
          ...fresh.auditLogs,
        ];
      });
      return res.json({ success: true });
    } catch (err) {
      console.error('Demo reset error:', err);
      return res.status(500).json({ error: 'Failed to reset demo dataset.' });
    }
  });

  // ---------------------------------------------------------------------------
  // Candidate Self-Service Onboarding Endpoints (Hashed Token-Gated)
  // ---------------------------------------------------------------------------
  type ResolvedToken =
    | { ok: false; error: string; status: number; expired?: boolean }
    | { ok: true; token: OnboardingToken; candidate: Candidate; db: PortalDatabase };

  function resolveCandidateToken(tokenStr: string): ResolvedToken {
    const db = store.getSnapshot();
    const tokenHash = hashTokenSha256(tokenStr.trim());
    const token = db.tokens.find((t) => t.tokenHash === tokenHash);
    if (!token) {
      return { ok: false, error: 'Invalid onboarding link. Please check the URL sent by 9HR India HR.', status: 404 };
    }
    if (token.isRevoked) {
      return { ok: false, error: 'This onboarding link has been revoked or superseded by a newer link. Please contact HR.', status: 403 };
    }
    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      return {
        ok: false,
        error: 'This onboarding link has expired. Please contact your 9HR India recruiter to regenerate a fresh link.',
        status: 410,
        expired: true,
      };
    }
    const candidate = db.candidates.find((c) => c.id === token.candidateId);
    if (!candidate) {
      return { ok: false, error: 'Candidate profile no longer exists.', status: 404 };
    }
    return { ok: true, token, candidate, db };
  }

  const EDITABLE_CANDIDATE_STATUSES: OnboardingStatus[] = [
    'Draft',
    'Link Sent',
    'In Progress',
    'Documents Pending',
    'Correction Required',
  ];

  app.get('/api/onboard/:token', async (req, res) => {
    const resolved = resolveCandidateToken(req.params.token);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: resolved.error, expired: resolved.expired });
    }

    const { token, candidate, db } = resolved;
    const documents = db.documents.filter((d) => d.candidateId === candidate.id);

    await store.withTransaction((tx) => {
      const tok = tx.tokens.find((t) => t.id === token.id);
      if (tok) {
        const nowIso = new Date().toISOString();
        if (!tok.firstAccessedAt) tok.firstAccessedAt = nowIso;
        tok.lastAccessedAt = nowIso;
        tok.redemptionCount = (tok.redemptionCount ?? 0) + 1;
      }
    });

    return res.json({
      candidate,
      documents,
      tokenExpiresAt: token.expiresAt,
      editable: !token.consumedAt && EDITABLE_CANDIDATE_STATUSES.includes(candidate.status),
      documentCategories: DOCUMENT_CATEGORIES,
      requiredCategories: REQUIRED_DOCUMENT_CATEGORIES,
    });
  });

  app.patch('/api/onboard/:token', async (req, res) => {
    try {
      const resolved = resolveCandidateToken(req.params.token);
      if (!resolved.ok) {
        return res.status(resolved.status).json({ error: resolved.error, expired: resolved.expired });
      }
      if (resolved.token.consumedAt || !EDITABLE_CANDIDATE_STATUSES.includes(resolved.candidate.status)) {
        return res.status(403).json({
          error: `Application is currently "${resolved.candidate.status}" and locked from editing.`,
        });
      }

      const body = sanitizeRecordStrings(req.body || {});
      const candId = resolved.candidate.id;

      const updated = await store.withTransaction((tx) => {
        const cand = tx.candidates.find((c) => c.id === candId)!;
        const nowIso = new Date().toISOString();

        if (body.personalInfo && typeof body.personalInfo === 'object') {
          cand.personalInfo = { ...cand.personalInfo, ...body.personalInfo };
          if (cand.personalInfo.fullName) cand.fullName = cand.personalInfo.fullName;
        }
        if (body.addressInfo && typeof body.addressInfo === 'object') {
          cand.addressInfo = { ...cand.addressInfo, ...body.addressInfo };
          if (cand.addressInfo.sameAsCurrent) {
            cand.addressInfo.permanentAddress = cand.addressInfo.currentAddress;
          }
        }
        if (body.familyInfo && typeof body.familyInfo === 'object') {
          cand.familyInfo = { ...cand.familyInfo, ...body.familyInfo };
        }
        if (body.educationInfo && typeof body.educationInfo === 'object') {
          cand.educationInfo = { ...cand.educationInfo, ...body.educationInfo };
        }
        if (body.employmentInfo && typeof body.employmentInfo === 'object') {
          cand.employmentInfo = { ...cand.employmentInfo, ...body.employmentInfo };
        }
        if (body.bankDetails && typeof body.bankDetails === 'object') {
          cand.bankDetails = {
            ...cand.bankDetails,
            ...body.bankDetails,
            ifscCode: String(body.bankDetails.ifscCode ?? cand.bankDetails.ifscCode).toUpperCase(),
          };
        }
        if (body.declaration && typeof body.declaration === 'object') {
          cand.declaration = { ...cand.declaration, ...body.declaration };
        }

        if (cand.status === 'Link Sent' || cand.status === 'Draft') {
          const prev = cand.status;
          cand.status = 'In Progress';
          tx.statusHistory.unshift({
            id: `sh-${crypto.randomBytes(6).toString('hex')}`,
            candidateId: cand.id,
            fromStatus: prev,
            toStatus: 'In Progress',
            changedById: cand.id,
            changedByName: cand.fullName,
            changedByRole: 'CANDIDATE',
            note: 'Candidate started filling onboarding details.',
            timestamp: nowIso,
          });
        }

        const candDocs = tx.documents.filter((d) => d.candidateId === cand.id);
        cand.completionPct = calculateCompletionPercentage(cand, candDocs);
        cand.updatedAt = nowIso;
        return cand;
      });

      return res.json({ candidate: updated, savedAt: new Date().toISOString() });
    } catch (err) {
      console.error('Autosave error:', err);
      return res.status(500).json({ error: 'Failed to save draft.' });
    }
  });

  app.post(
    '/api/onboard/:token/documents',
    (req, res, next) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File exceeds maximum allowed size of 5 MB.' });
          }
          return res.status(400).json({ error: err.message });
        }
        if (err) {
          return res.status(400).json({ error: 'File upload failed.' });
        }
        return next();
      });
    },
    async (req, res) => {
      try {
        const resolved = resolveCandidateToken(req.params.token);
        if (!resolved.ok) {
          return res.status(resolved.status).json({ error: resolved.error, expired: resolved.expired });
        }
        if (resolved.token.consumedAt || !EDITABLE_CANDIDATE_STATUSES.includes(resolved.candidate.status)) {
          return res.status(403).json({
            error: `Documents cannot be modified when application status is "${resolved.candidate.status}".`,
          });
        }

        const categoryParsed = documentCategorySchema.safeParse(req.body?.category);
        if (!categoryParsed.success) {
          return res.status(400).json({ error: 'Invalid document category.' });
        }

        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: 'No file attached.' });
        }

        const ext = path.extname(file.originalname).toLowerCase();
        const sigCheck = validateMagicBytes(file.buffer, ext, file.mimetype);
        if (!sigCheck.valid) {
          return res.status(400).json({ error: sigCheck.reason || 'Invalid or unsafe file.' });
        }

        const storageKey = `${resolved.candidate.id}_${crypto.randomBytes(16).toString('hex')}${ext}`;
        const destPath = path.join(store.uploadDir, storageKey);
        fs.writeFileSync(destPath, file.buffer);

        const result = await store.withTransaction((tx) => {
          const cand = tx.candidates.find((c) => c.id === resolved.candidate.id)!;
          const nowIso = new Date().toISOString();

          const oldDocs = tx.documents.filter(
            (d) => d.candidateId === cand.id && d.category === categoryParsed.data
          );
          for (const old of oldDocs) {
            const oldPath = path.join(store.uploadDir, path.basename(old.storageKey));
            if (fs.existsSync(oldPath) && !old.storageKey.startsWith('demo_')) {
              fs.unlinkSync(oldPath);
            }
          }
          tx.documents = tx.documents.filter(
            (d) => !(d.candidateId === cand.id && d.category === categoryParsed.data)
          );

          const doc: CandidateDocument = {
            id: `doc-${crypto.randomBytes(6).toString('hex')}`,
            candidateId: cand.id,
            category: categoryParsed.data,
            originalName: sanitizeText(path.basename(file.originalname)).slice(0, 140),
            mimeType: file.mimetype,
            sizeBytes: file.size,
            storageKey,
            verificationStatus: 'Pending',
            uploadedAt: nowIso,
            history: [],
          };

          tx.documents.push(doc);

          if (cand.status === 'Link Sent' || cand.status === 'Draft') {
            cand.status = 'In Progress';
          }
          const candDocs = tx.documents.filter((d) => d.candidateId === cand.id);
          cand.completionPct = calculateCompletionPercentage(cand, candDocs);
          cand.updatedAt = nowIso;

          appendAudit(tx, {
            actorId: cand.id,
            actorName: cand.fullName,
            actorRole: 'CANDIDATE',
            action: 'DOCUMENT_UPLOADED',
            targetType: 'DOCUMENT',
            targetId: doc.id,
            details: `Candidate ${cand.candidateCode} uploaded ${doc.category} (${doc.originalName}).`,
            ipAddress: getClientIp(req),
          });

          return { document: doc, completionPct: cand.completionPct };
        });

        return res.status(201).json(result);
      } catch (err) {
        console.error('Upload document error:', err);
        return res.status(500).json({ error: 'Failed to store uploaded document.' });
      }
    }
  );

  app.get('/api/onboard/:token/documents/:docId/file', (req, res) => {
    const resolved = resolveCandidateToken(req.params.token);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    const doc = resolved.db.documents.find(
      (d) => d.id === req.params.docId && d.candidateId === resolved.candidate.id
    );
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    const fullPath = path.join(store.uploadDir, path.basename(doc.storageKey));
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File unavailable.' });
    }
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${doc.originalName.replace(/["\\\r\n]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.sendFile(fullPath);
  });

  app.delete('/api/onboard/:token/documents/:docId', async (req, res) => {
    const resolved = resolveCandidateToken(req.params.token);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ error: resolved.error });
    }
    if (resolved.token.consumedAt || !EDITABLE_CANDIDATE_STATUSES.includes(resolved.candidate.status)) {
      return res.status(403).json({ error: 'Application is locked from document removal.' });
    }

    const doc = resolved.db.documents.find(
      (d) => d.id === req.params.docId && d.candidateId === resolved.candidate.id
    );
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    const completionPct = await store.withTransaction((tx) => {
      const target = tx.documents.find((d) => d.id === doc.id);
      if (target) {
        const p = path.join(store.uploadDir, path.basename(target.storageKey));
        if (fs.existsSync(p) && !target.storageKey.startsWith('demo_')) {
          fs.unlinkSync(p);
        }
      }
      tx.documents = tx.documents.filter((d) => d.id !== doc.id);
      const cand = tx.candidates.find((c) => c.id === resolved.candidate.id)!;
      const candDocs = tx.documents.filter((d) => d.candidateId === cand.id);
      cand.completionPct = calculateCompletionPercentage(cand, candDocs);
      cand.updatedAt = new Date().toISOString();
      return cand.completionPct;
    });

    return res.json({ success: true, completionPct });
  });

  app.post('/api/onboard/:token/submit', async (req, res) => {
    try {
      const resolved = resolveCandidateToken(req.params.token);
      if (!resolved.ok) {
        return res.status(resolved.status).json({ error: resolved.error, expired: resolved.expired });
      }
      if (resolved.token.consumedAt || !EDITABLE_CANDIDATE_STATUSES.includes(resolved.candidate.status)) {
        return res.status(400).json({
          error: `Application is already "${resolved.candidate.status}".`,
        });
      }

      const payload = sanitizeRecordStrings(req.body || {});
      const candSnapshot = resolved.candidate;

      const merged = {
        personalInfo: { ...candSnapshot.personalInfo, ...(payload.personalInfo || {}) },
        addressInfo: { ...candSnapshot.addressInfo, ...(payload.addressInfo || {}) },
        familyInfo: { ...candSnapshot.familyInfo, ...(payload.familyInfo || {}) },
        educationInfo: { ...candSnapshot.educationInfo, ...(payload.educationInfo || {}) },
        employmentInfo: { ...candSnapshot.employmentInfo, ...(payload.employmentInfo || {}) },
        bankDetails: {
          ...candSnapshot.bankDetails,
          ...(payload.bankDetails || {}),
          ifscCode: String(payload.bankDetails?.ifscCode ?? candSnapshot.bankDetails.ifscCode).toUpperCase(),
        },
        declaration: { ...candSnapshot.declaration, ...(payload.declaration || {}) },
      };

      if (merged.addressInfo.sameAsCurrent) {
        merged.addressInfo.permanentAddress = merged.addressInfo.currentAddress;
      }

      const checks = [
        { name: 'Personal Information', res: personalInfoSchema.safeParse(merged.personalInfo) },
        { name: 'Address Information', res: addressInfoSchema.safeParse(merged.addressInfo) },
        { name: 'Family Information', res: familyInfoSchema.safeParse(merged.familyInfo) },
        { name: 'Educational Information', res: educationInfoSchema.safeParse(merged.educationInfo) },
        { name: 'Employment Information', res: employmentInfoSchema.safeParse(merged.employmentInfo) },
        {
          name: 'Banking Information',
          res: bankDetailsSchema.safeParse({
            ...merged.bankDetails,
            confirmAccountNumber: merged.bankDetails.confirmAccountNumber ?? merged.bankDetails.accountNumber,
          }),
        },
        { name: 'Declaration', res: declarationSchema.safeParse(merged.declaration) },
      ];

      for (const check of checks) {
        if (!check.res.success) {
          const firstIssue = check.res.error.issues[0];
          return res.status(400).json({
            error: `${check.name}: ${firstIssue?.message || 'Incomplete or invalid fields.'}`,
            section: check.name,
            field: firstIssue?.path?.join('.'),
          });
        }
      }

      const docs = resolved.db.documents.filter((d) => d.candidateId === candSnapshot.id);
      const validCats = new Set(
        docs.filter((d) => d.verificationStatus !== 'Rejected').map((d) => d.category)
      );
      const missingCats = REQUIRED_DOCUMENT_CATEGORIES.filter((cat) => !validCats.has(cat));
      if (missingCats.length > 0) {
        return res.status(400).json({
          error: `Please upload valid documents for: ${missingCats.join(', ')}`,
          section: 'Document Upload',
        });
      }

      const submittedCandidate = await store.withTransaction(async (tx) => {
        const cand = tx.candidates.find((c) => c.id === candSnapshot.id)!;
        const prevStatus = cand.status;
        const nowIso = new Date().toISOString();

        cand.personalInfo = merged.personalInfo;
        cand.addressInfo = merged.addressInfo;
        cand.familyInfo = merged.familyInfo;
        cand.educationInfo = merged.educationInfo;
        cand.employmentInfo = merged.employmentInfo;
        cand.bankDetails = merged.bankDetails;
        cand.declaration = {
          accepted: true,
          digitalSignature: merged.declaration.digitalSignature,
          submittedAt: nowIso,
        };
        cand.fullName = cand.personalInfo.fullName || cand.fullName;
        cand.status = 'Submitted';
        cand.correctionNotes = undefined;
        cand.updatedAt = nowIso;

        // Mark token single-use consumed upon submission (HR can reopen if correction required)
        const tok = tx.tokens.find((t) => t.id === resolved.token.id);
        if (tok) tok.consumedAt = nowIso;

        const candDocs = tx.documents.filter((d) => d.candidateId === cand.id);
        cand.completionPct = calculateCompletionPercentage(cand, candDocs);

        tx.statusHistory.unshift({
          id: `sh-${crypto.randomBytes(6).toString('hex')}`,
          candidateId: cand.id,
          fromStatus: prevStatus,
          toStatus: 'Submitted',
          changedById: cand.id,
          changedByName: cand.fullName,
          changedByRole: 'CANDIDATE',
          note:
            prevStatus === 'Correction Required'
              ? 'Candidate resubmitted corrected onboarding application.'
              : 'Candidate completed all 8 steps and submitted onboarding package.',
          timestamp: nowIso,
        });

        const recruiter = tx.users.find((u) => u.id === cand.assignedRecruiterId);
        const hrEmail = recruiter?.email || 'hr@9hrindia.com';
        const hrName = recruiter?.fullName || cand.assignedRecruiterName;
        const emailDispatch = await dispatchNotificationEmail({
          to: hrEmail,
          subject: `Onboarding Submitted: ${cand.fullName} (${cand.candidateCode})`,
          body: `${cand.fullName} has submitted their onboarding form and documents for verification.`,
        });

        tx.notifications.unshift({
          id: `notif-${crypto.randomBytes(6).toString('hex')}`,
          type: 'CANDIDATE_SUBMITTED',
          title: `Onboarding Submitted: ${cand.fullName}`,
          message: `${cand.fullName} (${cand.position}) submitted their onboarding details and ${candDocs.length} documents.`,
          recipientEmail: hrEmail,
          recipientName: hrName,
          candidateId: cand.id,
          candidateCode: cand.candidateCode,
          deliveryStatus: emailDispatch.deliveryStatus,
          deliveryNote: emailDispatch.deliveryNote,
          isRead: false,
          createdAt: nowIso,
        });

        appendAudit(tx, {
          actorId: cand.id,
          actorName: cand.fullName,
          actorRole: 'CANDIDATE',
          action: 'CANDIDATE_SUBMITTED',
          targetType: 'CANDIDATE',
          targetId: cand.candidateCode,
          details: `Candidate ${cand.candidateCode} submitted full onboarding application.`,
          ipAddress: getClientIp(req),
        });

        return cand;
      });

      return res.json({ candidate: submittedCandidate });
    } catch (err) {
      console.error('Submit onboarding error:', err);
      return res.status(500).json({ error: 'Failed to submit onboarding application.' });
    }
  });

  // Global error handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled API error:', err);
    res.status(500).json({ error: 'Unexpected server error occurred.' });
  });

  return { app, store };
}
