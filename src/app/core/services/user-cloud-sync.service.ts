import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import type { User } from 'firebase/auth';
import type {
  CollectionReference,
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  FirestoreError,
  QuerySnapshot,
  WriteBatch,
} from 'firebase/firestore';
import { USER_LIMITS } from '../config/user-limits.config';
import {
  CloudSyncStatus,
  UserAccountState,
  UserProject,
  UserUploadedPhoto,
} from '../models/catalog.models';
import {
  extractAccountDocPayload,
  normalizeAccountState,
  normalizeIncomingProject,
  stripUndefinedDeep,
} from '../utils/user-state-normalizer.util';
import {
  FirebaseAuthHandle,
  FirebaseFirestoreHandle,
  getFirebaseAuth,
  getFirebaseFirestore,
  getStoredFirebaseConfig,
} from './firebase.config';
import { UserMediaService } from './user-media.service';

export type CloudSyncPlan =
  | 'none'
  | 'all'
  | {
      account?: boolean;
      projectIds?: string[];
      deletedProjectIds?: string[];
    };

export interface UserCloudSyncHost {
  getState(): UserAccountState;
  getAllUploadedPhotos(): UserUploadedPhoto[];
  resetLocalForAccountChange(): Promise<void>;
  mergeRemoteAccountData(
    remoteUserData: Record<string, unknown> | null,
    subcollectionProjects: UserProject[]
  ): void;
  attachUploadedPhotoPaths(uploadedMap: Map<string, string>): void;
  applyRemoteAccountDoc(next: UserAccountState): void;
  applyRemoteProjects(next: UserAccountState): void;
}

@Injectable({
  providedIn: 'root',
})
export class UserCloudSyncService implements OnDestroy {
  private readonly media = inject(UserMediaService);

  private readonly _currentUser = signal<User | null>(null);
  readonly currentUser = this._currentUser.asReadonly();

  private readonly _cloudSyncStatus = signal<CloudSyncStatus>(CloudSyncStatus.LocalOnly);
  readonly cloudSyncStatus = this._cloudSyncStatus.asReadonly();

  private host: UserCloudSyncHost | null = null;
  private unsubscribeUserFirestore: (() => void) | null = null;
  private unsubscribeProjectsFirestore: (() => void) | null = null;
  private unsubscribeAuth: (() => void) | null = null;
  private authGeneration = 0;
  private listenerInitGeneration = 0;
  private destroyed = false;
  private activeSyncedUid: string | null = null;
  private pendingAccountWrites = 0;
  private pendingBatchWrites = 0;
  private readonly pendingProjectWrites = new Map<string, number>();
  private readonly pendingProjectDeletes = new Map<string, number>();

  attachHost(host: UserCloudSyncHost): void {
    this.host = host;
  }

  getAuthGeneration(): number {
    return this.authGeneration;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.listenerInitGeneration++;
    this.clearAuthSubscription();
    this.clearFirestoreListeners();
  }

  protected isFirebaseConfigured(): boolean {
    return Boolean(getStoredFirebaseConfig());
  }

  protected getAuthHandle(): Promise<FirebaseAuthHandle | null> {
    return getFirebaseAuth();
  }

  protected getFirestoreHandle(): Promise<FirebaseFirestoreHandle | null> {
    return getFirebaseFirestore();
  }

  protected getUserDocRef(fs: FirebaseFirestoreHandle, uid: string): DocumentReference {
    return fs.doc(fs.db, 'users', uid);
  }

  protected getProjectsColRef(fs: FirebaseFirestoreHandle, uid: string): CollectionReference {
    return fs.collection(fs.db, 'users', uid, 'projects');
  }

  protected getProjectDocRef(
    fs: FirebaseFirestoreHandle,
    uid: string,
    projectId: string
  ): DocumentReference {
    return fs.doc(fs.db, 'users', uid, 'projects', projectId);
  }

  protected subscribeAuthState(
    fbAuth: FirebaseAuthHandle,
    callback: (user: User | null) => void
  ): () => void {
    return fbAuth.onAuthStateChanged(fbAuth.auth, callback);
  }

  protected fetchDocSnap(
    _fs: FirebaseFirestoreHandle,
    ref: DocumentReference
  ): Promise<DocumentSnapshot> {
    return _fs.getDoc(ref);
  }

  protected fetchQuerySnap(
    _fs: FirebaseFirestoreHandle,
    ref: CollectionReference
  ): Promise<QuerySnapshot> {
    return _fs.getDocs(ref);
  }

  protected subscribeDocSnapshot(
    fs: FirebaseFirestoreHandle,
    ref: DocumentReference,
    onNext: (snap: DocumentSnapshot) => void,
    onError: (err: FirestoreError) => void
  ): () => void {
    return fs.onSnapshot(ref, onNext, onError);
  }

