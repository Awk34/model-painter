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
const RUNTIME_CONFIG_TIMEOUT_MS = 3000;
const REVOKED_KEY_DIGESTS = new Set(['39:d1f2b247:1f77526b']);

let runtimeConfig: FirebaseClientConfig | null = null;
let cachedHandles: FirebaseHandles | null = null;

function fnv1a32(input: string, seed = 0x811c9dc5): string {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function isRevokedApiKey(apiKey: string): boolean {
  const trimmed = apiKey.trim();
  const reversed = [...trimmed].reverse().join('');
  const digest = `${trimmed.length}:${fnv1a32(trimmed)}:${fnv1a32(reversed, 0x9e3779b1)}`;
  return REVOKED_KEY_DIGESTS.has(digest);
}

function isLocalFirebaseHost(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isValidConfig(cfg: unknown): cfg is FirebaseClientConfig {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
    return false;
  }
  const candidate = cfg as Partial<FirebaseClientConfig>;
  if (
    typeof candidate.apiKey !== 'string' ||
    !candidate.apiKey.trim() ||
    typeof candidate.projectId !== 'string' ||
    !candidate.projectId.trim() ||
    typeof candidate.authDomain !== 'string' ||
    !candidate.authDomain.trim()
  ) {
    return false;
  }
  if (isRevokedApiKey(candidate.apiKey)) {
    return false;
  }
  return true;
}

function readValidLocalConfig(): FirebaseClientConfig | null {
  try {
    const raw = localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (isValidConfig(parsed)) {
      return parsed;
    }
    localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
  } catch {
    localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
  }
  return null;
}

export function resetRuntimeFirebaseConfigForTests(): void {
  runtimeConfig = null;
  cachedHandles = null;
}

/**
 * Loads Firebase client configuration at startup without hardcoding API keys in Git:
 * 1. Resets cached runtime state and purges any legacy/revoked `localStorage` config (`whc_firebase_config_v1`).
 * 2. On localhost, checks `/firebase-config.local.json` first, then `/__/firebase/init.json`.
 * 3. On production/preview hosts, checks `/__/firebase/init.json` first, then `/firebase-config.json`.
 */
export async function loadRuntimeFirebaseConfig(): Promise<void> {
  runtimeConfig = null;
  cachedHandles = null;
  readValidLocalConfig();

  const endpoints = isLocalFirebaseHost()
    ? ['/firebase-config.local.json', '/__/firebase/init.json']
    : ['/__/firebase/init.json', '/firebase-config.json'];

  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint, {
        cache: 'no-store',
        signal: AbortSignal.timeout(RUNTIME_CONFIG_TIMEOUT_MS),
      });
      const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
      if (resp.ok && contentType.includes('application/json')) {
        const data: unknown = await resp.json();
        if (isValidConfig(data)) {
          runtimeConfig = data;
          cachedHandles = null;
          return;
        }
      }
    } catch {
      // Ignore missing/timed-out runtime endpoint and try next source
    }
  }
}

export function getStoredFirebaseConfig(): FirebaseClientConfig | null {
  if (runtimeConfig) {
    return runtimeConfig;
  }
  return readValidLocalConfig();
}

export interface FirebaseHandles {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
  functions: Functions;
}

export function getFirebaseHandles(): FirebaseHandles | null {
  if (cachedHandles) {
    return cachedHandles;
  }
  const cfg = getStoredFirebaseConfig();
  if (!cfg || !cfg.apiKey || !cfg.projectId) {
    return null;
  }
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
