import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
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
import { isEditableElement } from '../../core/utils/clipboard-image.util';
import { AddToProjectModalComponent } from '../../shared/components/add-to-project-modal/add-to-project-modal.component';
import { AppModalDialogComponent } from '../../shared/components/modal-dialog/modal-dialog.component';
import { PaintBrandBadgeComponent } from '../../shared/components/paint-brand-badge/paint-brand-badge.component';
import { PaintSwatchComponent } from '../../shared/components/paint-swatch/paint-swatch.component';
import { StageReadinessBarsComponent } from '../../shared/components/stage-readiness-bars/stage-readiness-bars.component';
import { UserPhotoGalleryComponent } from '../../shared/components/user-photo-gallery/user-photo-gallery.component';
import {
  ModelPaintingStepsComponent,
  ModelStageFilter,
} from './components/model-painting-steps.component';
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
    RouterModule,
    UserPhotoGalleryComponent,
    StageReadinessBarsComponent,
    ModelPaintingStepsComponent,
    AddToProjectModalComponent,
    AppModalDialogComponent,
    PaintBrandBadgeComponent,
    PaintSwatchComponent,
    ProjectModelWorkspaceBarComponent,
    ProjectModelFeaturedImageModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './model-detail.component.ng.html',
  styleUrl: './model-detail.component.css',
  host: {
    '(document:keydown)': 'onZoomModalKeyDown($event)',
  },
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

  /** Route params: standalone `/models/:id` OR project-scoped `/projects/:projectId/models/:entryId` */
  readonly standaloneModelId = signal<string | null>(null);
  readonly projectId = signal<string | null>(null);
  readonly entryId = signal<string | null>(null);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly recipe = signal<ModelRecipe | null>(null);
  readonly selectedImageIndex = signal(0);
  readonly viewingCustomFeatured = signal(false);
  readonly selectedUserPhotoId = signal<string | null>(null);
  readonly showPins = signal(true);
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
  readonly isPanning = signal(false);

  private dragStartX = 0;
  private dragStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  private activePointerId: number | null = null;
  private lastLoadedRecipeId: string | null = null;
  private lastFeaturedSignature: string | null = null;
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
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const pid = params.get('projectId');
      const eid = params.get('entryId');
      const standaloneId = params.get('id');

      this.projectId.set(pid);
      this.entryId.set(eid);
      this.standaloneModelId.set(pid && eid ? null : standaloneId);
      this.loadError.set(null);
      this.zoomModalOpen.set(false);
      this.showFeaturedImageModal.set(false);
      this.selectedUserPhotoId.set(null);
      this.isPanning.set(false);
      this.activePointerId = null;
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
      this.router.navigate(['/projects', p.id, 'models', copy.id]);
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
      this.router.navigate(['/projects', p.id]);
    }
  }

  onStageBarClick(key: FinishStageKey): void {
    const target = STAGE_KEY_TO_FILTER[key];
    this.stageFilter.set(this.stageFilter() === target ? 'all' : target);
  }

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
    this.isPanning.set(false);
    this.showZoomPins.set(false);
    this.activePointerId = null;
    this.zoomModalOpen.set(true);
  }

  toggleZoomPins(): void {
    this.showZoomPins.set(!this.showZoomPins());
  }

  closeZoomModal(): void {
    if (this.zoomModalOpen()) {
      this.zoomModalOpen.set(false);
      this.isPanning.set(false);
      this.activePointerId = null;
    }
  }

  setZoomScale(scale: number): void {
    const clamped = Math.round(Math.min(4, Math.max(1, scale)) * 100) / 100;
    this.zoomScale.set(clamped);
    if (clamped <= 1) {
      this.resetPan();
    }
  }

  zoomIn(): void {
    this.setZoomScale(this.zoomScale() + 0.5);
  }

  zoomOut(): void {
    this.setZoomScale(this.zoomScale() - 0.5);
  }

  resetZoom(): void {
    this.zoomScale.set(1);
    this.resetPan();
  }

  panBy(dx: number, dy: number): void {
    if (this.zoomScale() <= 1) {
      return;
    }
    this.panX.update((v) => v + dx);
    this.panY.update((v) => v + dy);
  }

  onZoomModalKeyDown(event: KeyboardEvent): void {
    if (!this.zoomModalOpen() || isEditableElement(event.target)) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const step = event.shiftKey ? 80 : 32;
    switch (event.key) {
      case '+':
      case '=':
        event.preventDefault();
        this.zoomIn();
        break;
      case '-':
      case '_':
        event.preventDefault();
        this.zoomOut();
        break;
      case '0':
        event.preventDefault();
        this.resetZoom();
        break;
      case 'ArrowLeft':
        if (this.zoomScale() > 1) {
          event.preventDefault();
          this.panBy(step, 0);
        }
        break;
      case 'ArrowRight':
        if (this.zoomScale() > 1) {
          event.preventDefault();
          this.panBy(-step, 0);
        }
        break;
      case 'ArrowUp':
        if (this.zoomScale() > 1) {
          event.preventDefault();
          this.panBy(0, step);
        }
        break;
      case 'ArrowDown':
        if (this.zoomScale() > 1) {
          event.preventDefault();
          this.panBy(0, -step);
        }
        break;
    }
  }

  toggleQuickZoom(): void {
    if (this.zoomScale() > 1) {
      this.resetZoom();
    } else {
      this.setZoomScale(2.5);
    }
  }

  onZoomWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.25 : -0.25;
    this.setZoomScale(this.zoomScale() + delta);
  }

  onPanStart(event: PointerEvent): void {
    const stageEl = event.currentTarget as HTMLElement | null;
    stageEl?.focus?.({ preventScroll: true });
    if (this.zoomScale() <= 1 || event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.isPanning.set(true);
    this.activePointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.panOriginX = this.panX();
    this.panOriginY = this.panY();
    stageEl?.setPointerCapture?.(event.pointerId);
  }

  onPanMove(event: PointerEvent): void {
    if (!this.isPanning() || this.activePointerId !== event.pointerId) {
      return;
    }
    this.panX.set(this.panOriginX + (event.clientX - this.dragStartX));
    this.panY.set(this.panOriginY + (event.clientY - this.dragStartY));
  }

  onPanEnd(event: PointerEvent): void {
    if (this.activePointerId !== event.pointerId) {
      return;
    }
    const target = event.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    this.isPanning.set(false);
    this.activePointerId = null;
  }
}