  protected subscribeQuerySnapshot(
    fs: FirebaseFirestoreHandle,
    ref: CollectionReference,
    onNext: (snap: QuerySnapshot) => void,
    onError: (err: FirestoreError) => void
  ): () => void {
    return fs.onSnapshot(ref, onNext, onError);
  }

  protected writeDoc(
    fs: FirebaseFirestoreHandle,
    ref: DocumentReference,
    data: DocumentData,
    options?: { merge?: boolean }
  ): Promise<void> {
    return options ? fs.setDoc(ref, data, options) : fs.setDoc(ref, data);
  }

  protected removeDoc(fs: FirebaseFirestoreHandle, ref: DocumentReference): Promise<void> {
    return fs.deleteDoc(ref);
  }

  protected createWriteBatch(fs: FirebaseFirestoreHandle): WriteBatch {
    return fs.writeBatch(fs.db);
  }

  protected sdkSignOut(fbAuth: FirebaseAuthHandle): Promise<void> {
    return fbAuth.signOut(fbAuth.auth);
  }

  protected signInPopupWithGoogle(fbAuth: FirebaseAuthHandle): Promise<unknown> {
    const provider = new fbAuth.GoogleAuthProvider();
    return fbAuth.signInWithPopup(fbAuth.auth, provider);
  }

  protected signInEmailPassword(
    fbAuth: FirebaseAuthHandle,
    email: string,
    pass: string,
    isSignUp: boolean
  ): Promise<unknown> {
    return isSignUp
      ? fbAuth.createUserWithEmailAndPassword(fbAuth.auth, email, pass)
      : fbAuth.signInWithEmailAndPassword(fbAuth.auth, email, pass);
  }

  private clearAuthSubscription(): void {
    if (this.unsubscribeAuth) {
      this.unsubscribeAuth();
      this.unsubscribeAuth = null;
    }
  }

  private clearFirestoreListeners(): void {
    if (this.unsubscribeUserFirestore) {
      this.unsubscribeUserFirestore();
      this.unsubscribeUserFirestore = null;
    }
    if (this.unsubscribeProjectsFirestore) {
      this.unsubscribeProjectsFirestore();
      this.unsubscribeProjectsFirestore = null;
    }
  }

  initAuthListener(host?: UserCloudSyncHost): void {
    if (host) {
      this.host = host;
    }
    const initGen = ++this.listenerInitGeneration;
    this.clearAuthSubscription();
    this.clearFirestoreListeners();

    if (!this.isFirebaseConfigured()) {
      this._cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
      return;
    }

    void this.attachAuthListenerAsync(initGen);
  }

  private async attachAuthListenerAsync(initGen: number): Promise<void> {
    const fbAuth = await this.getAuthHandle();
    if (this.destroyed || initGen !== this.listenerInitGeneration) {
      return;
    }
    if (!fbAuth) {
      this._cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
      return;
    }

    const unsub = this.subscribeAuthState(fbAuth, (user) => {
      const authGen = ++this.authGeneration;
      this._currentUser.set(user);
      this.clearFirestoreListeners();
      if (!user) {
        this._cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
        return;
      }
      void this.syncSignedInUser(user, authGen);
    });

    if (this.destroyed || initGen !== this.listenerInitGeneration) {
      unsub();
      return;
    }
    this.unsubscribeAuth = unsub;
  }

  syncPlan(
    plan: CloudSyncPlan,
    committed: UserAccountState,
    removedProjectIds: readonly string[] = []
  ): void {
    if (plan === 'none' || !this._currentUser()) {
      return;
    }
    if (plan === 'all') {
      void this.pushAllToFirestore(committed, removedProjectIds);
      return;
    }
    if (plan.account) {
      void this.pushAccountDocToFirestore(committed);
    }
    for (const projectId of plan.projectIds ?? []) {
      const proj = committed.projects.find((p) => p.id === projectId);
      if (proj) {
        void this.pushProjectToFirestore(proj);
      }
    }
    for (const deletedId of plan.deletedProjectIds ?? []) {
      void this.deleteProjectFromFirestore(deletedId);
    }
  }

