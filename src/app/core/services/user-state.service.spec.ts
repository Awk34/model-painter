import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelSummary } from '../models/catalog.models';
import { CatalogService } from './catalog.service';
import { ImageService } from './image.service';
import { UserMediaService } from './user-media.service';
import { UserStateService } from './user-state.service';

const STORAGE_KEY = 'whc_user_state_v1';

describe('UserStateService — Project Model Entries & Migration', () => {
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

  it('migrates legacy recipeIds to ProjectModelEntry[] starting at 0% progress and embeds legacy project photos', () => {
    service = setupService({
      schemaVersion: 1,
      modelProgress: {
        'redemptor-dreadnought': ['step-1', 'step-2'],
      },
      projects: [
        {
          id: 'proj_legacy',
          name: 'Legacy Marines',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          recipeIds: ['redemptor-dreadnought'],
          colorIds: ['c1'],
          notes: [],
          coverPhotoId: 'ph_proj_1',
        },
      ],
      uploadedPhotos: [
        {
          id: 'ph_proj_1',
          targetType: 'project',
          targetId: 'proj_legacy',
          kind: 'showcase',
          isPrivate: true,
          fileName: 'squad.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 12000,
          createdAt: '2026-01-02T00:00:00Z',
        },
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
    // Standalone global modelProgress & standalone model photos are preserved
    expect(service.getCompletedStepIds('redemptor-dreadnought')).toEqual(['step-1', 'step-2']);
    expect(service.uploadedPhotos().map((p) => p.id)).toEqual(['ph_model_1']);

    const proj = service.getProjectById('proj_legacy');
    expect(proj).toBeDefined();
    expect(proj!.models.length).toBe(1);
    expect(proj!.models[0].recipeId).toBe('redemptor-dreadnought');
    expect(proj!.models[0].quantity).toBe(1);
    expect(proj!.models[0].notes).toBe('');
    // Migrated entries start at 0% progress
    expect(proj!.models[0].completedStepIds).toEqual([]);
    // Legacy project photo moved into project.photos and coverPhotoId preserved
    expect(proj!.photos.map((p) => p.id)).toEqual(['ph_proj_1']);
    expect(proj!.coverPhotoId).toBe('ph_proj_1');
    // allUploadedPhotos aggregates standalone + embedded project photos
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
