import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { UserStateService } from '../../core/services/user-state.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { ImageService } from '../../core/services/image.service';
import { ModelRecipe } from '../../core/models/warhammer.models';

@Component({
  selector: 'app-model-detail',
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './model-detail.component.ng.html',
  styles: [
    `
      .detail-page {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .top-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
      }
      .top-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .loading-card {
        padding: 40px;
        text-align: center;
      }
      .hero-split {
        display: grid;
        grid-template-columns: minmax(320px, 1.15fr) minmax(320px, 1fr);
        gap: 20px;
      }
      @media (max-width: 920px) {
        .hero-split {
          grid-template-columns: 1fr;
        }
      }
      .viewer-panel {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 18px;
        background: radial-gradient(circle at center, #282e3b 0%, #14171e 100%);
      }
      .main-img-stage {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 390px;
      }
      .img-overlay-box {
        position: relative;
        display: inline-block;
        max-width: 100%;
      }
      .stage-img {
        display: block;
        max-width: 100%;
        max-height: 440px;
        object-fit: contain;
      }
      .colour-pin {
        position: absolute;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid #ffffff;
        transform: translate(-50%, -50%);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.75);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        z-index: 5;
      }
      .colour-pin:hover,
      .colour-pin.active {
        transform: translate(-50%, -50%) scale(1.35);
        border-color: var(--gold-bright);
        box-shadow: 0 0 0 4px rgba(237, 179, 4, 0.45);
        z-index: 10;
      }
      .viewer-controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border-subtle);
      }
      .angle-thumbs {
        display: flex;
        gap: 8px;
        overflow-x: auto;
      }
      .angle-thumb {
        width: 54px;
        height: 54px;
        border-radius: var(--radius-xs);
        border: 2px solid var(--border-subtle);
        background: var(--bg-void);
        padding: 4px;
      }
      .angle-thumb.active {
        border-color: var(--gold-bright);
      }
      .angle-thumb img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .meta-panel {
        padding: 22px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .game-badge {
        background: rgba(255, 255, 255, 0.08);
        color: var(--text-secondary);
      }
      .model-title {
        font-size: 2rem;
        color: var(--gold-bright);
      }
      .factions-line {
        font-family: var(--font-sans);
        font-size: 0.86rem;
        color: var(--text-secondary);
      }
      .readiness-box {
        padding: 12px 14px;
        background: var(--bg-void);
        border-radius: var(--radius-sm);
        border: 1px solid var(--border-subtle);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ready-header {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 0.82rem;
      }
      .ready-header span {
        color: var(--text-secondary);
      }
      .progress-track {
        height: 8px;
        background: #232832;
        border-radius: 999px;
        overflow: hidden;
      }
      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--gold-primary), var(--gold-bright));
      }
      .progress-fill.complete {
        background: var(--status-owned);
      }
      .colours-on-model {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 4px;
      }
      .colours-on-model h3 {
        font-size: 1.1rem;
      }
      .hint {
        font-family: var(--font-sans);
        font-size: 0.78rem;
        color: var(--text-muted);
      }
      .cp-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 270px;
        overflow-y: auto;
      }
      .cp-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
        cursor: pointer;
      }
      .cp-card.active {
        border-color: var(--gold-bright);
        background: var(--gold-soft);
      }
      .cp-info {
        display: flex;
        flex-direction: column;
        flex: 1;
        font-family: var(--font-sans);
        font-size: 0.84rem;
      }
      .cp-info span {
        font-size: 0.72rem;
        color: var(--text-secondary);
      }
      .areas-section {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .areas-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .areas-list {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .area-card {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .area-header {
        border-bottom: 1px solid var(--border-subtle);
        padding-bottom: 12px;
      }
      .area-title-group {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .area-thumb {
        width: 56px;
        height: 56px;
        object-fit: contain;
        background: var(--bg-void);
        border-radius: var(--radius-xs);
        padding: 4px;
      }
      .area-sub {
        font-family: var(--font-sans);
        font-size: 0.8rem;
        color: var(--text-secondary);
      }
      .steps-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
        gap: 14px;
      }
      .step-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
      }
      .step-top {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        font-family: var(--font-sans);
        font-size: 0.72rem;
        font-weight: 700;
      }
      .step-num-badge {
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--gold-soft);
        color: var(--gold-bright);
      }
      .stage-pill {
        padding: 2px 8px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.07);
        color: var(--text-secondary);
      }
      .tech-pill {
        padding: 2px 8px;
        border-radius: 4px;
        background: rgba(56, 189, 248, 0.14);
        color: var(--status-sub);
      }
      .brush-pill {
        color: var(--text-muted);
      }
      .step-img-box {
        height: 150px;
        background: var(--bg-void);
        border-radius: var(--radius-xs);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
      }
      .step-img-box img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .step-text {
        font-size: 0.86rem;
        color: var(--text-secondary);
      }
      .step-paint-box {
        margin-top: auto;
        padding-top: 10px;
        border-top: 1px solid var(--border-subtle);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .step-paint-main {
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
        min-width: 0;
      }
      .sp-info {
        display: flex;
        flex-direction: column;
        font-family: var(--font-sans);
        font-size: 0.82rem;
      }
      .sp-info span {
        font-size: 0.72rem;
        color: var(--text-secondary);
      }
      .sp-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }
      .proj-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .proj-pick-btn {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        font-family: var(--font-sans);
        font-size: 0.86rem;
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-subtle);
      }
      .modal-body {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
    `,
  ],
})
export class ModelDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly readinessService = inject(InventoryMatchService);
  readonly paintModal = inject(PaintModalService);
  readonly img = inject(ImageService);

  readonly loading = signal(true);
  readonly recipe = signal<ModelRecipe | null>(null);
  readonly selectedImageIndex = signal(0);
  readonly showPins = signal(true);
  readonly selectedColourPointId = signal<string | null>(null);
  readonly stageFilter = signal<'all' | 'Base Finish' | 'Detail Finish' | 'Artificer Finish'>('all');

  readonly showProjectModal = signal(false);
  newProjectName = '';

  constructor() {
    this.route.paramMap.subscribe(async (params) => {
      const id = params.get('id');
      if (!id) return;
      this.loading.set(true);
      this.selectedImageIndex.set(0);
      const data = await this.catalog.getModelRecipe(id);
      this.recipe.set(data);
      this.selectedColourPointId.set(data?.colourPoints?.[0]?.id ?? null);
      this.loading.set(false);
    });
  }

  readonly activeImageUrl = computed(() => {
    const r = this.recipe();
    if (!r) return '/icons/ic_models.svg';
    const idx = this.selectedImageIndex();
    return this.img.resolve(r.localImagePaths?.[idx], r.images?.[idx]);
  });

  readonly readiness = computed(() => {
    const r = this.recipe();
    if (!r) return this.readinessService.evaluateReadiness([]);
    const paintIds: string[] = [];
    for (const area of r.paintingAreas ?? []) {
      for (const step of area.paintingSteps ?? []) {
        if (step.paint?.id) paintIds.push(step.paint.id);
      }
    }
    if (paintIds.length === 0) {
      const summary = this.catalog.modelById().get(r.id);
      if (summary) return this.readinessService.evaluateReadiness(summary.requiredPaintIds);
    }
    return this.readinessService.evaluateReadiness(paintIds);
  });

  formatFactions(r: ModelRecipe): string {
    const names = new Set<string>();
    for (const f of r.factions ?? []) {
      if (f.parentFactionName) names.add(f.parentFactionName);
      if (f.factionName) names.add(f.factionName);
    }
    return Array.from(names).join(' • ');
  }

  selectColourPoint(cpId: string): void {
    this.selectedColourPointId.set(cpId);
  }

  filterSteps(steps: ModelRecipe['paintingAreas'][0]['paintingSteps']) {
    const sf = this.stageFilter();
    if (sf === 'all') return steps;
    return steps.filter((s) => s.paintingStage === sf);
  }

  goToColour(colourId: string): void {
    this.router.navigate(['/colours', colourId]);
  }

  addToExistingProject(projectId: string, r: ModelRecipe): void {
    this.userState.addRecipeToProject(projectId, r.id, r.localImagePaths?.[0]);
    this.showProjectModal.set(false);
  }

  createProjectWithModel(r: ModelRecipe): void {
    const created = this.userState.createProject(
      this.newProjectName || r.name,
      r.images?.[0],
      r.localImagePaths?.[0]
    );
    this.userState.addRecipeToProject(created.id, r.id, r.localImagePaths?.[0]);
    this.newProjectName = '';
    this.showProjectModal.set(false);
  }
}
