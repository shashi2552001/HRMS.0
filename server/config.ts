export interface RuntimeSecurityConfig {
  appEnv: string;
  isProduction: boolean;
  dataDir: string;
  uploadDir: string;
  demoModeEnabled: boolean;
  demoSeedEnabled: boolean;
  sessionIdleTimeoutMinutes: number;
  sessionMaxLifetimeHours: number;
  loginMaxAttempts: number;
  loginLockoutMinutes: number;
}

export interface OptionalFirebaseServerConfig {
  configured: boolean;
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseId: string;
  oAuthClientId: string;
}

function parsePositiveInt(raw: string | undefined, fallback: number, min = 1, max = 10000): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return Math.floor(n);
}

export function getOptionalFirebaseConfig(): OptionalFirebaseServerConfig {
  const apiKey = (process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || '').trim();
  const authDomain = (process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
  const projectId = (process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const storageBucket = (process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim();
  const messagingSenderId = (
    process.env.FIREBASE_MESSAGING_SENDER_ID ||
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
    ''
  ).trim();
  const appId = (process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID || '').trim();
  const databaseId = (process.env.FIREBASE_DATABASE_ID || process.env.VITE_FIREBASE_DATABASE_ID || '').trim();
  const oAuthClientId = (process.env.FIREBASE_OAUTH_CLIENT_ID || '').trim();

  const configured = Boolean(projectId && (apiKey || oAuthClientId));

  return {
    configured,
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    databaseId,
    oAuthClientId,
  };
}

export function isFirebaseConfigured(): boolean {
  return getOptionalFirebaseConfig().configured;
}

export function getRuntimeSecurityConfig(): RuntimeSecurityConfig {
  const appEnv = (process.env.APP_ENV || process.env.NODE_ENV || 'development').trim().toLowerCase();
  const isProduction = appEnv === 'production' || process.env.NODE_ENV === 'production';

  const rawDemoMode = process.env.DEMO_MODE?.trim().toLowerCase();
  const rawDemoSeed = process.env.DEMO_SEED_ENABLED?.trim().toLowerCase();

  const demoModeEnabled = isProduction ? rawDemoMode === 'true' : rawDemoMode !== 'false';
  const demoSeedEnabled = isProduction ? rawDemoSeed === 'true' : rawDemoSeed !== 'false';

  const dataDir = process.env.DATA_DIR?.trim() || './data';
  const uploadDir = process.env.UPLOAD_DIR?.trim() || './private_uploads';

  return {
    appEnv,
    isProduction,
    dataDir,
    uploadDir,
    demoModeEnabled,
    demoSeedEnabled,
    sessionIdleTimeoutMinutes: parsePositiveInt(process.env.SESSION_IDLE_TIMEOUT_MINUTES, 30, 1, 1440),
    sessionMaxLifetimeHours: parsePositiveInt(process.env.SESSION_MAX_LIFETIME_HOURS, 8, 1, 720),
    loginMaxAttempts: parsePositiveInt(process.env.LOGIN_MAX_ATTEMPTS, 5, 1, 50),
    loginLockoutMinutes: parsePositiveInt(process.env.LOGIN_LOCKOUT_MINUTES, 15, 1, 1440),
  };
}

/**
 * Production startup MUST reject enabled demo credentials or unsafe demo configuration.
 */
export function assertSafeRuntimeEnvironment(): RuntimeSecurityConfig {
  const cfg = getRuntimeSecurityConfig();
  if (cfg.isProduction && (cfg.demoModeEnabled || cfg.demoSeedEnabled)) {
    throw new Error(
      'FATAL SECURITY ERROR: DEMO_MODE and DEMO_SEED_ENABLED must be disabled in production (APP_ENV=production / NODE_ENV=production).'
    );
  }
  return cfg;
}
