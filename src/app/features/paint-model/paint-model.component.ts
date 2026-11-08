import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { ImageService } from '../../core/services/image.service';
import { FactionNode, GameSystem, ModelSummary } from '../../core/models/warhammer.models';

@Component({
  selector: 'app-paint-model',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="page-container">
      <!-- Header -->
      <header class="section-hero">
        <div class="hero-left">
          <img src="/icons/ic_models.svg" alt="" class="hero-ic" />
          <div>
            <h1>Paint A Model</h1>
            <p class="subtitle">
              Browse {{ catalog.models().length | number }} official miniature painting recipes across {{ catalog.games().length }} Warhammer game systems, with instant "Can I Paint This?" readiness matching.
            </p>
          </div>
        </div>
      </header>

      <!-- Game Systems Strip -->
      <section class="games-strip-section">
        <div class="strip-header">
          <span class="field-label">Select Game System:</span>
          @if (selectedGameId()) {
            <button class="btn btn-ghost btn-sm" (click)="selectGame(null)">
              ✕ Clear Game Filter (Show All {{ catalog.models().length | number }} Models)
            </button>
          }
        </div>

        <div class="games-scroll">
          <button
            class="game-card studio-card"
            [class.active]="!selectedGameId()"
            (click)="selectGame(null)"
          >
            <div class="game-info">
              <strong>All Game Systems</strong>
              <span>{{ catalog.models().length | number }} Models</span>
            </div>
          </button>

          @for (g of catalog.games(); track g.id) {
            <button
              class="game-card studio-card"
              [class.active]="selectedGameId() === g.id"
              (click)="selectGame(g)"
            >
              @if (g.localImagePath || g.imageUrl) {
                <img
                  [src]="img.resolve(g.localImagePath, g.imageUrl)"
                  [alt]="g.name"
                  class="game-logo"
                  loading="lazy"
                />
              }
              <div class="game-info">
                <strong>{{ g.name }}</strong>
                <span>{{ g.recipeCount }} Models</span>
              </div>
            </button>
          }
        </div>
      </section>

      <!-- Hierarchical Faction Drill-Down (When a Game is Selected) -->
      @if (selectedGame(); as game) {
        <section class="factions-panel studio-card">
          <div class="faction-level">
            <span class="field-label">Factions in {{ game.name }}:</span>
            <div class="chip-bar">
              <button
                class="chip"
                [class.active]="!selectedParentFactionId()"
                (click)="selectParentFaction(null)"
              >
                All {{ game.name }} ({{ game.recipeCount }})
              </button>
              @for (f of game.factions; track f.id) {
                <button
                  class="chip"
                  [class.active]="selectedParentFactionId() === f.id"
                  (click)="selectParentFaction(f)"
                >
                  <span>{{ f.name }} ({{ f.recipeCount }})</span>
                </button>
              }
            </div>
          </div>

          @if (selectedParentFaction()?.childFactions?.length) {
            <div class="faction-level sub-level">
              <span class="field-label">Sub-Factions / Chapters / Warbands:</span>
              <div class="chip-bar">
                <button
                  class="chip"
                  [class.active]="!selectedSubFactionId()"
                  (click)="selectedSubFactionId.set(null)"
                >
                  All {{ selectedParentFaction()!.name }}
                </button>
                @for (sf of selectedParentFaction()!.childFactions!; track sf.id) {
                  <button
                    class="chip"
                    [class.active]="selectedSubFactionId() === sf.id"
                    (click)="selectedSubFactionId.set(sf.id)"
                  >
                    <span>{{ sf.name }} ({{ sf.recipeCount }})</span>
                  </button>
                }
              </div>
            </div>
          }
        </section>
      }

      <!-- Search, Range & "Can I Paint This?" Filter Bar -->
      <section class="filters-bar studio-card">
        <div class="search-input-wrap">
          <input
            type="text"
            class="input-control"
            placeholder="Search models by name, unit, character, or faction..."
            [ngModel]="searchQuery()"
            (ngModelChange)="onSearchChange($event)"
          />
        </div>

        <div class="filter-controls">
          <select
            class="input-control filter-select"
            [ngModel]="readinessFilter()"
            (ngModelChange)="readinessFilter.set($event); visibleLimit.set(60)"
          >
            <option value="all">Can I Paint This? — All Models</option>
            <option value="ready100">✓ 100% Paint Ready Now</option>
            <option value="missing2">⚡ Missing ≤ 2 Paints</option>
            <option value="sortReady">Sort by Highest Paint Match %</option>
          </select>

          <select
            class="input-control filter-select"
            [ngModel]="rangeFilter()"
            (ngModelChange)="rangeFilter.set($event); visibleLimit.set(60)"
          >
            <option value="all">All Paint Ranges</option>
            <option value="warhammer_colour">Citadel Colour (Classic)</option>
            <option value="warhammer_pro">Citadel Tone Pro</option>
          </select>
        </div>
      </section>

      <!-- Results Count -->
      <div class="results-meta">
        <span>
          Showing <strong>{{ displayedModels().length }}</strong> of
          <strong>{{ filteredModels().length | number }}</strong> matching models
        </span>
      </div>

      <!-- Models Grid -->
      @if (displayedModels().length > 0) {
        <div class="models-grid">
          @for (item of displayedModels(); track item.model.id) {
            <div
              class="model-card studio-card interactive"
              (click)="openModel(item.model.id)"
            >
              <div class="model-img-box">
                <img
                  [src]="img.resolve(item.model.localPrimaryImage, item.model.primaryImage)"
                  [alt]="item.model.name"
                  loading="lazy"
                />
                @if (item.model.range === 'warhammer_pro') {
                  <span class="range-tag badge badge-pro">Tone Pro</span>
                }
                @if (item.readiness.totalRequired > 0) {
                  <span
                    class="ready-badge"
                    [class.ready-full]="item.readiness.matchPercent === 100"
                    [class.ready-high]="item.readiness.matchPercent >= 75 && item.readiness.matchPercent < 100"
                  >
                    {{ item.readiness.matchPercent }}% Ready ({{ item.readiness.ownedDirectCount + item.readiness.substitutedCount }}/{{ item.readiness.totalRequired }})
                  </span>
                }
              </div>

              <div class="model-card-body">
                <h3 class="model-name">{{ item.model.name }}</h3>
                <p class="model-factions">
                  {{ item.model.factionNames.slice(0, 2).join(' • ') || item.model.gameNames[0] || 'Warhammer Miniature' }}
                </p>
              </div>
            </div>
          }
        </div>

        @if (filteredModels().length > visibleLimit()) {
          <div class="load-more-row">
            <button class="btn btn-secondary" (click)="loadMore()">
              Load More Models ({{ filteredModels().length - visibleLimit() | number }} remaining)
            </button>
          </div>
        }
      } @else {
        <div class="empty-state studio-card">
          <h3>No Models Match Your Filters</h3>
          <p>Try clearing the "Can I Paint This?" readiness filter or search query.</p>
          <button class="btn btn-gold" (click)="resetFilters()">Reset All Filters</button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .page-container {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .section-hero {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 18px 22px;
        background: linear-gradient(135deg, #1b1f27 0%, #121419 100%);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md);
      }
      .hero-left {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .hero-ic {
        width: 42px;
        height: 42px;
      }
      .hero-left h1 {
        font-size: 1.9rem;
        color: var(--gold-bright);
      }
      .subtitle {
        font-family: var(--font-sans);
        font-size: 0.86rem;
        color: var(--text-secondary);
      }
      .games-strip-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .strip-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .field-label {
        font-family: var(--font-sans);
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--text-secondary);
        letter-spacing: 0.04em;
      }
      .games-scroll {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        padding-bottom: 6px;
      }
      .game-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        min-width: 195px;
        flex-shrink: 0;
        text-align: left;
      }
      .game-card.active {
        border-color: var(--gold-bright);
        background: var(--gold-soft);
      }
      .game-logo {
        width: 42px;
        height: 42px;
        object-fit: contain;
        border-radius: 6px;
      }
      .game-info {
        display: flex;
        flex-direction: column;
        font-family: var(--font-sans);
      }
      .game-info strong {
        font-size: 0.82rem;
        color: var(--text-primary);
      }
      .game-info span {
        font-size: 0.72rem;
        color: var(--text-secondary);
      }
      .factions-panel {
        padding: 14px 18px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .faction-level {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .sub-level {
        padding-top: 10px;
        border-top: 1px solid var(--border-subtle);
      }
      .filters-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        padding: 14px 16px;
        align-items: center;
      }
      .search-input-wrap {
        flex: 1;
        min-width: 240px;
      }
      .filter-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .filter-select {
        width: auto;
        min-width: 210px;
      }
      .results-meta {
        font-family: var(--font-sans);
        font-size: 0.84rem;
        color: var(--text-secondary);
      }
      .models-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
        gap: 16px;
      }
      .model-card {
        display: flex;
        flex-direction: column;
        cursor: pointer;
      }
      .model-img-box {
        position: relative;
        height: 190px;
        background: radial-gradient(circle at center, #282e3a 0%, #14171d 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
      }
      .model-img-box img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .range-tag {
        position: absolute;
        top: 8px;
        left: 8px;
      }
      .ready-badge {
        position: absolute;
        bottom: 8px;
        right: 8px;
        padding: 3px 8px;
        border-radius: var(--radius-pill);
        background: rgba(13, 14, 17, 0.86);
        border: 1px solid var(--border-strong);
        font-family: var(--font-sans);
        font-size: 0.7rem;
        font-weight: 700;
        color: var(--text-secondary);
      }
      .ready-badge.ready-full {
        color: var(--status-owned);
        border-color: rgba(41, 194, 106, 0.5);
      }
      .ready-badge.ready-high {
        color: var(--gold-bright);
        border-color: var(--gold-border);
      }
      .model-card-body {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .model-name {
        font-size: 1.05rem;
        color: var(--text-primary);
      }
      .model-factions {
        font-family: var(--font-sans);
        font-size: 0.76rem;
        color: var(--text-secondary);
      }
      .load-more-row {
        display: flex;
        justify-content: center;
        padding: 16px 0;
      }
      .empty-state {
        padding: 40px 20px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }
    `,
  ],
})
export class PaintModelComponent {
  readonly catalog = inject(CatalogService);
  readonly readinessService = inject(InventoryMatchService);
  readonly img = inject(ImageService);
  private readonly router = inject(Router);

  readonly selectedGameId = signal<string | null>(null);
  readonly selectedParentFactionId = signal<string | null>(null);
  readonly selectedSubFactionId = signal<string | null>(null);
  readonly searchQuery = signal<string>('');
  readonly rangeFilter = signal<'all' | 'warhammer_colour' | 'warhammer_pro'>('all');
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

    if (rFilter === 'all') {
      return baseList.map((model) => ({
        model,
        readiness: this.readinessService.evaluateReadiness(model.requiredPaintIds),
      }));
    }

    const evaluated = baseList.map((model) => ({
      model,
      readiness: this.readinessService.evaluateReadiness(model.requiredPaintIds),
    }));

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
    this.rangeFilter.set('all');
    this.readinessFilter.set('all');
    this.visibleLimit.set(60);
  }

  openModel(id: string): void {
    this.router.navigate(['/models', id]);
  }
}
