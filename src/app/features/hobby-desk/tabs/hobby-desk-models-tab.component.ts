import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CollectionSubMode } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { InventoryMatchService } from '../../../core/services/inventory-match.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { matchesModelSearch } from '../../../core/utils/catalog-filter.util';
import { createVisibleLimit } from '../../../core/utils/pagination.util';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { ModelCardComponent } from '../../../shared/components/model-card/model-card.component';

@Component({
  selector: 'app-hobby-desk-models-tab',
  imports: [DecimalPipe, ReactiveFormsModule, RouterLink, AppIconComponent, ModelCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hobby-desk-models-tab.component.ng.html',
  styleUrl: './hobby-desk-models-tab.component.css',
})
export class HobbyDeskModelsTabComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  private readonly readinessService = inject(InventoryMatchService);

  readonly subMode = model<CollectionSubMode>('inventory');
  readonly modelSearch = signal('');
  readonly selectedModelGameFilter = signal('all');

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly gameFilterControl = new FormControl('all', { nonNullable: true });

  private readonly pagination = createVisibleLimit(60, () => [
    this.subMode(),
    this.modelSearch(),
    this.selectedModelGameFilter(),
  ]);
  readonly modelVisibleLimit = this.pagination.limit;

  constructor() {
    effect(() => {
      const q = this.modelSearch();
      if (this.searchControl.value !== q) {
        this.searchControl.setValue(q, { emitEvent: false });
      }
    });
    effect(() => {
      const g = this.selectedModelGameFilter();
      if (this.gameFilterControl.value !== g) {
        this.gameFilterControl.setValue(g, { emitEvent: false });
      }
    });

    this.searchControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((q) => {
      this.modelSearch.set(q);
    });
    this.gameFilterControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((g) => {
      this.selectedModelGameFilter.set(g);
    });
  }

  readonly filteredModels = computed(() => {
    const mode = this.subMode();
    const inv = this.userState.modelInventorySet();
    const wish = this.userState.modelWishlistSet();
    const q = this.modelSearch().trim().toLowerCase();
    const gameId = this.selectedModelGameFilter();

    return this.catalog
      .models()
      .filter((m) => {
        if (mode === 'inventory' && !inv.has(m.id)) {
          return false;
        }
        if (mode === 'wishlist' && !wish.has(m.id)) {
          return false;
        }
        if (gameId !== 'all' && !m.gameIds.includes(gameId)) {
          return false;
        }
        return matchesModelSearch(m, q);
      })
      .map((model) => {
        const staged = this.readinessService.evaluateStagedReadiness({
          base: model.paintsByStage?.base,
          detail: model.paintsByStage?.detail,
          artificer: model.paintsByStage?.artificer,
          all: model.requiredPaintIds,
        });
        return {
          model,
          staged,
        };
      });
  });

  readonly displayedModels = computed(() =>
    this.filteredModels().slice(0, this.modelVisibleLimit())
  );

  onSearchChange(query: string): void {
    this.modelSearch.set(query);
  }

  onGameFilterChange(gameId: string): void {
    this.selectedModelGameFilter.set(gameId);
  }

  loadMoreModels(): void {
    this.pagination.loadMore();
  }
}
