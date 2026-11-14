import { initializeApp, FirebaseApp, getApps } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { getFunctions, Functions } from 'firebase/functions';

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  useCloudStorage?: boolean;
}

const FIREBASE_CONFIG_STORAGE_KEY = 'whc_firebase_config_v1';
const REVOKED_API_KEYS = new Set(['AIzaSyByG509x0FEeglKVCT0REfX3dEC750iRu4']);

let runtimeConfig: FirebaseClientConfig | null = null;
let cachedHandles: FirebaseHandles | null = null;

function isValidConfig(cfg: unknown): cfg is FirebaseClientConfig {
  if (!cfg || typeof cfg !== 'object') return false;
  const candidate = cfg as Partial<FirebaseClientConfig>;
  if (!candidate.apiKey || !candidate.projectId || !candidate.authDomain) {
    return false;
  }
  if (REVOKED_API_KEYS.has(candidate.apiKey.trim())) {
    return false;
  }
  return true;
}

/**
 * Loads Firebase client configuration at startup without hardcoding API keys in Git:
 * 1. Purges any legacy/revoked `localStorage` config (`whc_firebase_config_v1`).
 * 2. Checks `/firebase-config.local.json` (gitignored local dev config).
 * 3. Checks `/__/firebase/init.json` (auto-served by Firebase Hosting in production/previews).
 */
export async function loadRuntimeFirebaseConfig(): Promise<void> {
  try {
    const raw = localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (!isValidConfig(parsed)) {
        localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
      }
    }
  } catch {
    localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
  }

  for (const endpoint of ['/firebase-config.local.json', '/__/firebase/init.json']) {
    try {
      const resp = await fetch(endpoint, { cache: 'no-store' });
      if (resp.ok) {
        const data: unknown = await resp.json();
        if (isValidConfig(data)) {
          runtimeConfig = data;
          cachedHandles = null;
          return;
        }
      }
    } catch {
      // Ignore missing runtime endpoint and try next source
    }
  }
}

export function getStoredFirebaseConfig(): FirebaseClientConfig | null {
  if (runtimeConfig) {
    return runtimeConfig;
  }
  try {
    const raw = localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isValidConfig(parsed)) {
        return parsed;
      }
      localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveFirebaseConfig(config: FirebaseClientConfig | null): void {
  cachedHandles = null;
  if (!config) {
    localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
  } else {
    localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify(config));
    runtimeConfig = config;
  }
}

export interface FirebaseHandles {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
  functions: Functions;
}

export function getFirebaseHandles(): FirebaseHandles | null {
  if (cachedHandles) return cachedHandles;
  const cfg = getStoredFirebaseConfig();
  if (!cfg || !cfg.apiKey || !cfg.projectId) return null;
  try {
    const app = getApps().length > 0 ? getApps()[0] : initializeApp(cfg);
    cachedHandles = {
      app,
      db: getFirestore(app),
      auth: getAuth(app),
      storage: getStorage(app),
      functions: getFunctions(app),
    };
    return cachedHandles;
  } catch (err) {
    console.warn('Failed to initialize Firebase client:', err);
    return null;
  }
}
