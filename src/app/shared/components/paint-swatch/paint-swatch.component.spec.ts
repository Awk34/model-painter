import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PaintSwatchComponent } from './paint-swatch.component';

function getPixelRgba(
  data: ImageData,
  x: number,
  y: number
): [number, number, number, number] {
  const idx = (y * data.width + x) * 4;
  return [data.data[idx], data.data[idx + 1], data.data[idx + 2], data.data[idx + 3]];
}

function getRgbLuminance([r, g, b]: [number, number, number, number]): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function rasterizeSwatch(
  fixture: ComponentFixture<PaintSwatchComponent>,
  scale = 2
): Promise<ImageData> {
  const el = fixture.nativeElement.querySelector('.paint-swatch') as HTMLElement;
  const cs = getComputedStyle(el);
  const w = parseFloat(cs.width);
  const h = parseFloat(cs.height);
  // Render inside a clean viewport without outer drop-shadow bleed so corner alpha tests edge clipping cleanly.
  const insetShadowsOnly = cs.boxShadow
    .split(/,(?![^(]*\))/)
    .map((s) => s.trim())
    .filter((s) => s.includes('inset'))
    .join(', ');
  const styleAttr = [
    `display:inline-block`,
    `width:${w}px`,
    `height:${h}px`,
    `border-radius:${cs.borderRadius}`,
    `border:${cs.border}`,
    `overflow:${cs.overflow}`,
    `background:${el.style.background || cs.background}`,
    `box-shadow:${insetShadowsOnly || 'none'}`,
  ]
    .join(';')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;">` +
    `<span style="${styleAttr}"></span>` +
    `</div></foreignObject></svg>`;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d')!;

  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve();
    };
    img.onerror = (err) => reject(err);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

