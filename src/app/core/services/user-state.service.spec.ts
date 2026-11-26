import { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { User } from 'firebase/auth';
import { USER_LIMITS } from '../config/user-limits.config';
import { CloudSyncStatus } from '../models/catalog.models';
import { ToastService } from './toast.service';
import { UserCloudSyncService } from './user-cloud-sync.service';
import { UserMediaService } from './user-media.service';
import { LOCAL_PERSIST_DEBOUNCE_MS, UserStateService } from './user-state.service';
import {
  PKCE_STATE_KEY,
  PKCE_TOKEN_CACHE_KEY,
  PKCE_VERIFIER_KEY,
} from '../utils/warhammer-pkce-storage.util';

const STORAGE_KEY = 'whc_user_state_v1';

describe('UserStateService — Project Model Entries', () => {
  let service: UserStateService;
  let deletePhotoAssetsSpy: jasmine.Spy;

  function setupService(initialStorage?: Record<string, unknown>): UserStateService {
    localStorage.removeItem(STORAGE_KEY);
    if (initialStorage) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialStorage));
    }

    deletePhotoAssetsSpy = jasmine.createSpy('deletePhotoAssets').and.resolveTo();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        UserStateService,
        {
          provide: UserMediaService,
          useValue: {
            resolvePhotoUrl: (ph: { id: string }) => `blob:${ph.id}`,
            deletePhotoAssets: deletePhotoAssetsSpy,
            clearAllLocalMedia: jasmine.createSpy('clearAllLocalMedia').and.resolveTo(),
            syncPendingBlobsToCloud: jasmine
              .createSpy('syncPendingBlobsToCloud')
              .and.resolveTo(new Map()),
          },
        },
      ],
    });

    return TestBed.inject(UserStateService);
  }

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('hydrates self-contained projects with embedded photos while keeping standalone model photos separate', () => {
    service = setupService({
      schemaVersion: 2,
      modelProgress: {
        'redemptor-dreadnought': ['step-1', 'step-2'],
      },
      projects: [
        {
          id: 'proj_1',
          name: 'Ultramarines Spearhead',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          models: [
            {
              id: 'pmod_1',
              recipeId: 'redemptor-dreadnought',
              quantity: 1,
              notes: '',
              completedStepIds: [],
              photos: [],
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-02T00:00:00Z',
            },
          ],
          colorIds: ['c1'],
          notes: [],
          coverPhotoId: 'ph_proj_1',
          photos: [
            {
              id: 'ph_proj_1',
              targetType: 'project',
              targetId: 'proj_1',
              kind: 'showcase',
              isPrivate: true,
              fileName: 'squad.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 12000,
              createdAt: '2026-01-02T00:00:00Z',
            },
          ],
        },
      ],
      uploadedPhotos: [
        {
          id: 'ph_model_1',
          targetType: 'model',
          targetId: 'redemptor-dreadnought',
          kind: 'showcase',
          isPrivate: true,
          fileName: 'standalone.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 9000,
          createdAt: '2026-01-02T00:00:00Z',
        },
      ],
    });

    expect(service.state().schemaVersion).toBe(2);
    expect(service.getCompletedStepIds('redemptor-dreadnought')).toEqual(['step-1', 'step-2']);
    expect(service.uploadedPhotos().map((p) => p.id)).toEqual(['ph_model_1']);

    const proj = service.getProjectById('proj_1');
    expect(proj).toBeDefined();
    expect(proj!.models.length).toBe(1);
    expect(proj!.photos.map((p) => p.id)).toEqual(['ph_proj_1']);
    expect(proj!.coverPhotoId).toBe('ph_proj_1');
    expect(service.allUploadedPhotos().length).toBe(2);
  });

  it('supports adding the same model twice with independent nickname, quantity, notes, progress, and featured image', () => {
    service = setupService();
    const proj = service.createProject('Ultramarines 2nd Company')!;

    const first = service.addModelToProject(proj.id, 'redemptor-dreadnought')!;
    const second = service.addModelToProject(proj.id, 'redemptor-dreadnought')!;

    expect(first.id).not.toBe(second.id);
    expect(service.getProjectById(proj.id)!.models.length).toBe(2);

    service.updateProjectModel(proj.id, first.id, {
      customName: 'Redemptor — Macro Plasma',
      quantity: 1,
      notes: 'Magnetized plasma arm + blue osl glow',
      featuredImage: {
        source: 'catalog_angle',
        imageIndex: 2,
        localImagePath: 'assets/images/models/redemptor_back.png',
      },
    });
    service.setProjectModelQuantity(proj.id, second.id, 25);
    service.updateProjectModel(proj.id, second.id, {
      customName: 'Redemptor — Gatling',
      notes: 'Heavy onslaught gatling cannon',
    });

    service.toggleProjectModelStepDone(proj.id, first.id, 'step-armor-base');
    service.toggleStepDone('redemptor-dreadnought', 'step-global-only');

    const updatedFirst = service.getProjectModelEntry(proj.id, first.id)!;
    const updatedSecond = service.getProjectModelEntry(proj.id, second.id)!;

    expect(updatedFirst.customName).toBe('Redemptor — Macro Plasma');
    expect(updatedFirst.quantity).toBe(1);
    expect(updatedFirst.notes).toBe('Magnetized plasma arm + blue osl glow');
    expect(updatedFirst.completedStepIds).toEqual(['step-armor-base']);
    expect(updatedFirst.featuredImage).toEqual({
      source: 'catalog_angle',
      imageIndex: 2,
      localImagePath: 'assets/images/models/redemptor_back.png',
      imageUrl: undefined,
    });

    expect(updatedSecond.customName).toBe('Redemptor — Gatling');
    expect(updatedSecond.quantity).toBe(25);
    expect(updatedSecond.notes).toBe('Heavy onslaught gatling cannon');
    expect(updatedSecond.completedStepIds).toEqual([]);
    expect(updatedSecond.featuredImage).toBeUndefined();

    // Total miniature count reflects summed quantities (1 + 25 = 26)
    expect(service.getProjectTotalMiniatures(service.getProjectById(proj.id)!)).toBe(26);
    // Standalone progress remains completely isolated
    expect(service.getCompletedStepIds('redemptor-dreadnought')).toEqual(['step-global-only']);
  });

  it('clamps quantity bounds, duplicates a model entry cleanly, and resets featured image', () => {
    service = setupService();
    const proj = service.createProject('Waaagh!')!;
    const ork = service.addModelToProject(proj.id, 'redemptor-dreadnought')!;

    service.setProjectModelQuantity(proj.id, ork.id, 0);
    expect(service.getProjectModelEntry(proj.id, ork.id)!.quantity).toBe(1);

    service.setProjectModelQuantity(proj.id, ork.id, 5000);
    expect(service.getProjectModelEntry(proj.id, ork.id)!.quantity).toBe(
      service.limits.MAX_MODEL_QUANTITY
    );

    service.updateProjectModel(proj.id, ork.id, {
      customName: 'Boss Mob',
      notes: 'Checkerboard shoulders',
      featuredImage: {
        source: 'catalog_model',
        modelId: 'alt-model',
        localImagePath: 'assets/images/models/alt.png',
      },
    });
    service.toggleProjectModelStepDone(proj.id, ork.id, 'step-1');

    const dup = service.duplicateProjectModel(proj.id, ork.id)!;
    expect(dup.id).not.toBe(ork.id);
    expect(dup.customName).toBe('Boss Mob (Copy)');
    expect(dup.quantity).toBe(1);
    expect(dup.notes).toBe('Checkerboard shoulders');
    expect(dup.completedStepIds).toEqual([]);
    expect(dup.featuredImage?.source).toBe('catalog_model');

    service.setProjectModelFeaturedImage(proj.id, dup.id, undefined);
    expect(service.getProjectModelEntry(proj.id, dup.id)!.featuredImage).toBeUndefined();
  });

  it('cleans up photo assets when removing a project model entry or deleting a project', async () => {
    service = setupService({
      schemaVersion: 2,
      projects: [
        {
          id: 'proj_photos',
          name: 'Photo Cleanup Test',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          colorIds: [],
          notes: [],
          photos: [
            {
              id: 'ph_proj_cover',
              targetType: 'project',
              targetId: 'proj_photos',
              kind: 'showcase',
              isPrivate: true,
              fileName: 'cover.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 5000,
              createdAt: '2026-01-01T00:00:00Z',
            },
          ],
          models: [
            {
              id: 'pmod_a',
              recipeId: 'redemptor-dreadnought',
              quantity: 1,
              notes: '',
              completedStepIds: [],
              featuredImage: { source: 'uploaded_photo', photoId: 'ph_entry_a' },
              photos: [
                {
                  id: 'ph_entry_a',
                  targetType: 'project_model',
                  targetId: 'pmod_a',
                  kind: 'showcase',
                  isPrivate: true,
                  fileName: 'dread.jpg',
                  mimeType: 'image/jpeg',
                  sizeBytes: 4000,
                  createdAt: '2026-01-01T00:00:00Z',
                },
              ],
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          ],
        },
      ],
    });

    // Deleting an entry's featured photo clears featuredImage back to undefined
    await service.deleteUserPhoto('ph_entry_a');
    expect(service.getProjectModelEntry('proj_photos', 'pmod_a')!.featuredImage).toBeUndefined();
    expect(service.getProjectModelEntry('proj_photos', 'pmod_a')!.photos.length).toBe(0);
    expect(deletePhotoAssetsSpy).toHaveBeenCalledTimes(1);

    // Deleting the project cleans up project-level photos too
    service.deleteProject('proj_photos');
    expect(service.getProjectById('proj_photos')).toBeUndefined();
    expect(deletePhotoAssetsSpy).toHaveBeenCalledTimes(2);
  });
});

