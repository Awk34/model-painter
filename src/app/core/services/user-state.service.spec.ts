import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { User } from 'firebase/auth';
import { USER_LIMITS } from '../config/user-limits.config';
import { CloudSyncStatus, ModelSummary } from '../models/catalog.models';
import { CatalogService } from './catalog.service';
import { ImageService } from './image.service';
import { UserMediaService } from './user-media.service';
import { UserStateService } from './user-state.service';

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

    const modelSummary: ModelSummary = {
      id: 'redemptor-dreadnought',
      name: 'Redemptor Dreadnought',
      range: 'warhammer_colour',
      primaryImage: 'https://example.com/redemptor.png',
      localPrimaryImage: 'assets/images/models/redemptor.png',
      gameIds: ['w40k'],
      gameNames: ['Warhammer 40,000'],
      factionIds: ['sm'],
      factionNames: ['Space Marines'],
      colorIds: [],
      requiredPaintIds: [],
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        UserStateService,
        {
          provide: CatalogService,
          useValue: {
            modelById: signal(new Map([[modelSummary.id, modelSummary]])),
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) =>
              local || remote || '/icons/ic_models.svg',
          },
        },
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
    expect(service.resolveProjectModelImageUrl(updatedFirst)).toBe(
      'assets/images/models/redemptor_back.png'
    );

    expect(updatedSecond.customName).toBe('Redemptor — Gatling');
    expect(updatedSecond.quantity).toBe(25);
    expect(updatedSecond.notes).toBe('Heavy onslaught gatling cannon');
    expect(updatedSecond.completedStepIds).toEqual([]);
    expect(service.resolveProjectModelImageUrl(updatedSecond)).toBe(
      'assets/images/models/redemptor.png'
    );

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
          provide: CatalogService,
          useValue: { modelById: signal(new Map()) },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) =>
              local || remote || '/icons/ic_models.svg',
          },
        },
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
    const racePromise = service.uploadPhotos({
      files: [file],
      targetType: 'model',
      targetId: 'm3',
      kind: 'showcase',
    });
    service.currentUser.set({ uid: 'user-switched' } as User);
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

    const svcPrivate = service as unknown as {
      getFbHandles: () => unknown;
      getUserDocRef: (db: unknown, uid: string) => unknown;
      getProjectsColRef: (db: unknown, uid: string) => unknown;
      getProjectDocRef: (db: unknown, uid: string, pid: string) => unknown;
      subscribeAuthState: (auth: unknown, cb: (u: User | null) => void) => () => void;
      fetchDocSnap: (ref: unknown) => Promise<{ exists: () => boolean; data: () => unknown }>;
      fetchQuerySnap: (ref: unknown) => Promise<{ forEach: (cb: (d: unknown) => void) => void }>;
      subscribeDocSnapshot: (
        ref: unknown,
        onNext: (snap: unknown) => void,
        onError: (err: Error) => void
      ) => () => void;
      subscribeQuerySnapshot: (
        ref: unknown,
        onNext: (snap: unknown) => void,
        onError: (err: Error) => void
      ) => () => void;
      createWriteBatch: (db: unknown) => {
        set: () => void;
        delete: () => void;
        commit: () => Promise<void>;
      };
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
    const fetchDocSpy = spyOn(svcPrivate, 'fetchDocSnap').and.callFake(
      () =>
        new Promise((res) => {
          resolveGetDoc = res;
        })
    );
    spyOn(svcPrivate, 'fetchQuerySnap').and.resolveTo({
      forEach: () => {},
    });
    spyOn(svcPrivate, 'getFbHandles').and.returnValue({
      auth: {},
      db: {},
      storage: {},
    });
    spyOn(svcPrivate, 'getUserDocRef').and.returnValue({ path: 'users/u' });
    spyOn(svcPrivate, 'getProjectsColRef').and.returnValue({ path: 'users/u/projects' });
    spyOn(svcPrivate, 'getProjectDocRef').and.returnValue({ path: 'users/u/projects/p' });
    spyOn(svcPrivate, 'subscribeAuthState').and.callFake((_auth, cb) => {
      authCb = cb;
      authSubCount++;
      return authSubCount === 1 ? unsubAuth1 : unsubAuth2;
    });
    spyOn(svcPrivate, 'subscribeDocSnapshot').and.callFake((_ref, onNext, onError) => {
      docOnNext = onNext;
      docOnError = onError;
      return () => {};
    });
    spyOn(svcPrivate, 'subscribeQuerySnapshot').and.callFake((_ref, onNext, onError) => {
      projOnNext = onNext;
      projOnError = onError;
      return () => {};
    });
    spyOn(svcPrivate, 'createWriteBatch').and.returnValue({
      set: () => {},
      delete: () => {},
      commit: () => Promise.resolve(),
    });
    const signOutSpy = spyOn(svcPrivate, 'sdkSignOut').and.resolveTo();

    // 1. Re-calling initAuthListener invokes previous unsubscribeAuth
    service.initAuthListener();
    service.initAuthListener();
    expect(unsubAuth1).toHaveBeenCalledTimes(1);

    // 2. Stale syncSignedInUser aborted when user signs out mid-fetch
    authCb({ uid: 'user-a' } as User);
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Syncing);
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
    svcPrivate.pendingProjectWrites.set(localProj.id, 1);
    projOnNext({
      metadata: { hasPendingWrites: false },
      forEach: () => {},
    });
    expect(service.getProjectById(localProj.id)).toBeDefined();
    svcPrivate.pendingProjectWrites.delete(localProj.id);

    docOnError(new Error('listener failed'));
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Error);
    service.cloudSyncStatus.set(CloudSyncStatus.Synced);
    projOnError(new Error('projects listener failed'));
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Error);
    // Avoid unused warning on docOnNext
    expect(typeof docOnNext).toBe('function');

    // 4. signOutCloud resets state(), localStorage, and calls clearAllLocalMedia()
    await service.signOutCloud();
    expect(signOutSpy).toHaveBeenCalledTimes(1);
    expect(service.currentUser()).toBeNull();
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.LocalOnly);
    expect(service.state().inventoryPaintIds).toEqual([]);
    expect(service.state().projects).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).inventoryPaintIds).toEqual([]);
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
    service = setupService();
    const proj = service.createProject('No-op Project')!;
    const entry = service.addModelToProject(proj.id, 'model-1')!;

    const baselineState = service.state();
    const setItemSpy = spyOn(localStorage, 'setItem').and.callThrough();
    const showToastSpy = spyOn(service, 'showToast').and.callThrough();

    // Entry currently has completedStepIds: []
    service.setProjectModelStepsDone(proj.id, entry.id, ['step-not-present'], false);
    service.clearProjectModelProgress(proj.id, entry.id);

    expect(service.state()).toBe(baselineState);
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(showToastSpy).not.toHaveBeenCalled();

    // Mark a step done, then verify idempotent setProjectModelStepsDone(..., true) is also a no-op
    service.setProjectModelStepsDone(proj.id, entry.id, ['step-1'], true);
    const afterAddState = service.state();
    setItemSpy.calls.reset();

    service.setProjectModelStepsDone(proj.id, entry.id, ['step-1'], true);
    expect(service.state()).toBe(afterAddState);
    expect(setItemSpy).not.toHaveBeenCalled();

    // Clearing non-empty progress updates state and triggers toast once
    service.clearProjectModelProgress(proj.id, entry.id);
    expect(service.state()).not.toBe(afterAddState);
    expect(service.getProjectModelCompletedStepIds(proj.id, entry.id)).toEqual([]);
    expect(setItemSpy).toHaveBeenCalledTimes(1);
    expect(service.toastMessage()).toContain('Cleared painting progress');
  });

  it('aborts stale signOutCloud post-await reset when concurrent onAuthStateChanged re-login occurs before sdkSignOut resolves', async () => {
    service = setupService();

    const svcPrivate = service as unknown as {
      getFbHandles: () => unknown;
      getUserDocRef: (db: unknown, uid: string) => unknown;
      getProjectsColRef: (db: unknown, uid: string) => unknown;
      getProjectDocRef: (db: unknown, uid: string, pid: string) => unknown;
      subscribeAuthState: (auth: unknown, cb: (u: User | null) => void) => () => void;
      fetchDocSnap: (ref: unknown) => Promise<{ exists: () => boolean; data: () => unknown }>;
      fetchQuerySnap: (ref: unknown) => Promise<{ forEach: (cb: (d: unknown) => void) => void }>;
      subscribeDocSnapshot: (
        ref: unknown,
        onNext: (snap: unknown) => void,
        onError: (err: Error) => void
      ) => () => void;
      subscribeQuerySnapshot: (
        ref: unknown,
        onNext: (snap: unknown) => void,
        onError: (err: Error) => void
      ) => () => void;
      createWriteBatch: (db: unknown) => {
        set: () => void;
        delete: () => void;
        commit: () => Promise<void>;
      };
      sdkSignOut: (auth: unknown) => Promise<void>;
    };

    let authCb!: (user: User | null) => void;
    let resolveSignOut!: () => void;

    spyOn(svcPrivate, 'getFbHandles').and.returnValue({ auth: {}, db: {}, storage: {} });
    spyOn(svcPrivate, 'getUserDocRef').and.callFake((_db, uid) => ({ path: `users/${uid}` }));
    spyOn(svcPrivate, 'getProjectsColRef').and.callFake((_db, uid) => ({
      path: `users/${uid}/projects`,
    }));
    spyOn(svcPrivate, 'getProjectDocRef').and.returnValue({ path: 'users/u/projects/p' });
    spyOn(svcPrivate, 'subscribeAuthState').and.callFake((_auth, cb) => {
      authCb = cb;
      return () => {};
    });
    spyOn(svcPrivate, 'fetchDocSnap').and.callFake(async (ref) => {
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
    spyOn(svcPrivate, 'fetchQuerySnap').and.resolveTo({ forEach: () => {} });
    spyOn(svcPrivate, 'subscribeDocSnapshot').and.returnValue(() => {});
    spyOn(svcPrivate, 'subscribeQuerySnapshot').and.returnValue(() => {});
    spyOn(svcPrivate, 'createWriteBatch').and.returnValue({
      set: () => {},
      delete: () => {},
      commit: () => Promise.resolve(),
    });
    spyOn(svcPrivate, 'sdkSignOut').and.callFake(
      () =>
        new Promise<void>((res) => {
          resolveSignOut = res;
        })
    );

    service.initAuthListener();
    authCb({ uid: 'uA' } as User);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.currentUser()?.uid).toBe('uA');
    expect(service.state().inventoryPaintIds).toEqual(['paint-user-a']);

    mediaMock.clearAllLocalMedia.calls.reset();
    const signOutPromise = service.signOutCloud();

    // Concurrent re-login as uB before sdkSignOut resolves
    authCb({ uid: 'uB' } as User);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.currentUser()?.uid).toBe('uB');
    expect(service.state().inventoryPaintIds).toEqual(['paint-user-b']);
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Synced);

    // Resolve stale sdkSignOut from uA signOutCloud()
    mediaMock.clearAllLocalMedia.calls.reset();
    resolveSignOut();
    await signOutPromise;

    expect(service.currentUser()?.uid).toBe('uB');
    expect(service.state().inventoryPaintIds).toEqual(['paint-user-b']);
    expect(service.cloudSyncStatus()).toBe(CloudSyncStatus.Synced);
    expect(mediaMock.clearAllLocalMedia).not.toHaveBeenCalled();
  });
});
