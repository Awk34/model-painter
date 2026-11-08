import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class PaintModalService {
  readonly activePaintId = signal<string | null>(null);

  openPaint(paintId: string): void {
    if (!paintId) return;
    this.activePaintId.set(paintId);
  }

  close(): void {
    this.activePaintId.set(null);
  }
}
