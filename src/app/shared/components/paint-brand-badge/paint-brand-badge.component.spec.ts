import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  CitadelPaintRange,
  KNOWN_THIRD_PARTY_BRANDS,
  PaintBrand,
} from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { PaintBrandBadgeVariant } from '../../../core/utils/catalog-filter.util';
import { PaintBrandBadgeComponent } from './paint-brand-badge.component';

interface ExpectedBadgeState {
  label: string;
  variant: PaintBrandBadgeVariant;
  brand: string;
  knownBrand: boolean;
}

const BADGE_VARIANT_CLASSES: Record<PaintBrandBadgeVariant, string> = {
  gold: 'badge-gold',
  pro: 'badge-pro',
  sub: 'badge-sub',
};

function expectBadge(
  fixture: ComponentFixture<PaintBrandBadgeComponent>,
  expected: Partial<ExpectedBadgeState> & Pick<ExpectedBadgeState, 'label'>
): void {
  const badge = fixture.nativeElement.querySelector('.badge') as HTMLElement | null;
  expect(badge).toBeTruthy();
  if (!badge) {
    return;
  }

  expect(badge.textContent?.trim()).toBe(expected.label);

  if (expected.variant !== undefined) {
    for (const [variantKey, cls] of Object.entries(BADGE_VARIANT_CLASSES)) {
      if (variantKey === expected.variant) {
        expect(badge.classList.contains(cls)).withContext(`class ${cls}`).toBeTrue();
      } else {
        expect(badge.classList.contains(cls)).withContext(`class ${cls}`).toBeFalse();
      }
    }
  }

  if (expected.brand !== undefined) {
    expect(badge.getAttribute('data-brand')).toBe(expected.brand);
  }

  if (expected.knownBrand !== undefined) {
    expect(badge.getAttribute('data-known-brand')).toBe(String(expected.knownBrand));
  }
}

describe('PaintBrandBadgeComponent', () => {
  const thirdPartyBrands = signal<string[]>([...KNOWN_THIRD_PARTY_BRANDS]);

  beforeEach(async () => {
    thirdPartyBrands.set([...KNOWN_THIRD_PARTY_BRANDS]);
    await TestBed.configureTestingModule({
      imports: [PaintBrandBadgeComponent],
      providers: [
        {
          provide: CatalogService,
          useValue: {
            thirdPartyBrands,
          },
        },
      ],
    }).compileComponents();
  });

  it('renders Citadel Colour gold badge by default', () => {
    const fixture = TestBed.createComponent(PaintBrandBadgeComponent);
    fixture.componentRef.setInput('paint', { range: CitadelPaintRange.WarhammerColour });
    fixture.detectChanges();

    expectBadge(fixture, {
      label: 'Citadel Colour',
      variant: 'gold',
      brand: 'Citadel Colour',
      knownBrand: true,
    });
  });

  it('renders Citadel Tone Pro badge for warhammer_pro range or CitadelTonePro brand', () => {
    const fixture = TestBed.createComponent(PaintBrandBadgeComponent);
    fixture.componentRef.setInput('paint', { range: CitadelPaintRange.WarhammerPro });
    fixture.detectChanges();

    expectBadge(fixture, {
      label: 'Citadel Tone Pro',
      variant: 'pro',
      brand: 'Citadel Tone Pro',
      knownBrand: true,
    });

    fixture.componentRef.setInput('paint', null);
    fixture.componentRef.setInput('brand', PaintBrand.CitadelTonePro);
    fixture.detectChanges();

    expectBadge(fixture, {
      label: 'Citadel Tone Pro',
      variant: 'pro',
      brand: 'Citadel Tone Pro',
      knownBrand: true,
    });
  });

  it('supports optional suffix for guide badges', () => {
    const fixture = TestBed.createComponent(PaintBrandBadgeComponent);
    fixture.componentRef.setInput('paint', { range: CitadelPaintRange.WarhammerColour });
    fixture.componentRef.setInput('suffix', 'Guide');
    fixture.detectChanges();

    expectBadge(fixture, {
      label: 'Citadel Colour Guide',
      variant: 'gold',
      brand: 'Citadel Colour',
      knownBrand: true,
    });

    fixture.componentRef.setInput('paint', { range: CitadelPaintRange.WarhammerPro });
    fixture.detectChanges();

    expectBadge(fixture, {
      label: 'Citadel Tone Pro Guide',
      variant: 'pro',
      brand: 'Citadel Tone Pro',
      knownBrand: true,
    });
  });

  it('renders known hard-coded PaintBrand 3rd-party brands with and without range', () => {
    const fixture = TestBed.createComponent(PaintBrandBadgeComponent);
    fixture.componentRef.setInput('paint', {
      brand: PaintBrand.TheArmyPainter,
      range: 'Warpaints Fanatic',
    });
    fixture.detectChanges();

    expectBadge(fixture, {
      label: 'The Army Painter — Warpaints Fanatic',
      variant: 'sub',
      brand: 'The Army Painter',
      knownBrand: true,
    });

    fixture.componentRef.setInput('paint', {
      brand: PaintBrand.Vallejo,
      range: 'Game Color',
    });
    fixture.componentRef.setInput('showRange', false);
    fixture.detectChanges();

    expectBadge(fixture, {
      label: 'Vallejo',
      variant: 'sub',
      brand: 'Vallejo',
      knownBrand: true,
    });
  });

  it('renders newly added brands from Firestore catalog with catalog casing and marks data-known-brand="false"', () => {
    thirdPartyBrands.set([...KNOWN_THIRD_PARTY_BRANDS, 'Scale75', 'Kimera Kolors']);

    const fixture = TestBed.createComponent(PaintBrandBadgeComponent);
    fixture.componentRef.setInput('paint', {
      brand: 'scale75',
      range: 'Scalecolor',
    });
    fixture.detectChanges();

    expectBadge(fixture, {
      label: 'Scale75 — Scalecolor',
      variant: 'sub',
      brand: 'Scale75',
      knownBrand: false,
    });

    fixture.componentRef.setInput('paint', {
      brand: 'Kimera Kolors',
      range: 'Pure Pigments',
    });
    fixture.detectChanges();

    expectBadge(fixture, {
      label: 'Kimera Kolors — Pure Pigments',
      variant: 'sub',
      brand: 'Kimera Kolors',
      knownBrand: false,
    });
  });
});
