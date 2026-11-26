import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

let nextDialogId = 0;

@Component({
  selector: 'app-modal-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './modal-dialog.component.ng.html',
  styleUrl: './modal-dialog.component.css',
})
export class AppModalDialogComponent {
  readonly open = input<boolean>(false);
  readonly title = input<string | null>(null);
  readonly titleId = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly ariaLabelledBy = input<string | null>(null);
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('lg');
  readonly closeLabel = input<string>('Close dialog');
  readonly closeOnBackdrop = input<boolean>(true);

  readonly closed = output<void>();

  private readonly dialogEl = viewChild<ElementRef<HTMLDialogElement>>('dialogEl');
  private readonly generatedTitleId = `app-modal-title-${nextDialogId++}`;
  private readonly supportsNativeClosedBy =
    typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
  private ignoreNextCloseEvent = false;
  private pressedOutside = false;

  readonly resolvedTitleId = computed(() => this.titleId() || this.generatedTitleId);

  readonly resolvedAriaLabelledBy = computed(() => {
    if (this.ariaLabel()) {
      return null;
    }
    const explicit = this.ariaLabelledBy();
    if (explicit) {
      return explicit;
    }
    return this.title() ? this.resolvedTitleId() : null;
  });

  constructor() {
    effect(() => {
      const isOpen = this.open();
      const el = this.dialogEl()?.nativeElement;
      if (!el || !el.isConnected) {
        return;
      }

      if (isOpen && !el.open) {
        this.ignoreNextCloseEvent = false;
        this.pressedOutside = false;
        if (typeof el.showModal === 'function') {
          try {
            el.showModal();
          } catch {
            el.setAttribute('open', '');
          }
        } else {
          el.setAttribute('open', '');
        }
      } else if (!isOpen && el.open) {
        if (typeof el.close === 'function') {
          this.ignoreNextCloseEvent = true;
          el.close();
        } else {
          el.removeAttribute('open');
        }
      }
    });

    inject(DestroyRef).onDestroy(() => {
      const el = this.dialogEl()?.nativeElement;
      if (el?.open) {
        if (typeof el.close === 'function') {
          this.ignoreNextCloseEvent = true;
          el.close();
        } else {
          el.removeAttribute('open');
        }
      }
    });
  }

  requestClose(): void {
    const el = this.dialogEl()?.nativeElement;
    if (el?.open) {
      if (typeof el.close === 'function') {
        this.ignoreNextCloseEvent = true;
        el.close();
      } else {
        el.removeAttribute('open');
      }
      el.returnValue = '';
    }
    this.pressedOutside = false;
    if (this.open()) {
      this.closed.emit();
    }
  }

  onDialogClose(): void {
    const el = this.dialogEl()?.nativeElement;
    if (el?.open) {
      return;
    }
    if (el) {
      el.returnValue = '';
    }
    this.pressedOutside = false;
    const ignored = this.ignoreNextCloseEvent;
    this.ignoreNextCloseEvent = false;
    if (!ignored && this.open()) {
      this.closed.emit();
    }
  }

  onDialogPointerDown(event: PointerEvent): void {
    if (!this.closeOnBackdrop() || this.supportsNativeClosedBy) {
      this.pressedOutside = false;
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      this.pressedOutside = false;
      return;
    }
    const el = this.dialogEl()?.nativeElement;
    this.pressedOutside = Boolean(el?.open && this.isOutsideDialog(event, el));
  }

  onDialogPointerUp(event: PointerEvent): void {
    if (!this.pressedOutside) {
      return;
    }
    this.pressedOutside = false;
    if (!this.closeOnBackdrop() || this.supportsNativeClosedBy) {
      return;
    }
    const el = this.dialogEl()?.nativeElement;
    if (el?.open && this.isOutsideDialog(event, el)) {
      this.requestClose();
    }
  }

  onDialogPointerCancel(): void {
    this.pressedOutside = false;
  }

  private isOutsideDialog(event: PointerEvent, dialog: HTMLDialogElement): boolean {
    const rect = dialog.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  }
}
