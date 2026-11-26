import { USER_LIMITS } from '../config/user-limits.config';
import { UserAccountState } from '../models/catalog.models';
import { mergeUserAccountState } from './user-state-merger.util';
import { createDefaultState } from './user-state-normalizer.util';

describe('user-state-merger.util', () => {
  it('merges inventory/wishlist sets while removing owned items from wishlists and supports replace mode', () => {
    const prev: UserAccountState = {
      ...createDefaultState(),
      inventoryPaintIds: ['p1'],
      wishlistPaintIds: ['p2', 'p3'],
      inventoryModelIds: ['m1'],
      wishlistModelIds: ['m2', 'm3'],
    };

    const merged = mergeUserAccountState(
      prev,
      {
        inventoryPaintIds: ['p2', 'p4'],
        wishlistPaintIds: ['p1', 'p5'],
        inventoryModelIds: ['m2'],
        wishlistModelIds: ['m1', 'm4'],
      },
      'merge'
    );

    expect(merged.inventoryPaintIds).toEqual(['p1', 'p2', 'p4']);
    expect(merged.wishlistPaintIds).toEqual(['p3', 'p5']);
    expect(merged.inventoryModelIds).toEqual(['m1', 'm2']);
    expect(merged.wishlistModelIds).toEqual(['m3', 'm4']);

    const replaced = mergeUserAccountState(
      prev,
      {
        inventoryPaintIds: ['p9'],
        wishlistPaintIds: ['p10'],
      },
      'replace'
    );
    expect(replaced.inventoryPaintIds).toEqual(['p9']);
    expect(replaced.wishlistPaintIds).toEqual(['p10']);
    expect(replaced.inventoryModelIds).toEqual([]);
  });

  it('resolves project conflicts by updatedAt while preserving existing createdAt', () => {
    const prev: UserAccountState = {
      ...createDefaultState(),
      projects: [
        {
          id: 'proj_1',
          name: 'Existing Newer',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2026-06-01T00:00:00Z',
          models: [],
          colorIds: [],
          notes: [],
          photos: [],
        },
        {
          id: 'proj_2',
          name: 'Existing Older',
          createdAt: '2025-02-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          models: [],
          colorIds: [],
          notes: [],
          photos: [],
        },
      ],
    };

    const merged = mergeUserAccountState(prev, {
      projects: [
        {
          id: 'proj_1',
          name: 'Stale Incoming',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
          models: [],
          colorIds: [],
          notes: [],
          photos: [],
        },
        {
          id: 'proj_2',
          name: 'Newer Incoming',
          createdAt: '2026-03-01T00:00:00Z',
          updatedAt: '2026-07-01T00:00:00Z',
          models: [],
          colorIds: [],
          notes: [],
          photos: [],
        },
      ],
    });

    expect(merged.projects.find((p) => p.id === 'proj_1')?.name).toBe('Existing Newer');
    const p2 = merged.projects.find((p) => p.id === 'proj_2')!;
    expect(p2.name).toBe('Newer Incoming');
    expect(p2.createdAt).toBe('2025-02-01T00:00:00Z');
  });

  it('preserves preferences when payload omits preferences or passes non-object preferences', () => {
    const prev: UserAccountState = {
      ...createDefaultState(),
      preferences: {
        defaultRangeFilter: 'warhammer_pro',
        allowCompatibleSubstitutions: false,
        allowThirdPartySubstitutions: false,
        preferredThirdPartyBrands: ['Vallejo'],
      },
    };

    const withoutPrefs = mergeUserAccountState(prev, { inventoryPaintIds: ['p1'] });
    expect(withoutPrefs.preferences).toEqual(prev.preferences);
    expect(withoutPrefs.preferences.preferredThirdPartyBrands).not.toBe(
      prev.preferences.preferredThirdPartyBrands
    );

    const arrayPrefs = mergeUserAccountState(prev, { preferences: ['bad'] });
    expect(arrayPrefs.preferences).toEqual(prev.preferences);
  });

  it('filters uploadedPhotos to targetType model, enforces reference isPrivate, strips prototype keys, and enforces quotas', () => {
    const prev = createDefaultState();
    const payload = JSON.parse(
      JSON.stringify({
        uploadedPhotos: [
          {
            id: 'ph_model',
            targetType: 'model',
            targetId: 'm1',
            kind: 'reference',
            isPrivate: false,
            fileName: 'ref.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            createdAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'ph_proj_ignored',
            targetType: 'project',
            targetId: 'p1',
            kind: 'showcase',
            isPrivate: false,
            fileName: 'proj.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 100,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
        modelProgress: {
          toString: ['s1'],
          constructor: ['bad'],
        },
        customCompatibilityOverrides: {
          toString: ['tp1'],
          prototype: ['bad'],
        },
        projects: Array.from({ length: USER_LIMITS.MAX_PROJECTS + 5 }, (_, i) => ({
          id: `proj_${i}`,
          name: `Project ${i}`,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          models: [],
          colorIds: [],
          notes: [],
          photos: [],
        })),
      })
    ) as Record<string, unknown>;

    const merged = mergeUserAccountState(prev, payload);
    expect(merged.uploadedPhotos.map((p) => p.id)).toEqual(['ph_model']);
    expect(merged.uploadedPhotos[0].isPrivate).toBeTrue();
    expect(merged.modelProgress['toString']).toEqual(['s1']);
    expect(Object.hasOwn(merged.modelProgress, 'constructor')).toBeFalse();
    expect(merged.customCompatibilityOverrides['toString']).toEqual(['tp1']);
    expect(Object.hasOwn(merged.customCompatibilityOverrides, 'prototype')).toBeFalse();
    expect(merged.projects.length).toBe(USER_LIMITS.MAX_PROJECTS);
  });

  it('enforces MAX_CUSTOM_PAINTS, MAX_STEPS_PER_MODEL_PROGRESS, and MAX_COMPATIBILITY_OVERRIDES_PER_PAINT caps when merging', () => {
    const prev = createDefaultState();
    const merged = mergeUserAccountState(prev, {
      customPaints: Array.from({ length: USER_LIMITS.MAX_CUSTOM_PAINTS + 15 }, (_, i) => ({
        id: `cp_${i}`,
        brand: 'Vallejo',
        range: 'Model Color',
        name: `Custom ${i}`,
        category: 'Layer',
        hex: '#112233',
        citadelMatches: [],
      })),
      modelProgress: {
        m1: Array.from({ length: USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS + 10 }, (_, i) => `s_${i}`),
      },
      customCompatibilityOverrides: {
        p1: Array.from(
          { length: USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT + 10 },
          (_, i) => `eq_${i}`
        ),
      },
    });

    expect(merged.customPaints.length).toBe(USER_LIMITS.MAX_CUSTOM_PAINTS);
    expect(merged.modelProgress['m1'].length).toBe(USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS);
    expect(merged.customCompatibilityOverrides['p1'].length).toBe(
      USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT
    );
  });
});
