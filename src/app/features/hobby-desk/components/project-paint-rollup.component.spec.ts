import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InventoryReadinessResult, Paint, StagedReadinessResult } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { ProjectPaintRollupComponent } from './project-paint-rollup.component';

function makeReadiness(overrides: Partial<InventoryReadinessResult> = {}): InventoryReadinessResult {
  return {
    totalRequired: 0,
    ownedDirectCount: 0,
    substitutedCount: 0,
    missingCount: 0,
    matchPercent: 100,
    ownedDirectIds: [],
    substitutedByPaintId: {},
    missingPaintIds: [],
    ...overrides,
  };
}

describe('ProjectPaintRollupComponent', () => {
  let addManyToWishlistSpy: jasmine.Spy;
  let addManyToInventorySpy: jasmine.Spy;

  beforeEach(() => {
    addManyToWishlistSpy = jasmine.createSpy('addManyToWishlist');
    addManyToInventorySpy = jasmine.createSpy('addManyToInventory');

    const paintMap = new Map<string, Paint>([
      [
        'p-missing',
        {
          id: 'p-missing',
          name: 'Mephiston Red',
          range: 'warhammer_colour',
          category: 'Base',
          gradientStartHex: '#9A1115',
        },
      ],
      [
        'p-sub',
        {
          id: 'p-sub',
          name: 'Retributor Armour',
          range: 'warhammer_colour',
          category: 'Base',
          gradientStartHex: '#EBB854',
        },
      ],
      [
        'p-owned',
        {
          id: 'p-owned',
          name: 'Abaddon Black',
          range: 'warhammer_colour',
          category: 'Base',
          gradientStartHex: '#000000',
        },
      ],
    ]);

    TestBed.configureTestingModule({
      imports: [ProjectPaintRollupComponent],
      providers: [
        {
          provide: CatalogService,
          useValue: {
            paints: signal(Array.from(paintMap.values())),
            paintById: signal(paintMap),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            addManyToWishlist: addManyToWishlistSpy,
            addManyToInventory: addManyToInventorySpy,
            isOwned: (id: string) => id === 'p-owned',
            isWishlisted: () => false,
            toggleInventory: () => undefined,
            toggleWishlist: () => undefined,
          },
        },
        {
          provide: PaintModalService,
          useValue: { openPaint: () => undefined },
        },
        {
          provide: ImageService,
          useValue: { resolve: () => '/icons/ic_models.svg' },
        },
      ],
    });
  });

  it('renders empty state when overall.totalRequired === 0 and emits addModelClick / addColorClick', () => {
    const emptyStaged: StagedReadinessResult = {
      base: makeReadiness(),
      detail: makeReadiness(),
      artificer: makeReadiness(),
      overall: makeReadiness(),
    };

    const fixture = TestBed.createComponent(ProjectPaintRollupComponent);
    fixture.componentRef.setInput('staged', emptyStaged);
    fixture.detectChanges();

    let modelClicks = 0;
    let colorClicks = 0;
    fixture.componentInstance.addModelClick.subscribe(() => (modelClicks += 1));
    fixture.componentInstance.addColorClick.subscribe(() => (colorClicks += 1));

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.empty-box')).not.toBeNull();
    const btns = Array.from(root.querySelectorAll('.empty-btn-row button')) as HTMLButtonElement[];
    btns[0].click();
    btns[1].click();
    expect(modelClicks).toBe(1);
    expect(colorClicks).toBe(1);
  });

  it('switches stages, resolves missing/substituted/owned paints (ignoring unknown IDs), triggers bulk actions, and toggles expanded', () => {
    const staged: StagedReadinessResult = {
      base: makeReadiness({
        totalRequired: 4,
        missingCount: 2,
        substitutedCount: 1,
        ownedDirectCount: 1,
        missingPaintIds: ['p-missing', 'p-unknown'],
        ownedDirectIds: ['p-owned', 'p-unknown-owned'],
        substitutedByPaintId: {
          'p-sub': {
            requiredPaintId: 'p-sub',
            substitutePaintId: 'tp-gold',
            substituteName: 'Glorious Gold',
            substituteBrand: 'Vallejo',
            substituteHex: '#EBB854',
            matchType: 'third_party',
          },
          'p-unknown-sub': {
            requiredPaintId: 'p-unknown-sub',
            substitutePaintId: 'tp-x',
            substituteName: 'Ignored',
            substituteBrand: 'Vallejo',
            substituteHex: '#888888',
            matchType: 'third_party',
          },
        },
      }),
      detail: makeReadiness({
        totalRequired: 1,
        ownedDirectCount: 1,
        ownedDirectIds: ['p-owned'],
      }),
      artificer: makeReadiness(),
      overall: makeReadiness({
        totalRequired: 4,
        missingCount: 1,
        substitutedCount: 1,
        ownedDirectCount: 1,
        missingPaintIds: ['p-missing'],
        ownedDirectIds: ['p-owned'],
        substitutedByPaintId: {
          'p-sub': {
            requiredPaintId: 'p-sub',
            substitutePaintId: 'tp-gold',
            substituteName: 'Glorious Gold',
            substituteBrand: 'Vallejo',
            substituteHex: '#EBB854',
            matchType: 'third_party',
          },
        },
      }),
    };

    const fixture = TestBed.createComponent(ProjectPaintRollupComponent);
    const comp = fixture.componentInstance;
    fixture.componentRef.setInput('staged', staged);
    fixture.detectChanges();

    expect(comp.selectedStage()).toBe('base');
    expect(comp.missingPaintObjects().map((p) => p.id)).toEqual(['p-missing']);
    expect(comp.substitutedList().map((x) => x.paint.id)).toEqual(['p-sub']);
    expect(comp.ownedDirectObjects().map((p) => p.id)).toEqual(['p-owned']);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Covered by Glorious Gold (Vallejo)');

    // Bulk wishlist and inventory actions
    const actionBtns = Array.from(root.querySelectorAll('.group-actions button')) as HTMLButtonElement[];
    actionBtns[0].click();
    actionBtns[1].click();
    expect(addManyToWishlistSpy).toHaveBeenCalledWith(['p-missing', 'p-unknown']);
    expect(addManyToInventorySpy).toHaveBeenCalledWith(['p-missing', 'p-unknown']);

    // Switch to Detail stage (0 missing -> shows all-covered message)
    const stageChips = Array.from(root.querySelectorAll('.chip-bar .chip')) as HTMLButtonElement[];
    stageChips[1].click();
    fixture.detectChanges();
    expect(comp.selectedStage()).toBe('detail');
    expect(root.querySelector('.all-covered-msg')?.textContent).toContain('You own every paint');

    // Switch to All Stages Combined
    stageChips[3].click();
    fixture.detectChanges();
    expect(comp.selectedStage()).toBe('all');
    expect(comp.rollupReadiness()).toBe(staged.overall);

    // Toggle expanded via CollapsibleSection header button
    const collapseBtn = root.querySelector('.section-toggle-btn') as HTMLButtonElement | null;
    expect(collapseBtn).not.toBeNull();
    expect(comp.expanded()).toBeTrue();
    collapseBtn?.click();
    fixture.detectChanges();
    expect(comp.expanded()).toBeFalse();
  });
});
