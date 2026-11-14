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

export const DEFAULT_FIREBASE_CONFIG: FirebaseClientConfig = {
  apiKey: 'AIzaSyByG509x0FEeglKVCT0REfX3dEC750iRu4',
  authDomain: 'model-painter-a8724.firebaseapp.com',
  projectId: 'model-painter-a8724',
  storageBucket: 'model-painter-a8724.firebasestorage.app',
  messagingSenderId: '764662707107',
  appId: '1:764662707107:web:becacf6cceabc7bd466016',
};

export function getStoredFirebaseConfig(): FirebaseClientConfig {
  try {
    const raw = localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FirebaseClientConfig>;
      if (parsed && parsed.apiKey && parsed.projectId && parsed.authDomain) {
        return parsed as FirebaseClientConfig;
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_FIREBASE_CONFIG;
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
