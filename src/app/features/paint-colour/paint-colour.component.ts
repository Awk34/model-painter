import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { ImageService } from '../../core/services/image.service';

@Component({
  selector: 'app-paint-colour',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="page-container">
      <!-- Header -->
      <header class="section-hero">
        <div class="hero-left">
          <img src="/icons/ic_colour.svg" alt="" class="hero-ic" />
          <div>
            <h1>Paint A Colour</h1>
            <p class="subtitle">
              Explore {{ catalog.colours().length }} official Citadel colour & basing guides across {{ catalog.colourGroups().length }} colour families, complete with Base, Detail, and Artificer Space Marine backpack showcases.
            </p>
          </div>
        </div>
      </header>

      <!-- 16 Colour Group Filter Chips -->
      <section class="groups-panel studio-card">
        <div class="groups-top-row">
          <span class="field-label">Filter by Colour Family:</span>

          <label class="basing-toggle">
            <input
              type="checkbox"
              [ngModel]="onlyBasing()"
              (ngModelChange)="onlyBasing.set($event)"
            />
            <img src="/icons/ic_bases.svg" alt="" class="base-ic" />
            <span>Only show guides for painting bases (17 Basing Guides)</span>
          </label>
        </div>

        <div class="chip-bar">
          <button
            class="chip"
            [class.active]="!selectedGroup()"
            (click)="selectedGroup.set(null)"
          >
            All Colour Families ({{ catalog.colours().length }})
          </button>

          @for (grp of catalog.colourGroups(); track grp.id) {
            <button
              class="chip"
              [class.active]="selectedGroup() === grp.name"
              (click)="selectedGroup.set(grp.name)"
            >
              @if (grp.hex) {
                <span class="mini-dot" [style.background]="grp.hex"></span>
              }
              <span>{{ grp.name }}</span>
            </button>
          }
        </div>
      </section>

      <!-- Search, Range & Readiness Filter Bar -->
      <section class="filters-bar studio-card">
        <div class="search-input-wrap">
          <input
            type="text"
            class="input-control"
            placeholder="Search colours by name, shade, or family (e.g., Ultramarine Blue, Pale Skin, Lava Base)..."
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
          />
        </div>

        <div class="filter-controls">
          <select
            class="input-control filter-select"
            [ngModel]="readinessFilter()"
            (ngModelChange)="readinessFilter.set($event)"
          >
            <option value="all">Can I Paint This? — All Colours</option>
            <option value="ready100">✓ 100% Paint Ready Now</option>
            <option value="missing1">⚡ Missing ≤ 1 Paint</option>
            <option value="sortReady">Sort by Highest Paint Match %</option>
          </select>

          <select
            class="input-control filter-select"
            [ngModel]="rangeFilter()"
            (ngModelChange)="rangeFilter.set($event)"
          >
            <option value="all">All Paint Ranges</option>
            <option value="warhammer_colour">Citadel Colour (Classic)</option>
            <option value="warhammer_pro">Citadel Tone Pro</option>
          </select>
        </div>
      </section>

      <div class="results-meta">
        <span>Showing <strong>{{ filteredColours().length }}</strong> matching colour guides</span>
      </div>

      <!-- Colours Grid -->
      @if (filteredColours().length > 0) {
        <div class="colours-grid">
          @for (item of filteredColours(); track item.colour.id) {
            <div
              class="colour-card studio-card interactive"
              (click)="openColour(item.colour.id)"
            >
              <div class="colour-preview-box">
                @if (item.colour.localImagePath || item.colour.imageUrl) {
                  <img
                    [src]="img.resolve(item.colour.localImagePath, item.colour.imageUrl)"
                    [alt]="item.colour.name"
                    loading="lazy"
                  />
                } @else {
                  <div class="fallback-swatch" [style.background]="item.colour.hex"></div>
                }

                <span
                  class="swatch-corner"
                  [style.background]="item.colour.hex"
                  [title]="item.colour.hex"
                ></span>

                @if (item.colour.guideType === 'basing') {
                  <span class="type-tag badge badge-gold">Basing Guide</span>
                } @else if (item.colour.range === 'warhammer_pro') {
                  <span class="type-tag badge badge-pro">Tone Pro</span>
                }

                @if (item.readiness.totalRequired > 0) {
                  <span
                    class="ready-badge"
                    [class.ready-full]="item.readiness.matchPercent === 100"
                  >
                    {{ item.readiness.matchPercent }}% Ready ({{ item.readiness.ownedDirectCount + item.readiness.substitutedCount }}/{{ item.readiness.totalRequired }})
                  </span>
                }
              </div>

              <div class="colour-card-body">
                <h3 class="colour-name">{{ item.colour.name }}</h3>
                <p class="colour-groups">
                  {{ item.colour.colourGroups.join(' • ') }} • {{ item.colour.requiredPaintIds.length }} Paints
                </p>
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="empty-state studio-card">
          <h3>No Colour Guides Match Your Filters</h3>
          <button class="btn btn-gold" (click)="resetFilters()">Reset Filters</button>
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
      .groups-panel {
        padding: 16px 18px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .groups-top-row {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      .field-label {
        font-family: var(--font-sans);
        font-size: 0.78rem;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--text-secondary);
      }
      .basing-toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: var(--radius-pill);
        background: var(--bg-elevated);
        border: 1px solid var(--border-strong);
        font-family: var(--font-sans);
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }
      .base-ic {
        width: 18px;
        height: 18px;
      }
      .mini-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.35);
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
      .colours-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(225px, 1fr));
        gap: 16px;
      }
      .colour-card {
        display: flex;
        flex-direction: column;
        cursor: pointer;
      }
      .colour-preview-box {
        position: relative;
        height: 175px;
        background: radial-gradient(circle at center, #292f3b 0%, #14171d 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 10px;
      }
      .colour-preview-box img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .fallback-swatch {
        width: 84px;
        height: 84px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.25);
      }
      .swatch-corner {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.5);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
      }
      .type-tag {
        position: absolute;
        top: 10px;
        left: 10px;
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
      .colour-card-body {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .colour-name {
        font-size: 1.05rem;
      }
      .colour-groups {
        font-family: var(--font-sans);
        font-size: 0.76rem;
        color: var(--text-secondary);
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
export class PaintColourComponent {
  readonly catalog = inject(CatalogService);
  readonly readinessService = inject(InventoryMatchService);
  readonly img = inject(ImageService);
  private readonly router = inject(Router);

  readonly selectedGroup = signal<string | null>(null);
  readonly onlyBasing = signal<boolean>(false);
  readonly searchQuery = signal<string>('');
  readonly rangeFilter = signal<'all' | 'warhammer_colour' | 'warhammer_pro'>('all');
  readonly readinessFilter = signal<'all' | 'ready100' | 'missing1' | 'sortReady'>('all');

  readonly filteredColours = computed(() => {
    const grp = this.selectedGroup();
    const basing = this.onlyBasing();
    const q = this.searchQuery().trim().toLowerCase();
    const range = this.rangeFilter();
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

    const evaluated = matches.map((colour) => ({
      colour,
      readiness: this.readinessService.evaluateReadiness(colour.requiredPaintIds),
    }));

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
    this.readinessFilter.set('all');
  }

  openColour(id: string): void {
    this.router.navigate(['/colours', id]);
  }
}
