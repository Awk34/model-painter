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

const CARD_BG_RGB = { r: 31, g: 35, b: 43 }; // --bg-card #1f232b

interface RgbColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseRgbColor(raw: string): RgbColor {
  const match = raw.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
  if (!match) {
    throw new Error(`Unable to parse color: ${raw}`);
  }
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] !== undefined ? Number(match[4]) : 1,
  };
}

function compositeOver(fg: RgbColor, bg: { r: number; g: number; b: number }): { r: number; g: number; b: number } {
  const alpha = fg.a;
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

function relativeLuminance(c: { r: number; g: number; b: number }): number {
  const toLinear = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

function contrastRatio(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
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

  it('meets WCAG 2.1 AA (>= 4.5:1) computed contrast across gold, sub, and pro gradient variants', () => {
    const fixture = TestBed.createComponent(PaintBrandBadgeComponent);
    const wrapper = document.createElement('div');
    wrapper.style.background = '#1f232b';
    wrapper.appendChild(fixture.nativeElement);
    document.body.appendChild(wrapper);

    try {
      // Gold variant
      fixture.componentRef.setInput('paint', { range: CitadelPaintRange.WarhammerColour });
      fixture.detectChanges();
      const goldEl = fixture.nativeElement.querySelector('.badge-gold') as HTMLElement;
      const goldStyle = getComputedStyle(goldEl);
      const goldFg = parseRgbColor(goldStyle.color);
      const goldBg = compositeOver(parseRgbColor(goldStyle.backgroundColor), CARD_BG_RGB);
      expect(contrastRatio(goldFg, goldBg)).toBeGreaterThanOrEqual(4.5);

      // Sub variant
      fixture.componentRef.setInput('paint', { brand: PaintBrand.TheArmyPainter, range: 'Fanatic' });
      fixture.detectChanges();
      const subEl = fixture.nativeElement.querySelector('.badge-sub') as HTMLElement;
      const subStyle = getComputedStyle(subEl);
      const subFg = parseRgbColor(subStyle.color);
      const subBg = compositeOver(parseRgbColor(subStyle.backgroundColor), CARD_BG_RGB);
      expect(contrastRatio(subFg, subBg)).toBeGreaterThanOrEqual(4.5);

      // Pro gradient variant (verify every gradient color stop)
      fixture.componentRef.setInput('paint', { range: CitadelPaintRange.WarhammerPro });
      fixture.detectChanges();
      const proEl = fixture.nativeElement.querySelector('.badge-pro') as HTMLElement;
      const proStyle = getComputedStyle(proEl);
      const proFg = parseRgbColor(proStyle.color);
      const stops = (proStyle.backgroundImage || '').match(/rgba?\([^)]+\)/g) ?? [];
      expect(stops.length).toBeGreaterThanOrEqual(3);
      for (const stop of stops) {
        const stopBg = compositeOver(parseRgbColor(stop), CARD_BG_RGB);
        expect(contrastRatio(proFg, stopBg))
          .withContext(`pro contrast against stop ${stop}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    } finally {
      wrapper.remove();
    }
  });
});
