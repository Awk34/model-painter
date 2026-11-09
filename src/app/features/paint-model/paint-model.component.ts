import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { ImageService } from '../../core/services/image.service';
import { UserStateService } from '../../core/services/user-state.service';
import { FactionNode, GameSystem, ModelSummary } from '../../core/models/warhammer.models';

@Component({
  selector: 'app-paint-model',
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paint-model.component.ng.html',
  styleUrl: './paint-model.component.css',
})
export class PaintModelComponent {
  readonly catalog = inject(CatalogService);
  readonly readinessService = inject(InventoryMatchService);
  readonly userState = inject(UserStateService);
  readonly img = inject(ImageService);
  private readonly router = inject(Router);

  readonly selectedGameId = signal<string | null>(null);
  readonly selectedParentFactionId = signal<string | null>(null);
  readonly selectedSubFactionId = signal<string | null>(null);
  readonly searchQuery = signal<string>('');
  readonly collectionFilter = signal<'all' | 'inventory' | 'wishlist'>('all');
  readonly rangeFilter = signal<'all' | 'warhammer_colour' | 'warhammer_pro'>('all');
  readonly targetStage = signal<'base' | 'detail' | 'artificer'>('base');
  readonly readinessFilter = signal<'all' | 'ready100' | 'missing2' | 'sortReady'>('all');
  readonly visibleLimit = signal<number>(60);

  readonly selectedGame = computed(() => {
    const gid = this.selectedGameId();
    if (!gid) return null;
    return this.catalog.games().find((g) => g.id === gid) ?? null;
  });

  readonly selectedParentFaction = computed(() => {
    const g = this.selectedGame();
    const fid = this.selectedParentFactionId();
    if (!g || !fid) return null;
    return g.factions.find((f) => f.id === fid) ?? null;
  });

  readonly filteredModels = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const cFilter = this.collectionFilter();
    const modelInv = this.userState.modelInventorySet();
    const modelWish = this.userState.modelWishlistSet();
    const range = this.rangeFilter();
    const rFilter = this.readinessFilter();
    const gid = this.selectedGameId();
    const pfid = this.selectedParentFactionId();
    const sfid = this.selectedSubFactionId();

    // Allowed recipe IDs when a game or faction node is active
    let allowedRecipeSet: Set<string> | null = null;
    if (sfid && this.selectedParentFaction()) {
      const sub = this.selectedParentFaction()!.childFactions?.find((c) => c.id === sfid);
      if (sub) allowedRecipeSet = new Set(sub.recipeIds);
    } else if (pfid && this.selectedParentFaction()) {
      allowedRecipeSet = new Set(this.selectedParentFaction()!.recipeIds);
    } else if (gid && this.selectedGame()) {
      allowedRecipeSet = new Set(this.selectedGame()!.recipeIds);
    }

    const baseList = this.catalog.models().filter((m) => {
      if (cFilter === 'inventory' && !modelInv.has(m.id)) return false;
      if (cFilter === 'wishlist' && !modelWish.has(m.id)) return false;
      if (allowedRecipeSet && !allowedRecipeSet.has(m.id) && (!gid || !m.gameIds.includes(gid))) {
        return false;
      }
      if (range !== 'all' && m.range !== range) return false;
      if (q) {
        const matchName = m.name.toLowerCase().includes(q);
        const matchFac = m.factionNames.some((fn) => fn.toLowerCase().includes(q));
        const matchGame = m.gameNames.some((gn) => gn.toLowerCase().includes(q));
        if (!matchName && !matchFac && !matchGame) return false;
      }
      return true;
    });

    const tStage = this.targetStage();

    const evaluated = baseList.map((model) => {
      const staged = this.readinessService.evaluateStagedReadiness({
        base: model.paintsByStage?.base,
        detail: model.paintsByStage?.detail,
        artificer: model.paintsByStage?.artificer,
        all: model.requiredPaintIds,
      });
      return {
        model,
        staged,
        readiness: staged[tStage],
      };
    });

    if (rFilter === 'all') {
      return evaluated;
    }

    if (rFilter === 'ready100') {
      return evaluated.filter(
        (x) => x.readiness.totalRequired > 0 && x.readiness.matchPercent === 100
      );
    }
    if (rFilter === 'missing2') {
      return evaluated.filter(
        (x) => x.readiness.totalRequired > 0 && x.readiness.missingCount <= 2
      );
    }
    if (rFilter === 'sortReady') {
      return [...evaluated].sort((a, b) => b.readiness.matchPercent - a.readiness.matchPercent);
    }
    return evaluated;
  });

  readonly displayedModels = computed(() =>
    this.filteredModels().slice(0, this.visibleLimit())
  );

  selectGame(game: GameSystem | null): void {
    this.selectedGameId.set(game ? game.id : null);
    this.selectedParentFactionId.set(null);
    this.selectedSubFactionId.set(null);
    this.visibleLimit.set(60);
  }

  selectParentFaction(faction: FactionNode | null): void {
    this.selectedParentFactionId.set(faction ? faction.id : null);
    this.selectedSubFactionId.set(null);
    this.visibleLimit.set(60);
  }

  onSearchChange(val: string): void {
    this.searchQuery.set(val);
    this.visibleLimit.set(60);
  }

  loadMore(): void {
    this.visibleLimit.update((v) => v + 60);
  }

  resetFilters(): void {
    this.selectedGameId.set(null);
    this.selectedParentFactionId.set(null);
    this.selectedSubFactionId.set(null);
    this.searchQuery.set('');
    this.collectionFilter.set('all');
    this.rangeFilter.set('all');
    this.targetStage.set('base');
    this.readinessFilter.set('all');
    this.visibleLimit.set(60);
  }

  openModel(id: string): void {
    this.router.navigate(['/models', id]);
  }
}
