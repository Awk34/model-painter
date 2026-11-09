import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, RouterOutlet } from '@angular/router';
import { CatalogService } from './core/services/catalog.service';
import { UserStateService } from './core/services/user-state.service';
import { CatalogSyncStatus } from './core/models/warhammer.models';
import { PaintDetailModalComponent } from './shared/components/paint-detail-modal/paint-detail-modal.component';

@Component({
  selector: 'app-root',
  imports: [CommonModule, RouterOutlet, RouterModule, PaintDetailModalComponent],
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
  private readonly router = inject(Router);
  private readonly avatarFailed = signal(false);

  readonly avatarUrl = computed(() => {
    const user = this.userState.currentUser();
    if (this.avatarFailed() || !user?.photoURL) {
      return '/icons/ic_profile.svg';
    }
    return user.photoURL;
  });

  onAvatarError(): void {
    this.avatarFailed.set(true);
  }

  onKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.router.navigate(['/search']);
    }
  }
}
