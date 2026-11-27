import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { USER_LIMITS, formatBytes } from '../../../core/config/user-limits.config';
import { UserStateService } from '../../../core/services/user-state.service';

@Component({
  selector: 'app-account-quotas-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-quotas-card.component.ng.html',
  styleUrl: './account-card.shared.css',
})
export class AccountQuotasCardComponent {
  readonly userState = inject(UserStateService);
  readonly maxPhotoSizeLabel = `${USER_LIMITS.MAX_PHOTO_FILE_SIZE_MB} MB`;

  readonly showcasePhotoCount = computed(
    () => this.userState.allUploadedPhotos().filter((p) => p.kind === 'showcase').length
  );

  readonly referencePhotoCount = computed(
    () => this.userState.allUploadedPhotos().filter((p) => p.kind === 'reference').length
  );

  readonly totalUploadedBytesLabel = computed(() => {
    const total = this.userState.allUploadedPhotos().reduce((acc, p) => acc + p.sizeBytes, 0);
    return formatBytes(total);
  });
}
