import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  CitadelThirdPartyMatchRef,
  ColorSummary,
  ModelSummary,
  Paint,
  PaintCompatibilityLink,
  ThirdPartyPaint,
} from '../models/catalog.models';
import { CatalogService } from './catalog.service';
import { InventoryMatchService } from './inventory-match.service';
import { UserStateService } from './user-state.service';

describe('InventoryMatchService', () => {
  let service: InventoryMatchService;

  const inventorySet = signal(new Set<string>());
  const preferences = signal({
    allowCompatibleSubstitutions: true,
    allowThirdPartySubstitutions: true,
  });
  const customCompatibilityOverrides = signal<Record<string, string[]>>({});
  const customPaintById = signal(new Map<string, ThirdPartyPaint>());

  const paintById = signal(new Map<string, Paint>());
  const thirdPartyPaintById = signal(new Map<string, ThirdPartyPaint>());
  const classicToToneProMap = signal(new Map<string, PaintCompatibilityLink[]>());
  const toneProToClassicMap = signal(new Map<string, PaintCompatibilityLink[]>());
  const citadelToThirdPartyMap = signal<Record<string, CitadelThirdPartyMatchRef[]>>({});
  const modelById = signal(new Map<string, ModelSummary>());
  const colorById = signal(new Map<string, ColorSummary>());

  beforeEach(() => {
    inventorySet.set(new Set());
    preferences.set({
      allowCompatibleSubstitutions: true,
      allowThirdPartySubstitutions: true,
    });
    customCompatibilityOverrides.set({});
    customPaintById.set(new Map());

    paintById.set(
      new Map<string, Paint>([
        [
          'cit-mephiston',
          {
            id: 'cit-mephiston',
            name: 'Mephiston Red',
            range: 'warhammer_colour',
            category: 'Base',
            gradientStartHex: '#9A1115',
          },
        ],
        [
          'pro-crimson',
          {
            id: 'pro-crimson',
            name: 'Sanguine Crimson',
            range: 'warhammer_pro',
            category: 'Tone Pro',
            gradientStartHex: '#A01418',
          },
        ],
      ])
    );

    thirdPartyPaintById.set(
      new Map<string, ThirdPartyPaint>([
        [
          'tp-vallejo-red',
          {
            id: 'tp-vallejo-red',
            brand: 'Vallejo',
            range: 'Model Color',
            name: 'Flat Red',
            category: 'Acrylic',
            hex: '#9B1317',
            citadelMatches: [],
          },
        ],
      ])
    );

    classicToToneProMap.set(
      new Map<string, PaintCompatibilityLink[]>([
        [
          'cit-mephiston',
          [
            {
              classic_paint_id: 'cit-mephiston',
              classic_paint_name: 'Mephiston Red',
              classic_category: 'Base',
              tone_pro_paint_id: 'pro-crimson',
              tone_pro_paint_name: 'Sanguine Crimson',
              tone_pro_hex: '#A01418',
            },
          ],
        ],
      ])
    );

    toneProToClassicMap.set(
      new Map<string, PaintCompatibilityLink[]>([
        [
          'pro-crimson',
          [
            {
              classic_paint_id: 'cit-mephiston',
              classic_paint_name: 'Mephiston Red',
              classic_category: 'Base',
              tone_pro_paint_id: 'pro-crimson',
              tone_pro_paint_name: 'Sanguine Crimson',
              tone_pro_hex: '#A01418',
            },
          ],
        ],
      ])
    );

    citadelToThirdPartyMap.set({
      'cit-abaddon': [
        {
          thirdPartyPaintId: 'tp-ak-black',
          brand: 'AK Interactive',
          range: '3rd Gen',
          name: 'Black',
          category: 'Acrylic',
          hex: '#111111',
          deltaE: 0.8,
          matchQuality: 'exact',
        },
      ],
    });

    modelById.set(new Map());
    colorById.set(new Map());

    TestBed.configureTestingModule({
      providers: [
        InventoryMatchService,
        {
          provide: UserStateService,
          useValue: {
            inventorySet,
            preferences,
            customCompatibilityOverrides,
            customPaintById,
          },
        },
        {
          provide: CatalogService,
          useValue: {
            paintById,
            thirdPartyPaintById,
            classicToToneProMap,
            toneProToClassicMap,
            citadelToThirdPartyMap,
            modelById,
            colorById,
          },
        },
      ],
    });

    service = TestBed.inject(InventoryMatchService);
  });

  it('returns 100% readiness for empty or null required paint lists', () => {
    const res = service.evaluateReadiness(null);
    expect(res.totalRequired).toBe(0);
    expect(res.matchPercent).toBe(100);
    expect(res.missingCount).toBe(0);
  });

  it('deduplicates required paint IDs and counts direct ownership first', () => {
    inventorySet.set(new Set(['cit-mephiston']));
    const res = service.evaluateReadiness(['cit-mephiston', 'cit-mephiston', 'cit-abaddon']);
    expect(res.totalRequired).toBe(2);
    expect(res.ownedDirectCount).toBe(1);
    expect(res.missingCount).toBe(1);
    expect(res.matchPercent).toBe(50);
  });

  it('prioritizes custom compatibility overrides even when automatic substitutions are disabled', () => {
    preferences.set({
      allowCompatibleSubstitutions: false,
      allowThirdPartySubstitutions: false,
    });
    customPaintById.set(
      new Map([
        [
          'custom-1',
          {
            id: 'custom-1',
            brand: 'Pro Acryl',
            range: 'Base',
            name: 'Bold Pyrrole Red',
            category: 'Base',
            hex: '#B01216',
            citadelMatches: [],
            isCustom: true,
          },
        ],
      ])
    );
    customCompatibilityOverrides.set({ 'cit-mephiston': ['custom-1'] });
    inventorySet.set(new Set(['custom-1']));

    const res = service.evaluateReadiness(['cit-mephiston']);
    expect(res.substitutedCount).toBe(1);
    expect(res.matchPercent).toBe(100);
    expect(res.substitutedByPaintId['cit-mephiston'].matchType).toBe('custom_override');
    expect(res.substitutedByPaintId['cit-mephiston'].substituteName).toBe('Bold Pyrrole Red');
  });

  it('matches official Citadel Classic <-> Tone Pro compatibility when enabled', () => {
    inventorySet.set(new Set(['pro-crimson']));
    const res = service.evaluateReadiness(['cit-mephiston']);
    expect(res.substitutedCount).toBe(1);
    expect(res.substitutedByPaintId['cit-mephiston'].matchType).toBe('tone_pro');

    preferences.set({
      allowCompatibleSubstitutions: false,
      allowThirdPartySubstitutions: true,
    });
    const disabledRes = service.evaluateReadiness(['cit-mephiston']);
    expect(disabledRes.substitutedCount).toBe(0);
    expect(disabledRes.missingCount).toBe(1);
  });

  it('matches 3rd-party equivalents when enabled and records deltaE', () => {
    inventorySet.set(new Set(['tp-ak-black']));
    const res = service.evaluateReadiness(['cit-abaddon']);
    expect(res.substitutedCount).toBe(1);
    expect(res.substitutedByPaintId['cit-abaddon'].matchType).toBe('third_party');
    expect(res.substitutedByPaintId['cit-abaddon'].deltaE).toBe(0.8);
  });

  it('aggregates model and color stages in evaluateProjectStagedReadiness', () => {
    modelById.set(
      new Map<string, ModelSummary>([
        [
          'm1',
          {
            id: 'm1',
            name: 'Intercessor',
            range: 'warhammer_colour',
            gameIds: [],
            gameNames: [],
            factionIds: [],
            factionNames: [],
            colorIds: [],
            requiredPaintIds: ['cit-mephiston', 'cit-abaddon'],
            paintsByStage: {
              base: ['cit-mephiston'],
              detail: ['cit-abaddon'],
              artificer: [],
            },
          },
        ],
      ])
    );
    colorById.set(
      new Map<string, ColorSummary>([
        [
          'c1',
          {
            id: 'c1',
            name: 'Crimson Armour',
            hex: '#9A1115',
            range: 'warhammer_colour',
            guideType: 'miniature',
            colorGroups: [],
            basePaintIds: ['cit-mephiston'],
            detailPaintIds: [],
            artificerPaintIds: ['pro-crimson'],
            requiredPaintIds: ['cit-mephiston', 'pro-crimson'],
          },
        ],
      ])
    );
    inventorySet.set(new Set(['cit-mephiston']));
    preferences.set({
      allowCompatibleSubstitutions: false,
      allowThirdPartySubstitutions: false,
    });

    const staged = service.evaluateProjectStagedReadiness({
      models: [
        {
          id: 'pmod_1',
          recipeId: 'm1',
          quantity: 1,
          notes: '',
          completedStepIds: [],
          photos: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'pmod_2',
          recipeId: 'm1',
          quantity: 2,
          notes: 'Second variant',
          completedStepIds: [],
          photos: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      colorIds: ['c1'],
    });

    expect(staged.base.matchPercent).toBe(100);
    expect(staged.detail.matchPercent).toBe(0);
    expect(staged.artificer.matchPercent).toBe(0);
    expect(staged.overall.totalRequired).toBe(3);
    expect(staged.overall.ownedDirectCount).toBe(1);
  });
});

