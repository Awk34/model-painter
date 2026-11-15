import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FinishStageKey, ModelRecipe } from '../../core/models/catalog.models';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { UserStateService } from '../../core/services/user-state.service';
import { AddToProjectModalComponent } from '../../shared/components/add-to-project-modal/add-to-project-modal.component';
import { StageReadinessBarsComponent } from '../../shared/components/stage-readiness-bars/stage-readiness-bars.component';
import { UserPhotoGalleryComponent } from '../../shared/components/user-photo-gallery/user-photo-gallery.component';
import {
  ModelPaintingStepsComponent,
  ModelStageFilter,
} from './components/model-painting-steps.component';

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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './model-detail.component.ng.html',
  styleUrl: './model-detail.component.css',
  host: {
    '(document:keydown.escape)': 'closeZoomModal()',
  },
})
export class ModelDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly readinessService = inject(InventoryMatchService);
  readonly img = inject(ImageService);

  readonly loading = signal(true);
  readonly recipe = signal<ModelRecipe | null>(null);
  readonly selectedImageIndex = signal(0);
  readonly showPins = signal(true);
  readonly selectedColorPointId = signal<string | null>(null);
  readonly stageFilter = signal<ModelStageFilter>('all');
  readonly showProjectModal = signal(false);
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

  readonly activeStageKey = computed<FinishStageKey | null>(
    () => FILTER_TO_STAGE_KEY[this.stageFilter()]
  );

  readonly modelPhotoCount = computed(() => {
    const r = this.recipe();
    if (!r) {
      return 0;
    }
    return this.userState.getTargetPhotoCount('model', r.id);
  });

  readonly activeImageUrl = computed(() => {
    const r = this.recipe();
    if (!r) {
      return '/icons/ic_models.svg';
    }
    const idx = this.selectedImageIndex();
    return this.img.resolve(r.localImagePaths?.[idx], r.images?.[idx]);
  });

  readonly stagedReadiness = computed(() => {
    const r = this.recipe();
    if (!r) {
      return this.readinessService.evaluateStagedReadiness({});
    }

    const baseIds: string[] = [];
    const detailIds: string[] = [];
    const artificerIds: string[] = [];
    const allIds: string[] = [];

    for (const area of r.paintingAreas ?? []) {
      for (const step of area.paintingSteps ?? []) {
        const pid = step.paint?.id;
        if (!pid) {
          continue;
        }
        allIds.push(pid);
        const stage = (step.paintingStage ?? '').toLowerCase();
        if (stage.includes('base')) {
          baseIds.push(pid);
        } else if (stage.includes('detail')) {
          detailIds.push(pid);
        } else {
          artificerIds.push(pid);
        }
      }
    }

    const summary = this.catalog.modelById().get(r.id);
    if (allIds.length === 0 && summary) {
      return this.readinessService.evaluateStagedReadiness({
        base: summary.paintsByStage?.base,
        detail: summary.paintsByStage?.detail,
        artificer: summary.paintsByStage?.artificer,
        all: summary.requiredPaintIds,
      });
    }

    return this.readinessService.evaluateStagedReadiness({
      base: baseIds.length ? baseIds : summary?.paintsByStage?.base,
      detail: detailIds.length ? detailIds : summary?.paintsByStage?.detail,
      artificer: artificerIds.length ? artificerIds : summary?.paintsByStage?.artificer,
      all: allIds,
    });
  });

  readonly readiness = computed(() => this.stagedReadiness().overall);

  constructor() {
    this.route.paramMap.subscribe(async (params) => {
      const id = params.get('id');
      if (!id) {
        return;
      }
      this.loading.set(true);
      this.selectedImageIndex.set(0);
      this.zoomModalOpen.set(false);
      this.isPanning.set(false);
      this.activePointerId = null;
      const data = await this.catalog.getModelRecipe(id);
      this.recipe.set(data);
      this.selectedColorPointId.set(data?.colorPoints?.[0]?.id ?? null);
      this.loading.set(false);
    });
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

  goToColor(colorId: string): void {
    this.router.navigate(['/colors', colorId]);
  }

  openZoomModal(): void {
    this.zoomScale.set(2);
    this.panX.set(0);
    this.panY.set(0);
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
      this.panX.set(0);
      this.panY.set(0);
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
    this.panX.set(0);
    this.panY.set(0);
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
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
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

  selectZoomAngle(index: number): void {
    this.selectedImageIndex.set(index);
    this.panX.set(0);
    this.panY.set(0);
  }
}
