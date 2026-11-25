export interface OptionalFirebaseClientConfig {
  configured: boolean;
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  databaseId: string;
}

export function getOptionalFirebaseClientConfig(): OptionalFirebaseClientConfig {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
  const apiKey = (env.VITE_FIREBASE_API_KEY || '').trim();
  const authDomain = (env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
  const projectId = (env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const storageBucket = (env.VITE_FIREBASE_STORAGE_BUCKET || '').trim();
  const messagingSenderId = (env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim();
  const appId = (env.VITE_FIREBASE_APP_ID || '').trim();
  const databaseId = (env.VITE_FIREBASE_DATABASE_ID || '').trim();

  return {
    configured: Boolean(apiKey && authDomain && projectId),
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    databaseId,
  };
}

export function isFirebaseClientConfigured(): boolean {
  return getOptionalFirebaseClientConfig().configured;
}
