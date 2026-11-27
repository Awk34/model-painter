import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GameSystem, InventoryReadinessResult, ModelSummary, StagedReadinessResult } from '../../core/models/catalog.models';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { UserStateService } from '../../core/services/user-state.service';
import { PaintModelComponent } from './paint-model.component';

function makeReadiness(): InventoryReadinessResult {
  return {
    totalRequired: 1,
    ownedDirectCount: 1,
    substitutedCount: 0,
    missingCount: 0,
    matchPercent: 100,
    ownedDirectIds: ['p1'],
    substitutedByPaintId: {},
    missingPaintIds: [],
  };
}

const SAMPLE_STAGED: StagedReadinessResult = {
  base: makeReadiness(),
  detail: makeReadiness(),
  artificer: makeReadiness(),
  overall: makeReadiness(),
};

describe('PaintModelComponent faction/sub-faction filtering', () => {
  const games: GameSystem[] = [
    {
      id: 'w40k',
      name: 'Warhammer 40,000',
      recipeCount: 4,
      recipeIds: ['m-sm-um', 'm-sm-ba', 'm-ork'],
      factions: [
        {
          id: 'fac-sm',
          name: 'Space Marines',
          recipeCount: 2,
          recipeIds: ['m-sm-um', 'm-sm-ba'],
          childFactions: [
            { id: 'sub-um', name: 'Ultramarines', recipeCount: 1, recipeIds: ['m-sm-um'] },
            { id: 'sub-ba', name: 'Blood Angels', recipeCount: 1, recipeIds: ['m-sm-ba'] },
          ],
        },
        {
          id: 'fac-ork',
          name: 'Orks',
          recipeCount: 1,
          recipeIds: ['m-ork'],
        },
      ],
    },
  ];

  const models: ModelSummary[] = [
    {
      id: 'm-sm-um',
      name: 'Ultramarines Intercessor',
      range: 'warhammer_colour',
      gameIds: ['w40k'],
      gameNames: ['Warhammer 40,000'],
      factionIds: ['fac-sm', 'sub-um'],
      factionNames: ['Space Marines', 'Ultramarines'],
      colorIds: [],
      requiredPaintIds: ['p1'],
    },
    {
      id: 'm-sm-ba',
      name: 'Blood Angels Guard',
      range: 'warhammer_colour',
      gameIds: ['w40k'],
      gameNames: ['Warhammer 40,000'],
      factionIds: ['fac-sm', 'sub-ba'],
      factionNames: ['Space Marines', 'Blood Angels'],
      colorIds: [],
      requiredPaintIds: ['p1'],
    },
    {
      id: 'm-ork',
      name: 'Ork Boy',
      range: 'warhammer_colour',
      gameIds: ['w40k'],
      gameNames: ['Warhammer 40,000'],
      factionIds: ['fac-ork'],
      factionNames: ['Orks'],
      colorIds: [],
      requiredPaintIds: ['p1'],
    },
    {
      id: 'm-40k-extra',
      name: 'Imperial Knight',
      range: 'warhammer_colour',
      gameIds: ['w40k'],
      gameNames: ['Warhammer 40,000'],
      factionIds: [],
      factionNames: [],
      colorIds: [],
      requiredPaintIds: ['p1'],
    },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PaintModelComponent],
      providers: [
        provideRouter([]),
        {
          provide: CatalogService,
          useValue: {
            games: signal(games),
            models: signal(models),
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateStagedReadiness: () => SAMPLE_STAGED,
          },
        },
        {
          provide: UserStateService,
          useValue: {
            state: signal({ inventoryModelIds: [], wishlistModelIds: [] }),
            inventoryModelIds: signal([]),
            wishlistModelIds: signal([]),
            modelInventorySet: signal(new Set<string>()),
            modelWishlistSet: signal(new Set<string>()),
            isModelOwned: () => false,
            isModelWishlisted: () => false,
            toggleModelInventory: () => {},
            toggleModelWishlist: () => {},
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) =>
              local || remote || '/icons/ic_models.svg',
          },
        },
      ],
    });
  });

  it('filters out models from other factions when game and parent faction are selected', () => {
    const fixture = TestBed.createComponent(PaintModelComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.selectGame(games[0]);
    comp.selectParentFaction(games[0].factions[0]);
    fixture.detectChanges();

    expect(comp.filteredModels().map((item) => item.model.id)).toEqual(['m-sm-um', 'm-sm-ba']);
  });

  it('filters strictly to sub-faction recipeIds and resets visibleLimit on sub-faction click', () => {
    const fixture = TestBed.createComponent(PaintModelComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.selectGame(games[0]);
    comp.selectParentFaction(games[0].factions[0]);
    comp.loadMore();
    expect(comp.visibleLimit()).toBe(120);

    comp.selectSubFaction('sub-um');
    fixture.detectChanges();

    expect(comp.visibleLimit()).toBe(60);
    expect(comp.filteredModels().map((item) => item.model.id)).toEqual(['m-sm-um']);
  });

  it('returns empty results instead of leaking parent/game models when sub-faction ID is missing from parentFaction.childFactions', () => {
    const fixture = TestBed.createComponent(PaintModelComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.selectGame(games[0]);
    comp.selectParentFaction(games[0].factions[0]);
    comp.selectSubFaction('non-existent-subfaction');
    fixture.detectChanges();

    expect(comp.filteredModels()).toEqual([]);
  });

  it('keeps gameIds fallback active when only game is selected without faction/sub-faction', () => {
    const fixture = TestBed.createComponent(PaintModelComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.selectGame(games[0]);
    fixture.detectChanges();

    expect(comp.filteredModels().map((item) => item.model.id)).toEqual([
      'm-sm-um',
      'm-sm-ba',
      'm-ork',
      'm-40k-extra',
    ]);
  });
});
