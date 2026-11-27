import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { InventoryMatchService } from '../../../core/services/inventory-match.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { matchesModelSearch } from '../../../core/utils/catalog-filter.util';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { StageReadinessPillsComponent } from '../../../shared/components/stage-readiness-pills/stage-readiness-pills.component';

export type CollectionSubMode = 'inventory' | 'wishlist' | 'catalogue';

@Component({
  selector: 'app-hobby-desk-models-tab',
  imports: [DecimalPipe, FormsModule, RouterModule, AppIconComponent, StageReadinessPillsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hobby-desk-models-tab.component.ng.html',
  styleUrl: './hobby-desk-models-tab.component.css',
})
export class HobbyDeskModelsTabComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly img = inject(ImageService);
  private readonly readinessService = inject(InventoryMatchService);

  readonly subMode = model<CollectionSubMode>('inventory');
  readonly modelSearch = signal('');
  readonly selectedModelGameFilter = signal('all');
  readonly modelVisibleLimit = signal(60);

  constructor() {
    effect(() => {
      this.subMode();
      this.modelVisibleLimit.set(60);
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
    this.modelVisibleLimit.set(60);
  }

  onGameFilterChange(gameId: string): void {
    this.selectedModelGameFilter.set(gameId);
    this.modelVisibleLimit.set(60);
  }

  loadMoreModels(): void {
    this.modelVisibleLimit.update((v) => v + 60);
  }
}