  private async syncSignedInUser(user: User, authGen: number): Promise<void> {
    this._cloudSyncStatus.set(CloudSyncStatus.Syncing);
    const fs = await this.getFirestoreHandle();
    if (!fs || authGen !== this.authGeneration) {
      if (authGen === this.authGeneration && !fs) {
        this._cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
      }
      return;
    }

    const userDocRef = this.getUserDocRef(fs, user.uid);
    const projectsColRef = this.getProjectsColRef(fs, user.uid);

    try {
      if (this.activeSyncedUid && this.activeSyncedUid !== user.uid) {
        await this.host?.resetLocalForAccountChange();
        if (authGen !== this.authGeneration) {
          return;
        }
      }

      const [userSnap, projectsSnap] = await Promise.all([
        this.fetchDocSnap(fs, userDocRef),
        this.fetchQuerySnap(fs, projectsColRef),
      ]);
      if (authGen !== this.authGeneration) {
        return;
      }
      this.activeSyncedUid = user.uid;

      const remoteUserData = userSnap.exists()
        ? (userSnap.data() as Record<string, unknown>)
        : null;

      const subcollectionProjects: UserProject[] = [];
      projectsSnap.forEach((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        subcollectionProjects.push(normalizeIncomingProject({ ...raw, id: docSnap.id }));
      });

      this.host?.mergeRemoteAccountData(remoteUserData, subcollectionProjects);

      const uploadedMap = await this.media.syncPendingBlobsToCloud(
        this.host?.getAllUploadedPhotos() ?? [],
        user.uid
      );
      if (authGen !== this.authGeneration) {
        return;
      }
      if (uploadedMap.size > 0) {
        this.host?.attachUploadedPhotoPaths(uploadedMap);
      }

      const currentState = this.host?.getState();
      if (currentState) {
        await this.pushAllToFirestore(currentState);
        if (authGen !== this.authGeneration) {
          return;
        }
      }

      this.unsubscribeUserFirestore = this.subscribeDocSnapshot(
        fs,
        userDocRef,
        (docSnap) => {
          if (
            authGen !== this.authGeneration ||
            !docSnap.exists() ||
            docSnap.metadata.hasPendingWrites ||
            this.pendingAccountWrites > 0 ||
            this.pendingBatchWrites > 0 ||
            !this.host
          ) {
            return;
          }
          const remote = docSnap.data() as Partial<UserAccountState>;
          const current = this.host.getState();
          if (remote.updatedAt && remote.updatedAt > current.updatedAt) {
            const normalized = normalizeAccountState({
              ...remote,
              projects: current.projects,
            });
            this.host.applyRemoteAccountDoc(normalized);
          }
        },
        (err) => {
          if (authGen !== this.authGeneration) {
            return;
          }
          console.warn('Firestore user listener error:', err);
          this._cloudSyncStatus.set(CloudSyncStatus.Error);
        }
      );

      this.unsubscribeProjectsFirestore = this.subscribeQuerySnapshot(
        fs,
        projectsColRef,
        (querySnap) => {
          if (
            authGen !== this.authGeneration ||
            querySnap.metadata.hasPendingWrites ||
            this.pendingBatchWrites > 0 ||
            !this.host
          ) {
            return;
          }
          const remoteMap = new Map<string, UserProject>();
          querySnap.forEach((docSnap) => {
            if ((this.pendingProjectDeletes.get(docSnap.id) ?? 0) > 0) {
              return;
            }
            const raw = docSnap.data() as Record<string, unknown>;
            remoteMap.set(docSnap.id, normalizeIncomingProject({ ...raw, id: docSnap.id }));
          });
          const current = this.host.getState();
          for (const localProj of current.projects) {
            if ((this.pendingProjectWrites.get(localProj.id) ?? 0) > 0) {
              remoteMap.set(localProj.id, localProj);
            }
          }
          const remoteProjects = Array.from(remoteMap.values());
          remoteProjects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          const next: UserAccountState = {
            ...current,
            projects: remoteProjects.slice(0, USER_LIMITS.MAX_PROJECTS),
          };
          this.host.applyRemoteProjects(next);
        },
        (err) => {
          if (authGen !== this.authGeneration) {
            return;
          }
          console.warn('Firestore projects listener error:', err);
          this._cloudSyncStatus.set(CloudSyncStatus.Error);
        }
      );

      this._cloudSyncStatus.set(CloudSyncStatus.Synced);
    } catch (err) {
      if (authGen !== this.authGeneration) {
        return;
      }
      console.warn('Firestore user sync failed:', err);
      this._cloudSyncStatus.set(CloudSyncStatus.Error);
    }
  }

  private async runFirestoreSync(
    errorLabel: string,
    op: (fs: FirebaseFirestoreHandle, uid: string) => Promise<void>
  ): Promise<void> {
    const fs = await this.getFirestoreHandle();
    const user = this._currentUser();
    if (!fs || !user) {
      return;
    }
    const startGen = this.authGeneration;
    try {
      this._cloudSyncStatus.set(CloudSyncStatus.Syncing);
      await op(fs, user.uid);
      if (startGen === this.authGeneration) {
        this._cloudSyncStatus.set(CloudSyncStatus.Synced);
      }
    } catch (err) {
      console.warn(errorLabel, err);
      if (startGen === this.authGeneration) {
        this._cloudSyncStatus.set(CloudSyncStatus.Error);
      }
    }
  }

