import { TestBed } from '@angular/core/testing';
import { ThirdPartyPaint } from '../../../core/models/catalog.models';
import { PaintOverrideLinkerComponent } from './paint-override-linker.component';

describe('PaintOverrideLinkerComponent', () => {
  it('syncs reactive select control with selectedPaintId model and emits linkRequested', () => {
    const paints: ThirdPartyPaint[] = [
      {
        id: 'tp-1',
        brand: 'The Army Painter',
        range: 'Warpaints Fanatic',
        name: 'Ultramarine Blue',
        category: 'Base',
        hex: '#0D407F',
        citadelMatches: [],
      },
    ];

    TestBed.configureTestingModule({
      imports: [PaintOverrideLinkerComponent],
    });
    const fixture = TestBed.createComponent(PaintOverrideLinkerComponent);
    const comp = fixture.componentInstance;
    fixture.componentRef.setInput('paints', paints);
    fixture.detectChanges();

    const linkSpy = jasmine.createSpy('linkRequested');
    comp.linkRequested.subscribe(linkSpy);

    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '#paint-override-select'
    ) as HTMLSelectElement;
    expect(select.labels?.length).toBe(1);

    select.value = 'tp-1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(comp.selectedPaintId()).toBe('tp-1');

    const btn = (fixture.nativeElement as HTMLElement).querySelector(
      'button'
    ) as HTMLButtonElement;
    expect(btn.disabled).toBeFalse();
    btn.click();
    expect(linkSpy).toHaveBeenCalledWith('tp-1');
  });
});
