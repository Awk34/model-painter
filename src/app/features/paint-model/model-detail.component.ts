import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  FinishStageKey,
  ModelRecipe,
  ProjectModelEntry,
  UserProject,
  UserUploadedPhoto,
} from '../../core/models/catalog.models';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { ProjectImageResolverService } from '../../core/services/project-image-resolver.service';
import { UserMediaService } from '../../core/services/user-media.service';
import { UserStateService } from '../../core/services/user-state.service';
import { AddToProjectModalComponent } from '../../shared/components/add-to-project-modal/add-to-project-modal.component';
import { CollapsibleSectionComponent } from '../../shared/components/collapsible-section/collapsible-section.component';
import { PaintBrandBadgeComponent } from '../../shared/components/paint-brand-badge/paint-brand-badge.component';
import { PaintSwatchComponent } from '../../shared/components/paint-swatch/paint-swatch.component';
import { StageReadinessBarsComponent } from '../../shared/components/stage-readiness-bars/stage-readiness-bars.component';
import { UserPhotoGalleryComponent } from '../../shared/components/user-photo-gallery/user-photo-gallery.component';
import { ImageZoomLightboxComponent } from './components/image-zoom-lightbox.component';
import {
  ModelPaintingStepsComponent,
  ModelStageFilter,
} from './components/model-painting-steps.component';
import { ModelThumbnailStripComponent } from './components/model-thumbnail-strip.component';
import { ProjectModelFeaturedImageModalComponent } from './components/project-model-featured-image-modal.component';
import { ProjectModelWorkspaceBarComponent } from './components/project-model-workspace-bar.component';

const STAGE_KEY_TO_FILTER: Record<FinishStageKey, Exclude<ModelStageFilter, 'all'>> = {
  base: 'Base Finish',
  detail: 'Detail Finish',
  artificer: 'Artificer Finish',
};

const FILTER_TO_STAGE_KEY: Record<ModelStageFilter, FinishStageKey | null> = {
  all: null,
  'Base Finish': 'base',
  'Detail Finish': 'detail',
  'Artificer Finish': 'artificer',
};

