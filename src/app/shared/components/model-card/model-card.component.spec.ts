import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { InventoryReadinessResult, ModelSummary, StagedReadinessResult } from '../../../core/models/catalog.models';
import { ImageService } from '../../../core/services/image.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { ModelCardComponent } from './model-card.component';

function makeReadiness(): InventoryReadinessResult {
  return {
    totalRequired: 2,
    ownedDirectCount: 1,
    substitutedCount: 0,
    missingCount: 1,
    matchPercent: 50,
    ownedDirectIds: ['p1'],
    substitutedByPaintId: {},
    missingPaintIds: ['p2'],
  };
}

const SAMPLE_STAGED: StagedReadinessResult = {
  base: makeReadiness(),
  detail: makeReadiness(),
  artificer: makeReadiness(),
  overall: makeReadiness(),
};

const SAMPLE_MODEL: ModelSummary = {
  id: 'm1',
  name: 'Intercessor Squad',
  range: 'warhammer_pro',
  gameIds: ['w40k'],
  gameNames: ['Warhammer 40,000'],
  factionIds: ['sm'],
  factionNames: ['Space Marines'],
  colorIds: [],
  requiredPaintIds: ['p1', 'p2'],
};

describe('ModelCardComponent', () => {
  it('renders stretched link inside requested heading level, Tone Pro tag, readiness pills, and isolated toggles', () => {
    const toggleModelInventory = jasmine.createSpy('toggleModelInventory');
    const toggleModelWishlist = jasmine.createSpy('toggleModelWishlist');

    TestBed.configureTestingModule({
      imports: [ModelCardComponent],
      providers: [
        provideRouter([]),
        {
          provide: UserStateService,
          useValue: {
            isModelOwned: () => false,
            isModelWishlisted: () => true,
            toggleModelInventory,
            toggleModelWishlist,
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

    const fixture = TestBed.createComponent(ModelCardComponent);
    fixture.componentRef.setInput('model', SAMPLE_MODEL);
    fixture.componentRef.setInput('staged', SAMPLE_STAGED);
    fixture.componentRef.setInput('activeStage', 'base');
    fixture.componentRef.setInput('showRangeTag', true);
    fixture.componentRef.setInput('headingLevel', 'h2');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const cardImg = root.querySelector('.model-img-box img') as HTMLImageElement;
    expect(cardImg.getAttribute('loading')).toBe('lazy');
    expect(cardImg.getAttribute('decoding')).toBe('async');
    expect(cardImg.getAttribute('width')).toBe('200');
    expect(cardImg.getAttribute('height')).toBe('166');
    expect(root.querySelector('h2 a.card-stretched-link')?.getAttribute('href')).toBe('/models/m1');
    expect(root.querySelector('.range-tag')?.textContent?.trim()).toBe('Tone Pro');
    expect(root.querySelector('app-stage-readiness-pills')).not.toBeNull();

    const buttons = Array.from(root.querySelectorAll('.model-card-actions button')) as HTMLButtonElement[];
    expect(buttons[1].getAttribute('aria-label')).toContain('Intercessor Squad');
    buttons[0].click();
    buttons[1].click();
    expect(toggleModelInventory).toHaveBeenCalledWith('m1');
    expect(toggleModelWishlist).toHaveBeenCalledWith('m1');

    fixture.componentRef.setInput('headingLevel', 'h3');
    fixture.componentRef.setInput('compact', true);
    fixture.componentRef.setInput('staged', null);
    fixture.detectChanges();
    expect(root.querySelector('h3 a.card-stretched-link')).not.toBeNull();
    expect(root.querySelector('app-stage-readiness-pills')).toBeNull();
  });
});