describe('UserStateService — M1 Data Integrity, Photo Quota & Auth/Sync Hotfixes', () => {
  let service: UserStateService;
  let mediaMock: {
    resolvePhotoUrl: jasmine.Spy;
    deletePhotoAssets: jasmine.Spy;
    clearAllLocalMedia: jasmine.Spy;
    syncPendingBlobsToCloud: jasmine.Spy;
    validateImageFile: jasmine.Spy;
    storeLocalBlob: jasmine.Spy;
    uploadToCloudStorage: jasmine.Spy;
  };

  function setupService(initialStorage?: Record<string, unknown>): UserStateService {
    localStorage.removeItem(STORAGE_KEY);
    if (initialStorage) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(initialStorage));
    }

    mediaMock = {
      resolvePhotoUrl: jasmine.createSpy('resolvePhotoUrl').and.callFake((ph: { id: string }) => `blob:${ph.id}`),
      deletePhotoAssets: jasmine.createSpy('deletePhotoAssets').and.resolveTo(),
      clearAllLocalMedia: jasmine.createSpy('clearAllLocalMedia').and.resolveTo(),
      syncPendingBlobsToCloud: jasmine.createSpy('syncPendingBlobsToCloud').and.resolveTo(new Map()),
      validateImageFile: jasmine.createSpy('validateImageFile').and.resolveTo({
        blob: new Blob(['img'], { type: 'image/jpeg' }),
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        wasDownscaled: false,
      }),
      storeLocalBlob: jasmine.createSpy('storeLocalBlob').and.resolveTo('blob:stored'),
      uploadToCloudStorage: jasmine.createSpy('uploadToCloudStorage').and.resolveTo(undefined),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        UserStateService,
        {
          provide: UserMediaService,
          useValue: mediaMock,
        },
      ],
    });

    return TestBed.inject(UserStateService);
  }

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('merges customCompatibilityOverrides & preferences without clobbering preferences on partial import, preserves project createdAt, and aligns photo isPrivate', () => {
    service = setupService({
      schemaVersion: 2,
      preferences: {
        defaultRangeFilter: 'warhammer_pro',
        allowCompatibleSubstitutions: false,
        allowThirdPartySubstitutions: true,
        preferredThirdPartyBrands: ['Vallejo'],
      },
      customCompatibilityOverrides: {
        'paint-1': ['tp-1'],
      },
      projects: [
        {
          id: 'proj_keep_created',
          name: 'Original Name',
          createdAt: '2025-05-01T00:00:00Z',
          updatedAt: '2025-05-02T00:00:00Z',
          models: [],
          colorIds: [],
          notes: [],
          photos: [],
        },
      ],
    });

    // Partial import without preferences must preserve existing preferences
    service.importAccountPayload(
      {
        projects: [
          {
            id: 'proj_keep_created',
            name: 'Updated Name',
            createdAt: '2026-11-01T00:00:00Z',
            updatedAt: '2026-11-10T00:00:00Z',
            models: [],
            colorIds: [],
            notes: [],
            photos: [],
          },
        ],
        customCompatibilityOverrides: {
          'paint-1': ['tp-2'],
          'paint-2': ['tp-3'],
        },
        uploadedPhotos: [
          {
            id: 'ph_show',
            targetType: 'model',
            targetId: 'm1',
            kind: 'showcase',
            isPrivate: false,
            fileName: 'show.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            createdAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'ph_ref',
            targetType: 'model',
            targetId: 'm1',
            kind: 'reference',
            isPrivate: false,
            fileName: 'ref.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
      'merge',
      false
    );

    expect(service.preferences().defaultRangeFilter).toBe('warhammer_pro');
    expect(service.preferences().allowCompatibleSubstitutions).toBeFalse();
    expect(service.preferences().preferredThirdPartyBrands).toEqual(['Vallejo']);
    expect(service.customCompatibilityOverrides()).toEqual({
      'paint-1': ['tp-1', 'tp-2'],
      'paint-2': ['tp-3'],
    });
    const proj = service.getProjectById('proj_keep_created')!;
    expect(proj.name).toBe('Updated Name');
    expect(proj.createdAt).toBe('2025-05-01T00:00:00Z');
    expect(service.uploadedPhotos().find((p) => p.id === 'ph_show')?.isPrivate).toBeFalse();
    expect(service.uploadedPhotos().find((p) => p.id === 'ph_ref')?.isPrivate).toBeTrue();

    // Explicit preferences import merges cleanly
    service.importAccountPayload(
      {
        preferences: {
          defaultRangeFilter: 'warhammer_colour',
          allowThirdPartySubstitutions: false,
        },
      },
      'merge',
      false
    );
    expect(service.preferences().defaultRangeFilter).toBe('warhammer_colour');
    expect(service.preferences().allowThirdPartySubstitutions).toBeFalse();
    expect(service.preferences().allowCompatibleSubstitutions).toBeFalse();
  });

  it('does not mutate prev or write localStorage on commit() no-ops', () => {
    const filledProgress: Record<string, string[]> = {};
    for (let i = 0; i < USER_LIMITS.MAX_MODEL_PROGRESS_KEYS; i++) {
      filledProgress[`model_${i}`] = ['s1'];
    }
    service = setupService({
      schemaVersion: 2,
      updatedAt: '2026-01-01T00:00:00Z',
      inventoryPaintIds: ['p1'],
      wishlistPaintIds: ['p2'],
      modelProgress: filledProgress,
    });

    const prevStateRef = service.state();
    const prevUpdatedAt = prevStateRef.updatedAt;
    const setItemSpy = spyOn(localStorage, 'setItem').and.callThrough();

    service.setStepsDone('model_overflow', ['s1'], true);
    service.clearModelProgress('missing_model');
    service.addManyToWishlist(['p1', 'p2']);
    service.addManyToInventory(['p1']);

    expect(service.state()).toBe(prevStateRef);
    expect(prevStateRef.updatedAt).toBe(prevUpdatedAt);
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('performs atomic toggleStepDone and toggleProjectModelStepDone updates', () => {
    service = setupService();
    const proj = service.createProject('Atomic Test')!;
    const entry = service.addModelToProject(proj.id, 'model-1')!;

    service.toggleStepDone('model-1', 'step-a');
    service.toggleStepDone('model-1', 'step-a');
    expect(service.isStepDone('model-1', 'step-a')).toBeFalse();

    service.toggleProjectModelStepDone(proj.id, entry.id, 'step-b');
    expect(service.getProjectModelCompletedStepIds(proj.id, entry.id)).toEqual(['step-b']);
    service.toggleProjectModelStepDone(proj.id, entry.id, 'step-b');
    expect(service.getProjectModelCompletedStepIds(proj.id, entry.id)).toEqual([]);
  });

  it('sets isPrivate based on photo kind, preserves older photos on concurrent quota exhaustion, cleans up rejected blobs, and aborts on UID change', async () => {
    const existingShowcase = Array.from({ length: USER_LIMITS.MAX_MODEL_SHOWCASE_PHOTOS - 1 }, (_, i) => ({
      id: `ph_existing_${i}`,
      targetType: 'model' as const,
      targetId: 'm1',
      kind: 'showcase' as const,
      isPrivate: false,
      fileName: `old_${i}.jpg`,
      mimeType: 'image/jpeg' as const,
      sizeBytes: 100,
      createdAt: '2026-01-01T00:00:00Z',
    }));

    service = setupService({
      schemaVersion: 2,
      uploadedPhotos: existingShowcase,
    });

    // Simulate concurrent upload filling the final slot while uploadPhotos is awaiting validation
    let releaseValidation!: () => void;
    const gate = new Promise<void>((res) => {
      releaseValidation = res;
    });
    mediaMock.validateImageFile.and.callFake(async () => {
      await gate;
      return {
        blob: new Blob(['new'], { type: 'image/jpeg' }),
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        wasDownscaled: false,
      };
    });

    const file = new File(['abc'], 'new.jpg', { type: 'image/jpeg' });
    const uploadPromise = service.uploadPhotos({
      files: [file],
      targetType: 'model',
      targetId: 'm1',
      kind: 'showcase',
    });

    // While validation is pending, fill the last remaining showcase slot directly
    service.importAccountPayload(
      {
        uploadedPhotos: [
          {
            id: 'ph_concurrent_fill',
            targetType: 'model',
            targetId: 'm1',
            kind: 'showcase',
            isPrivate: false,
            fileName: 'concurrent.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            createdAt: '2026-01-02T00:00:00Z',
          },
        ],
      },
      'merge',
      false
    );

    releaseValidation();
    const res = await uploadPromise;

    expect(res.uploaded.length).toBe(0);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(mediaMock.deletePhotoAssets).toHaveBeenCalledTimes(1);
    // All existing photos + concurrent photo remain intact
    expect(service.getPhotosForTarget('model', 'm1', 'showcase').length).toBe(
      USER_LIMITS.MAX_MODEL_SHOWCASE_PHOTOS
    );

    // Normal showcase upload sets isPrivate: false; reference sets isPrivate: true
    mediaMock.validateImageFile.and.resolveTo({
      blob: new Blob(['ok'], { type: 'image/jpeg' }),
      mimeType: 'image/jpeg',
      width: 640,
      height: 480,
      wasDownscaled: false,
    });
    const showRes = await service.uploadPhotos({
      files: [file],
      targetType: 'model',
      targetId: 'm2',
      kind: 'showcase',
    });
    expect(showRes.uploaded[0].isPrivate).toBeFalse();

    const refRes = await service.uploadPhotos({
      files: [file],
      targetType: 'model',
      targetId: 'm2',
      kind: 'reference',
    });
    expect(refRes.uploaded[0].isPrivate).toBeTrue();

    // Mid-upload session change discards commit and cleans up blobs
    let releaseUidRace!: () => void;
    mediaMock.validateImageFile.and.callFake(
      () =>
        new Promise((res2) => {
          releaseUidRace = () =>
            res2({
              blob: new Blob(['race'], { type: 'image/jpeg' }),
              mimeType: 'image/jpeg',
              width: 500,
              height: 500,
              wasDownscaled: false,
            });
        })
    );
    mediaMock.deletePhotoAssets.calls.reset();
    const cloudSync = TestBed.inject(UserCloudSyncService);
    const racePromise = service.uploadPhotos({
      files: [file],
      targetType: 'model',
      targetId: 'm3',
      kind: 'showcase',
    });
    (
      cloudSync as unknown as { _currentUser: WritableSignal<User | null> }
    )._currentUser.set({ uid: 'user-switched' } as User);
    releaseUidRace();
    const raceResult = await racePromise;
    expect(raceResult.uploaded.length).toBe(0);
    expect(raceResult.errors.some((e) => /session changed/i.test(e))).toBeTrue();
    expect(mediaMock.deletePhotoAssets).toHaveBeenCalledTimes(1);
  });

  it('normalizes featuredImage in updateProjectModel and bounds addCustomPaint inputs', () => {
    service = setupService();
    const proj = service.createProject('Featured & Custom Paint')!;
    const entry = service.addModelToProject(proj.id, 'model-1')!;

    service.updateProjectModel(proj.id, entry.id, {
      featuredImage: { source: 'catalog_angle', imageIndex: 2.9 },
    });
    expect(service.getProjectModelEntry(proj.id, entry.id)?.featuredImage).toEqual({
      source: 'catalog_angle',
      imageIndex: 2,
      localImagePath: undefined,
      imageUrl: undefined,
    });

    service.updateProjectModel(proj.id, entry.id, {
      featuredImage: { source: 'catalog_angle', imageIndex: -1 },
    });
    expect(service.getProjectModelEntry(proj.id, entry.id)?.featuredImage).toBeUndefined();

    expect(
      service.addCustomPaint({
        name: '   ',
        brand: 'Brand',
        range: 'Range',
        category: 'Layer',
        hex: '#000000',
        citadelMatches: [],
      })
    ).toBeNull();

    const created = service.addCustomPaint({
      name: 'My Paint',
      brand: 'My Brand',
      range: 'My Range',
      code: 'X'.repeat(100),
      category: 'Cat'.repeat(30),
      hex: '#1234567890abcdef1234',
      citadelMatches: Array.from({ length: 25 }, (_, i) => ({
        citadelPaintId: `c_${i}`,
        citadelPaintName: `C ${i}`,
        citadelRange: 'warhammer_colour',
        citadelCategory: 'Base',
        citadelHex: '#fff',
        deltaE: 1,
        matchQuality: 'exact' as const,
      })),
    })!;

    expect(created).not.toBeNull();
    expect(created.code?.length).toBe(64);
    expect(created.category.length).toBe(64);
    expect(created.hex.length).toBe(16);
    expect(created.citadelMatches.length).toBe(USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT);
  });

  it('defers URL.revokeObjectURL in exportBackupJson and clears prior timeout in showToast', () => {
    service = setupService();
    jasmine.clock().install();
    try {
      const createSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:backup-1');
      const revokeSpy = spyOn(URL, 'revokeObjectURL');
      const clickSpy = spyOn(HTMLAnchorElement.prototype, 'click');

      service.exportBackupJson();
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeSpy).not.toHaveBeenCalled();

      jasmine.clock().tick(999);
      expect(revokeSpy).not.toHaveBeenCalled();
      jasmine.clock().tick(1);
      expect(revokeSpy).toHaveBeenCalledWith('blob:backup-1');

      service.showToast('First');
      jasmine.clock().tick(2000);
      service.showToast('First');
      jasmine.clock().tick(2000);
      expect(service.toastMessage()).toBe('First');
      jasmine.clock().tick(1500);
      expect(service.toastMessage()).toBeNull();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('handles initAuthListener unsubscribe, stale syncSignedInUser abort, onSnapshot errors/pending writes, and signOutCloud reset', async () => {
    service = setupService({
      schemaVersion: 2,
      inventoryPaintIds: ['owned-before-signout'],
    });
    const cloudSync = TestBed.inject(UserCloudSyncService);

    const syncPrivate = cloudSync as unknown as {
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
      createWriteBatch: (fs: unknown) => {
        set: () => void;
        delete: () => void;
        commit: () => Promise<void>;
      };
      writeDoc: (fs: unknown, ref: unknown, data: unknown, opts?: unknown) => Promise<void>;
      removeDoc: (fs: unknown, ref: unknown) => Promise<void>;
      sdkSignOut: (auth: unknown) => Promise<void>;
      pendingProjectWrites: Map<string, number>;
    };

    const unsubAuth1 = jasmine.createSpy('unsubAuth1');
    const unsubAuth2 = jasmine.createSpy('unsubAuth2');
    let authCb!: (user: User | null) => void;
    let authSubCount = 0;

    let docOnNext!: (snap: unknown) => void;
    let docOnError!: (err: Error) => void;
    let projOnNext!: (snap: unknown) => void;
    let projOnError!: (err: Error) => void;

    let resolveGetDoc!: (val: { exists: () => boolean; data: () => unknown }) => void;
    const fetchDocSpy = spyOn(syncPrivate, 'fetchDocSnap').and.callFake(
      () =>
        new Promise((res) => {
          resolveGetDoc = res;
        })
    );
    spyOn(syncPrivate, 'fetchQuerySnap').and.resolveTo({
      forEach: () => {},
    });
    spyOn(syncPrivate, 'isFirebaseConfigured').and.returnValue(true);
    spyOn(syncPrivate, 'getAuthHandle').and.resolveTo({ auth: {} });
    spyOn(syncPrivate, 'getFirestoreHandle').and.resolveTo({ db: {} });
    spyOn(syncPrivate, 'getUserDocRef').and.returnValue({ path: 'users/u' });
    spyOn(syncPrivate, 'getProjectsColRef').and.returnValue({ path: 'users/u/projects' });
    spyOn(syncPrivate, 'getProjectDocRef').and.returnValue({ path: 'users/u/projects/p' });
    spyOn(syncPrivate, 'subscribeAuthState').and.callFake((_auth, cb) => {
      authCb = cb;
      authSubCount++;
      return authSubCount === 1 ? unsubAuth1 : unsubAuth2;
    });
    spyOn(syncPrivate, 'subscribeDocSnapshot').and.callFake((_fs, _ref, onNext, onError) => {
      docOnNext = onNext;
      docOnError = onError;
      return () => {};
    });
    spyOn(syncPrivate, 'subscribeQuerySnapshot').and.callFake((_fs, _ref, onNext, onError) => {
      projOnNext = onNext;
      projOnError = onError;
      return () => {};
    });
    spyOn(syncPrivate, 'createWriteBatch').and.returnValue({
      set: () => {},
      delete: () => {},
      commit: () => Promise.resolve(),
    });
    spyOn(syncPrivate, 'writeDoc').and.resolveTo();
    spyOn(syncPrivate, 'removeDoc').and.resolveTo();
    const signOutSpy = spyOn(syncPrivate, 'sdkSignOut').and.resolveTo();

    // 1. Re-calling initAuthListener invokes previous unsubscribeAuth
    service.initAuthListener();
    await new Promise((r) => setTimeout(r, 0));
    service.initAuthListener();
    await new Promise((r) => setTimeout(r, 0));
    expect(unsubAuth1).toHaveBeenCalledTimes(1);

    // 2. Stale syncSignedInUser aborted when user signs out mid-fetch
    authCb({ uid: 'user-a' } as User);
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Syncing);
    await new Promise((r) => setTimeout(r, 0));
    const firstResolve = resolveGetDoc;
    authCb(null);
    firstResolve({
      exists: () => true,
      data: () => ({ inventoryPaintIds: ['stale-user-a-paint'] }),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(service.state().inventoryPaintIds).not.toContain('stale-user-a-paint');
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.LocalOnly);

    // 3. Complete sync for user-b and test projects onSnapshot pending write guard + error callbacks
    fetchDocSpy.and.resolveTo({
      exists: () => true,
      data: () => ({ inventoryPaintIds: ['user-b-paint'] }),
    });
    authCb({ uid: 'user-b' } as User);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Synced);
    expect(service.state().inventoryPaintIds).toContain('user-b-paint');

    const localProj = service.createProject('Local Pending Project')!;
    syncPrivate.pendingProjectWrites.set(localProj.id, 1);
    projOnNext({
      metadata: { hasPendingWrites: false },
      forEach: () => {},
    });
    expect(service.getProjectById(localProj.id)).toBeDefined();
    syncPrivate.pendingProjectWrites.delete(localProj.id);

    docOnError(new Error('listener failed'));
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Error);
    (
      cloudSync as unknown as { _cloudSyncStatus: WritableSignal<CloudSyncStatus> }
    )._cloudSyncStatus.set(CloudSyncStatus.Synced);
    projOnError(new Error('projects listener failed'));
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Error);
    // Avoid unused warning on docOnNext
    expect(typeof docOnNext).toBe('function');

    // 4. signOutCloud resets state(), localStorage, PKCE caches, and calls clearAllLocalMedia()
    sessionStorage.setItem(PKCE_TOKEN_CACHE_KEY, '{"code":"c","bearer":"tok"}');
    sessionStorage.setItem(PKCE_VERIFIER_KEY, 'v');
    sessionStorage.setItem(PKCE_STATE_KEY, 's');
    localStorage.setItem(PKCE_TOKEN_CACHE_KEY, '{"code":"c","bearer":"tok"}');

    await service.signOutCloud();
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(service.currentUser()).toBeNull();
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.LocalOnly);
    expect(service.state().inventoryPaintIds).toEqual([]);
    expect(service.state().projects).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).inventoryPaintIds).toEqual([]);
    expect(sessionStorage.getItem(PKCE_TOKEN_CACHE_KEY)).toBeNull();
    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
    expect(sessionStorage.getItem(PKCE_STATE_KEY)).toBeNull();
    expect(localStorage.getItem(PKCE_TOKEN_CACHE_KEY)).toBeNull();
    expect(mediaMock.clearAllLocalMedia).toHaveBeenCalled();
  });

  it('guards prototype-named keys in importAccountPayload, toggleStepDone, setStepsDone, and linkCustomEquivalent', () => {
    service = setupService();

    const parsedPayload = JSON.parse(
      '{"modelProgress":{"toString":["s_imp"],"constructor":["s_ctor"],"__proto__":["s_proto"]},"customCompatibilityOverrides":{"toString":["p_imp"],"constructor":["p_ctor"],"__proto__":["p_proto"]}}'
    ) as Record<string, unknown>;

    expect(() => service.importAccountPayload(parsedPayload, 'merge', false)).not.toThrow();
    expect(service.getCompletedStepIds('toString')).toEqual(['s_imp']);
    expect(service.getCompletedStepIds('constructor')).toEqual([]);
    expect(service.getCompletedStepIds('__proto__')).toEqual([]);
    expect(service.customCompatibilityOverrides()['toString']).toEqual(['p_imp']);
    expect(Object.hasOwn(service.customCompatibilityOverrides(), 'constructor')).toBeFalse();
    expect(Object.hasOwn(service.customCompatibilityOverrides(), '__proto__')).toBeFalse();

    expect(() => service.toggleStepDone('toString', 's_toggle')).not.toThrow();
    expect(service.isStepDone('toString', 's_toggle')).toBeTrue();
    expect(() => service.toggleStepDone('constructor', 's_x')).not.toThrow();
    expect(() => service.toggleStepDone('__proto__', 's_x')).not.toThrow();

    expect(() => service.setStepsDone('constructor', ['s_a'], true)).not.toThrow();
    expect(() => service.setStepsDone('prototype', ['s_a'], true)).not.toThrow();
    expect(() => service.setStepsDone('toString', ['s_set'], true)).not.toThrow();
    expect(service.isStepDone('toString', 's_set')).toBeTrue();

    expect(() => service.linkCustomEquivalent('toString', 'p_link')).not.toThrow();
    expect(service.customCompatibilityOverrides()['toString']).toEqual(['p_imp', 'p_link']);
    expect(() => service.linkCustomEquivalent('constructor', 'p_bad')).not.toThrow();
    expect(() => service.linkCustomEquivalent('__proto__', 'p_bad')).not.toThrow();
    expect(Object.hasOwn(service.customCompatibilityOverrides(), 'constructor')).toBeFalse();
    expect(Object.hasOwn(service.customCompatibilityOverrides(), '__proto__')).toBeFalse();
  });

  it('preserves state() reference and performs zero localStorage.setItem writes on no-op setProjectModelStepsDone and clearProjectModelProgress', () => {
    jasmine.clock().install();
    try {
      service = setupService();
      const proj = service.createProject('No-op Project')!;
      const entry = service.addModelToProject(proj.id, 'model-1')!;
      service.flushLocalPersistence();

      const baselineState = service.state();
      const setItemSpy = spyOn(localStorage, 'setItem').and.callThrough();
      const showToastSpy = spyOn(service, 'showToast').and.callThrough();

      // Entry currently has completedStepIds: []
      service.setProjectModelStepsDone(proj.id, entry.id, ['step-not-present'], false);
      service.clearProjectModelProgress(proj.id, entry.id);
      jasmine.clock().tick(LOCAL_PERSIST_DEBOUNCE_MS);

      expect(service.state()).toBe(baselineState);
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(showToastSpy).not.toHaveBeenCalled();

      // Mark a step done, then verify idempotent setProjectModelStepsDone(..., true) is also a no-op
      service.setProjectModelStepsDone(proj.id, entry.id, ['step-1'], true);
      service.flushLocalPersistence();
      const afterAddState = service.state();
      setItemSpy.calls.reset();

      service.setProjectModelStepsDone(proj.id, entry.id, ['step-1'], true);
      jasmine.clock().tick(LOCAL_PERSIST_DEBOUNCE_MS);
      expect(service.state()).toBe(afterAddState);
      expect(setItemSpy).not.toHaveBeenCalled();

      // Clearing non-empty progress updates state and triggers toast once, coalescing into 1 write
      service.clearProjectModelProgress(proj.id, entry.id);
      expect(service.state()).not.toBe(afterAddState);
      expect(service.getProjectModelCompletedStepIds(proj.id, entry.id)).toEqual([]);
      jasmine.clock().tick(LOCAL_PERSIST_DEBOUNCE_MS);
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(service.toastMessage()).toContain('Cleared painting progress');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('aborts stale signOutCloud post-await reset when concurrent onAuthStateChanged re-login occurs before sdkSignOut resolves', async () => {
    service = setupService();
    const cloudSync = TestBed.inject(UserCloudSyncService);

    const syncPrivate = cloudSync as unknown as {
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
      createWriteBatch: (fs: unknown) => {
        set: () => void;
        delete: () => void;
        commit: () => Promise<void>;
      };
      writeDoc: (fs: unknown, ref: unknown, data: unknown, opts?: unknown) => Promise<void>;
      removeDoc: (fs: unknown, ref: unknown) => Promise<void>;
      sdkSignOut: (auth: unknown) => Promise<void>;
    };

    let authCb!: (user: User | null) => void;
    let resolveSignOut!: () => void;

    spyOn(syncPrivate, 'isFirebaseConfigured').and.returnValue(true);
    spyOn(syncPrivate, 'getAuthHandle').and.resolveTo({ auth: {} });
    spyOn(syncPrivate, 'getFirestoreHandle').and.resolveTo({ db: {} });
    spyOn(syncPrivate, 'getUserDocRef').and.callFake((_fs, uid) => ({ path: `users/${uid}` }));
    spyOn(syncPrivate, 'getProjectsColRef').and.callFake((_fs, uid) => ({
      path: `users/${uid}/projects`,
    }));
    spyOn(syncPrivate, 'getProjectDocRef').and.returnValue({ path: 'users/u/projects/p' });
    spyOn(syncPrivate, 'subscribeAuthState').and.callFake((_auth, cb) => {
      authCb = cb;
      return () => {};
    });
    spyOn(syncPrivate, 'fetchDocSnap').and.callFake(async (_fs, ref) => {
      const path = (ref as { path: string }).path;
      if (path === 'users/uB') {
        return {
          exists: () => true,
          data: () => ({ inventoryPaintIds: ['paint-user-b'] }),
        };
      }
      return {
        exists: () => true,
        data: () => ({ inventoryPaintIds: ['paint-user-a'] }),
      };
    });
    spyOn(syncPrivate, 'fetchQuerySnap').and.resolveTo({ forEach: () => {} });
    spyOn(syncPrivate, 'subscribeDocSnapshot').and.returnValue(() => {});
    spyOn(syncPrivate, 'subscribeQuerySnapshot').and.returnValue(() => {});
    spyOn(syncPrivate, 'createWriteBatch').and.returnValue({
      set: () => {},
      delete: () => {},
      commit: () => Promise.resolve(),
    });
    spyOn(syncPrivate, 'sdkSignOut').and.callFake(
      () =>
        new Promise<void>((res) => {
          resolveSignOut = res;
        })
    );

    service.initAuthListener();
    await new Promise((r) => setTimeout(r, 0));
    authCb({ uid: 'uA' } as User);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.currentUser()?.uid).toBe('uA');
    expect(service.state().inventoryPaintIds).toEqual(['paint-user-a']);

    mediaMock.clearAllLocalMedia.calls.reset();
    const signOutPromise = service.signOutCloud();
    await new Promise((r) => setTimeout(r, 0));

    // Concurrent re-login as uB before sdkSignOut resolves
    authCb({ uid: 'uB' } as User);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.currentUser()?.uid).toBe('uB');
    expect(service.state().inventoryPaintIds).toEqual(['paint-user-b']);
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Synced);

    // Resolve stale sdkSignOut from uA signOutCloud()
    sessionStorage.setItem(PKCE_TOKEN_CACHE_KEY, '{"code":"cB","bearer":"tokB"}');
    mediaMock.clearAllLocalMedia.calls.reset();
    resolveSignOut();
    await signOutPromise;

    expect(service.currentUser()?.uid).toBe('uB');
    expect(service.state().inventoryPaintIds).toEqual(['paint-user-b']);
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Synced);
    expect(mediaMock.clearAllLocalMedia).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PKCE_TOKEN_CACHE_KEY)).toBe('{"code":"cB","bearer":"tokB"}');
    sessionStorage.removeItem(PKCE_TOKEN_CACHE_KEY);
  });

  it('clears PKCE token cache on resetLocalData()', () => {
    service = setupService();
    sessionStorage.setItem(PKCE_TOKEN_CACHE_KEY, '{"code":"c","bearer":"tok"}');
    sessionStorage.setItem(PKCE_VERIFIER_KEY, 'v');
    sessionStorage.setItem(PKCE_STATE_KEY, 's');
    localStorage.setItem(PKCE_TOKEN_CACHE_KEY, '{"code":"c","bearer":"tok"}');

    service.resetLocalData();

    expect(sessionStorage.getItem(PKCE_TOKEN_CACHE_KEY)).toBeNull();
    expect(sessionStorage.getItem(PKCE_VERIFIER_KEY)).toBeNull();
    expect(sessionStorage.getItem(PKCE_STATE_KEY)).toBeNull();
    expect(localStorage.getItem(PKCE_TOKEN_CACHE_KEY)).toBeNull();
  });

  it('strips unexpected properties in addCustomPaint() and updatePreferences()', () => {
    service = setupService();

    const created = service.addCustomPaint({
      brand: 'Vallejo',
      range: 'Model Color',
      name: 'Evil Sunz Alt',
      category: 'Layer',
      potStyle: 'dropper_bottle',
      hex: '#D42E24',
      citadelMatches: [
        {
          citadelPaintId: 'paint-red',
          citadelPaintName: 'Evil Sunz Scarlet',
          citadelRange: 'Citadel Base',
          citadelCategory: 'Layer',
          citadelHex: '#C0241A',
          deltaE: 2.4,
          matchQuality: 'close',
          extraMatchField: 'should-be-stripped',
        } as never,
      ],
      injectedKey: 'should-be-stripped',
    } as never);

    expect(created).not.toBeNull();
    expect(created!.potStyle).toBe('dropper_bottle');
    expect(Object.hasOwn(created as unknown as Record<string, unknown>, 'injectedKey')).toBeFalse();
    expect(
      Object.hasOwn(
        created!.citadelMatches[0] as unknown as Record<string, unknown>,
        'extraMatchField'
      )
    ).toBeFalse();

    service.updatePreferences({
      defaultRangeFilter: 'warhammer_pro',
      allowCompatibleSubstitutions: false,
      unknownPrefKey: 'evil',
    } as never);

    const prefs = service.preferences() as unknown as Record<string, unknown>;
    expect(prefs['defaultRangeFilter']).toBe('warhammer_pro');
    expect(prefs['allowCompatibleSubstitutions']).toBeFalse();
    expect(Object.hasOwn(prefs, 'unknownPrefKey')).toBeFalse();
  });

  it('rejects text/html SPA fallback and 404 in loadExtractedAccountSnapshot() while importing valid JSON', async () => {
    service = setupService();
    const fetchSpy = spyOn(window, 'fetch');

    fetchSpy.and.resolveTo(
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    await expectAsync(service.loadExtractedAccountSnapshot('merge')).toBeRejectedWithError(
      /not available in this environment/
    );

    fetchSpy.and.resolveTo(
      new Response('Not Found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain' },
      })
    );
    await expectAsync(service.loadExtractedAccountSnapshot('merge')).toBeRejectedWithError(
      /not available in this environment/
    );

    fetchSpy.and.resolveTo(
      new Response(JSON.stringify({ inventoryPaintIds: ['paint-gold'], projects: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await service.loadExtractedAccountSnapshot('merge');
    expect(service.state().inventoryPaintIds).toContain('paint-gold');
  });

  it('delegates showToast and toastMessage to ToastService', () => {
    service = setupService();
    const toastService = TestBed.inject(ToastService);
    const showSpy = spyOn(toastService, 'show').and.callThrough();

    service.showToast('Delegated');
    expect(showSpy).toHaveBeenCalledOnceWith('Delegated');
    expect(service.toastMessage()).toBe('Delegated');

    toastService.dismiss();
    expect(service.toastMessage()).toBeNull();
  });

  it('debounces rapid localStorage writes into one write and flushes on pagehide, visibilitychange, resetLocalData, and ngOnDestroy', () => {
    jasmine.clock().install();
    try {
      service = setupService();
      const setItemSpy = spyOn(localStorage, 'setItem').and.callThrough();

      // 5 rapid mutations coalesce into a single localStorage write
      service.toggleInventory('p1');
      service.toggleInventory('p2');
      service.toggleWishlist('p3');
      service.toggleModelInventory('m1');
      service.updatePreferences({ allowThirdPartySubstitutions: false });

      expect(service.inventoryPaintIds()).toEqual(['p1', 'p2']);
      expect(setItemSpy).not.toHaveBeenCalled();

      jasmine.clock().tick(LOCAL_PERSIST_DEBOUNCE_MS - 1);
      expect(setItemSpy).not.toHaveBeenCalled();

      jasmine.clock().tick(1);
      expect(setItemSpy).toHaveBeenCalledTimes(1);

      // pagehide flushes immediately
      setItemSpy.calls.reset();
      service.toggleInventory('p4');
      expect(setItemSpy).not.toHaveBeenCalled();
      window.dispatchEvent(new Event('pagehide'));
      expect(setItemSpy).toHaveBeenCalledTimes(1);

      // visibilitychange(hidden) flushes immediately
      setItemSpy.calls.reset();
      service.toggleInventory('p5');
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });

      // resetLocalData cancels pending timer and writes blank state immediately
      setItemSpy.calls.reset();
      service.toggleInventory('p6');
      service.resetLocalData();
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).inventoryPaintIds).toEqual([]);
      jasmine.clock().tick(LOCAL_PERSIST_DEBOUNCE_MS);
      expect(setItemSpy).toHaveBeenCalledTimes(1);

      // ngOnDestroy flushes pending writes and unregisters listeners
      setItemSpy.calls.reset();
      service.toggleInventory('p7');
      service.ngOnDestroy();
      expect(setItemSpy).toHaveBeenCalledTimes(1);
      setItemSpy.calls.reset();
      window.dispatchEvent(new Event('pagehide'));
      expect(setItemSpy).not.toHaveBeenCalled();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('preserves unrelated slice signal identities and keeps O(1) lookup maps synchronized', () => {
    service = setupService();
    const proj = service.createProject('Identity Test')!;
    const entry = service.addModelToProject(proj.id, 'model-1')!;

    const invIdsBefore = service.inventoryPaintIds();
    const invSetBefore = service.inventorySet();
    const wishSetBefore = service.wishlistSet();
    const prefsBefore = service.preferences();
    const customBefore = service.customPaints();
    const overridesBefore = service.customCompatibilityOverrides();
    const uploadedBefore = service.uploadedPhotos();

    // Mutating projects preserves all unrelated slice references
    service.renameProject(proj.id, 'Renamed Identity Test');
    expect(service.inventoryPaintIds()).toBe(invIdsBefore);
    expect(service.inventorySet()).toBe(invSetBefore);
    expect(service.wishlistSet()).toBe(wishSetBefore);
    expect(service.preferences()).toBe(prefsBefore);
    expect(service.customPaints()).toBe(customBefore);
    expect(service.customCompatibilityOverrides()).toBe(overridesBefore);
    expect(service.uploadedPhotos()).toBe(uploadedBefore);

    // Mutating inventory preserves projects and modelProgress references
    const projectsBefore = service.projects();
    const progressBefore = service.modelProgress();
    service.toggleInventory('paint-xyz');
    expect(service.projects()).toBe(projectsBefore);
    expect(service.modelProgress()).toBe(progressBefore);

    // O(1) lookup maps reflect updated project & entry
    expect(service.projectByIdMap().get(proj.id)?.name).toBe('Renamed Identity Test');
    expect(service.projectModelByIdMap().get(entry.id)?.entry.recipeId).toBe('model-1');
    service.removeModelFromProject(proj.id, entry.id);
    expect(service.projectModelByIdMap().has(entry.id)).toBeFalse();
  });

  it('recovers from malformed localStorage JSON, enforces MAX_PROJECTS (50) and quota caps, and updates project/note/photo metadata', async () => {
    // 1. Malformed JSON in localStorage falls back cleanly to default state
    TestBed.resetTestingModule();
    localStorage.setItem(STORAGE_KEY, '{corrupt-json');
    TestBed.configureTestingModule({
      providers: [
        UserStateService,
        {
          provide: UserMediaService,
          useValue: {
            resolvePhotoUrl: (ph: { id: string }) => `blob:${ph.id}`,
            deletePhotoAssets: jasmine.createSpy('deletePhotoAssets').and.resolveTo(),
            clearAllLocalMedia: jasmine.createSpy('clearAllLocalMedia').and.resolveTo(),
            syncPendingBlobsToCloud: jasmine.createSpy('syncPendingBlobsToCloud').and.resolveTo(new Map()),
          },
        },
      ],
    });
    service = TestBed.inject(UserStateService);
    expect(service.projects()).toEqual([]);
    expect(service.inventoryPaintIds()).toEqual([]);

    service = setupService();

    // 2. toggleInventory / toggleWishlist auto-removes from opposite list; addMany respects limits
    service.toggleWishlist('p1');
    expect(service.isWishlisted('p1')).toBeTrue();
    service.toggleInventory('p1');
    expect(service.isOwned('p1')).toBeTrue();
    expect(service.isWishlisted('p1')).toBeFalse();

    service.toggleModelWishlist('m1');
    expect(service.isModelWishlisted('m1')).toBeTrue();
    service.toggleModelInventory('m1');
    expect(service.isModelOwned('m1')).toBeTrue();
    expect(service.isModelWishlisted('m1')).toBeFalse();

    service.addManyToInventory(['p1', 'p2', 'p3']);
    service.addManyToWishlist(['p2', 'p4']);
    expect(service.isOwned('p2')).toBeTrue();
    expect(service.isWishlisted('p4')).toBeTrue();
    expect(service.isWishlisted('p2')).toBeFalse();

    // 3. MAX_PROJECTS (50) limit blocks 51st project creation
    for (let i = 0; i < USER_LIMITS.MAX_PROJECTS; i++) {
      expect(service.createProject(`Proj ${i}`)).not.toBeNull();
    }
    expect(service.createProject('Overflow Project')).toBeNull();
    expect(service.toastMessage()).toContain('Project limit reached (50 projects max)');

    // Delete all but one and verify renameProject, duplicateProject (strips photos & progress), colors, notes, and photo captions
    const firstProj = service.projects()[0];
    for (const p of service.projects().slice(1)) {
      service.deleteProject(p.id);
    }

    service.renameProject(firstProj.id, 'Renamed Army');
    expect(service.getProjectById(firstProj.id)?.name).toBe('Renamed Army');

    service.addColorToProject(firstProj.id, 'color-gold');
    expect(service.getProjectById(firstProj.id)?.colorIds).toEqual(['color-gold']);
    service.removeColorFromProject(firstProj.id, 'color-gold');
    expect(service.getProjectById(firstProj.id)?.colorIds).toEqual([]);

    service.saveProjectNote(firstProj.id, null, 'Recipe Note', [
      { id: 'blk_1', type: 'checkbox', value: 'Prime black', checked: false },
    ]);
    const note = service.getProjectById(firstProj.id)?.notes[0];
    expect(note).toBeDefined();
    service.toggleNoteCheckbox(firstProj.id, note!.id, 0);
    expect(service.getProjectById(firstProj.id)?.notes[0].components[0].checked).toBeTrue();
    service.deleteProjectNote(firstProj.id, note!.id);
    expect(service.getProjectById(firstProj.id)?.notes).toEqual([]);

    const entry = service.addModelToProject(firstProj.id, 'model-x')!;
    service.toggleProjectModelStepDone(firstProj.id, entry.id, 'step-1');
    const up = await service.uploadPhotos({
      files: [new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' })],
      targetType: 'project',
      targetId: firstProj.id,
      kind: 'showcase',
    });
    expect(up.uploaded.length).toBe(1);
    const photoId = up.uploaded[0].id;
    service.updatePhotoCaption(photoId, 'Completed squad');
    expect(service.getProjectById(firstProj.id)?.photos[0].caption).toBe('Completed squad');
    service.setProjectCoverPhoto(firstProj.id, photoId);
    expect(service.getProjectById(firstProj.id)?.coverPhotoId).toBe(photoId);
    service.setProjectThumbnail(firstProj.id, 'assets/images/models/dante.jpg');
    expect(service.getProjectById(firstProj.id)?.localThumbnailPath).toBe(
      'assets/images/models/dante.jpg'
    );

    const dup = service.duplicateProject(firstProj.id)!;
    expect(dup.name).toBe('Renamed Army (Copy)');
    expect(dup.photos).toEqual([]);
    expect(dup.coverPhotoId).toBeUndefined();
    expect(dup.models[0].photos).toEqual([]);

    // 4. getPhotoQuotaLimit across all 6 combinations
    expect(service.getPhotoQuotaLimit('model', 'showcase')).toBe(
      USER_LIMITS.MAX_MODEL_SHOWCASE_PHOTOS
    );
    expect(service.getPhotoQuotaLimit('model', 'reference')).toBe(
      USER_LIMITS.MAX_MODEL_REFERENCE_PHOTOS
    );
    expect(service.getPhotoQuotaLimit('project', 'showcase')).toBe(
      USER_LIMITS.MAX_PROJECT_SHOWCASE_PHOTOS
    );
    expect(service.getPhotoQuotaLimit('project', 'reference')).toBe(
      USER_LIMITS.MAX_PROJECT_REFERENCE_PHOTOS
    );
    expect(service.getPhotoQuotaLimit('project_model', 'showcase')).toBe(
      USER_LIMITS.MAX_PROJECT_MODEL_SHOWCASE_PHOTOS
    );
    expect(service.getPhotoQuotaLimit('project_model', 'reference')).toBe(
      USER_LIMITS.MAX_PROJECT_MODEL_REFERENCE_PHOTOS
    );

    // 5. uploadPhotos error on missing project
    const missingProjRes = await service.uploadPhotos({
      files: [new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })],
      targetType: 'project',
      targetId: 'does_not_exist',
      kind: 'showcase',
    });
    expect(missingProjRes.uploaded).toEqual([]);
    expect(missingProjRes.errors.some((e) => /deleted/i.test(e))).toBeTrue();

    // 6. signInWithGoogle / signInWithEmail delegate to UserCloudSyncService
    const cloudSync = TestBed.inject(UserCloudSyncService);
    const gSpy = spyOn(cloudSync, 'signInWithGoogle').and.resolveTo();
    const eSpy = spyOn(cloudSync, 'signInWithEmail').and.resolveTo();
    await service.signInWithGoogle();
    await service.signInWithEmail('u@example.com', 'pw123', false);
    expect(gSpy).toHaveBeenCalledTimes(1);
    expect(eSpy).toHaveBeenCalledWith('u@example.com', 'pw123', false);
  });
});