@Component({
  selector: 'app-model-detail',
  imports: [
    DecimalPipe,
    RouterLink,
    CollapsibleSectionComponent,
    UserPhotoGalleryComponent,
    StageReadinessBarsComponent,
    ModelPaintingStepsComponent,
    ModelThumbnailStripComponent,
    ImageZoomLightboxComponent,
    AddToProjectModalComponent,
    PaintBrandBadgeComponent,
    PaintSwatchComponent,
    ProjectModelWorkspaceBarComponent,
    ProjectModelFeaturedImageModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './model-detail.component.ng.html',
  styleUrl: './model-detail.component.css',
})
export class ModelDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly readinessService = inject(InventoryMatchService);
  readonly img = inject(ImageService);
  readonly media = inject(UserMediaService);
  readonly projectImg = inject(ProjectImageResolverService);

  private readonly zoomLightbox = viewChild(ImageZoomLightboxComponent);
  private readonly paramMap = toSignal(this.route.paramMap);

  /** Route params: standalone `/models/:id` OR project-scoped `/projects/:projectId/models/:entryId` */
  readonly projectId = computed(() => this.paramMap()?.get('projectId') ?? null);
  readonly entryId = computed(() => this.paramMap()?.get('entryId') ?? null);
  readonly standaloneModelId = computed(() => {
    const pid = this.projectId();
    const eid = this.entryId();
    return pid && eid ? null : (this.paramMap()?.get('id') ?? null);
  });

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly recipe = signal<ModelRecipe | null>(null);
  readonly selectedImageIndex = signal(0);
  readonly viewingCustomFeatured = signal(false);
  readonly selectedUserPhotoId = signal<string | null>(null);
  readonly selectedColorPointId = signal<string | null>(null);
  readonly stageFilter = signal<ModelStageFilter>('all');
  readonly showProjectModal = signal(false);
  readonly showFeaturedImageModal = signal(false);
  readonly userPhotosExpanded = signal(true);
  readonly zoomModalOpen = signal(false);
  readonly showZoomPins = signal(false);
  readonly zoomScale = signal(2);
  readonly panX = signal(0);
  readonly panY = signal(0);

  private lastLoadedRecipeId: string | null = null;
  private lastFeaturedSignature: string | null = null;
  private lastRouteKey: string | null = null;
  private loadGeneration = 0;

  readonly isProjectMode = computed(() => Boolean(this.projectId() && this.entryId()));

  readonly project = computed<UserProject | null>(() => {
    const pid = this.projectId();
    if (!pid) {
      return null;
    }
    return this.userState.projects().find((p) => p.id === pid) ?? null;
  });

  readonly projectModelEntry = computed<ProjectModelEntry | null>(() => {
    const p = this.project();
    const eid = this.entryId();
    if (!p || !eid) {
      return null;
    }
    return p.models.find((m) => m.id === eid) ?? null;
  });

  readonly activeRecipeId = computed<string | null>(() => {
    if (this.isProjectMode()) {
      return this.projectModelEntry()?.recipeId ?? null;
    }
    return this.standaloneModelId();
  });

  readonly activeStageKey = computed<FinishStageKey | null>(
    () => FILTER_TO_STAGE_KEY[this.stageFilter()]
  );

  readonly featuredUploadedPhotoId = computed<string | undefined>(() => {
    const fi = this.projectModelEntry()?.featuredImage;
    return fi?.source === 'uploaded_photo' ? fi.photoId : undefined;
  });

  readonly hasCustomOverlayFeatured = computed<boolean>(() => {
    const fi = this.projectModelEntry()?.featuredImage;
    return Boolean(fi && (fi.source === 'uploaded_photo' || fi.source === 'catalog_model'));
  });

  readonly customFeaturedUrl = computed<string | null>(() => {
    const entry = this.projectModelEntry();
    if (!entry || !this.hasCustomOverlayFeatured()) {
      return null;
    }
    return this.projectImg.resolveProjectModelImageUrl(entry, null, this.recipe());
  });

  readonly userModelPhotos = computed<UserUploadedPhoto[]>(() => {
    const p = this.project();
    const entry = this.projectModelEntry();
    if (p && entry) {
      return [
        ...this.userState.getPhotosForTarget('project_model', entry.id, 'showcase', p.id),
        ...this.userState.getPhotosForTarget('project_model', entry.id, 'reference', p.id),
      ];
    }
    const r = this.recipe();
    if (!r) {
      return [];
    }
    return [
      ...this.userState.getPhotosForTarget('model', r.id, 'showcase'),
      ...this.userState.getPhotosForTarget('model', r.id, 'reference'),
    ];
  });

  readonly userThumbPhotos = computed<UserUploadedPhoto[]>(() => {
    const featuredId = this.hasCustomOverlayFeatured() ? this.featuredUploadedPhotoId() : undefined;
    const all = this.userModelPhotos();
    return featuredId ? all.filter((ph) => ph.id !== featuredId) : all;
  });

  readonly selectedUserPhoto = computed<UserUploadedPhoto | null>(() => {
    const id = this.selectedUserPhotoId();
    if (!id) {
      return null;
    }
    return this.userModelPhotos().find((ph) => ph.id === id) ?? null;
  });

  readonly hasThumbnailStrip = computed<boolean>(() =>
    Boolean(
      this.hasCustomOverlayFeatured() ||
        (this.recipe()?.images.length ?? 0) > 1 ||
        this.userThumbPhotos().length > 0
    )
  );

  readonly modelPhotoCount = computed(() => {
    const p = this.project();
    const entry = this.projectModelEntry();
    if (p && entry) {
      return this.userState.getTargetPhotoCount('project_model', entry.id, p.id);
    }
    const r = this.recipe();
    if (!r) {
      return 0;
    }
    return this.userState.getTargetPhotoCount('model', r.id);
  });

  readonly activeImageUrl = computed(() => {
    const userPhoto = this.selectedUserPhoto();
    if (userPhoto) {
      return this.media.resolvePhotoUrl(userPhoto);
    }
    if (this.viewingCustomFeatured()) {
      const customUrl = this.customFeaturedUrl();
      if (customUrl) {
        return customUrl;
      }
    }
    const r = this.recipe();
    if (!r) {
      return '/icons/ic_models.svg';
    }
    const idx = this.selectedImageIndex();
    return this.img.resolve(r.localImagePaths?.[idx], r.images?.[idx]);
  });

  readonly canShowColorPins = computed(() => {
    const r = this.recipe();
    return Boolean(
      r &&
        !this.viewingCustomFeatured() &&
        !this.selectedUserPhoto() &&
        this.selectedImageIndex() === 0 &&
        r.colorPoints.length
    );
  });

  readonly stagedReadiness = computed(() =>
    this.readinessService.evaluateModelRecipeStagedReadiness(this.recipe())
  );

  readonly readiness = computed(() => this.stagedReadiness().overall);

  constructor() {
    effect(() => {
      const pid = this.projectId();
      const eid = this.entryId();
      const standaloneId = this.standaloneModelId();
      const routeKey = `${pid ?? ''}|${eid ?? ''}|${standaloneId ?? ''}`;
      if (routeKey === this.lastRouteKey) {
        return;
      }
      this.lastRouteKey = routeKey;
      this.loadError.set(null);
      this.zoomModalOpen.set(false);
      this.showFeaturedImageModal.set(false);
      this.selectedUserPhotoId.set(null);
      this.lastFeaturedSignature = null;
      if (!(pid && eid)) {
        this.selectedImageIndex.set(0);
        this.viewingCustomFeatured.set(false);
      }
    });

    // Load catalog recipe whenever activeRecipeId changes
    effect(() => {
      const targetRecipeId = this.activeRecipeId();
      if (!targetRecipeId) {
        this.loadGeneration++;
        this.lastLoadedRecipeId = null;
        this.recipe.set(null);
        this.loadError.set(null);
        this.loading.set(false);
        return;
      }
      if (targetRecipeId === this.lastLoadedRecipeId) {
        return;
      }
      this.lastLoadedRecipeId = targetRecipeId;
      void this.loadRecipe(targetRecipeId);
    });

    // Sync initial/updated featured image into the hero viewer when in project-model mode
    effect(() => {
      const entry = this.projectModelEntry();
      if (!entry) {
        this.viewingCustomFeatured.set(false);
        return;
      }
      const sig = `${entry.id}:${JSON.stringify(entry.featuredImage ?? null)}`;
      if (sig === this.lastFeaturedSignature) {
        return;
      }
      this.lastFeaturedSignature = sig;

      const fi = entry.featuredImage;
      this.selectedUserPhotoId.set(null);
      if (fi?.source === 'uploaded_photo' || fi?.source === 'catalog_model') {
        this.viewingCustomFeatured.set(true);
      } else if (fi?.source === 'catalog_angle') {
        this.viewingCustomFeatured.set(false);
        this.selectedImageIndex.set(fi.imageIndex);
      } else {
        this.viewingCustomFeatured.set(false);
        this.selectedImageIndex.set(0);
      }
    });
  }

  private async loadRecipe(recipeId: string): Promise<void> {
    const reqGen = ++this.loadGeneration;
    this.loading.set(true);
    this.loadError.set(null);
    if (!this.isProjectMode()) {
      this.selectedImageIndex.set(0);
      this.viewingCustomFeatured.set(false);
      this.selectedUserPhotoId.set(null);
    }
    try {
      const data = await this.catalog.getModelRecipe(recipeId);
      if (reqGen !== this.loadGeneration || this.activeRecipeId() !== recipeId) {
        return;
      }
      this.recipe.set(data);
      this.selectedColorPointId.set(data?.colorPoints?.[0]?.id ?? null);
    } catch (err) {
      console.warn(`Failed to load model recipe ${recipeId}:`, err);
      if (reqGen === this.loadGeneration && this.activeRecipeId() === recipeId) {
        this.recipe.set(null);
        this.selectedColorPointId.set(null);
        this.loadError.set('Unable to load this model guide right now. Please try again.');
      }
    } finally {
      if (reqGen === this.loadGeneration && this.activeRecipeId() === recipeId) {
        this.loading.set(false);
      }
    }
  }

  private resetPan(): void {
    this.panX.set(0);
    this.panY.set(0);
  }

  selectCustomFeaturedView(): void {
    this.viewingCustomFeatured.set(true);
    this.selectedUserPhotoId.set(null);
    this.resetPan();
  }

  selectOfficialAngleView(index: number): void {
    this.viewingCustomFeatured.set(false);
    this.selectedUserPhotoId.set(null);
    this.selectedImageIndex.set(index);
    this.resetPan();
  }

  selectUserPhotoView(photoId: string): void {
    this.viewingCustomFeatured.set(false);
    this.selectedUserPhotoId.set(photoId);
    this.resetPan();
  }

  onSelectFeaturedUploadedPhoto(photoId: string | undefined): void {
    const p = this.project();
    const entry = this.projectModelEntry();
    if (!p || !entry) {
      return;
    }
    this.userState.setProjectModelFeaturedImage(
      p.id,
      entry.id,
      photoId ? { source: 'uploaded_photo', photoId } : undefined
    );
  }

  duplicateCurrentProjectModel(): void {
    const p = this.project();
    const entry = this.projectModelEntry();
    if (!p || !entry) {
      return;
    }
    const copy = this.userState.duplicateProjectModel(p.id, entry.id);
    if (copy) {
      void this.router.navigate(['/projects', p.id, 'models', copy.id]);
    }
  }

  removeCurrentProjectModel(): void {
    const p = this.project();
    const entry = this.projectModelEntry();
    if (!p || !entry) {
      return;
    }
    const label = entry.customName || this.recipe()?.name || 'this model';
    if (confirm(`Remove "${label}" from "${p.name}"?`)) {
      this.userState.removeModelFromProject(p.id, entry.id);
      void this.router.navigate(['/projects', p.id]);
    }
  }

  onStageBarClick(key: FinishStageKey): void {
    const target = STAGE_KEY_TO_FILTER[key];
    this.stageFilter.set(this.stageFilter() === target ? 'all' : target);
  }

  readonly formattedFactions = computed(() => {
    const r = this.recipe();
    return r ? this.formatFactions(r) : '';
  });

  formatFactions(r: ModelRecipe): string {
    const names = new Set<string>();
    for (const f of r.factions ?? []) {
      if (f.parentFactionName) {
        names.add(f.parentFactionName);
      }
      if (f.factionName) {
        names.add(f.factionName);
      }
    }
    return Array.from(names).join(' • ');
  }

  selectColorPoint(cpId: string): void {
    this.selectedColorPointId.set(cpId);
  }

  openZoomModal(): void {
    this.zoomScale.set(2);
    this.resetPan();
    this.showZoomPins.set(false);
    this.zoomModalOpen.set(true);
  }

  toggleZoomPins(): void {
    this.showZoomPins.set(!this.showZoomPins());
  }

  closeZoomModal(): void {
    if (this.zoomModalOpen()) {
      this.zoomModalOpen.set(false);
    }
  }

  zoomIn(): void {
    const next = Math.round(Math.min(4, Math.max(1, this.zoomScale() + 0.5)) * 100) / 100;
    this.zoomScale.set(next);
  }

  zoomOut(): void {
    const next = Math.round(Math.min(4, Math.max(1, this.zoomScale() - 0.5)) * 100) / 100;
    this.zoomScale.set(next);
    if (next <= 1) {
      this.resetPan();
    }
  }

  resetZoom(): void {
    this.zoomScale.set(1);
    this.resetPan();
    this.zoomLightbox()?.resetZoom();
  }
}
