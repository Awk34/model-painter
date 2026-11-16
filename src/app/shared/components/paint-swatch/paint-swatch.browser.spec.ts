import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { PaintSwatchLike } from '../../../core/utils/catalog-filter.util';
import { PaintSwatchComponent, PaintSwatchSize } from './paint-swatch.component';

interface ShowcaseEntry {
  name: string;
  subtitle: string;
  paint: PaintSwatchLike;
  size?: PaintSwatchSize;
}

const FLAT_BASE_PAINTS: ShowcaseEntry[] = [
  {
    name: 'Rakarth Flesh',
    subtitle: 'base',
    paint: { potStyle: 'flat', category: 'base', gradientStartHex: '#9C998D' },
  },
  {
    name: 'Mephiston Red',
    subtitle: 'base',
    paint: { potStyle: 'flat', category: 'base', gradientStartHex: '#960C09' },
  },
  {
    name: 'Abaddon Black',
    subtitle: 'base',
    paint: { potStyle: 'flat', category: 'base', gradientStartHex: '#000000' },
  },
];

const METALLIC_PAINTS: ShowcaseEntry[] = [
  {
    name: 'Retributor Armour',
    subtitle: 'base',
    paint: {
      potStyle: 'metallic',
      category: 'base',
      gradientStartHex: '#FFFFFF',
      gradientMiddleHex: '#EBB854',
      gradientEndHex: '#89571D',
    },
  },
  {
    name: 'Leadbelcher',
    subtitle: 'base',
    paint: {
      potStyle: 'metallic',
      category: 'base',
      gradientStartHex: '#F0F0F0',
      gradientMiddleHex: '#8A8A8A',
      gradientEndHex: '#151E24',
    },
  },
  {
    name: 'Stormhost Silver',
    subtitle: 'layer',
    paint: {
      potStyle: 'metallic',
      category: 'layer',
      gradientStartHex: '#FAFAFA',
      gradientMiddleHex: '#D6D9DB',
      gradientEndHex: '#9DA3A7',
    },
  },
  {
    name: 'Canoptek Alloy',
    subtitle: 'layer',
    paint: {
      potStyle: 'metallic',
      category: 'layer',
      gradientStartHex: '#F5EDE3',
      gradientMiddleHex: '#FBF8F8',
      gradientEndHex: '#B09791',
    },
  },
];

const SHADE_PAINTS: ShowcaseEntry[] = [
  {
    name: 'Reikland Fleshshade',
    subtitle: 'shade',
    paint: {
      potStyle: 'shade',
      category: 'shade',
      gradientStartHex: '#FFD5B7',
      gradientMiddleHex: '#AC491D',
      gradientEndHex: '#311908',
    },
  },
  {
    name: 'Nuln Oil',
    subtitle: 'shade',
    paint: {
      potStyle: 'shade',
      category: 'shade',
      gradientStartHex: '#DFD9D6',
      gradientMiddleHex: '#5D5A58',
      gradientEndHex: '#101010',
    },
  },
  {
    name: 'Agrax Earthshade',
    subtitle: 'shade',
    paint: {
      potStyle: 'shade',
      category: 'shade',
      gradientStartHex: '#E2DAC8',
      gradientMiddleHex: '#725839',
      gradientEndHex: '#2D190C',
    },
  },
];

const SIZE_VARIANTS: ShowcaseEntry[] = [
  {
    name: 'Retributor (mini)',
    subtitle: '22×22',
    paint: METALLIC_PAINTS[0].paint,
    size: 'mini',
  },
  {
    name: 'Retributor (md)',
    subtitle: '34×34',
    paint: METALLIC_PAINTS[0].paint,
    size: 'md',
  },
  {
    name: 'Retributor (large)',
    subtitle: '52×52',
    paint: METALLIC_PAINTS[0].paint,
    size: 'large',
  },
];

describe('PaintSwatchComponent visual regression', () => {
  const fixtures: ComponentFixture<PaintSwatchComponent>[] = [];
  let board: HTMLDivElement | null = null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaintSwatchComponent],
    }).compileComponents();
  });

  afterEach(() => {
    for (const fixture of fixtures) {
      fixture.destroy();
    }
    fixtures.length = 0;
    board?.remove();
    board = null;
  });

  it('renders smooth round swatches across flat, metallic, shade, and size variants', async () => {
    await page.viewport(920, 520);

    board = document.createElement('div');
    board.style.cssText = [
      'width: 872px',
      'background: #121419',
      'color: #f3f4f6',
      'font-family: system-ui, -apple-system, sans-serif',
      'padding: 20px 24px',
      'display: flex',
      'flex-direction: column',
      'gap: 14px',
      'border-radius: 12px',
    ].join(';');

    const sections: { title: string; entries: ShowcaseEntry[] }[] = [
      { title: 'Flat Base Paints', entries: FLAT_BASE_PAINTS },
      { title: 'Metallic Paints', entries: METALLIC_PAINTS },
      { title: 'Shade Washes', entries: SHADE_PAINTS },
      { title: 'Size Variants (mini / md / large)', entries: SIZE_VARIANTS },
    ];

    for (const section of sections) {
      const sectionEl = document.createElement('section');
      sectionEl.style.cssText = [
        'background: #161920',
        'border: 1px solid rgba(255, 255, 255, 0.08)',
        'border-radius: 10px',
        'padding: 12px 16px',
        'display: flex',
        'flex-direction: column',
        'gap: 10px',
      ].join(';');

      const heading = document.createElement('h3');
      heading.textContent = section.title;
      heading.style.cssText = [
        'margin: 0',
        'font-size: 11px',
        'text-transform: uppercase',
        'letter-spacing: 0.08em',
        'color: #9ca3af',
        'font-weight: 700',
      ].join(';');
      sectionEl.appendChild(heading);

      const grid = document.createElement('div');
      grid.style.cssText = [
        'display: flex',
        'flex-wrap: wrap',
        'align-items: center',
        'gap: 18px',
      ].join(';');

      for (const entry of section.entries) {
        const card = document.createElement('div');
        card.style.cssText = [
          'display: flex',
          'align-items: center',
          'gap: 10px',
          'min-width: 185px',
        ].join(';');

        const fixture = TestBed.createComponent(PaintSwatchComponent);
        fixture.componentRef.setInput('paint', entry.paint);
        if (entry.size) {
          fixture.componentRef.setInput('size', entry.size);
        }
        fixture.detectChanges();
        fixtures.push(fixture);

        card.appendChild(fixture.nativeElement);

        const meta = document.createElement('div');
        const nameEl = document.createElement('div');
        nameEl.textContent = entry.name;
        nameEl.style.cssText = 'font-size: 13px; font-weight: 600; color: #f3f4f6; line-height: 1.25;';
        const subEl = document.createElement('div');
        subEl.textContent = entry.subtitle;
        subEl.style.cssText = 'font-size: 11px; color: #9ca3af; line-height: 1.25;';
        meta.append(nameEl, subEl);
        card.appendChild(meta);

        grid.appendChild(card);
      }

      sectionEl.appendChild(grid);
      board.appendChild(sectionEl);
    }

    document.body.appendChild(board);

    expect(board.querySelectorAll('.paint-swatch.metallic').length).toBe(7);
    expect(board.querySelectorAll('.paint-swatch.shade').length).toBe(3);

    await expect.element(page.elementLocator(board)).toMatchScreenshot('paint-swatch-matrix');
  });
});
