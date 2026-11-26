import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterModule, RouterOutlet } from '@angular/router';
import { CatalogSyncStatus } from './core/models/catalog.models';
import { CatalogService } from './core/services/catalog.service';
import { ToastService } from './core/services/toast.service';
import { UserStateService } from './core/services/user-state.service';
import { AppIconComponent } from './shared/components/app-icon/app-icon.component';
import { PaintDetailModalComponent } from './shared/components/paint-detail-modal/paint-detail-modal.component';

@Component({
  selector: 'app-root',
  imports: [DecimalPipe, RouterOutlet, RouterModule, PaintDetailModalComponent, AppIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.ng.html',
  host: {
    '(window:keydown)': 'onKeyDown($event)',
  },
  styleUrl: './app.component.css',
})
export class AppComponent {
  readonly CatalogSyncStatus = CatalogSyncStatus;
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly avatarFailed = signal(false);
  private readonly toastPopover = viewChild<ElementRef<HTMLElement>>('toastPopover');
  private lastFocusBeforeToast: HTMLElement | null = null;

  readonly avatarUrl = computed(() => {
    const user = this.userState.currentUser();
    if (this.avatarFailed() || !user?.photoURL) {
      return null;
    }
    return user.photoURL;
  });

  constructor() {
    effect(() => {
      this.userState.currentUser()?.photoURL;
      this.avatarFailed.set(false);
    });

    effect(() => {
      const active = this.toast.current();
      const el = this.toastPopover()?.nativeElement;
      if (!el || !el.isConnected || typeof el.showPopover !== 'function') {
        return;
      }
      try {
        if (active) {
          if (!el.matches(':popover-open')) {
            const activeEl = document.activeElement;
            this.lastFocusBeforeToast =
              activeEl instanceof HTMLElement && !el.contains(activeEl) ? activeEl : null;
            el.showPopover();
          }
          if (
            (el.matches(':hover') || el.matches(':focus-within')) &&
            !untracked(() => this.toast.isPaused())
          ) {
            this.toast.pause();
          }
        } else if (el.matches(':popover-open')) {
          el.hidePopover();
        }
      } catch {
        // Graceful no-op in disconnected TestBed or unsupported environments
      }
    });
  }

  onAvatarError(): void {
    this.avatarFailed.set(true);
  }

  onToastMouseEnter(): void {
    this.toast.pause();
  }

  onToastMouseLeave(): void {
    const el = this.toastPopover()?.nativeElement;
    if (!el?.matches(':focus-within')) {
      this.toast.resume();
    }
  }

  onToastFocusIn(): void {
    this.toast.pause();
  }

  onToastFocusOut(event: FocusEvent): void {
    const el = this.toastPopover()?.nativeElement;
    const next = event.relatedTarget;
    if ((!el || !(next instanceof Node) || !el.contains(next)) && !el?.matches(':hover')) {
      this.toast.resume();
    }
  }

  dismissToast(): void {
    const el = this.toastPopover()?.nativeElement;
    const activeEl = document.activeElement;
    const focusWasInside = Boolean(el && activeEl instanceof Node && el.contains(activeEl));
    const returnTarget = this.lastFocusBeforeToast;
    this.lastFocusBeforeToast = null;

    this.toast.dismiss();

    if (focusWasInside && returnTarget?.isConnected) {
      returnTarget.focus();
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.router.navigate(['/search']);
    }
  }
}
