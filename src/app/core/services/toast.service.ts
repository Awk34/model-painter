import { Injectable, OnDestroy, computed, signal } from '@angular/core';

export interface ToastNotification {
  readonly id: number;
  readonly message: string;
  readonly durationMs: number;
}

const DEFAULT_TOAST_DURATION_MS = 3500;
const MAX_TIMEOUT_MS = 2_147_483_647;

@Injectable({ providedIn: 'root' })
export class ToastService implements OnDestroy {
  readonly current = signal<ToastNotification | null>(null);
  readonly message = computed(() => this.current()?.message ?? null);
  readonly isPaused = signal(false);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private remainingMs = 0;
  private startedAt = 0;
  private nextId = 0;

  show(message: string, durationMs = DEFAULT_TOAST_DURATION_MS): void {
    if (!message.trim()) {
      this.dismiss();
      return;
    }

    this.clearTimer();
    const safeDuration = Number.isFinite(durationMs) ? durationMs : DEFAULT_TOAST_DURATION_MS;
    const clampedDuration = Math.min(MAX_TIMEOUT_MS, Math.max(0, safeDuration));
    const id = ++this.nextId;
    this.isPaused.set(false);
    this.remainingMs = clampedDuration;
    this.current.set({ id, message, durationMs: clampedDuration });

    if (clampedDuration > 0) {
      this.scheduleTimer(id, clampedDuration);
    }
  }

  dismiss(expectedId?: number): void {
    if (expectedId !== undefined && this.current()?.id !== expectedId) {
      return;
    }
    this.clearTimer();
    this.remainingMs = 0;
    this.isPaused.set(false);
    this.current.set(null);
  }

  pause(): void {
    const active = this.current();
    if (!active || this.isPaused() || !this.timer) {
      return;
    }
    this.clearTimer();
    const elapsed = Math.max(0, Date.now() - this.startedAt);
    this.remainingMs = Math.max(0, this.remainingMs - elapsed);
    this.isPaused.set(true);
  }

  resume(): void {
    const active = this.current();
    if (!active || !this.isPaused()) {
      return;
    }
    this.isPaused.set(false);
    if (this.remainingMs <= 0) {
      this.dismiss(active.id);
      return;
    }
    this.scheduleTimer(active.id, this.remainingMs);
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  private scheduleTimer(id: number, delayMs: number): void {
    this.clearTimer();
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.dismiss(id);
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
