import type { FirebaseApp } from 'firebase/app';
import type {
  Auth,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import type {
  Firestore,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import type { FirebaseStorage, deleteObject, getBlob, ref, uploadBytes } from 'firebase/storage';
import type { Functions, httpsCallable } from 'firebase/functions';

export interface FirebaseClientConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  useCloudStorage?: boolean;
}

export interface FirebaseAuthHandle {
  app: FirebaseApp;
  auth: Auth;
  GoogleAuthProvider: typeof GoogleAuthProvider;
  onAuthStateChanged: typeof onAuthStateChanged;
  signInWithPopup: typeof signInWithPopup;
  signInWithEmailAndPassword: typeof signInWithEmailAndPassword;
  createUserWithEmailAndPassword: typeof createUserWithEmailAndPassword;
  signOut: typeof signOut;
}

export interface FirebaseFirestoreHandle {
  app: FirebaseApp;
  db: Firestore;
  collection: typeof collection;
  deleteDoc: typeof deleteDoc;
  doc: typeof doc;
  getDoc: typeof getDoc;
  getDocs: typeof getDocs;
  onSnapshot: typeof onSnapshot;
  setDoc: typeof setDoc;
  writeBatch: typeof writeBatch;
}

export interface FirebaseStorageHandle {
  app: FirebaseApp;
  storage: FirebaseStorage;
  ref: typeof ref;
  getBlob: typeof getBlob;
  uploadBytes: typeof uploadBytes;
  deleteObject: typeof deleteObject;
}

export interface FirebaseFunctionsHandle {
  app: FirebaseApp;
  functions: Functions;
  httpsCallable: typeof httpsCallable;
}

const FIREBASE_CONFIG_STORAGE_KEY = 'whc_firebase_config_v1';
const RUNTIME_CONFIG_TIMEOUT_MS = 3000;
const REVOKED_KEY_DIGESTS = new Set(['39:d1f2b247:1f77526b']);

let runtimeConfig: FirebaseClientConfig | null = null;
let localConfigCache: FirebaseClientConfig | null = null;
let localConfigChecked = false;

let cachedApp: FirebaseApp | null = null;
let cachedAuthHandle: FirebaseAuthHandle | null = null;
let cachedFirestoreHandle: FirebaseFirestoreHandle | null = null;
let cachedStorageHandle: FirebaseStorageHandle | null = null;
let cachedFunctionsHandle: FirebaseFunctionsHandle | null = null;

let appPromise: Promise<FirebaseApp | null> | null = null;
let authPromise: Promise<FirebaseAuthHandle | null> | null = null;
let firestorePromise: Promise<FirebaseFirestoreHandle | null> | null = null;
let storagePromise: Promise<FirebaseStorageHandle | null> | null = null;
let functionsPromise: Promise<FirebaseFunctionsHandle | null> | null = null;

function clearCachedSdkHandles(): void {
  cachedApp = null;
  cachedAuthHandle = null;
  cachedFirestoreHandle = null;
  cachedStorageHandle = null;
  cachedFunctionsHandle = null;
  appPromise = null;
  authPromise = null;
  firestorePromise = null;
  storagePromise = null;
  functionsPromise = null;
}

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

export function getRuntimeConfigEndpoints(isLocal = isLocalFirebaseHost()): readonly string[] {
  return isLocal
    ? ['/firebase-config.local.json', '/__/firebase/init.json']
    : ['/__/firebase/init.json', '/firebase-config.json'];
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
  if (localConfigChecked) {
    return localConfigCache;
  }
  localConfigChecked = true;
  localConfigCache = null;
  try {
    const raw = localStorage.getItem(FIREBASE_CONFIG_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (isValidConfig(parsed)) {
      localConfigCache = parsed;
      return parsed;
    }
    localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
  } catch {
    try {
      localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
    } catch {
      // Ignore storage access errors
    }
  }
  return null;
}

export function invalidateLocalFirebaseConfigCache(): void {
  localConfigChecked = false;
  localConfigCache = null;
}

export function resetRuntimeFirebaseConfigForTests(): void {
  runtimeConfig = null;
  invalidateLocalFirebaseConfigCache();
  clearCachedSdkHandles();
}

/**
 * Loads Firebase client configuration at startup without hardcoding API keys in Git:
 * 1. Resets cached runtime state and purges any legacy/revoked `localStorage` config (`whc_firebase_config_v1`).
 * 2. On localhost, checks `/firebase-config.local.json` first, then `/__/firebase/init.json`.
 * 3. On production/preview hosts, checks `/__/firebase/init.json` first, then `/firebase-config.json`.
 */
export async function loadRuntimeFirebaseConfig(): Promise<void> {
  runtimeConfig = null;
  invalidateLocalFirebaseConfigCache();
  clearCachedSdkHandles();
  readValidLocalConfig();

  const endpoints = getRuntimeConfigEndpoints();

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
          clearCachedSdkHandles();
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

export function getLoadedFirebaseAuth(): Auth | null {
  return cachedAuthHandle?.auth ?? null;
}

export async function getFirebaseApp(): Promise<FirebaseApp | null> {
  if (cachedApp) {
    return cachedApp;
  }
  const cfg = getStoredFirebaseConfig();
  if (!cfg || !cfg.apiKey || !cfg.projectId) {
    return null;
  }
  if (!appPromise) {
    appPromise = (async () => {
      try {
        const { getApps, initializeApp } = await import('firebase/app');
        const apps = getApps();
        const app = apps.length > 0 ? apps[0] : initializeApp(cfg);
        cachedApp = app;
        return app;
      } catch (err) {
        appPromise = null;
        console.warn('Failed to initialize Firebase client:', err);
        return null;
      }
    })();
  }
  return appPromise;
}

export async function getFirebaseAuth(): Promise<FirebaseAuthHandle | null> {
  if (cachedAuthHandle) {
    return cachedAuthHandle;
  }
  if (!getStoredFirebaseConfig()) {
    return null;
  }
  if (!authPromise) {
    authPromise = (async () => {
      try {
        const [app, mod] = await Promise.all([getFirebaseApp(), import('firebase/auth')]);
        if (!app) {
          authPromise = null;
          return null;
        }
        const handle: FirebaseAuthHandle = {
          app,
          auth: mod.getAuth(app),
          GoogleAuthProvider: mod.GoogleAuthProvider,
          onAuthStateChanged: mod.onAuthStateChanged,
          signInWithPopup: mod.signInWithPopup,
          signInWithEmailAndPassword: mod.signInWithEmailAndPassword,
          createUserWithEmailAndPassword: mod.createUserWithEmailAndPassword,
          signOut: mod.signOut,
        };
        cachedAuthHandle = handle;
        return handle;
      } catch (err) {
        authPromise = null;
        console.warn('Failed to load Firebase Auth:', err);
        return null;
      }
    })();
  }
  return authPromise;
}

export async function getFirebaseFirestore(): Promise<FirebaseFirestoreHandle | null> {
  if (cachedFirestoreHandle) {
    return cachedFirestoreHandle;
  }
  if (!getStoredFirebaseConfig()) {
    return null;
  }
  if (!firestorePromise) {
    firestorePromise = (async () => {
      try {
        const [app, mod] = await Promise.all([getFirebaseApp(), import('firebase/firestore')]);
        if (!app) {
          firestorePromise = null;
          return null;
        }
        const handle: FirebaseFirestoreHandle = {
          app,
          db: mod.getFirestore(app),
          collection: mod.collection,
          deleteDoc: mod.deleteDoc,
          doc: mod.doc,
          getDoc: mod.getDoc,
          getDocs: mod.getDocs,
          onSnapshot: mod.onSnapshot,
          setDoc: mod.setDoc,
          writeBatch: mod.writeBatch,
        };
        cachedFirestoreHandle = handle;
        return handle;
      } catch (err) {
        firestorePromise = null;
        console.warn('Failed to load Firebase Firestore:', err);
        return null;
      }
    })();
  }
  return firestorePromise;
}

export async function getFirebaseStorage(): Promise<FirebaseStorageHandle | null> {
  if (cachedStorageHandle) {
    return cachedStorageHandle;
  }
  if (!getStoredFirebaseConfig()) {
    return null;
  }
  if (!storagePromise) {
    storagePromise = (async () => {
      try {
        const [app, mod] = await Promise.all([getFirebaseApp(), import('firebase/storage')]);
        if (!app) {
          storagePromise = null;
          return null;
        }
        const handle: FirebaseStorageHandle = {
          app,
          storage: mod.getStorage(app),
          ref: mod.ref,
          getBlob: mod.getBlob,
          uploadBytes: mod.uploadBytes,
          deleteObject: mod.deleteObject,
        };
        cachedStorageHandle = handle;
        return handle;
      } catch (err) {
        storagePromise = null;
        console.warn('Failed to load Firebase Storage:', err);
        return null;
      }
    })();
  }
  return storagePromise;
}

export async function getFirebaseFunctions(): Promise<FirebaseFunctionsHandle | null> {
  if (cachedFunctionsHandle) {
    return cachedFunctionsHandle;
  }
  if (!getStoredFirebaseConfig()) {
    return null;
  }
  if (!functionsPromise) {
    functionsPromise = (async () => {
      try {
        const [app, mod] = await Promise.all([getFirebaseApp(), import('firebase/functions')]);
        if (!app) {
          functionsPromise = null;
          return null;
        }
        const handle: FirebaseFunctionsHandle = {
          app,
          functions: mod.getFunctions(app),
          httpsCallable: mod.httpsCallable,
        };
        cachedFunctionsHandle = handle;
        return handle;
      } catch (err) {
        functionsPromise = null;
        console.warn('Failed to load Firebase Functions:', err);
        return null;
      }
    })();
  }
  return functionsPromise;
}
