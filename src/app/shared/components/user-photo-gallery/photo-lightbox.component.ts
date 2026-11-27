import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { formatBytes } from '../../../core/config/user-limits.config';
import { UserUploadedPhoto } from '../../../core/models/catalog.models';
import { isEditableElement } from '../../../core/utils/clipboard-image.util';
import { AppModalDialogComponent } from '../modal-dialog/modal-dialog.component';

@Component({
  selector: 'app-photo-lightbox',
  imports: [AppModalDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './photo-lightbox.component.ng.html',
  styleUrl: './photo-lightbox.component.css',
})
export class PhotoLightboxComponent {
  readonly formatBytes = formatBytes;

  readonly photo = input<UserUploadedPhoto | null>(null);
  readonly photoUrl = input<string>('');
  readonly titleId = input.required<string>();
  readonly index = input<number>(0);
  readonly totalCount = input<number>(0);
  readonly isReference = input<boolean>(false);

  readonly closed = output<void>();
  readonly prev = output<void>();
  readonly next = output<void>();
  readonly deleteRequested = output<UserUploadedPhoto>();

  onLightboxKeyDown(event: KeyboardEvent): void {
    if (!this.photo() || this.totalCount() <= 1 || isEditableElement(event.target)) {
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.prev.emit();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.next.emit();
    }
  }
}
