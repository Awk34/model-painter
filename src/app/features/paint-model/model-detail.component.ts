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
  styleUrl: './model-detail.component.css',
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

  readonly stagedReadiness = computed(() => {
    const r = this.recipe();
    if (!r) return this.readinessService.evaluateStagedReadiness({});

    const baseIds: string[] = [];
    const detailIds: string[] = [];
    const artificerIds: string[] = [];
    const allIds: string[] = [];

    for (const area of r.paintingAreas ?? []) {
      for (const step of area.paintingSteps ?? []) {
        const pid = step.paint?.id;
        if (!pid) continue;
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
