import { TestBed } from '@angular/core/testing';
import type { User } from 'firebase/auth';
import { CloudSyncStatus, UserAccountState, UserProject } from '../models/catalog.models';
import { createDefaultState } from '../utils/user-state-normalizer.util';
import { UserCloudSyncHost, UserCloudSyncService } from './user-cloud-sync.service';
import { UserMediaService } from './user-media.service';

describe('UserCloudSyncService', () => {
  let service: UserCloudSyncService;
  let hostState: UserAccountState;
  let hostMock: jasmine.SpyObj<UserCloudSyncHost>;
  let mediaMock: {
    syncPendingBlobsToCloud: jasmine.Spy;
    clearAllLocalMedia: jasmine.Spy;
  };

  beforeEach(() => {
    hostState = createDefaultState();
    hostMock = jasmine.createSpyObj<UserCloudSyncHost>('UserCloudSyncHost', [
      'getState',
      'getAllUploadedPhotos',
      'resetLocalForAccountChange',
      'mergeRemoteAccountData',
      'attachUploadedPhotoPaths',
      'applyRemoteAccountDoc',
      'applyRemoteProjects',
    ]);
    hostMock.getState.and.callFake(() => hostState);
    hostMock.getAllUploadedPhotos.and.returnValue([]);
    hostMock.resetLocalForAccountChange.and.callFake(async () => {
      hostState = createDefaultState();
    });
    hostMock.mergeRemoteAccountData.and.callFake((remoteUserData, subcollectionProjects) => {
      if (remoteUserData && Array.isArray(remoteUserData['inventoryPaintIds'])) {
        hostState = {
          ...hostState,
          inventoryPaintIds: remoteUserData['inventoryPaintIds'] as string[],
        };
      }
      if (subcollectionProjects.length > 0) {
        hostState = {
          ...hostState,
          projects: subcollectionProjects,
        };
      }
    });
    hostMock.applyRemoteAccountDoc.and.callFake((next) => {
      hostState = next;
    });
    hostMock.applyRemoteProjects.and.callFake((next) => {
      hostState = next;
    });

    mediaMock = {
      syncPendingBlobsToCloud: jasmine.createSpy('syncPendingBlobsToCloud').and.resolveTo(new Map()),
      clearAllLocalMedia: jasmine.createSpy('clearAllLocalMedia').and.resolveTo(),
    };

    TestBed.configureTestingModule({
      providers: [
        UserCloudSyncService,
        { provide: UserMediaService, useValue: mediaMock },
      ],
    });
    service = TestBed.inject(UserCloudSyncService);
    service.attachHost(hostMock);
  });

  it('sets LocalOnly without calling getAuthHandle when Firebase is unconfigured', () => {
    const svcPrivate = service as unknown as {
      isFirebaseConfigured: () => boolean;
      getAuthHandle: () => Promise<unknown>;
    };
    spyOn(svcPrivate, 'isFirebaseConfigured').and.returnValue(false);
    const getAuthSpy = spyOn(svcPrivate, 'getAuthHandle');

    service.initAuthListener();

    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.LocalOnly);
    expect(getAuthSpy).not.toHaveBeenCalled();
  });

  it('unsubscribes stale async auth listener when initAuthListener is superseded or ngOnDestroy runs mid-await', async () => {
    const svcPrivate = service as unknown as {
      isFirebaseConfigured: () => boolean;
      getAuthHandle: () => Promise<unknown>;
      subscribeAuthState: (auth: unknown, cb: (u: User | null) => void) => () => void;
    };

    let resolveFirstAuth!: (val: unknown) => void;
    let resolveSecondAuth!: (val: unknown) => void;
    let callCount = 0;
    const unsub1 = jasmine.createSpy('unsub1');
    const unsub2 = jasmine.createSpy('unsub2');

    spyOn(svcPrivate, 'isFirebaseConfigured').and.returnValue(true);
    spyOn(svcPrivate, 'getAuthHandle').and.callFake(
      () =>
        new Promise((res) => {
          callCount++;
          if (callCount === 1) {
            resolveFirstAuth = res;
          } else {
            resolveSecondAuth = res;
          }
        })
    );
    const subSpy = spyOn(svcPrivate, 'subscribeAuthState').and.callFake(() =>
      subSpy.calls.count() === 1 ? unsub1 : unsub2
    );

    service.initAuthListener();
    service.initAuthListener();
    resolveFirstAuth({ auth: {} });
    await Promise.resolve();
    await Promise.resolve();
    expect(unsub1).not.toHaveBeenCalled();
    expect(subSpy).not.toHaveBeenCalled();

    // Now test ngOnDestroy after subscribeAuthState returns:
    resolveSecondAuth({ auth: {} });
    await Promise.resolve();
    await Promise.resolve();
    expect(subSpy).toHaveBeenCalledTimes(1);

    service.ngOnDestroy();
    expect(unsub1).toHaveBeenCalledTimes(1);
  });

  it('respects pending write/delete guards, stale updatedAt, error callbacks, and decrements counters on write failure', async () => {
    const svcPrivate = service as unknown as {
      isFirebaseConfigured: () => boolean;
      getAuthHandle: () => Promise<unknown>;
      getFirestoreHandle: () => Promise<unknown>;
      getUserDocRef: (fs: unknown, uid: string) => unknown;
      getProjectsColRef: (fs: unknown, uid: string) => unknown;
      getProjectDocRef: (fs: unknown, uid: string, pid: string) => unknown;
      subscribeAuthState: (auth: unknown, cb: (u: User | null) => void) => () => void;
      fetchDocSnap: (fs: unknown, ref: unknown) => Promise<{ exists: () => boolean; data: () => unknown }>;
      fetchQuerySnap: (fs: unknown, ref: unknown) => Promise<{ forEach: (cb: (d: unknown) => void) => void }>;
      subscribeDocSnapshot: (
        fs: unknown,
        ref: unknown,
        onNext: (snap: unknown) => void,
        onError: (err: Error) => void
      ) => () => void;
      subscribeQuerySnapshot: (
        fs: unknown,
        ref: unknown,
        onNext: (snap: unknown) => void,
        onError: (err: Error) => void
      ) => () => void;
      writeDoc: (fs: unknown, ref: unknown, data: unknown, opts?: unknown) => Promise<void>;
      removeDoc: (fs: unknown, ref: unknown) => Promise<void>;
      createWriteBatch: (fs: unknown) => {
        set: () => void;
        delete: () => void;
        commit: () => Promise<void>;
      };
      pendingAccountWrites: number;
      pendingProjectDeletes: Map<string, number>;
    };

    let authCb!: (user: User | null) => void;
    let docOnNext!: (snap: unknown) => void;
    let projOnNext!: (snap: unknown) => void;

    spyOn(svcPrivate, 'isFirebaseConfigured').and.returnValue(true);
    spyOn(svcPrivate, 'getAuthHandle').and.resolveTo({ auth: {} });
    spyOn(svcPrivate, 'getFirestoreHandle').and.resolveTo({ db: {} });
    spyOn(svcPrivate, 'getUserDocRef').and.returnValue({ path: 'users/u1' });
    spyOn(svcPrivate, 'getProjectsColRef').and.returnValue({ path: 'users/u1/projects' });
    spyOn(svcPrivate, 'getProjectDocRef').and.returnValue({ path: 'users/u1/projects/p1' });
    spyOn(svcPrivate, 'subscribeAuthState').and.callFake((_auth, cb) => {
      authCb = cb;
      return () => {};
    });
    spyOn(svcPrivate, 'fetchDocSnap').and.resolveTo({
      exists: () => true,
      data: () => ({ inventoryPaintIds: ['p-init'] }),
    });
    spyOn(svcPrivate, 'fetchQuerySnap').and.resolveTo({ forEach: () => {} });
    spyOn(svcPrivate, 'subscribeDocSnapshot').and.callFake((_fs, _ref, onNext) => {
      docOnNext = onNext;
      return () => {};
    });
    spyOn(svcPrivate, 'subscribeQuerySnapshot').and.callFake((_fs, _ref, onNext) => {
      projOnNext = onNext;
      return () => {};
    });
    spyOn(svcPrivate, 'createWriteBatch').and.returnValue({
      set: () => {},
      delete: () => {},
      commit: () => Promise.resolve(),
    });
    spyOn(svcPrivate, 'writeDoc').and.rejectWith(new Error('permission-denied'));
    spyOn(svcPrivate, 'removeDoc').and.rejectWith(new Error('delete-failed'));
    spyOn(console, 'warn');

    service.initAuthListener();
    await new Promise((r) => setTimeout(r, 0));
    authCb({ uid: 'u1' } as User);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Synced);

    // 1. Stale updatedAt and hasPendingWrites are ignored on user doc snapshot
    hostState = { ...hostState, updatedAt: '2026-06-01T00:00:00Z' };
    docOnNext({
      exists: () => true,
      metadata: { hasPendingWrites: true },
      data: () => ({ updatedAt: '2026-07-01T00:00:00Z', inventoryPaintIds: ['pending'] }),
    });
    docOnNext({
      exists: () => true,
      metadata: { hasPendingWrites: false },
      data: () => ({ updatedAt: '2026-05-01T00:00:00Z', inventoryPaintIds: ['stale'] }),
    });
    expect(hostMock.applyRemoteAccountDoc).not.toHaveBeenCalled();

    // Newer remote doc applies cleanly
    docOnNext({
      exists: () => true,
      metadata: { hasPendingWrites: false },
      data: () => ({ updatedAt: '2026-08-01T00:00:00Z', inventoryPaintIds: ['newer'] }),
    });
    expect(hostMock.applyRemoteAccountDoc).toHaveBeenCalledTimes(1);

    // 2. Pending delete suppresses resurrection in projects snapshot
    svcPrivate.pendingProjectDeletes.set('p_del', 1);
    projOnNext({
      metadata: { hasPendingWrites: false },
      forEach: (cb: (d: unknown) => void) => {
        cb({
          id: 'p_del',
          data: () => ({ name: 'Zombie', updatedAt: '2026-09-01T00:00:00Z' }),
        });
        cb({
          id: 'p_keep',
          data: () => ({ name: 'Kept', updatedAt: '2026-09-01T00:00:00Z' }),
        });
      },
    });
    const lastProjects = hostMock.applyRemoteProjects.calls.mostRecent().args[0].projects;
    expect(lastProjects.map((p: UserProject) => p.id)).toEqual(['p_keep']);
    svcPrivate.pendingProjectDeletes.delete('p_del');

    // 3. Counters decrement in finally even when writeDoc / removeDoc reject
    await service.pushAccountDocToFirestore(hostState);
    expect(svcPrivate.pendingAccountWrites).toBe(0);
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Error);

    await service.deleteProjectFromFirestore('p_del');
    expect(svcPrivate.pendingProjectDeletes.size).toBe(0);
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Error);
  });

  it('dispatches syncPlan modes, handles account switching and uploaded photo paths, and guards signIn/signOut', async () => {
    const svcPrivate = service as unknown as {
      isFirebaseConfigured: () => boolean;
      getAuthHandle: () => Promise<unknown>;
      getFirestoreHandle: () => Promise<unknown>;
      getUserDocRef: (fs: unknown, uid: string) => unknown;
      getProjectsColRef: (fs: unknown, uid: string) => unknown;
      getProjectDocRef: (fs: unknown, uid: string, pid: string) => unknown;
      subscribeAuthState: (auth: unknown, cb: (u: User | null) => void) => () => void;
      fetchDocSnap: (fs: unknown, ref: unknown) => Promise<{ exists: () => boolean; data: () => unknown }>;
      fetchQuerySnap: (fs: unknown, ref: unknown) => Promise<{ forEach: (cb: (d: unknown) => void) => void }>;
      subscribeDocSnapshot: () => () => void;
      subscribeQuerySnapshot: () => () => void;
      createWriteBatch: (fs: unknown) => {
        set: () => void;
        delete: () => void;
        commit: () => Promise<void>;
      };
      signInPopupWithGoogle: (auth: unknown) => Promise<void>;
      signInEmailPassword: (auth: unknown, e: string, p: string, s: boolean) => Promise<void>;
    };

    // 1. Unconfigured sign-in throws & signOutCloud returns false
    const getAuthSpy = spyOn(svcPrivate, 'getAuthHandle').and.resolveTo(null);
    await expectAsync(service.signInWithGoogle()).toBeRejectedWithError(/Configure your Firebase/i);
    await expectAsync(service.signInWithEmail('a@b.c', 'pw')).toBeRejectedWithError(
      /Configure your Firebase/i
    );
    expect(await service.signOutCloud()).toBeFalse();

    // 2. Configured signIn delegates
    getAuthSpy.and.resolveTo({ auth: {} });
    const googleSpy = spyOn(svcPrivate, 'signInPopupWithGoogle').and.resolveTo();
    const emailSpy = spyOn(svcPrivate, 'signInEmailPassword').and.resolveTo();
    await service.signInWithGoogle();
    await service.signInWithEmail('a@b.c', 'secret', true);
    expect(googleSpy).toHaveBeenCalledTimes(1);
    expect(emailSpy).toHaveBeenCalledWith({ auth: {} }, 'a@b.c', 'secret', true);

    // 3. Firestore null -> LocalOnly; syncSignedInUser account switch calls resetLocalForAccountChange & attachUploadedPhotoPaths
    let authCb!: (user: User | null) => void;
    spyOn(svcPrivate, 'isFirebaseConfigured').and.returnValue(true);
    spyOn(svcPrivate, 'subscribeAuthState').and.callFake((_auth, cb) => {
      authCb = cb;
      return () => {};
    });
    const getFsSpy = spyOn(svcPrivate, 'getFirestoreHandle').and.resolveTo(null);

    service.initAuthListener();
    await new Promise((r) => setTimeout(r, 0));
    authCb({ uid: 'uid_1' } as User);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.LocalOnly);

    getFsSpy.and.resolveTo({ db: {} });
    spyOn(svcPrivate, 'getUserDocRef').and.returnValue({});
    spyOn(svcPrivate, 'getProjectsColRef').and.returnValue({});
    spyOn(svcPrivate, 'getProjectDocRef').and.returnValue({});
    const fetchDocSpy = spyOn(svcPrivate, 'fetchDocSnap').and.resolveTo({
      exists: () => false,
      data: () => ({}),
    });
    spyOn(svcPrivate, 'fetchQuerySnap').and.resolveTo({ forEach: () => {} });
    spyOn(svcPrivate, 'subscribeDocSnapshot').and.returnValue(() => {});
    spyOn(svcPrivate, 'subscribeQuerySnapshot').and.returnValue(() => {});
    spyOn(svcPrivate, 'createWriteBatch').and.returnValue({
      set: () => {},
      delete: () => {},
      commit: () => Promise.resolve(),
    });
    mediaMock.syncPendingBlobsToCloud.and.resolveTo(new Map([['ph_1', 'users/uid_1/ph_1.jpg']]));

    authCb({ uid: 'uid_1' } as User);
    await new Promise((r) => setTimeout(r, 0));
    expect(hostMock.attachUploadedPhotoPaths).toHaveBeenCalledWith(
      new Map([['ph_1', 'users/uid_1/ph_1.jpg']])
    );
    expect(hostMock.resetLocalForAccountChange).not.toHaveBeenCalled();

    // Switch to uid_2 -> resets local account state before merging
    authCb({ uid: 'uid_2' } as User);
    await new Promise((r) => setTimeout(r, 0));
    expect(hostMock.resetLocalForAccountChange).toHaveBeenCalledTimes(1);

    // 4. syncPlan routes none, all, and partial account/project/delete updates
    const pushAllSpy = spyOn(service, 'pushAllToFirestore').and.resolveTo();
    const pushAccSpy = spyOn(service, 'pushAccountDocToFirestore').and.resolveTo();
    const pushProjSpy = spyOn(service, 'pushProjectToFirestore').and.resolveTo();
    const delProjSpy = spyOn(service, 'deleteProjectFromFirestore').and.resolveTo();

    const proj: UserProject = {
      id: 'proj_sync',
      name: 'Sync Proj',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      models: [],
      colorIds: [],
      notes: [],
      photos: [],
    };
    const committed: UserAccountState = { ...hostState, projects: [proj] };

    service.syncPlan('none', committed);
    expect(pushAllSpy).not.toHaveBeenCalled();

    service.syncPlan('all', committed, ['proj_old']);
    expect(pushAllSpy).toHaveBeenCalledWith(committed, ['proj_old']);

    service.syncPlan(
      { account: true, projectIds: ['proj_sync', 'missing'], deletedProjectIds: ['proj_del'] },
      committed
    );
    expect(pushAccSpy).toHaveBeenCalledWith(committed);
    expect(pushProjSpy).toHaveBeenCalledWith(proj);
    expect(delProjSpy).toHaveBeenCalledWith('proj_del');

    // 5. fetchDocSnap failure transitions to Error
    spyOn(console, 'warn');
    fetchDocSpy.and.rejectWith(new Error('network error'));
    authCb({ uid: 'uid_3' } as User);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Error);
  });
});
