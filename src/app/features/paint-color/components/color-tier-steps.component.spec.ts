import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InventoryReadinessResult } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { ColorTierBlock, ColorTierStepsComponent } from './color-tier-steps.component';

function makeReadiness(overrides: Partial<InventoryReadinessResult> = {}): InventoryReadinessResult {
  return {
    totalRequired: 2,
    ownedDirectCount: 0,
    substitutedCount: 1,
    missingCount: 1,
    matchPercent: 50,
    ownedDirectIds: [],
    substitutedByPaintId: {
      'p-macragge': {
        requiredPaintId: 'p-macragge',
        substitutePaintId: 'tp-val-blue',
        substituteName: 'Ultramarine Blue',
        substituteBrand: 'Vallejo',
        substituteHex: '#0D407F',
        matchType: 'third_party',
        deltaE: 1.2,
      },
    },
    missingPaintIds: ['p-nuln'],
    ...overrides,
  };
}

const SAMPLE_BLOCKS: ColorTierBlock[] = [
  {
    key: 'base',
    label: 'Base Finish',
    steps: [
      {
        id: 'st-1',
        stepOrder: 1,
        technique: 'Basecoat',
        paint: {
          id: 'p-macragge',
          name: 'Macragge Blue',
          category: 'Base',
          hex: '#0D407F',
        },
      },
    ],
  },
  {
    key: 'detail',
    label: 'Detail Finish',
    steps: [
      {
        id: 'st-no-paint',
        stepOrder: 1,
        technique: 'Drybrush',
      },
      {
        id: 'st-2',
        stepOrder: 2,
        technique: '',
        paint: {
          id: 'p-nuln',
          name: 'Nuln Oil',
          category: 'Shade',
          hex: '#101010',
        },
      },
    ],
  },
  {
    key: 'artificer',
    label: 'Artificer Finish',
    steps: [],
  },
];

describe('ColorTierStepsComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ColorTierStepsComponent],
      providers: [
        {
          provide: UserStateService,
          useValue: {
            isOwned: () => false,
            isWishlisted: () => false,
            toggleInventory: () => undefined,
            toggleWishlist: () => undefined,
          },
        },
        {
          provide: CatalogService,
          useValue: {
            paints: signal([]),
            paintById: signal(new Map()),
          },
        },
        {
          provide: PaintModalService,
          useValue: {
            openPaint: () => undefined,
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) => local || remote || '/icons/ic_models.svg',
          },
        },
      ],
    });
  });

  it('renders tier blocks, singular/plural step counts, and skips steps without paint', () => {
    const fixture = TestBed.createComponent(ColorTierStepsComponent);
    fixture.componentRef.setInput('tierBlocks', SAMPLE_BLOCKS);
    fixture.componentRef.setInput('readiness', makeReadiness());
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const blocks = Array.from(root.querySelectorAll('.tier-block')) as HTMLElement[];
    expect(blocks.length).toBe(3);

    const subs = blocks.map((b) => b.querySelector('.tier-sub')?.textContent?.trim());
    expect(subs).toEqual(['1 Step', '2 Steps', '0 Steps']);

    // Detail Finish has 2 steps in input, but st-no-paint lacks paint -> only 1 PaintActionRow rendered
    expect(blocks[0].querySelectorAll('app-paint-action-row').length).toBe(1);
    expect(blocks[1].querySelectorAll('app-paint-action-row').length).toBe(1);
    expect(blocks[2].querySelectorAll('app-paint-action-row').length).toBe(0);

    // Subtitle falls back from st.technique to sp.category, and short substitute format renders
    expect(blocks[0].textContent).toContain('Basecoat');
    expect(blocks[0].textContent).toContain('⇄ Ultramarine Blue');
    expect(blocks[1].textContent).toContain('Shade');
  });

  it('updates activeTier model(), aria-pressed, and .highlighted on header click', () => {
    const fixture = TestBed.createComponent(ColorTierStepsComponent);
    const comp = fixture.componentInstance;
    fixture.componentRef.setInput('tierBlocks', SAMPLE_BLOCKS);
    fixture.componentRef.setInput('readiness', makeReadiness());
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const blocks = Array.from(root.querySelectorAll('.tier-block')) as HTMLElement[];
    const buttons = Array.from(root.querySelectorAll('.tier-block-header-btn')) as HTMLButtonElement[];

    expect(comp.activeTier()).toBe('base');
    expect(blocks[0].classList.contains('highlighted')).toBeTrue();
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');

    buttons[1].click();
    fixture.detectChanges();

    expect(comp.activeTier()).toBe('detail');
    expect(blocks[0].classList.contains('highlighted')).toBeFalse();
    expect(blocks[1].classList.contains('highlighted')).toBeTrue();
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
  });
});
