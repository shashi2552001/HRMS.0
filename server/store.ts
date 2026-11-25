import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DEFAULT_ROLE_PERMISSIONS } from '../src/shared/rbac.ts';
import {
  AttendanceRecord,
  AuditLog,
  Candidate,
  CandidateDocument,
  Employee,
  InternalMessage,
  LeaveRequest,
  LoginHistoryEntry,
  MeetingRecord,
  NotificationRecord,
  OnboardingToken,
  PayrollRun,
  RolePermissionsMap,
  StatusHistoryEntry,
  SystemConfig,
} from '../src/shared/types.ts';
import {
  assertSafeRuntimeEnvironment,
  getRuntimeSecurityConfig,
  isFirebaseConfigured,
} from './config.ts';
import { isSmtpConfigured } from './mailer.ts';
import { buildEmptyDatabase, buildSeedDatabase, seedDemoAccounts } from './seed.ts';
import { hashTokenSha256, StaffUserRecord } from './security.ts';

export interface ServerSession {
  id: string;
  userId: string;
  tokenHash: string;
  refreshTokenHash?: string;
  rememberMe: boolean;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokedReason?: string;
}

export interface LoginAttemptTracker {
  failedCount: number;
  firstFailedAt: string;
  lockedUntil?: string;
}

export interface ActivationTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt?: string;
  createdAt: string;
}

export interface PortalDatabase {
  users: StaffUserRecord[];
  candidates: Candidate[];
  tokens: OnboardingToken[];
  documents: CandidateDocument[];
  statusHistory: StatusHistoryEntry[];
  employees: Employee[];
  notifications: NotificationRecord[];
  auditLogs: AuditLog[];
  sessions: ServerSession[];
  loginAttempts: Record<string, LoginAttemptTracker>;
  loginHistory: LoginHistoryEntry[];
  activationTokens: ActivationTokenRecord[];
  rolePermissions: RolePermissionsMap;
  attendance: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
  payrollRuns: PayrollRun[];
  meetings: MeetingRecord[];
  messages: InternalMessage[];
  config: SystemConfig;
  counters: {
    candidateSeq: number;
    employeeSeq: number;
    staffSeq: number;
  };
}

export { buildSeedDatabase, seedDemoAccounts };

function normalizeLoadedDatabase(state: PortalDatabase): PortalDatabase {
  const rt = getRuntimeSecurityConfig();
  if (!state.sessions) state.sessions = [];
  if (!state.loginAttempts) state.loginAttempts = {};
  if (!state.loginHistory) state.loginHistory = [];
  if (!state.activationTokens) state.activationTokens = [];
  if (!state.rolePermissions) state.rolePermissions = structuredClone(DEFAULT_ROLE_PERMISSIONS);
  for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as Array<keyof RolePermissionsMap>) {
    if (!state.rolePermissions[role]) {
      state.rolePermissions[role] = structuredClone(DEFAULT_ROLE_PERMISSIONS[role]);
    }
  }
  if (!state.attendance) state.attendance = [];
  if (!state.leaveRequests) state.leaveRequests = [];
  if (!state.payrollRuns) state.payrollRuns = [];
  if (!state.meetings) state.meetings = [];
  if (!state.messages) state.messages = [];

  // Remove legacy 2FA/OTP challenge arrays if migrating an older portal-db.json
  const mutableState = state as unknown as Record<string, unknown>;
  delete mutableState.twoFactorChallenges;
  delete mutableState.emailOtpChallenges;

  for (const u of state.users) {
    if (!u.status) {
      u.status = u.isActive ? 'ACTIVE' : 'DEACTIVATED';
    }
    u.isActive = u.status === 'ACTIVE';

    // Safely clear any legacy 2FA state on existing user records so login is never blocked
    const legacyUser = u as unknown as Record<string, unknown>;
    delete legacyUser.twoFactorEnabled;
    delete legacyUser.twoFactorMethods;
    delete legacyUser.recoveryCodesCount;
    delete legacyUser.twoFactorSecret;
    delete legacyUser.pendingTwoFactorSecret;
    delete legacyUser.usedTotpSteps;
    delete legacyUser.recoveryCodeHashes;
  }

  // Migrate any legacy plaintext onboarding tokens to hashed-only representation
  for (const t of state.tokens) {
    if (!t.tokenHash && t.token) {
      t.tokenHash = hashTokenSha256(t.token);
      t.tokenPrefix = t.token.slice(0, 10);
      delete t.token;
    }
  }

  const rawConfig = { ...(state.config as unknown as Record<string, unknown>) };
  delete rawConfig.otpExpiryMinutes;
  delete rawConfig.otpMaxAttempts;

  state.config = {
    ...(rawConfig as unknown as SystemConfig),
    smtpConfigured: isSmtpConfigured(),
    firebaseConfigured: isFirebaseConfigured(),
    demoModeEnabled: rt.demoModeEnabled,
    sessionIdleTimeoutMinutes: state.config?.sessionIdleTimeoutMinutes || rt.sessionIdleTimeoutMinutes,
    sessionMaxLifetimeHours: state.config?.sessionMaxLifetimeHours || rt.sessionMaxLifetimeHours,
    loginMaxAttempts: state.config?.loginMaxAttempts || rt.loginMaxAttempts,
    loginLockoutMinutes: state.config?.loginLockoutMinutes || rt.loginLockoutMinutes,
  };
  return state;
}

export class PortalStore {
  public readonly dataDir: string;
  public readonly uploadDir: string;
  private readonly dbFilePath: string;
  private state: PortalDatabase;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(options?: { dataDir?: string; uploadDir?: string }) {
    const rt = assertSafeRuntimeEnvironment();

    this.dataDir = path.resolve(options?.dataDir?.trim() || rt.dataDir);
    this.uploadDir = path.resolve(options?.uploadDir?.trim() || rt.uploadDir);
    this.dbFilePath = path.join(this.dataDir, 'portal-db.json');

    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.uploadDir, { recursive: true });

    if (fs.existsSync(this.dbFilePath)) {
      const raw = fs.readFileSync(this.dbFilePath, 'utf8');
      this.state = normalizeLoadedDatabase(JSON.parse(raw) as PortalDatabase);
      if (rt.demoSeedEnabled) {
        seedDemoAccounts(this.state, this.uploadDir);
      }
      this.persistSync();
    } else {
      this.state = rt.demoSeedEnabled
        ? buildSeedDatabase(this.uploadDir)
        : buildEmptyDatabase();
      this.persistSync();
    }
  }

  private persistSync(): void {
    const tmpPath = `${this.dbFilePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.dbFilePath);
  }

  public getSnapshot(): PortalDatabase {
    return this.state;
  }

  /**
   * Serialized transactional mutation with automatic rollback on exception.
   */
  public async withTransaction<T>(fn: (db: PortalDatabase) => Promise<T> | T): Promise<T> {
    let release!: () => void;
    const prev = this.writeLock;
    this.writeLock = new Promise<void>((res) => {
      release = res;
    });
    await prev;

    const backup = structuredClone(this.state);
    try {
      const result = await fn(this.state);
      this.persistSync();
      return result;
    } catch (err) {
      this.state = backup;
      throw err;
    } finally {
      release();
    }
  }

  public reloadFromDisk(): void {
    if (fs.existsSync(this.dbFilePath)) {
      const raw = fs.readFileSync(this.dbFilePath, 'utf8');
      this.state = normalizeLoadedDatabase(JSON.parse(raw) as PortalDatabase);
    }
  }
}
