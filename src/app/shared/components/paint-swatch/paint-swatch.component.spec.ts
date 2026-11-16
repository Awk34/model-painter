import { TestBed } from '@angular/core/testing';
import { PaintSwatchComponent } from './paint-swatch.component';

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
});

