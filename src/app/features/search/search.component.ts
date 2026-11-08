import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { UserStateService } from '../../core/services/user-state.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { ImageService } from '../../core/services/image.service';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="page-container">
      <!-- Search Hero -->
      <header class="search-hero studio-card">
        <div class="search-title-row">
          <img src="/icons/ic_search.svg" alt="" class="search-ic" />
          <div>
            <h1>Global Search</h1>
            <p class="subtitle">
              Instant search across {{ catalog.models().length | number }} Models, {{ catalog.colours().length }} Colours, {{ catalog.paints().length }} Citadel Paints, and {{ catalog.thirdPartyPaints().length }} 3rd-Party Paints.
            </p>
          </div>
        </div>

        <div class="big-search-wrap">
          <input
            type="text"
            class="input-control big-search"
            placeholder="Type any miniature, faction, Citadel paint, Army Painter / Vallejo / Two Thin Coats paint, or colour scheme..."
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
            autofocus
          />
          @if (query()) {
            <button class="clear-btn" (click)="query.set('')">✕ Clear</button>
          }
        </div>

        <div class="chip-bar">
          <button
            class="chip"
            [class.active]="tab() === 'all'"
            (click)="tab.set('all')"
          >
            All Results ({{ totalCount() }})
          </button>
          <button
            class="chip"
            [class.active]="tab() === 'models'"
            (click)="tab.set('models')"
          >
            Models ({{ matchedModels().length }})
          </button>
          <button
            class="chip"
            [class.active]="tab() === 'colours'"
            (click)="tab.set('colours')"
          >
            Colours ({{ matchedColours().length }})
          </button>
          <button
            class="chip"
            [class.active]="tab() === 'paints'"
            (click)="tab.set('paints')"
          >
            Citadel & 3rd-Party Paints ({{ matchedCitadelPaints().length + matchedThirdPartyPaints().length }})
          </button>
        </div>
      </header>

      <!-- Paints Section -->
      @if (
        (tab() === 'all' || tab() === 'paints') &&
        (matchedCitadelPaints().length > 0 || matchedThirdPartyPaints().length > 0)
      ) {
        <section class="result-section">
          <h2>Paints ({{ matchedCitadelPaints().length + matchedThirdPartyPaints().length }})</h2>
          <div class="paints-grid">
            @for (cp of matchedCitadelPaints().slice(0, 24); track cp.id) {
              <div class="paint-item studio-card">
                <button class="paint-main" (click)="paintModal.openPaint(cp.id)">
                  <span class="paint-swatch" [style.background]="cp.gradientStartHex"></span>
                  <div class="p-info">
                    <strong>{{ cp.name }}</strong>
                    <span>{{ cp.range === 'warhammer_pro' ? 'Citadel Tone Pro' : 'Citadel Colour' }} • {{ cp.category }}</span>
                  </div>
                </button>
                <button
                  class="btn btn-sm"
                  [class.btn-owned]="userState.isOwned(cp.id)"
                  [class.btn-ghost]="!userState.isOwned(cp.id)"
                  (click)="userState.toggleInventory(cp.id)"
                >
                  {{ userState.isOwned(cp.id) ? '✓ Owned' : '+ Own' }}
                </button>
              </div>
            }

            @for (tp of matchedThirdPartyPaints().slice(0, 24); track tp.id) {
              <div class="paint-item studio-card">
                <button class="paint-main" (click)="paintModal.openPaint(tp.id)">
                  <span class="paint-swatch" [style.background]="tp.hex"></span>
                  <div class="p-info">
                    <strong>{{ tp.name }}</strong>
                    <span>{{ tp.brand }} • {{ tp.range }}</span>
                  </div>
                </button>
                <button
                  class="btn btn-sm"
                  [class.btn-owned]="userState.isOwned(tp.id)"
                  [class.btn-ghost]="!userState.isOwned(tp.id)"
                  (click)="userState.toggleInventory(tp.id)"
                >
                  {{ userState.isOwned(tp.id) ? '✓ Owned' : '+ Own' }}
                </button>
              </div>
            }
          </div>
        </section>
      }

      <!-- Colours Section -->
      @if ((tab() === 'all' || tab() === 'colours') && matchedColours().length > 0) {
        <section class="result-section">
          <h2>Colour Guides ({{ matchedColours().length }})</h2>
          <div class="cards-grid">
            @for (c of matchedColours().slice(0, 24); track c.id) {
              <div
                class="result-card studio-card interactive"
                (click)="router.navigate(['/colours', c.id])"
              >
                <div class="c-swatch-bar" [style.background]="c.hex"></div>
                <div class="r-body">
                  <strong>{{ c.name }}</strong>
                  <span>{{ c.colourGroups.join(', ') }} • {{ c.requiredPaintIds.length }} Paints</span>
                </div>
              </div>
            }
          </div>
        </section>
      }

      <!-- Models Section -->
      @if ((tab() === 'all' || tab() === 'models') && matchedModels().length > 0) {
        <section class="result-section">
          <h2>Model Painting Guides ({{ matchedModels().length }})</h2>
          <div class="cards-grid">
            @for (m of matchedModels().slice(0, 36); track m.id) {
              <div
                class="result-card studio-card interactive"
                (click)="router.navigate(['/models', m.id])"
              >
                <div class="m-img-box">
                  <img
                    [src]="img.resolve(m.localPrimaryImage, m.primaryImage)"
                    [alt]="m.name"
                    loading="lazy"
                  />
                </div>
                <div class="r-body">
                  <strong>{{ m.name }}</strong>
                  <span>{{ m.factionNames.slice(0, 2).join(' • ') || m.gameNames[0] }}</span>
                </div>
              </div>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .page-container {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .search-hero {
        padding: 22px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .search-title-row {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .search-ic {
        width: 38px;
        height: 38px;
      }
      .search-title-row h1 {
        font-size: 1.85rem;
        color: var(--gold-bright);
      }
      .subtitle {
        font-family: var(--font-sans);
        font-size: 0.86rem;
        color: var(--text-secondary);
      }
      .big-search-wrap {
        position: relative;
        display: flex;
        align-items: center;
      }
      .big-search {
        font-size: 1.05rem;
        padding: 14px 18px;
      }
      .clear-btn {
        position: absolute;
        right: 14px;
        color: var(--text-secondary);
        font-family: var(--font-sans);
        font-size: 0.8rem;
      }
      .result-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .result-section h2 {
        font-size: 1.35rem;
        color: var(--gold-bright);
      }
      .paints-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
        gap: 10px;
      }
      .paint-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        gap: 10px;
      }
      .paint-main {
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
        flex: 1;
        min-width: 0;
      }
      .p-info {
        display: flex;
        flex-direction: column;
        font-family: var(--font-sans);
        font-size: 0.84rem;
      }
      .p-info span {
        font-size: 0.72rem;
        color: var(--text-secondary);
      }
      .cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 14px;
      }
      .result-card {
        display: flex;
        flex-direction: column;
        cursor: pointer;
      }
      .c-swatch-bar {
        height: 64px;
      }
      .m-img-box {
        height: 150px;
        background: #15181f;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 10px;
      }
      .m-img-box img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .r-body {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-family: var(--font-sans);
        font-size: 0.85rem;
      }
      .r-body span {
        font-size: 0.74rem;
        color: var(--text-secondary);
      }
    `,
  ],
})
export class SearchComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly paintModal = inject(PaintModalService);
  readonly img = inject(ImageService);
  readonly router = inject(Router);

  readonly query = signal<string>('');
  readonly tab = signal<'all' | 'models' | 'colours' | 'paints'>('all');

  readonly matchedCitadelPaints = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.catalog.paints().slice(0, 12);
    return this.catalog
      .paints()
      .filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  });

  readonly matchedThirdPartyPaints = computed(() => {
    const q = this.query().trim().toLowerCase();
    const allTp = [...this.userState.customPaints(), ...this.catalog.thirdPartyPaints()];
    if (!q) return allTp.slice(0, 12);
    return allTp.filter(
      (tp) =>
        tp.name.toLowerCase().includes(q) ||
        tp.brand.toLowerCase().includes(q) ||
        tp.range.toLowerCase().includes(q)
    );
  });

  readonly matchedColours = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.catalog.colours().slice(0, 12);
    return this.catalog
      .colours()
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.colourGroups.some((g) => g.toLowerCase().includes(q))
      );
  });

  readonly matchedModels = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.catalog.models().slice(0, 16);
    return this.catalog
      .models()
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.factionNames.some((f) => f.toLowerCase().includes(q)) ||
          m.gameNames.some((g) => g.toLowerCase().includes(q))
      );
  });

  readonly totalCount = computed(
    () =>
      this.matchedCitadelPaints().length +
      this.matchedThirdPartyPaints().length +
      this.matchedColours().length +
      this.matchedModels().length
  );
}
