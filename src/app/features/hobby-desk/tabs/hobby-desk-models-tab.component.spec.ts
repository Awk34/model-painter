import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  GameSystem,
  InventoryReadinessResult,
  ModelSummary,
  StagedReadinessResult,
} from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { InventoryMatchService } from '../../../core/services/inventory-match.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { HobbyDeskModelsTabComponent } from './hobby-desk-models-tab.component';

function makeStage(pct = 100): InventoryReadinessResult {
  return {
    totalRequired: 1,
    ownedDirectCount: pct === 100 ? 1 : 0,
    substitutedCount: 0,
    missingCount: pct === 100 ? 0 : 1,
    matchPercent: pct,
    ownedDirectIds: pct === 100 ? ['p1'] : [],
    substitutedByPaintId: {},
    missingPaintIds: pct === 100 ? [] : ['p1'],
  };
}

const SAMPLE_STAGED: StagedReadinessResult = {
  base: makeStage(100),
  detail: makeStage(100),
  artificer: makeStage(100),
  overall: makeStage(100),
};

function makeModel(index: number, overrides: Partial<ModelSummary> = {}): ModelSummary {
  return {
    id: `model-${index}`,
    name: `Miniature ${index}`,
    range: 'warhammer_colour',
    gameIds: ['game-40k'],
    gameNames: ['Warhammer 40,000'],
    factionIds: ['fac-sm'],
    factionNames: ['Space Marines'],
    colorIds: [],
    requiredPaintIds: ['p1'],
    paintsByStage: { base: ['p1'], detail: [], artificer: [] },
    ...overrides,
  };
}

describe('HobbyDeskModelsTabComponent', () => {
  function setupModule(options: {
    models?: ModelSummary[];
    games?: GameSystem[];
    inventoryModelIds?: string[];
    wishlistModelIds?: string[];
  } = {}) {
    const modelsSig = signal<ModelSummary[]>(options.models ?? []);
    const gamesSig = signal<GameSystem[]>(
      options.games ?? [
        { id: 'game-40k', name: 'Warhammer 40,000', recipeCount: 2, recipeIds: [], factions: [] },
        { id: 'game-aos', name: 'Age of Sigmar', recipeCount: 1, recipeIds: [], factions: [] },
      ]
    );
    const invIds = signal<string[]>(options.inventoryModelIds ?? []);
    const wishIds = signal<string[]>(options.wishlistModelIds ?? []);
    const invSet = signal(new Set<string>(invIds()));
    const wishSet = signal(new Set<string>(wishIds()));

    TestBed.configureTestingModule({
      imports: [HobbyDeskModelsTabComponent],
      providers: [
        provideRouter([]),
        {
          provide: CatalogService,
          useValue: {
            models: modelsSig,
            games: gamesSig,
          },
        },
        {
          provide: UserStateService,
          useValue: {
            modelInventorySet: invSet,
            modelWishlistSet: wishSet,
            inventoryModelIds: invIds,
            wishlistModelIds: wishIds,
            isModelOwned: (id: string) => invSet().has(id),
            isModelWishlisted: (id: string) => wishSet().has(id),
            toggleModelInventory: () => undefined,
            toggleModelWishlist: () => undefined,
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateStagedReadiness: () => SAMPLE_STAGED,
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: () => '/icons/ic_models.svg',
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(HobbyDeskModelsTabComponent);
    fixture.detectChanges();
    return { fixture, comp: fixture.componentInstance, invSet, wishSet, invIds, wishIds };
  }

  it('filters across inventory, wishlist, catalogue, game filter, and search with FormControl sync', () => {
    const models = [
      makeModel(1, { name: 'Intercessor', gameIds: ['game-40k'], gameNames: ['Warhammer 40,000'] }),
      makeModel(2, { name: 'Stormcast Liberator', gameIds: ['game-aos'], gameNames: ['Age of Sigmar'] }),
      makeModel(3, { name: 'Dante', gameIds: ['game-40k'], gameNames: ['Warhammer 40,000'] }),
    ];
    const { fixture, comp } = setupModule({
      models,
      inventoryModelIds: ['model-1'],
      wishlistModelIds: ['model-2'],
    });

    const root = fixture.nativeElement as HTMLElement;
    expect(comp.subMode()).toBe('inventory');
    expect(comp.filteredModels().map((x) => x.model.id)).toEqual(['model-1']);
    expect(root.querySelector('[aria-live="polite"]')?.textContent?.trim()).toBe(
      'Showing 1 of 1 matching models'
    );

    // Switch to wishlist
    comp.subMode.set('wishlist');
    fixture.detectChanges();
    expect(comp.filteredModels().map((x) => x.model.id)).toEqual(['model-2']);

    // Switch to catalogue and filter via FormControls
    comp.subMode.set('catalogue');
    fixture.detectChanges();
    expect(comp.filteredModels().length).toBe(3);

    comp.gameFilterControl.setValue('game-40k');
    fixture.detectChanges();
    expect(comp.selectedModelGameFilter()).toBe('game-40k');
    expect(comp.filteredModels().map((x) => x.model.id)).toEqual(['model-1', 'model-3']);

    comp.searchControl.setValue('dante');
    fixture.detectChanges();
    expect(comp.modelSearch()).toBe('dante');
    expect(comp.filteredModels().map((x) => x.model.id)).toEqual(['model-3']);
  });

  it('paginates at 60 items, increments on loadMoreModels, and resets limit when filters or subMode change', () => {
    const models = Array.from({ length: 75 }, (_, i) => makeModel(i + 1));
    const { fixture, comp } = setupModule({ models });

    comp.subMode.set('catalogue');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(comp.modelVisibleLimit()).toBe(60);
    expect(comp.displayedModels().length).toBe(60);
    expect(root.querySelector('[aria-live="polite"]')?.textContent?.trim()).toBe(
      'Showing 60 of 75 matching models'
    );

    const loadMoreBtn = root.querySelector('.load-more-row button') as HTMLButtonElement | null;
    expect(loadMoreBtn?.textContent).toContain('15 remaining');
    loadMoreBtn?.click();
    fixture.detectChanges();

    expect(comp.modelVisibleLimit()).toBe(120);
    expect(comp.displayedModels().length).toBe(75);
    expect(root.querySelector('.load-more-row button')).toBeNull();

    // Changing search resets visible limit back to 60
    comp.searchControl.setValue('Miniature');
    fixture.detectChanges();
    expect(comp.modelVisibleLimit()).toBe(60);
    expect(comp.displayedModels().length).toBe(60);
  });

  it('renders distinct empty-state messages for inventory, wishlist, and catalogue (hiding CTA on catalogue)', () => {
    const { fixture, comp } = setupModule({ models: [] });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('.empty-state')?.textContent).toContain('Model Inventory is empty');
    const browseBtn = root.querySelector('.empty-state button') as HTMLButtonElement | null;
    expect(browseBtn?.textContent).toContain('Browse All Models Catalogue');

    comp.subMode.set('wishlist');
    fixture.detectChanges();
    expect(root.querySelector('.empty-state')?.textContent).toContain('Model Wishlist is currently empty');
    expect(root.querySelector('.empty-state button')).not.toBeNull();

    // Clicking Browse CTA switches to catalogue mode, which hides the CTA button
    (root.querySelector('.empty-state button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(comp.subMode()).toBe('catalogue');
    expect(root.querySelector('.empty-state')?.textContent).toContain(
      'No models match your current search or game system filter.'
    );
    expect(root.querySelector('.empty-state button')).toBeNull();
  });
});
