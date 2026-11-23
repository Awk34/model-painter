import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { USER_LIMITS, formatBytes } from '../../../core/config/user-limits.config';
import {
  UserPhotoKind,
  UserPhotoTargetType,
  UserUploadedPhoto,
} from '../../../core/models/catalog.models';
import { UserMediaService } from '../../../core/services/user-media.service';
import { UserStateService } from '../../../core/services/user-state.service';
import {
  extractClipboardImageFiles,
  hasOpenModalDialog,
  isEditableElement,
  readClipboardImageFiles,
} from '../../../core/utils/clipboard-image.util';

@Component({
  selector: 'app-user-photo-gallery',
  imports: [DatePipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-photo-gallery.component.ng.html',
  styleUrl: './user-photo-gallery.component.css',
  host: {
    '(document:keydown.escape)': 'closeLightbox()',
    '(document:paste)': 'onDocumentPaste($event)',
  },
})
export class UserPhotoGalleryComponent {
  readonly userState = inject(UserStateService);
  readonly media = inject(UserMediaService);
  readonly limits = USER_LIMITS;
  readonly formatBytes = formatBytes;

  readonly targetType = input.required<UserPhotoTargetType>();
  readonly targetId = input.required<string>();
  readonly projectId = input<string | undefined>(undefined);
  readonly kind = input.required<UserPhotoKind>();
  readonly heading = input<string>('');
  readonly description = input<string>('');
  readonly allowSetCover = input<boolean>(false);
  readonly activeCoverPhotoId = input<string | undefined>(undefined);
  readonly coverButtonLabel = input<string>('Set Cover');
  readonly activeCoverBadgeLabel = input<string>('★ Cover');
  readonly allowGlobalPaste = input<boolean>(false);

  readonly selectCover = output<string | undefined>();

  readonly uploading = signal(false);
  readonly dragActive = signal(false);
  readonly errorMessages = signal<string[]>([]);
  readonly captionDraft = signal('');
  readonly editingCaptionId = signal<string | null>(null);
  readonly editingCaptionText = signal('');
  readonly lightboxIndex = signal<number | null>(null);

  readonly inputId = computed(
    () => `photo-upload-${this.targetType()}-${this.kind()}-${this.targetId()}`
  );

  readonly captionInputId = computed(
    () => `photo-caption-${this.targetType()}-${this.kind()}-${this.targetId()}`
  );

  readonly acceptAttr = USER_LIMITS.ALLOWED_IMAGE_MIME_TYPES.join(',');

  readonly sectionMax = computed(() =>
    this.userState.getPhotoQuotaLimit(this.targetType(), this.kind())
  );

  readonly photos = computed(() =>
    this.userState.getPhotosForTarget(
      this.targetType(),
      this.targetId(),
      this.kind(),
      this.projectId()
    )
  );

  readonly totalAccountPhotoCount = computed(() => this.userState.allUploadedPhotos().length);

  readonly remainingInSection = computed(() =>
    Math.max(0, this.sectionMax() - this.photos().length)
  );

  readonly remainingInAccount = computed(() =>
    Math.max(0, USER_LIMITS.MAX_TOTAL_USER_PHOTOS - this.totalAccountPhotoCount())
  );

  readonly isAtLimit = computed(
    () => this.remainingInSection() <= 0 || this.remainingInAccount() <= 0
  );

  readonly isReference = computed(() => this.kind() === 'reference');

  readonly activeLightboxPhoto = computed<UserUploadedPhoto | null>(() => {
    const idx = this.lightboxIndex();
    const list = this.photos();
    if (idx === null || idx < 0 || idx >= list.length) {
      return null;
    }
    return list[idx];
  });

  async onFileInputChange(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const fileList = inputEl.files;
    if (!fileList || fileList.length === 0) {
      return;
    }
    const files = Array.from(fileList);
    inputEl.value = '';
    await this.handleFiles(files);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.isAtLimit() && !this.uploading()) {
      this.dragActive.set(true);
    }
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragActive.set(false);
    if (this.isAtLimit() || this.uploading()) {
      return;
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      await this.handleFiles(files);
    }
  }

  async onPaste(event: ClipboardEvent): Promise<void> {
    const files = extractClipboardImageFiles(event);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (this.isAtLimit() || this.uploading()) {
      return;
    }
    await this.handleFiles(files);
  }

  async onDocumentPaste(event: ClipboardEvent): Promise<void> {
    if (
      !this.allowGlobalPaste() ||
      event.defaultPrevented ||
      this.isAtLimit() ||
      this.uploading() ||
      this.lightboxIndex() !== null ||
      isEditableElement(event.target) ||
      hasOpenModalDialog()
    ) {
      return;
    }
    const files = extractClipboardImageFiles(event);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    await this.handleFiles(files);
  }

  async onPasteButtonClick(): Promise<void> {
    if (this.isAtLimit() || this.uploading()) {
      return;
    }
    this.errorMessages.set([]);
    const result = await readClipboardImageFiles();
    if (result.files.length > 0) {
      await this.handleFiles(result.files);
    } else if (result.error) {
      this.errorMessages.set([result.error]);
    }
  }

  private async handleFiles(files: File[]): Promise<void> {
    this.uploading.set(true);
    this.errorMessages.set([]);
    try {
      const result = await this.userState.uploadPhotos({
        files,
        targetType: this.targetType(),
        targetId: this.targetId(),
        projectId: this.projectId(),
        kind: this.kind(),
        caption: this.captionDraft(),
      });
      if (result.uploaded.length > 0) {
        this.captionDraft.set('');
      }
      if (result.errors.length > 0) {
        this.errorMessages.set(result.errors);
      }
    } finally {
      this.uploading.set(false);
    }
  }

  startEditCaption(photo: UserUploadedPhoto): void {
    this.editingCaptionId.set(photo.id);
    this.editingCaptionText.set(photo.caption ?? '');
  }

  cancelEditCaption(): void {
    this.editingCaptionId.set(null);
    this.editingCaptionText.set('');
  }

  saveCaption(photoId: string): void {
    this.userState.updatePhotoCaption(photoId, this.editingCaptionText());
    this.editingCaptionId.set(null);
    this.editingCaptionText.set('');
  }

  async confirmDelete(photo: UserUploadedPhoto): Promise<void> {
    const label = photo.caption || photo.fileName;
    if (confirm(`Delete photo "${label}"?`)) {
      this.closeLightbox();
      await this.userState.deleteUserPhoto(photo.id);
    }
  }

  toggleCover(photoId: string): void {
    if (this.activeCoverPhotoId() === photoId) {
      this.selectCover.emit(undefined);
    } else {
      this.selectCover.emit(photoId);
    }
  }

  openLightbox(index: number): void {
    this.lightboxIndex.set(index);
  }

  closeLightbox(): void {
    if (this.lightboxIndex() !== null) {
      this.lightboxIndex.set(null);
    }
  }

  prevPhoto(): void {
    const idx = this.lightboxIndex();
    const len = this.photos().length;
    if (idx === null || len <= 1) {
      return;
    }
    this.lightboxIndex.set((idx - 1 + len) % len);
  }

  nextPhoto(): void {
    const idx = this.lightboxIndex();
    const len = this.photos().length;
    if (idx === null || len <= 1) {
      return;
    }
    this.lightboxIndex.set((idx + 1) % len);
  }
}
