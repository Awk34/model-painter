import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, input, model, output, signal } from '@angular/core';
import { ModelColorPoint } from '../../../core/models/catalog.models';
import { isEditableElement } from '../../../core/utils/clipboard-image.util';
import { AppModalDialogComponent } from '../../../shared/components/modal-dialog/modal-dialog.component';

@Component({
  selector: 'app-image-zoom-lightbox',
  imports: [DecimalPipe, AppModalDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './image-zoom-lightbox.component.ng.html',
  styleUrl: './image-zoom-lightbox.component.css',
  host: {
    '(document:keydown)': 'onZoomModalKeyDown($event)',
  },
})
export class ImageZoomLightboxComponent {
  readonly open = input.required<boolean>();
  readonly title = input.required<string>();
  readonly imageUrl = input.required<string>();
  readonly imageAlt = input.required<string>();
  readonly colorPoints = input<ModelColorPoint[]>([]);
  readonly canShowColorPins = input<boolean>(false);
  readonly selectedColorPointId = input<string | null>(null);
  readonly hasThumbnailStrip = input<boolean>(false);

  readonly zoomScale = model<number>(2);
  readonly panX = model<number>(0);
  readonly panY = model<number>(0);
  readonly showZoomPins = model<boolean>(false);

  readonly closed = output<void>();
  readonly selectColorPoint = output<string>();

  readonly isPanning = signal(false);

  private dragStartX = 0;
  private dragStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  private activePointerId: number | null = null;

  constructor() {
    effect(() => {
      if (!this.open()) {
        this.isPanning.set(false);
        this.activePointerId = null;
      }
    });
  }

  toggleZoomPins(): void {
    this.showZoomPins.set(!this.showZoomPins());
  }

  close(): void {
    this.isPanning.set(false);
    this.activePointerId = null;
    this.closed.emit();
  }

  private resetPan(): void {
    this.panX.set(0);
    this.panY.set(0);
  }

  setZoomScale(scale: number): void {
    const clamped = Math.round(Math.min(4, Math.max(1, scale)) * 100) / 100;
    this.zoomScale.set(clamped);
    if (clamped <= 1) {
      this.resetPan();
    }
  }

  zoomIn(): void {
    this.setZoomScale(this.zoomScale() + 0.5);
  }

  zoomOut(): void {
    this.setZoomScale(this.zoomScale() - 0.5);
  }

  resetZoom(): void {
    this.zoomScale.set(1);
    this.resetPan();
  }

  panBy(dx: number, dy: number): void {
    if (this.zoomScale() <= 1) {
      return;
    }
    this.panX.update((v) => v + dx);
    this.panY.update((v) => v + dy);
  }

  onZoomModalKeyDown(event: KeyboardEvent): void {
    if (!this.open() || isEditableElement(event.target)) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const step = event.shiftKey ? 80 : 32;
    switch (event.key) {
      case '+':
      case '=':
        event.preventDefault();
        this.zoomIn();
        break;
      case '-':
      case '_':
        event.preventDefault();
        this.zoomOut();
        break;
      case '0':
        event.preventDefault();
        this.resetZoom();
        break;
      case 'ArrowLeft':
        if (this.zoomScale() > 1) {
          event.preventDefault();
          this.panBy(step, 0);
        }
        break;
      case 'ArrowRight':
        if (this.zoomScale() > 1) {
          event.preventDefault();
          this.panBy(-step, 0);
        }
        break;
      case 'ArrowUp':
        if (this.zoomScale() > 1) {
          event.preventDefault();
          this.panBy(0, step);
        }
        break;
      case 'ArrowDown':
        if (this.zoomScale() > 1) {
          event.preventDefault();
          this.panBy(0, -step);
        }
        break;
    }
  }

  toggleQuickZoom(): void {
    if (this.zoomScale() > 1) {
      this.resetZoom();
    } else {
      this.setZoomScale(2.5);
    }
  }

  onZoomWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.25 : -0.25;
    this.setZoomScale(this.zoomScale() + delta);
  }

  onPanStart(event: PointerEvent): void {
    const stageEl = event.currentTarget as HTMLElement | null;
    stageEl?.focus?.({ preventScroll: true });
    if (this.zoomScale() <= 1 || event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.isPanning.set(true);
    this.activePointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.panOriginX = this.panX();
    this.panOriginY = this.panY();
    stageEl?.setPointerCapture?.(event.pointerId);
  }

  onPanMove(event: PointerEvent): void {
    if (!this.isPanning() || this.activePointerId !== event.pointerId) {
      return;
    }
    this.panX.set(this.panOriginX + (event.clientX - this.dragStartX));
    this.panY.set(this.panOriginY + (event.clientY - this.dragStartY));
  }

  onPanEnd(event: PointerEvent): void {
    if (this.activePointerId !== event.pointerId) {
      return;
    }
    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    this.isPanning.set(false);
    this.activePointerId = null;
  }
}
