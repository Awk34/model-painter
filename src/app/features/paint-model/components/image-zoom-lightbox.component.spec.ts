import { TestBed } from '@angular/core/testing';
import { ImageZoomLightboxComponent } from './image-zoom-lightbox.component';

describe('ImageZoomLightboxComponent', () => {
  it('supports keyboard zoom/pan, pointer drag-release guard, and pin toggle inside modal dialog', () => {
    TestBed.configureTestingModule({
      imports: [ImageZoomLightboxComponent],
    });

    const fixture = TestBed.createComponent(ImageZoomLightboxComponent);
    const comp = fixture.componentInstance;
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('title', 'Abaddon');
    fixture.componentRef.setInput('imageUrl', '/icons/ic_models.svg');
    fixture.componentRef.setInput('imageAlt', 'Abaddon zoomed');
    fixture.componentRef.setInput('canShowColorPins', true);
    fixture.componentRef.setInput('colorPoints', [
      { id: 'cp1', name: 'Gold', colorId: 'c1', hex: '#edb304', point: { x: 0.5, y: 0.5 } },
    ]);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const dialog = root.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBeTrue();
    const zoomImg = root.querySelector('.zoom-stage-img') as HTMLImageElement;
    expect(zoomImg.getAttribute('decoding')).toBe('async');
    expect(zoomImg.getAttribute('width')).toBe('800');
    expect(zoomImg.getAttribute('height')).toBe('800');
    expect(zoomImg.hasAttribute('loading')).toBeFalse();

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    expect(comp.zoomScale()).toBe(2.5);

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(comp.panX()).toBe(-32);

    const stage = root.querySelector('.zoom-stage') as HTMLElement;
    const releaseSpy = jasmine.createSpy('releasePointerCapture');
    stage.hasPointerCapture = () => true;
    stage.releasePointerCapture = releaseSpy;
    stage.setPointerCapture = () => {};

    comp.onPanStart({
      button: 0,
      pointerId: 7,
      clientX: 100,
      clientY: 100,
      currentTarget: stage,
      preventDefault: () => {},
    } as unknown as PointerEvent);
    expect(comp.isPanning()).toBeTrue();

    comp.onPanEnd({ pointerId: 99, currentTarget: stage } as unknown as PointerEvent);
    expect(comp.isPanning()).toBeTrue();
    expect(releaseSpy).not.toHaveBeenCalled();

    comp.onPanEnd({ pointerId: 7, currentTarget: stage } as unknown as PointerEvent);
    expect(comp.isPanning()).toBeFalse();
    expect(releaseSpy).toHaveBeenCalledWith(7);
  });
});
