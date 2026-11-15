import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { UserStateService } from '../../core/services/user-state.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { ImageService } from '../../core/services/image.service';
import { ColorDetails, ColorStageStep } from '../../core/models/catalog.models';

@Component({
  selector: 'app-color-detail',
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './color-detail.component.ng.html',
  styleUrl: './color-detail.component.css',
})
export class ColorDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly readinessService = inject(InventoryMatchService);
  readonly paintModal = inject(PaintModalService);
  readonly img = inject(ImageService);

  readonly loading = signal(true);
  readonly color = signal<ColorDetails | null>(null);
  readonly activeTier = signal<'base' | 'detail' | 'artificer'>('base');
  readonly showProjectModal = signal(false);
  newProjectName = '';

  constructor() {
    this.route.paramMap.subscribe(async (params) => {
      const id = params.get('id');
      if (!id) return;
      this.loading.set(true);
      const data = await this.catalog.getColorDetails(id);
      this.color.set(data);
      this.loading.set(false);
    });
  }

  readonly activeShowcaseImage = computed(() => {
    const c = this.color();
    if (!c) return '/icons/ic_color.svg';
    const tier = this.activeTier();
    if (tier === 'base' && (c.baseFinish?.localBackpackImagePath || c.baseFinish?.backpackImage)) {
      return this.img.resolve(c.baseFinish.localBackpackImagePath, c.baseFinish.backpackImage);
    }
    if (
      tier === 'detail' &&
      (c.detailFinish?.localBackpackImagePath || c.detailFinish?.backpackImage)
    ) {
      return this.img.resolve(c.detailFinish.localBackpackImagePath, c.detailFinish.backpackImage);
    }
    if (
      tier === 'artificer' &&
      (c.artificerFinish?.localBackpackImagePath || c.artificerFinish?.backpackImage)
    ) {
      return this.img.resolve(
        c.artificerFinish.localBackpackImagePath,
        c.artificerFinish.backpackImage
      );
    }
    return this.img.resolve(
      c.localImagePath || c.localHeaderImagePath,
      c.imageUrl || c.headerImage
    );
  });

  readonly allTierBlocks = computed(() => {
    const c = this.color();
    if (!c) return [];
    const blocks: {
      key: 'base' | 'detail' | 'artificer';
      label: string;
      steps: ColorStageStep[];
    }[] = [];
    if (c.baseFinish?.stages?.length) {
      blocks.push({ key: 'base', label: 'Base Finish (Battle Ready)', steps: c.baseFinish.stages });
    }
    if (c.detailFinish?.stages?.length) {
      blocks.push({
        key: 'detail',
        label: 'Detail Finish (Parade Ready)',
        steps: c.detailFinish.stages,
      });
    }
    if (c.artificerFinish?.stages?.length) {
      blocks.push({
        key: 'artificer',
        label: 'Artificer Finish (Masterclass)',
        steps: c.artificerFinish.stages,
      });
    }
    return blocks;
  });

  readonly stagedReadiness = computed(() => {
    const c = this.color();
    if (!c) return this.readinessService.evaluateStagedReadiness({});
    const extractIds = (steps?: ColorStageStep[]) =>
      (steps ?? []).map((st) => st.paint?.id).filter((id): id is string => Boolean(id));

    return this.readinessService.evaluateStagedReadiness({
      base: extractIds(c.baseFinish?.stages),
      detail: extractIds(c.detailFinish?.stages),
      artificer: extractIds(c.artificerFinish?.stages),
    });
  });

  readonly readiness = computed(() => this.stagedReadiness().overall);

  readonly modelsUsingColor = computed(() => {
    const c = this.color();
    if (!c) return [];
    return this.catalog.modelsUsingColorMap().get(c.id) ?? [];
  });

  goToModel(id: string): void {
    this.router.navigate(['/models', id]);
  }

  addToExistingProject(projectId: string, colorId: string): void {
    this.userState.addColorToProject(projectId, colorId);
    this.showProjectModal.set(false);
  }

  createProjectWithColor(c: ColorDetails): void {
    const created = this.userState.createProject(
      this.newProjectName || `${c.name} Scheme`,
      c.imageUrl,
      c.localImagePath
    );
    this.userState.addColorToProject(created.id, c.id);
    this.newProjectName = '';
    this.showProjectModal.set(false);
  }
}
