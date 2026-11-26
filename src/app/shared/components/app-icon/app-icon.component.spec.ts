import { TestBed } from '@angular/core/testing';
import { AppIconComponent } from './app-icon.component';

describe('AppIconComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppIconComponent],
    }).compileComponents();
  });

  it('renders decorative inline SVG with fill="currentColor" and aria-hidden="true"', () => {
    const fixture = TestBed.createComponent(AppIconComponent);
    fixture.componentRef.setInput('name', 'models');
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg') as SVGElement | null;
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 960 960');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
    expect(svg?.getAttribute('aria-label')).toBeNull();
    expect(svg?.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('renders accessible role="img" and aria-label when label input is provided', () => {
    const fixture = TestBed.createComponent(AppIconComponent);
    fixture.componentRef.setInput('name', 'project');
    fixture.componentRef.setInput('label', 'Hobby projects');
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg') as SVGElement | null;
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 20 22');
    expect(svg?.getAttribute('aria-hidden')).toBeNull();
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('Hobby projects');
  });
});
