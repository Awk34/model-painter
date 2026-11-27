import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { formatBytes } from '../../../core/config/user-limits.config';
import { CollectionSubMode } from '../../../core/models/catalog.models';
import { UserStateService } from '../../../core/services/user-state.service';
import { AppIconComponent, AppIconName } from '../app-icon/app-icon.component';

@Component({
  selector: 'app-desk-header',
  imports: [AppIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './desk-header.component.ng.html',
  styleUrl: './desk-header.component.css',
})
export class DeskHeaderComponent {
  readonly userState = inject(UserStateService);

  readonly icon = input.required<AppIconName>();
  readonly title = input.required<string>();
  readonly subtitle = input.required<string>();

  readonly projectsClick = output<void>();
  readonly modelsClick = output<Extract<CollectionSubMode, 'inventory' | 'wishlist'>>();
  readonly paintsClick = output<Extract<CollectionSubMode, 'inventory' | 'wishlist'>>();

  readonly totalUploadedBytesLabel = computed(() => {
    const total = this.userState.allUploadedPhotos().reduce((acc, p) => acc + p.sizeBytes, 0);
    return formatBytes(total);
  });
}
