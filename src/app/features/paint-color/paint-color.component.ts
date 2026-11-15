import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { FinishStageKey } from '../../core/models/catalog.models';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { applyReadinessFilter } from '../../core/utils/catalog-filter.util';
import { StageReadinessPillsComponent } from '../../shared/components/stage-readiness-pills/stage-readiness-pills.component';

@Component({
  selector: 'app-paint-color',
  imports: [FormsModule, RouterModule, StageReadinessPillsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paint-color.component.ng.html',
  styleUrl: './paint-color.component.css',
})
export class PaintColorComponent {
  readonly catalog = inject(CatalogService);
  readonly readinessService = inject(InventoryMatchService);
  readonly img = inject(ImageService);
  private readonly router = inject(Router);

  readonly selectedGroup = signal<string | null>(null);
  readonly onlyBasing = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly rangeFilter = signal<'all' | 'warhammer_colour' | 'warhammer_pro'>('all');
  readonly targetStage = signal<FinishStageKey>('base');
  readonly readinessFilter = signal<'all' | 'ready100' | 'missing1' | 'sortReady'>('all');

  readonly filteredColors = computed(() => {
    const grp = this.selectedGroup();
    const basing = this.onlyBasing();
    const q = this.searchQuery().trim().toLowerCase();
    const range = this.rangeFilter();
    const tStage = this.targetStage();
    const rFilter = this.readinessFilter();

    const matches = this.catalog.colors().filter((c) => {
      if (basing && c.guideType !== 'basing') {
        return false;
      }
      if (grp && !c.colorGroups.some((g) => g.toLowerCase() === grp.toLowerCase())) {
        return false;
      }
      if (range !== 'all' && c.range !== range) {
        return false;
      }
      if (q) {
        const hay = `${c.name} ${c.colorGroups.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) {
          return false;
        }
      }
      return true;
    });

    const evaluated = matches.map((color) => {
      const staged = this.readinessService.evaluateStagedReadiness({
        base: color.basePaintIds,
        detail: color.detailPaintIds,
        artificer: color.artificerPaintIds,
        all: color.requiredPaintIds,
      });
      return {
        color,
        staged,
        readiness: staged[tStage],
      };
    });

    return applyReadinessFilter(evaluated, rFilter);
  });

  resetFilters(): void {
    this.selectedGroup.set(null);
    this.onlyBasing.set(false);
    this.searchQuery.set('');
    this.rangeFilter.set('all');
    this.targetStage.set('base');
    this.readinessFilter.set('all');
  }

  openColor(id: string): void {
    this.router.navigate(['/colors', id]);
  }
}