  async pushAccountDocToFirestore(stateToSave: UserAccountState): Promise<void> {
    this.pendingAccountWrites++;
    try {
      await this.runFirestoreSync('Failed to sync account document to Firestore:', (fs, uid) =>
        this.writeDoc(
          fs,
          this.getUserDocRef(fs, uid),
          stripUndefinedDeep(extractAccountDocPayload(stateToSave)),
          { merge: true }
        )
      );
    } finally {
      this.pendingAccountWrites = Math.max(0, this.pendingAccountWrites - 1);
    }
  }

  async pushProjectToFirestore(project: UserProject): Promise<void> {
    this.pendingProjectWrites.set(
      project.id,
      (this.pendingProjectWrites.get(project.id) ?? 0) + 1
    );
    try {
      await this.runFirestoreSync(
        `Failed to sync project ${project.id} to Firestore:`,
        (fs, uid) =>
          this.writeDoc(
            fs,
            this.getProjectDocRef(fs, uid, project.id),
            stripUndefinedDeep(project)
          )
      );
    } finally {
      const remaining = (this.pendingProjectWrites.get(project.id) ?? 1) - 1;
      if (remaining > 0) {
        this.pendingProjectWrites.set(project.id, remaining);
      } else {
        this.pendingProjectWrites.delete(project.id);
      }
    }
  }

  async deleteProjectFromFirestore(projectId: string): Promise<void> {
    this.pendingProjectDeletes.set(
      projectId,
      (this.pendingProjectDeletes.get(projectId) ?? 0) + 1
    );
    try {
      await this.runFirestoreSync(
        `Failed to delete project ${projectId} from Firestore:`,
        (fs, uid) => this.removeDoc(fs, this.getProjectDocRef(fs, uid, projectId))
      );
    } finally {
      const remaining = (this.pendingProjectDeletes.get(projectId) ?? 1) - 1;
      if (remaining > 0) {
        this.pendingProjectDeletes.set(projectId, remaining);
      } else {
        this.pendingProjectDeletes.delete(projectId);
      }
    }
  }

  async pushAllToFirestore(
    stateToSave: UserAccountState,
    deletedProjectIds: readonly string[] = []
  ): Promise<void> {
    this.pendingBatchWrites++;
    try {
      await this.runFirestoreSync(
        'Failed to batch-sync account & projects to Firestore:',
        (fs, uid) => {
          const batch = this.createWriteBatch(fs);
          batch.set(
            this.getUserDocRef(fs, uid),
            stripUndefinedDeep(extractAccountDocPayload(stateToSave)),
            { merge: true }
          );
          for (const proj of stateToSave.projects.slice(0, USER_LIMITS.MAX_PROJECTS)) {
            batch.set(
              this.getProjectDocRef(fs, uid, proj.id),
              stripUndefinedDeep(proj)
            );
          }
          for (const delId of deletedProjectIds) {
            batch.delete(this.getProjectDocRef(fs, uid, delId));
          }
          return batch.commit();
        }
      );
    } finally {
      this.pendingBatchWrites = Math.max(0, this.pendingBatchWrites - 1);
    }
  }

  async signInWithGoogle(): Promise<void> {
    const fbAuth = await this.getAuthHandle();
    if (!fbAuth) {
      throw new Error('Configure your Firebase Project credentials first to enable Cloud Auth.');
    }
    await this.signInPopupWithGoogle(fbAuth);
  }

  async signInWithEmail(email: string, pass: string, isSignUp = false): Promise<void> {
    const fbAuth = await this.getAuthHandle();
    if (!fbAuth) {
      throw new Error('Configure your Firebase Project credentials first to enable Cloud Auth.');
    }
    await this.signInEmailPassword(fbAuth, email, pass, isSignUp);
  }

  async signOutCloud(): Promise<boolean> {
    const fbAuth = await this.getAuthHandle();
    if (!fbAuth) {
      return false;
    }
    const signOutGen = ++this.authGeneration;
    this.clearFirestoreListeners();
    await this.sdkSignOut(fbAuth);
    if (this.authGeneration !== signOutGen && this._currentUser() !== null) {
      return false;
    }
    this.activeSyncedUid = null;
    this._currentUser.set(null);
    this._cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
    await this.host?.resetLocalForAccountChange();
    if (this.authGeneration !== signOutGen && this._currentUser() !== null) {
      return false;
    }
    return true;
  }
}
