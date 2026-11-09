import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { ImageService } from '../../core/services/image.service';

@Component({
  selector: 'app-paint-colour',
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paint-colour.component.ng.html',
  styleUrl: './paint-colour.component.css',
})
export class PaintColourComponent {
  readonly catalog = inject(CatalogService);
  readonly readinessService = inject(InventoryMatchService);
  readonly img = inject(ImageService);
  private readonly router = inject(Router);

  readonly selectedGroup = signal<string | null>(null);
  readonly onlyBasing = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly rangeFilter = signal<'all' | 'warhammer_colour' | 'warhammer_pro'>('all');
  readonly targetStage = signal<'base' | 'detail' | 'artificer'>('base');
  readonly readinessFilter = signal<'all' | 'ready100' | 'missing1' | 'sortReady'>('all');

  readonly filteredColours = computed(() => {
    const grp = this.selectedGroup();
    const basing = this.onlyBasing();
    const q = this.searchQuery().trim().toLowerCase();
    const range = this.rangeFilter();
    const tStage = this.targetStage();
    const rFilter = this.readinessFilter();

    const matches = this.catalog.colours().filter((c) => {
      if (basing && c.guideType !== 'basing') return false;
      if (grp && !c.colourGroups.some((g) => g.toLowerCase() === grp.toLowerCase())) {
        return false;
      }
      if (range !== 'all' && c.range !== range) return false;
      if (q) {
        const hay = `${c.name} ${c.colourGroups.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const evaluated = matches.map((colour) => {
      const staged = this.readinessService.evaluateStagedReadiness({
        base: colour.basePaintIds,
        detail: colour.detailPaintIds,
        artificer: colour.artificerPaintIds,
        all: colour.requiredPaintIds,
      });
      return {
        colour,
        staged,
        readiness: staged[tStage],
      };
    });

    if (rFilter === 'ready100') {
      return evaluated.filter(
        (x) => x.readiness.totalRequired > 0 && x.readiness.matchPercent === 100
      );
    }
    if (rFilter === 'missing1') {
      return evaluated.filter(
        (x) => x.readiness.totalRequired > 0 && x.readiness.missingCount <= 1
      );
    }
    if (rFilter === 'sortReady') {
      return [...evaluated].sort((a, b) => b.readiness.matchPercent - a.readiness.matchPercent);
    }
    return evaluated;
  });

  resetFilters(): void {
    this.selectedGroup.set(null);
    this.onlyBasing.set(false);
    this.searchQuery.set('');
    this.rangeFilter.set('all');
    this.targetStage.set('base');
    this.readinessFilter.set('all');
  }

  openColour(id: string): void {
    this.router.navigate(['/colours', id]);
  }
}
