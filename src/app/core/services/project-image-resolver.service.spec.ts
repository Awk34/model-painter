import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelRecipe, ModelSummary, ProjectModelEntry, UserProject } from '../models/catalog.models';
import { CatalogService } from './catalog.service';
import { ImageService } from './image.service';
import { ProjectImageResolverService } from './project-image-resolver.service';
import { UserMediaService } from './user-media.service';

describe('ProjectImageResolverService', () => {
  let resolver: ProjectImageResolverService;
  const modelMap = signal(new Map<string, ModelSummary>());

  beforeEach(() => {
    modelMap.set(
      new Map<string, ModelSummary>([
        [
          'redemptor-dreadnought',
          {
            id: 'redemptor-dreadnought',
            name: 'Redemptor Dreadnought',
            range: 'warhammer_colour',
            primaryImage: 'https://example.com/redemptor.png',
            localPrimaryImage: 'assets/images/models/redemptor.png',
            gameIds: [],
            gameNames: [],
            factionIds: [],
            factionNames: [],
            colorIds: [],
            requiredPaintIds: [],
          },
        ],
        [
          'alt-model',
          {
            id: 'alt-model',
            name: 'Alt Model',
            range: 'warhammer_colour',
            primaryImage: 'https://example.com/alt.png',
            localPrimaryImage: 'assets/images/models/alt.png',
            gameIds: [],
            gameNames: [],
            factionIds: [],
            factionNames: [],
            colorIds: [],
            requiredPaintIds: [],
          },
        ],
      ])
    );

    TestBed.configureTestingModule({
      providers: [
        ProjectImageResolverService,
        {
          provide: CatalogService,
          useValue: { modelById: modelMap },
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
          },
        },
      ],
    });
    resolver = TestBed.inject(ProjectImageResolverService);
  });

  function makeEntry(overrides: Partial<ProjectModelEntry> = {}): ProjectModelEntry {
    return {
      id: 'pmod_1',
      recipeId: 'redemptor-dreadnought',
      quantity: 1,
      notes: '',
      completedStepIds: [],
      photos: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  it('resolves uploaded_photo, catalog_angle, catalog_model, recipe, summary, and fallback URLs', () => {
    const uploadedEntry = makeEntry({
      featuredImage: { source: 'uploaded_photo', photoId: 'ph_1' },
      photos: [
        {
          id: 'ph_1',
          targetType: 'project_model',
          targetId: 'pmod_1',
          kind: 'showcase',
          isPrivate: false,
          fileName: 'a.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    });
    expect(resolver.resolveProjectModelImageUrl(uploadedEntry)).toBe('blob:ph_1');

    const angleEntry = makeEntry({
      featuredImage: {
        source: 'catalog_angle',
        imageIndex: 1,
        localImagePath: 'assets/images/models/redemptor_back.png',
      },
    });
    const recipe: Pick<ModelRecipe, 'localImagePaths' | 'images'> = {
      localImagePaths: ['assets/r0.png', 'assets/r1.png'],
      images: ['https://r0', 'https://r1'],
    };
    expect(resolver.resolveProjectModelImageUrl(angleEntry, null, recipe)).toBe('assets/r1.png');
    expect(resolver.resolveProjectModelImageUrl(angleEntry)).toBe(
      'assets/images/models/redemptor_back.png'
    );

    const altModelEntry = makeEntry({
      featuredImage: { source: 'catalog_model', modelId: 'alt-model' },
    });
    expect(resolver.resolveProjectModelImageUrl(altModelEntry)).toBe(
      'assets/images/models/alt.png'
    );

    expect(resolver.resolveProjectModelImageUrl(makeEntry())).toBe(
      'assets/images/models/redemptor.png'
    );
    expect(
      resolver.resolveProjectModelImageUrl(makeEntry({ recipeId: 'unknown-id' }))
    ).toBe('/icons/ic_models.svg');
  });

  it('resolves project cover URLs by priority: coverPhotoId showcase -> first showcase -> thumbnail -> first model -> default icon', () => {
    const makeProject = (overrides: Partial<UserProject> = {}): UserProject => ({
      id: 'proj_1',
      name: 'Test',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      models: [],
      colorIds: [],
      notes: [],
      photos: [],
      ...overrides,
    });

    expect(
      resolver.resolveProjectCoverUrl(
        makeProject({
          coverPhotoId: 'ph_2',
          photos: [
            {
              id: 'ph_1',
              targetType: 'project',
              targetId: 'proj_1',
              kind: 'showcase',
              isPrivate: false,
              fileName: '1.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 10,
              createdAt: '2026-01-01T00:00:00Z',
            },
            {
              id: 'ph_2',
              targetType: 'project',
              targetId: 'proj_1',
              kind: 'showcase',
              isPrivate: false,
              fileName: '2.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 10,
              createdAt: '2026-01-01T00:00:00Z',
            },
          ],
        })
      )
    ).toBe('blob:ph_2');

    expect(
      resolver.resolveProjectCoverUrl(
        makeProject({ localThumbnailPath: 'assets/images/thumb.png' })
      )
    ).toBe('assets/images/thumb.png');

    expect(
      resolver.resolveProjectCoverUrl(makeProject({ models: [makeEntry()] }))
    ).toBe('assets/images/models/redemptor.png');

    expect(resolver.resolveProjectCoverUrl(makeProject())).toBe('/icons/ic_project.svg');
  });
});
