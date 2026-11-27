import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, input, model, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { USER_LIMITS, formatBytes } from '../../../core/config/user-limits.config';
import { UserPhotoTargetType, UserUploadedPhoto } from '../../../core/models/catalog.models';

@Component({
  selector: 'app-photo-card',
  imports: [DatePipe, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './photo-card.component.ng.html',
  styleUrl: './photo-card.component.css',
})
export class PhotoCardComponent {
  readonly limits = USER_LIMITS;
  readonly formatBytes = formatBytes;

  readonly photo = input.required<UserUploadedPhoto>();
  readonly photoUrl = input.required<string>();
  readonly targetType = input<UserPhotoTargetType>('model');
  readonly isReference = input<boolean>(false);
  readonly allowSetCover = input<boolean>(false);
  readonly isActiveCover = input<boolean>(false);
  readonly coverButtonLabel = input<string>('Set Cover');
  readonly activeCoverBadgeLabel = input<string>('★ Cover');
  readonly isEditingCaption = input<boolean>(false);

  readonly editingCaptionText = model<string>('');

  readonly inspect = output<void>();
  readonly startEdit = output<void>();
  readonly saveCaption = output<string>();
  readonly cancelEdit = output<void>();
  readonly toggleCover = output<void>();
  readonly deleteRequested = output<void>();

  readonly editCaptionControl = new FormControl('', { nonNullable: true });
  readonly editCaptionForm = new FormGroup({ caption: this.editCaptionControl });

  constructor() {
    effect(() => {
      const value = this.editingCaptionText();
      if (this.editCaptionControl.value !== value) {
        this.editCaptionControl.setValue(value, { emitEvent: false });
      }
    });

    this.editCaptionControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((val) => {
      this.editingCaptionText.set(val);
    });
  }

  onSaveCaption(): void {
    this.saveCaption.emit(this.editCaptionControl.value);
  }
}
