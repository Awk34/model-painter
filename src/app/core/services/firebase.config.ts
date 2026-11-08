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
}

const FIREBASE_CONFIG_STORAGE_KEY = 'whc_firebase_config_v1';

export function getStoredFirebaseConfig(): FirebaseClientConfig | null {
  try {
    const raw = localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.apiKey && parsed.projectId) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveFirebaseConfig(config: FirebaseClientConfig | null): void {
  if (!config) {
    localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
  } else {
    localStorage.setItem(FIREBASE_CONFIG_STORAGE_KEY, JSON.stringify(config));
  }
}

export interface FirebaseHandles {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
  functions: Functions;
}

let cachedHandles: FirebaseHandles | null = null;

export function getFirebaseHandles(): FirebaseHandles | null {
  if (cachedHandles) return cachedHandles;
  const cfg = getStoredFirebaseConfig();
  if (!cfg) return null;
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
