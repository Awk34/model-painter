import { ChangeDetectionStrategy, Component, effect, input, model, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { USER_LIMITS } from '../../../core/config/user-limits.config';

@Component({
  selector: 'app-photo-upload-dropzone',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './photo-upload-dropzone.component.ng.html',
  styleUrl: './photo-upload-dropzone.component.css',
})
export class PhotoUploadDropzoneComponent {
  readonly limits = USER_LIMITS;

  readonly inputId = input.required<string>();
  readonly captionInputId = input.required<string>();
  readonly acceptAttr = input.required<string>();
  readonly isReference = input<boolean>(false);
  readonly uploading = input<boolean>(false);
  readonly isAtLimit = input<boolean>(false);
  readonly photoCount = input<number>(0);
  readonly sectionMax = input<number>(0);
  readonly remainingInSection = input<number>(0);
  readonly remainingInAccount = input<number>(0);
  readonly errorMessages = input<string[]>([]);

  readonly caption = model<string>('');
  readonly dragActive = model<boolean>(false);

  readonly filesSelected = output<File[]>();
  readonly pasteRequested = output<void>();
  readonly dismissErrors = output<void>();

  readonly captionControl = new FormControl('', { nonNullable: true });

  constructor() {
    effect(() => {
      const value = this.caption();
      if (this.captionControl.value !== value) {
        this.captionControl.setValue(value, { emitEvent: false });
      }
    });

    this.captionControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((val) => {
      this.caption.set(val);
    });
  }

  onFileInputChange(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const fileList = inputEl.files;
    if (!fileList || fileList.length === 0) {
      return;
    }
    const files = Array.from(fileList);
    inputEl.value = '';
    this.filesSelected.emit(files);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.isAtLimit() && !this.uploading()) {
      this.dragActive.set(true);
    }
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    const currentTarget = event.currentTarget as HTMLElement | null;
    const relatedTarget = event.relatedTarget;
    if (!(relatedTarget instanceof Node && currentTarget?.contains(relatedTarget))) {
      this.dragActive.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
    if (this.isAtLimit() || this.uploading()) {
      return;
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      this.filesSelected.emit(files);
    }
  }
}
