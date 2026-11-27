import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, linkedSignal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FinishStageKey } from '../../core/models/catalog.models';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { UserStateService } from '../../core/services/user-state.service';
import { applyReadinessFilter } from '../../core/utils/catalog-filter.util';
import { createVisibleLimit } from '../../core/utils/pagination.util';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { CatalogFilterBarComponent } from '../../shared/components/catalog-filter-bar/catalog-filter-bar.component';
import { StageReadinessPillsComponent } from '../../shared/components/stage-readiness-pills/stage-readiness-pills.component';

@Component({
  selector: 'app-paint-color',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    AppIconComponent,
    CatalogFilterBarComponent,
    StageReadinessPillsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paint-color.component.ng.html',
  styleUrl: './paint-color.component.css',
})
export class PaintColorComponent {
  readonly catalog = inject(CatalogService);
  readonly readinessService = inject(InventoryMatchService);
  readonly userState = inject(UserStateService);
  readonly img = inject(ImageService);

  readonly selectedGroup = signal<string | null>(null);
  readonly onlyBasing = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly rangeFilter = linkedSignal<'all' | 'warhammer_colour' | 'warhammer_pro'>(
    () => this.userState.preferences().defaultRangeFilter ?? 'all'
  );
  readonly targetStage = signal<FinishStageKey>('base');
  readonly readinessFilter = signal<'all' | 'ready100' | 'missing1' | 'sortReady'>('all');

  private readonly pagination = createVisibleLimit(60, () => [
    this.selectedGroup(),
    this.onlyBasing(),
    this.searchQuery(),
    this.rangeFilter(),
    this.targetStage(),
    this.readinessFilter(),
  ]);
  readonly visibleLimit = this.pagination.limit;

  readonly onlyBasingControl = new FormControl(false, { nonNullable: true });

  constructor() {
    effect(() => {
      const value = this.onlyBasing();
      if (this.onlyBasingControl.value !== value) {
        this.onlyBasingControl.setValue(value, { emitEvent: false });
      }
    });

    this.onlyBasingControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((val) => {
      this.onlyBasing.set(val);
    });
  }

  readonly basingGuideCount = computed(
    () => this.catalog.colors().filter((c) => c.guideType === 'basing').length
  );

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

  readonly displayedColors = computed(() =>
    this.filteredColors().slice(0, this.visibleLimit())
  );

  loadMore(): void {
    this.pagination.loadMore();
  }

  resetFilters(): void {
    this.selectedGroup.set(null);
    this.onlyBasing.set(false);
    this.searchQuery.set('');
    this.rangeFilter.set('all');
    this.targetStage.set('base');
    this.readinessFilter.set('all');
    this.pagination.reset();
  }
}
