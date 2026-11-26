import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class PaintModalService {
  private readonly _activePaintId = signal<string | null>(null);
  readonly activePaintId = this._activePaintId.asReadonly();

  openPaint(paintId: string): void {
    if (!paintId) return;
    this._activePaintId.set(paintId);
  }

  close(): void {
    this._activePaintId.set(null);
  }
}