describe('PaintSwatchComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaintSwatchComponent],
    }).compileComponents();
  });

  it('renders metallic class and sheen gradient for metallic paints', () => {
    const fixture = TestBed.createComponent(PaintSwatchComponent);
    fixture.componentRef.setInput('paint', {
      potStyle: 'metallic',
      category: 'base',
      gradientStartHex: '#FFFFFF',
      gradientMiddleHex: '#EBB854',
      gradientEndHex: '#89571D',
    });
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.paint-swatch') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.classList.contains('metallic')).toBeTrue();
    expect(el.classList.contains('shade')).toBeFalse();
    const bg = el.style.background || el.style.backgroundImage;
    expect(bg).toContain('linear-gradient');
    expect(bg).toContain('235, 184, 84'); // #EBB854
  });

  it('renders shade class and strong pooling gradient for shade paints', () => {
    const fixture = TestBed.createComponent(PaintSwatchComponent);
    fixture.componentRef.setInput('paint', {
      potStyle: 'shade',
      category: 'shade',
      gradientStartHex: '#FFD5B7',
      gradientMiddleHex: '#AC491D',
      gradientEndHex: '#311908',
    });
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.paint-swatch') as HTMLElement;
    expect(el).toBeTruthy();
    expect(el.classList.contains('shade')).toBeTrue();
    expect(el.classList.contains('metallic')).toBeFalse();
    const bg = el.style.background || el.style.backgroundImage;
    expect(bg).toContain('linear-gradient');
    expect(bg).toContain('172, 73, 29'); // #AC491D
  });

  it('supports fallback hex input and mini/large size variants', () => {
    const fixture = TestBed.createComponent(PaintSwatchComponent);
    fixture.componentRef.setInput('paint', undefined);
    fixture.componentRef.setInput('hex', '#960C09');
    fixture.componentRef.setInput('size', 'mini');
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.paint-swatch') as HTMLElement;
    expect(el.classList.contains('mini')).toBeTrue();
    expect(el.classList.contains('mini-swatch')).toBeTrue();
    expect(el.classList.contains('large')).toBeFalse();
    expect(el.style.background).toContain('rgb(150, 12, 9)');

    fixture.componentRef.setInput('size', 'large');
    fixture.detectChanges();
    expect(el.classList.contains('large')).toBeTrue();
    expect(el.classList.contains('mini')).toBeFalse();
  });

  it('rasterizes smoothly round circular edges with transparent outer corners and no border-tiling artifacts', async () => {
    const retributorArmour = {
      potStyle: 'metallic',
      category: 'base',
      gradientStartHex: '#FFFFFF',
      gradientMiddleHex: '#EBB854',
      gradientEndHex: '#89571D',
    };
    const nulnOil = {
      potStyle: 'shade',
      category: 'shade',
      gradientStartHex: '#DFD9D6',
      gradientMiddleHex: '#5D5A58',
      gradientEndHex: '#101010',
    };

    for (const paint of [retributorArmour, nulnOil]) {
      const fixture = TestBed.createComponent(PaintSwatchComponent);
      fixture.componentRef.setInput('paint', paint);
      fixture.detectChanges();

      const img = await rasterizeSwatch(fixture, 2);
      expect(img.width).toBe(68);
      expect(img.height).toBe(68);

      // Corners outside the 34px circle must remain completely transparent.
      for (const [x, y] of [
        [2, 2],
        [65, 2],
        [2, 65],
        [65, 65],
      ]) {
        expect(getPixelRgba(img, x, y)[3]).withContext(`corner (${x},${y}) alpha`).toBe(0);
      }

      // Center and inner cardinal edge pixels inside the circle must be fully opaque.
      for (const [x, y] of [
        [34, 34],
        [34, 6],
        [34, 61],
        [6, 34],
        [61, 34],
      ]) {
        expect(getPixelRgba(img, x, y)[3]).withContext(`inner (${x},${y}) alpha`).toBe(255);
      }

      // Inner top-left rim must remain brighter than center and bottom-right darker (no border wraparound).
      const topLeftLum = getRgbLuminance(getPixelRgba(img, 14, 14));
      const centerLum = getRgbLuminance(getPixelRgba(img, 34, 34));
      const bottomRightLum = getRgbLuminance(getPixelRgba(img, 54, 54));
      expect(topLeftLum).toBeGreaterThan(centerLum);
      expect(centerLum).toBeGreaterThan(bottomRightLum);
    }
  });

  it('rasterizes distinct diagonal pixel luminance profiles for flat, metallic, and shade swatches', async () => {
    const mephistonFixture = TestBed.createComponent(PaintSwatchComponent);
    mephistonFixture.componentRef.setInput('paint', {
      potStyle: 'flat',
      category: 'base',
      gradientStartHex: '#960C09',
    });
    mephistonFixture.detectChanges();
    const flatImg = await rasterizeSwatch(mephistonFixture, 2);
    const flatCenter = getPixelRgba(flatImg, 34, 34);
    expect(flatCenter[0]).toBeGreaterThan(120);
    expect(flatCenter[1]).toBeLessThan(30);

    const metallicFixture = TestBed.createComponent(PaintSwatchComponent);
    metallicFixture.componentRef.setInput('paint', {
      potStyle: 'metallic',
      category: 'base',
      gradientStartHex: '#FFFFFF',
      gradientMiddleHex: '#EBB854',
      gradientEndHex: '#89571D',
    });
    metallicFixture.detectChanges();
    const metallicImg = await rasterizeSwatch(metallicFixture, 2);
    const metHighlightLum = getRgbLuminance(getPixelRgba(metallicImg, 20, 20));
    const metBodyLum = getRgbLuminance(getPixelRgba(metallicImg, 34, 34));
    const metShadowLum = getRgbLuminance(getPixelRgba(metallicImg, 52, 52));
    expect(metHighlightLum).toBeGreaterThan(metBodyLum);
    expect(metBodyLum).toBeGreaterThan(metShadowLum);

    const shadeFixture = TestBed.createComponent(PaintSwatchComponent);
    shadeFixture.componentRef.setInput('paint', {
      potStyle: 'shade',
      category: 'shade',
      gradientStartHex: '#FFD5B7',
      gradientMiddleHex: '#AC491D',
      gradientEndHex: '#311908',
    });
    shadeFixture.detectChanges();
    const shadeImg = await rasterizeSwatch(shadeFixture, 2);
    const shadeTintLum = getRgbLuminance(getPixelRgba(shadeImg, 16, 16));
    const shadeMidLum = getRgbLuminance(getPixelRgba(shadeImg, 30, 30));
    const shadeDeepLum = getRgbLuminance(getPixelRgba(shadeImg, 52, 52));
    expect(shadeTintLum).toBeGreaterThan(shadeMidLum);
    expect(shadeMidLum).toBeGreaterThan(shadeDeepLum);
    expect(shadeTintLum - shadeDeepLum).toBeGreaterThan(90);
  });
});

