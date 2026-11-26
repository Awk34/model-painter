import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AppModalDialogComponent } from './modal-dialog.component';

@Component({
  imports: [AppModalDialogComponent],
  template: `
    <button type="button" id="opener-btn" (click)="open.set(true)">Open</button>
    <app-modal-dialog
      [open]="open()"
      [title]="title()"
      [ariaLabel]="ariaLabel()"
      [size]="size()"
      [style.--dialog-max-width]="customMaxWidth()"
      [closeOnBackdrop]="closeOnBackdrop()"
      (closed)="onClosed()"
    >
      <div class="modal-body">
        <button type="button" id="inner-btn">Inner Action</button>
      </div>
    </app-modal-dialog>
  `,
})
class TestHostComponent {
  readonly open = signal(false);
  readonly title = signal<string | null>('Test Dialog Title');
  readonly ariaLabel = signal<string | null>(null);
  readonly size = signal<'sm' | 'md' | 'lg' | 'xl'>('lg');
  readonly customMaxWidth = signal<string | null>(null);
  readonly closeOnBackdrop = signal(true);
  closedCount = 0;

  onClosed(): void {
    this.closedCount++;
    this.open.set(false);
  }
}

const flushDialogFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

describe('AppModalDialogComponent', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('opens via showModal(), sets aria-labelledby to the heading, and closes cleanly without double-emitting closed', async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const host = fixture.componentInstance;
    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog).not.toBeNull();
    expect(dialog.open).toBeFalse();

    host.open.set(true);
    fixture.detectChanges();

    expect(dialog.open).toBeTrue();
    expect(dialog.matches(':modal')).toBeTrue();

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const heading = fixture.nativeElement.querySelector(`#${labelledBy}`) as HTMLElement | null;
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent?.trim()).toBe('Test Dialog Title');

    host.open.set(false);
    fixture.detectChanges();
    await flushDialogFrame();
    fixture.detectChanges();
    expect(dialog.open).toBeFalse();
    expect(host.closedCount).toBe(0);
  });

  it('supports initial open=true render, emits closed once on native close/cancel, and closes on destroy', async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBeTrue();

    // User-initiated close via close button
    const closeBtn = fixture.nativeElement.querySelector('.close-btn') as HTMLButtonElement;
    closeBtn.click();
    await flushDialogFrame();
    fixture.detectChanges();

    expect(dialog.open).toBeFalse();
    expect(fixture.componentInstance.closedCount).toBe(1);

    // Re-open and destroy fixture to confirm DestroyRef cleans up open top-layer dialog
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    expect(dialog.open).toBeTrue();

    fixture.destroy();
    await flushDialogFrame();
    expect(dialog.open).toBeFalse();
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('restores focus to the invoker button when closed', async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();

    const opener = fixture.nativeElement.querySelector('#opener-btn') as HTMLButtonElement;
    opener.focus();
    expect(document.activeElement).toBe(opener);

    opener.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBeTrue();

    const closeBtn = fixture.nativeElement.querySelector('.close-btn') as HTMLButtonElement;
    closeBtn.click();
    await flushDialogFrame();
    fixture.detectChanges();

    expect(dialog.open).toBeFalse();
    expect(document.activeElement).toBe(opener);
  });

  it('does not dismiss on inside->outside drag release and dismisses on outside->outside click in fallback path', async () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();

    const modalComp = fixture.debugElement.query(By.directive(AppModalDialogComponent))
      .componentInstance as AppModalDialogComponent;
    // Exercise Safari fallback bounding-box logic deterministically
    (modalComp as unknown as { supportsNativeClosedBy: boolean }).supportsNativeClosedBy = false;

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    spyOn(dialog, 'getBoundingClientRect').and.returnValue(new DOMRect(100, 100, 400, 300));

    // Inside pointerdown -> outside pointerup (drag-release) must NOT close
    modalComp.onDialogPointerDown(
      new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0, clientX: 250, clientY: 250 })
    );
    modalComp.onDialogPointerUp(
      new PointerEvent('pointerup', { pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 })
    );
    await flushDialogFrame();
    fixture.detectChanges();
    expect(dialog.open).toBeTrue();
    expect(fixture.componentInstance.closedCount).toBe(0);

    // Outside pointerdown -> outside pointerup must close
    modalComp.onDialogPointerDown(
      new PointerEvent('pointerdown', { pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 })
    );
    modalComp.onDialogPointerUp(
      new PointerEvent('pointerup', { pointerType: 'mouse', button: 0, clientX: 12, clientY: 12 })
    );
    await flushDialogFrame();
    fixture.detectChanges();
    expect(dialog.open).toBeFalse();
    expect(fixture.componentInstance.closedCount).toBe(1);
  });

  it('uses ariaLabel when provided instead of aria-labelledby', () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentInstance.title.set(null);
    fixture.componentInstance.ariaLabel.set('Custom Accessible Dialog');
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.getAttribute('aria-label')).toBe('Custom Accessible Dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBeNull();
  });

  it('allows --dialog-max-width on <app-modal-dialog> to override size presets', () => {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    const fixture = TestBed.createComponent(TestHostComponent);
    const host = fixture.componentInstance;

    host.size.set('xl');
    host.customMaxWidth.set('1180px');
    host.open.set(true);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(getComputedStyle(dialog).maxWidth).toBe('1180px');

    host.size.set('sm');
    host.customMaxWidth.set('480px');
    fixture.detectChanges();
    expect(getComputedStyle(dialog).maxWidth).toBe('480px');

    host.customMaxWidth.set(null);
    fixture.detectChanges();
    expect(getComputedStyle(dialog).maxWidth).toBe('520px');
  });
});
