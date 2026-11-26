import { USER_LIMITS } from '../config/user-limits.config';
import {
  CURRENT_SCHEMA_VERSION,
  normalizeAccountState,
  normalizeConfigurations,
  normalizeFeaturedImage,
  normalizeIncomingProject,
  normalizePreferences,
} from './user-state-normalizer.util';

describe('user-state-normalizer.util', () => {
  it('reassigns duplicate ProjectModelEntry IDs before binding photo targetId and clears mismatched featuredImage', () => {
    const proj = normalizeIncomingProject({
      id: 'proj_1',
      name: 'Test Project',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      models: [
        {
          id: 'pmod_dup',
          recipeId: 'model-a',
          photos: [
            {
              id: 'ph_first',
              targetType: 'project_model',
              targetId: 'pmod_dup',
              kind: 'showcase',
              fileName: 'a.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 1234,
            },
          ],
        },
        {
          id: 'pmod_dup',
          recipeId: 'model-b',
          featuredImage: { source: 'uploaded_photo', photoId: 'ph_missing' },
          photos: [
            {
              id: 'ph_second',
              targetType: 'project_model',
              targetId: 'pmod_dup',
              kind: 'reference',
              fileName: 'b.jpg',
              mimeType: 'image/png',
              sizeBytes: 2345,
            },
          ],
        },
      ],
    });

    expect(proj.models.length).toBe(2);
    const [first, second] = proj.models;
    expect(first.id).toBe('pmod_dup');
    expect(second.id).not.toBe('pmod_dup');
    expect(first.photos[0].targetId).toBe(first.id);
    expect(second.photos[0].targetId).toBe(second.id);
    expect(second.featuredImage).toBeUndefined();
  });

  it('guards empty and whitespace strings, bounds lengths/dimensions, and preserves note component IDs', () => {
    const longProjId = 'p'.repeat(120);
    const proj = normalizeIncomingProject({
      id: '   ',
      name: '   ',
      createdAt: '',
      updatedAt: '   ',
      models: [
        {
          id: '   ',
          recipeId: 'recipe-1',
          createdAt: '',
          updatedAt: '   ',
          configurations: [
            null,
            { id: '   ', slot: 'Weapon', option: 'Plasma', optionId: '  ', notes: '' },
          ],
          photos: [
            {
              id: '   ',
              targetType: 'project_model',
              targetId: 'x',
              fileName: 'empty-id.jpg',
            },
            {
              id: 'ph_valid',
              targetType: 'project_model',
              targetId: 'wrong-target',
              kind: 'showcase',
              fileName: '   ',
              width: 40000,
              height: 1200,
              createdAt: '   ',
              storagePath: '   ',
            },
          ],
        },
      ],
      notes: [
        'not-an-object',
        {
          id: '   ',
          title: '',
          createdAt: '',
          updatedAt: '  ',
          components: [
            null,
            { id: '  blk_1  ', type: 'checkbox', value: 'Prime', checked: true },
            { id: '   ', type: 'text', value: 'Basecoat' },
          ],
        },
      ],
    });

    expect(proj.id.startsWith('proj_')).toBeTrue();
    expect(proj.name).toBe('Imported Project');
    expect(proj.createdAt.trim().length).toBeGreaterThan(0);
    expect(proj.updatedAt.trim().length).toBeGreaterThan(0);

    const entry = proj.models[0];
    expect(entry.id.startsWith('pmod_')).toBeTrue();
    expect(entry.id.length).toBeLessThanOrEqual(120);
    expect(entry.createdAt.trim().length).toBeGreaterThan(0);
    expect(entry.configurations?.[0].id).toBe('cfg_1');
    expect(entry.configurations?.[0].optionId).toBeUndefined();
    expect(entry.configurations?.[0].notes).toBeUndefined();

    expect(entry.photos.length).toBe(1);
    expect(entry.photos[0].id).toBe('ph_valid');
    expect(entry.photos[0].fileName).toBe('photo.jpg');
    expect(entry.photos[0].width).toBeUndefined();
    expect(entry.photos[0].height).toBe(1200);
    expect(entry.photos[0].storagePath).toBeUndefined();

    expect(proj.notes.length).toBe(1);
    const note = proj.notes[0];
    expect(note.id.startsWith('note_')).toBeTrue();
    expect(note.id.length).toBeLessThanOrEqual(120);
    expect(note.title).toBe('Project Note');
    expect(note.createdAt.length).toBeLessThanOrEqual(64);
    expect(note.updatedAt.length).toBeLessThanOrEqual(64);
    expect(note.components.length).toBe(2);
    expect(note.components[0].id).toBe('blk_1');
    expect(note.components[1].id).toBeUndefined();

    const nearMaxProj = normalizeIncomingProject({
      id: longProjId,
      name: 'Long ID',
      models: [{ recipeId: 'r1' }],
    });
    expect(nearMaxProj.models[0].id.endsWith('_0')).toBeTrue();
    expect(nearMaxProj.models[0].id.length).toBeLessThanOrEqual(120);
  });

  it('validates and bounds customPaints, customCompatibilityOverrides, preferences, and updatedAt', () => {
    const oversizedOverrides: Record<string, unknown> = {};
    for (let i = 0; i < USER_LIMITS.MAX_COMPATIBILITY_OVERRIDE_KEYS + 20; i++) {
      oversizedOverrides[`paint_${i}`] = Array.from(
        { length: USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT + 5 },
        (_, j) => `eq_${j}`
      );
    }
    oversizedOverrides['   '] = ['should_skip'];
    oversizedOverrides['empty_vals'] = ['', '   ', null];

    const state = normalizeAccountState({
      updatedAt: '   ',
      projects: ['invalid' as never, [] as never],
      customPaints: [
        'bad' as never,
        { id: 'c_empty', name: '   ', brand: 'B', range: 'R', category: 'Layer', hex: '#000', citadelMatches: [] },
        {
          id: 'c_valid',
          name: 'Valid Custom',
          brand: 'My Brand',
          range: 'My Range',
          code: 'C'.repeat(100),
          category: 'Cat'.repeat(40),
          hex: '#1234567890abcdef1234',
          citadelMatches: Array.from({ length: 30 }, (_, idx) => ({
            citadelPaintId: `cit_${idx}`,
            citadelPaintName: `Cit ${idx}`,
            citadelRange: 'warhammer_colour',
            citadelCategory: 'Base',
            citadelHex: '#ffffff',
            deltaE: 1,
            matchQuality: 'exact' as const,
          })),
        },
        {
          id: 'c_valid',
          name: 'Duplicate ID should be skipped',
          brand: 'B',
          range: 'R',
          category: 'Base',
          hex: '#111111',
          citadelMatches: [],
        },
      ],
      customCompatibilityOverrides: oversizedOverrides as Record<string, string[]>,
      preferences: {
        defaultRangeFilter: 'invalid_range' as never,
        allowCompatibleSubstitutions: 'yes' as never,
        allowThirdPartySubstitutions: false,
        preferredThirdPartyBrands: Array.from({ length: 80 }, (_, i) => `Brand ${i}`),
      },
    });

    expect(state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(state.updatedAt.trim().length).toBeGreaterThan(0);
    expect(state.projects.length).toBe(0);

    expect(state.customPaints.length).toBe(1);
    expect(state.customPaints[0].id).toBe('c_valid');
    expect(state.customPaints[0].code?.length).toBe(64);
    expect(state.customPaints[0].category.length).toBe(64);
    expect(state.customPaints[0].hex.length).toBe(16);
    expect(state.customPaints[0].citadelMatches.length).toBe(
      USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT
    );

    const overrideKeys = Object.keys(state.customCompatibilityOverrides);
    expect(overrideKeys.length).toBe(USER_LIMITS.MAX_COMPATIBILITY_OVERRIDE_KEYS);
    expect(state.customCompatibilityOverrides['   ']).toBeUndefined();
    expect(state.customCompatibilityOverrides['empty_vals']).toBeUndefined();
    expect(state.customCompatibilityOverrides['paint_0'].length).toBe(
      USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT
    );

    expect(state.preferences.defaultRangeFilter).toBe('all');
    expect(state.preferences.allowCompatibleSubstitutions).toBeTrue();
    expect(state.preferences.allowThirdPartySubstitutions).toBeFalse();
    expect(state.preferences.preferredThirdPartyBrands.length).toBe(50);

    expect(normalizePreferences(['not-an-object']).defaultRangeFilter).toBe('all');
    expect(
      normalizeAccountState({
        customCompatibilityOverrides: ['not-an-object'] as unknown as Record<string, string[]>,
      }).customCompatibilityOverrides
    ).toEqual({});
  });

  it('aligns isPrivate for showcase vs reference photos and normalizes featuredImage', () => {
    const state = normalizeAccountState({
      uploadedPhotos: [
        {
          id: 'ph_show_default',
          targetType: 'model',
          targetId: 'm1',
          kind: 'showcase',
          fileName: 's1.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          createdAt: '2026-01-01T00:00:00Z',
        } as never,
        {
          id: 'ph_show_private',
          targetType: 'model',
          targetId: 'm1',
          kind: 'showcase',
          isPrivate: true,
          fileName: 's2.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'ph_ref_force',
          targetType: 'model',
          targetId: 'm1',
          kind: 'reference',
          isPrivate: false,
          fileName: 'r1.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 100,
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    });

    expect(state.uploadedPhotos.map((p) => [p.id, p.isPrivate])).toEqual([
      ['ph_show_default', false],
      ['ph_show_private', true],
      ['ph_ref_force', true],
    ]);

    expect(normalizeFeaturedImage({ source: 'catalog_angle', imageIndex: 2.9 })).toEqual({
      source: 'catalog_angle',
      imageIndex: 2,
      localImagePath: undefined,
      imageUrl: undefined,
    });
    expect(normalizeFeaturedImage({ source: 'catalog_angle', imageIndex: -1 })).toBeUndefined();
    expect(normalizeFeaturedImage({ source: 'catalog_angle', imageIndex: 99 })).toBeUndefined();
    expect(normalizeConfigurations([{ slot: ' ', option: 'X' }])).toBeUndefined();
  });
});
