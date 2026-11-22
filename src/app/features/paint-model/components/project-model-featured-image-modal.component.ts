import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { USER_LIMITS } from '../../../core/config/user-limits.config';
import {
  ModelRecipe,
  ProjectModelEntry,
  ProjectModelFeaturedImage,
  UserProject,
} from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { UserMediaService } from '../../../core/services/user-media.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { matchesModelSearch } from '../../../core/utils/catalog-filter.util';

export type FeaturedImagePickerTab = 'angles' | 'uploaded' | 'catalog';

@Component({
  selector: 'app-project-model-featured-image-modal',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-model-featured-image-modal.component.ng.html',
  styleUrl: './project-model-featured-image-modal.component.css',
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class ProjectModelFeaturedImageModalComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly media = inject(UserMediaService);
  readonly img = inject(ImageService);
  readonly limits = USER_LIMITS;

  readonly open = input<boolean>(false);
  readonly project = input.required<UserProject>();
  readonly entry = input.required<ProjectModelEntry>();
  readonly recipe = input<ModelRecipe | null>(null);

  readonly closed = output<void>();

  readonly activeTab = signal<FeaturedImagePickerTab>('angles');
  readonly catalogSearch = signal('');
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);

  readonly acceptAttr = USER_LIMITS.ALLOWED_IMAGE_MIME_TYPES.join(',');

  readonly officialAngles = computed(() => {
    const r = this.recipe();
    if (!r) {
      return [];
    }
    const maxLen = Math.max(r.images?.length ?? 0, r.localImagePaths?.length ?? 0);
    const items: { index: number; url: string; localPath?: string; remoteUrl?: string }[] = [];
    for (let i = 0; i < maxLen; i++) {
      const localPath = r.localImagePaths?.[i];
      const remoteUrl = r.images?.[i];
      items.push({
        index: i,
        url: this.img.resolve(localPath, remoteUrl),
        localPath,
        remoteUrl,
      });
    }
    return items;
  });

  readonly entryPhotos = computed(() => this.entry().photos ?? []);

  readonly filteredCatalogModels = computed(() => {
    const q = this.catalogSearch().trim().toLowerCase();
    const list = this.catalog.models();
    if (!q) {
      return list.slice(0, 40);
    }
    return list.filter((m) => matchesModelSearch(m, q)).slice(0, 40);
  });

  readonly currentFeatured = computed(() => this.entry().featuredImage);

  isAngleActive(index: number): boolean {
    const fi = this.currentFeatured();
    if (!fi) {
      return index === 0;
    }
    return fi.source === 'catalog_angle' && fi.imageIndex === index;
  }

  isUploadedPhotoActive(photoId: string): boolean {
    const fi = this.currentFeatured();
    return fi?.source === 'uploaded_photo' && fi.photoId === photoId;
  }

  isCatalogModelActive(modelId: string): boolean {
    const fi = this.currentFeatured();
    return fi?.source === 'catalog_model' && fi.modelId === modelId;
  }

  selectOfficialAngle(angle: { index: number; localPath?: string; remoteUrl?: string }): void {
    const next: ProjectModelFeaturedImage | undefined =
      angle.index === 0
        ? undefined
        : {
            source: 'catalog_angle',
            imageIndex: angle.index,
            localImagePath: angle.localPath,
            imageUrl: angle.remoteUrl,
          };
    this.userState.setProjectModelFeaturedImage(this.project().id, this.entry().id, next);
    this.close();
  }

  selectUploadedPhoto(photoId: string): void {
    this.userState.setProjectModelFeaturedImage(this.project().id, this.entry().id, {
      source: 'uploaded_photo',
      photoId,
    });
    this.close();
  }

  selectCatalogModel(modelId: string, localImagePath?: string, imageUrl?: string): void {
    this.userState.setProjectModelFeaturedImage(this.project().id, this.entry().id, {
      source: 'catalog_model',
      modelId,
      localImagePath,
      imageUrl,
    });
    this.close();
  }

  resetToDefault(): void {
    this.userState.setProjectModelFeaturedImage(this.project().id, this.entry().id, undefined);
    this.close();
  }

  async onQuickUploadFile(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = '';
    if (!file) {
      return;
    }
    this.uploading.set(true);
    this.uploadError.set(null);
    try {
      const result = await this.userState.uploadPhotos({
        files: [file],
        targetType: 'project_model',
        targetId: this.entry().id,
        projectId: this.project().id,
        kind: 'showcase',
      });
      if (result.errors.length > 0) {
        this.uploadError.set(result.errors[0]);
      }
      const created = result.uploaded[0];
      if (created) {
        this.userState.setProjectModelFeaturedImage(this.project().id, this.entry().id, {
          source: 'uploaded_photo',
          photoId: created.id,
        });
        this.close();
      }
    } finally {
      this.uploading.set(false);
    }
  }

  onEscape(): void {
    if (this.open()) {
      this.close();
    }
  }

  close(): void {
    this.catalogSearch.set('');
    this.uploadError.set(null);
    this.closed.emit();
  }
}
