import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CatalogService } from '../../../core/services/catalog.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { ImageService } from '../../../core/services/image.service';

@Component({
  selector: 'app-paint-detail-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (activePaintId(); as pid) {
      <div class="modal-backdrop" (click)="close()">
        <div class="modal-panel paint-modal" (click)="$event.stopPropagation()">
          <!-- Header -->
          <div class="modal-header">
            <div class="paint-header-main">
              @if (citadelPaint(); as cp) {
                <div class="pot-preview">
                  @if (cp.localImagePath || cp.imageUrl) {
                    <img
                      [src]="img.resolve(cp.localImagePath, cp.imageUrl)"
                      [alt]="cp.name"
                      class="pot-img"
                    />
                  } @else {
                    <div
                      class="paint-swatch large"
                      [style.background]="cp.gradientStartHex"
                    ></div>
                  }
                </div>
                <div>
                  <div class="badge-row">
                    @if (cp.range === 'warhammer_pro') {
                      <span class="badge badge-pro">Citadel Tone Pro</span>
                    } @else {
                      <span class="badge badge-gold">Citadel Colour</span>
                    }
                    <span class="badge category-badge">{{ cp.category }}</span>
                    <span class="hex-pill">{{ cp.gradientStartHex }}</span>
                  </div>
                  <h2 class="paint-title">{{ cp.name }}</h2>
                </div>
              } @else {
                @if (thirdPartyPaint(); as tp) {
                  <div class="pot-preview">
                    <div class="paint-swatch large" [style.background]="tp.hex"></div>
                  </div>
                  <div>
                    <div class="badge-row">
                      <span class="badge badge-sub">{{ tp.brand }} — {{ tp.range }}</span>
                      <span class="badge category-badge">{{ tp.category }}</span>
                      @if (tp.code) {
                        <span class="hex-pill">{{ tp.code }}</span>
                      }
                      <span class="hex-pill">{{ tp.hex }}</span>
                    </div>
                    <h2 class="paint-title">{{ tp.name }}</h2>
                  </div>
                }
              }
            </div>

            <button class="close-btn" (click)="close()" title="Close">✕</button>
          </div>

          <!-- Action Bar -->
          <div class="action-bar">
            <button
              class="btn"
              [class.btn-owned]="userState.isOwned(pid)"
              [class.btn-secondary]="!userState.isOwned(pid)"
              (click)="userState.toggleInventory(pid)"
            >
              <span>{{ userState.isOwned(pid) ? '✓ In Inventory' : '+ Add to Inventory' }}</span>
            </button>

            <button
              class="btn"
              [class.btn-wishlist]="userState.isWishlisted(pid)"
              [class.btn-secondary]="!userState.isWishlisted(pid)"
              (click)="userState.toggleWishlist(pid)"
            >
              <span>{{ userState.isWishlisted(pid) ? '★ On Wishlist' : '☆ Add to Wishlist' }}</span>
            </button>
          </div>

          <!-- Scrollable Body -->
          <div class="modal-body">
            <!-- Tone Pro 1-5 Pentad Strip -->
            @if (citadelPaint()?.warhammerProRange?.length) {
              <section class="modal-section">
                <h3 class="section-title">Tone Pro 1–5 Pentad System</h3>
                <p class="section-subtitle">
                  Official 5-step tonal progression for this Tone Pro triad/pentad family.
                </p>
                <div class="pentad-strip">
                  @for (step of citadelPaint()!.warhammerProRange!; track step.id; let idx = $index) {
                    <button
                      class="pentad-step"
                      [class.current]="step.id === pid"
                      (click)="selectPaint(step.id)"
                    >
                      <span class="pentad-num">{{ step.position || idx + 1 }}</span>
                      <span class="pentad-swatch" [style.background]="step.hex"></span>
                      <span class="pentad-name">{{ step.name }}</span>
                      @if (userState.isOwned(step.id)) {
                        <span class="owned-dot" title="Owned in Inventory">✓</span>
                      }
                    </button>
                  }
                </div>
              </section>
            }

            <!-- Official Citadel Classic <-> Tone Pro Equivalents -->
            @if (officialCitadelEquivalents().length > 0) {
              <section class="modal-section">
                <h3 class="section-title">
                  Official Citadel Classic ↔ Tone Pro Equivalents
                </h3>
                <div class="equiv-grid">
                  @for (eq of officialCitadelEquivalents(); track eq.id) {
                    <div class="equiv-card studio-card">
                      <button class="equiv-main" (click)="selectPaint(eq.id)">
                        <span class="paint-swatch" [style.background]="eq.hex"></span>
                        <div class="equiv-info">
                          <span class="equiv-name">{{ eq.name }}</span>
                          <span class="equiv-meta">{{ eq.label }}</span>
                        </div>
                      </button>
                      <button
                        class="btn btn-sm"
                        [class.btn-owned]="userState.isOwned(eq.id)"
                        [class.btn-ghost]="!userState.isOwned(eq.id)"
                        (click)="userState.toggleInventory(eq.id)"
                      >
                        {{ userState.isOwned(eq.id) ? '✓ Owned' : '+ Own' }}
                      </button>
                    </div>
                  }
                </div>
              </section>
            }

            <!-- Cross-Brand 3rd-Party Equivalents (for Citadel Paints) -->
            @if (citadelPaint()) {
              <section class="modal-section">
                <div class="section-header-row">
                  <div>
                    <h3 class="section-title">Cross-Brand 3rd-Party Paint Equivalents</h3>
                    <p class="section-subtitle">
                      Owning any linked equivalent satisfies "Can I Paint This?" when 3rd-party substitutions are enabled.
                    </p>
                  </div>
                </div>

                @if (crossBrandMatches().length > 0) {
                  <div class="equiv-grid">
                    @for (m of crossBrandMatches(); track m.thirdPartyPaintId) {
                      <div class="equiv-card studio-card">
                        <button class="equiv-main" (click)="selectPaint(m.thirdPartyPaintId)">
                          <span class="paint-swatch" [style.background]="m.hex"></span>
                          <div class="equiv-info">
                            <span class="equiv-name">{{ m.name }}</span>
                            <span class="equiv-meta">
                              {{ m.brand }} • {{ m.range }}
                              @if (m.code) { ({{ m.code }}) }
                            </span>
                            <span class="delta-badge" [attr.data-quality]="m.matchQuality">
                              ΔE {{ m.deltaE }} ({{ m.matchQuality }})
                            </span>
                          </div>
                        </button>
                        <button
                          class="btn btn-sm"
                          [class.btn-owned]="userState.isOwned(m.thirdPartyPaintId)"
                          [class.btn-ghost]="!userState.isOwned(m.thirdPartyPaintId)"
                          (click)="userState.toggleInventory(m.thirdPartyPaintId)"
                        >
                          {{ userState.isOwned(m.thirdPartyPaintId) ? '✓ Owned' : '+ Own' }}
                        </button>
                      </div>
                    }
                  </div>
                } @else {
                  <p class="empty-hint">No pre-seeded cross-brand matches for this technical/specialty paint.</p>
                }

                <!-- Custom Override Linker -->
                <div class="override-box">
                  <label class="override-label">Link Custom or 3rd-Party Equivalent Override:</label>
                  <div class="override-controls">
                    <select class="input-control" [(ngModel)]="selectedOverridePaintId">
                      <option value="">Select a 3rd-party or custom paint...</option>
                      @for (tp of allThirdPartyAndCustomPaints(); track tp.id) {
                        <option [value]="tp.id">{{ tp.brand }} — {{ tp.name }} ({{ tp.range }})</option>
                      }
                    </select>
                    <button
                      class="btn btn-secondary"
                      [disabled]="!selectedOverridePaintId"
                      (click)="addCustomLink(pid)"
                    >
                      + Link Equivalent
                    </button>
                  </div>
                </div>
              </section>
            }

            <!-- Citadel Matches (when viewing a 3rd-Party Paint) -->
            @if (thirdPartyPaint(); as tp) {
              <section class="modal-section">
                <h3 class="section-title">Equivalent Citadel Paints</h3>
                <div class="equiv-grid">
                  @for (cm of tp.citadelMatches; track cm.citadelPaintId) {
                    <div class="equiv-card studio-card">
                      <button class="equiv-main" (click)="selectPaint(cm.citadelPaintId)">
                        <span class="paint-swatch" [style.background]="cm.citadelHex"></span>
                        <div class="equiv-info">
                          <span class="equiv-name">{{ cm.citadelPaintName }}</span>
                          <span class="equiv-meta">
                            {{ cm.citadelRange === 'warhammer_pro' ? 'Tone Pro' : 'Citadel Classic' }} • {{ cm.citadelCategory }}
                          </span>
                          <span class="delta-badge" [attr.data-quality]="cm.matchQuality">
                            ΔE {{ cm.deltaE }} ({{ cm.matchQuality }})
                          </span>
                        </div>
                      </button>
                      <button
                        class="btn btn-sm"
                        [class.btn-owned]="userState.isOwned(cm.citadelPaintId)"
                        [class.btn-ghost]="!userState.isOwned(cm.citadelPaintId)"
                        (click)="userState.toggleInventory(cm.citadelPaintId)"
                      >
                        {{ userState.isOwned(cm.citadelPaintId) ? '✓ Owned' : '+ Own' }}
                      </button>
                    </div>
                  }
                </div>
              </section>
            }

            <!-- Reverse Lookups: Colours & Models using this Paint -->
            @if (citadelPaint()) {
              <section class="modal-section">
                <h3 class="section-title">
                  Colours Using This Paint ({{ coloursUsingPaint().length }})
                </h3>
                @if (coloursUsingPaint().length > 0) {
                  <div class="reverse-chip-list">
                    @for (col of coloursUsingPaint().slice(0, 24); track col.id) {
                      <button class="reverse-chip" (click)="goToColour(col.id)">
                        <span class="mini-dot" [style.background]="col.hex"></span>
                        <span>{{ col.name }}</span>
                      </button>
                    }
                  </div>
                } @else {
                  <p class="empty-hint">No colour guides directly list this paint.</p>
                }
              </section>

              <section class="modal-section">
                <h3 class="section-title">
                  Models Using This Paint ({{ modelsUsingPaint().length }})
                </h3>
                @if (modelsUsingPaint().length > 0) {
                  <div class="reverse-models-grid">
                    @for (mod of modelsUsingPaint().slice(0, 12); track mod.id) {
                      <button class="reverse-model-card studio-card interactive" (click)="goToModel(mod.id)">
                        <img
                          [src]="img.resolve(mod.localPrimaryImage, mod.primaryImage)"
                          [alt]="mod.name"
                          loading="lazy"
                        />
                        <span>{{ mod.name }}</span>
                      </button>
                    }
                  </div>
                } @else {
                  <p class="empty-hint">No model recipes directly list this paint.</p>
                }
              </section>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .paint-modal {
        max-width: 780px;
      }
      .modal-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 20px 24px;
        background: var(--bg-void);
        border-bottom: 1px solid var(--border-subtle);
      }
      .paint-header-main {
        display: flex;
        align-items: center;
        gap: 18px;
      }
      .pot-preview {
        width: 72px;
        height: 72px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.03);
        border-radius: var(--radius-md);
        border: 1px solid var(--border-subtle);
        padding: 6px;
        flex-shrink: 0;
      }
      .pot-img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .paint-swatch.large {
        width: 52px;
        height: 52px;
      }
      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 6px;
      }
      .category-badge {
        background: rgba(255, 255, 255, 0.08);
        color: var(--text-secondary);
      }
      .hex-pill {
        font-family: monospace;
        font-size: 0.75rem;
        padding: 2px 7px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.06);
        color: var(--text-muted);
      }
      .paint-title {
        font-size: 1.55rem;
        color: var(--text-primary);
      }
      .close-btn {
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: var(--bg-card);
        color: var(--text-secondary);
        font-size: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .close-btn:hover {
        background: var(--bg-card-hover);
        color: var(--text-primary);
      }
      .action-bar {
        display: flex;
        gap: 12px;
        padding: 14px 24px;
        background: var(--bg-elevated);
        border-bottom: 1px solid var(--border-subtle);
      }
      .modal-body {
        padding: 20px 24px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
      .modal-section {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .section-title {
        font-size: 1.05rem;
        color: var(--gold-bright);
      }
      .section-subtitle {
        font-size: 0.83rem;
        color: var(--text-secondary);
        font-family: var(--font-sans);
      }
      .pentad-strip {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 8px;
      }
      .pentad-step {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 10px 8px;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
        position: relative;
        text-align: center;
      }
      .pentad-step.current {
        border-color: var(--gold-bright);
        background: var(--gold-soft);
      }
      .pentad-num {
        font-family: var(--font-display);
        font-size: 0.85rem;
        color: var(--text-muted);
      }
      .pentad-swatch {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.25);
      }
      .pentad-name {
        font-family: var(--font-sans);
        font-size: 0.76rem;
        font-weight: 600;
        color: var(--text-primary);
      }
      .owned-dot {
        position: absolute;
        top: 6px;
        right: 6px;
        font-size: 0.7rem;
        color: var(--status-owned);
        font-weight: 700;
      }
      .equiv-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
        gap: 10px;
      }
      .equiv-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        gap: 10px;
      }
      .equiv-main {
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
        flex: 1;
        min-width: 0;
      }
      .equiv-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .equiv-name {
        font-family: var(--font-sans);
        font-weight: 700;
        font-size: 0.86rem;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .equiv-meta {
        font-family: var(--font-sans);
        font-size: 0.74rem;
        color: var(--text-secondary);
      }
      .delta-badge {
        font-family: var(--font-sans);
        font-size: 0.68rem;
        font-weight: 700;
        color: var(--status-sub);
        margin-top: 2px;
      }
      .delta-badge[data-quality='exact'] {
        color: var(--status-owned);
      }
      .override-box {
        margin-top: 8px;
        padding: 12px;
        background: var(--bg-void);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
      }
      .override-label {
        display: block;
        font-family: var(--font-sans);
        font-size: 0.78rem;
        color: var(--text-secondary);
        margin-bottom: 6px;
      }
      .override-controls {
        display: flex;
        gap: 8px;
      }
      .reverse-chip-list {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }
      .reverse-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 5px 11px;
        border-radius: var(--radius-pill);
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        font-family: var(--font-sans);
        font-size: 0.78rem;
        color: var(--text-primary);
      }
      .reverse-chip:hover {
        border-color: var(--gold-bright);
      }
      .mini-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.3);
      }
      .reverse-models-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
        gap: 10px;
      }
      .reverse-model-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px;
        gap: 6px;
        text-align: center;
      }
      .reverse-model-card img {
        width: 100%;
        height: 84px;
        object-fit: contain;
      }
      .reverse-model-card span {
        font-family: var(--font-sans);
        font-size: 0.74rem;
        font-weight: 600;
        color: var(--text-primary);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .empty-hint {
        font-family: var(--font-sans);
        font-size: 0.82rem;
        color: var(--text-muted);
      }
    `,
  ],
})
export class PaintDetailModalComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly modalService = inject(PaintModalService);
  readonly img = inject(ImageService);
  private readonly router = inject(Router);

  selectedOverridePaintId = '';

  readonly activePaintId = this.modalService.activePaintId;

  readonly citadelPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) return null;
    return this.catalog.paintById().get(id) ?? null;
  });

  readonly thirdPartyPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) return null;
    return (
      this.catalog.thirdPartyPaintById().get(id) ??
      this.userState.customPaints().find((c) => c.id === id) ??
      null
    );
  });

  readonly allThirdPartyAndCustomPaints = computed(() => [
    ...this.userState.customPaints(),
    ...this.catalog.thirdPartyPaints(),
  ]);

  readonly officialCitadelEquivalents = computed(() => {
    const cp = this.citadelPaint();
    if (!cp) return [];
    const results: { id: string; name: string; hex: string; label: string }[] = [];

    const proLinks = this.catalog.classicToToneProMap().get(cp.id) ?? [];
    for (const l of proLinks) {
      results.push({
        id: l.tone_pro_paint_id,
        name: l.tone_pro_paint_name,
        hex: l.tone_pro_hex,
        label: 'Citadel Tone Pro Equivalent',
      });
    }

    const classicLinks = this.catalog.toneProToClassicMap().get(cp.id) ?? [];
    for (const l of classicLinks) {
      const classicP = this.catalog.paintById().get(l.classic_paint_id);
      results.push({
        id: l.classic_paint_id,
        name: l.classic_paint_name,
        hex: classicP?.gradientStartHex ?? '#888888',
        label: `Citadel Classic (${l.classic_category})`,
      });
    }
    return results;
  });

  readonly crossBrandMatches = computed(() => {
    const cp = this.citadelPaint();
    if (!cp) return [];
    const preseeded = this.catalog.citadelToThirdPartyMap()[cp.id] ?? [];
    const userOverrideIds = this.userState.customCompatibilityOverrides()[cp.id] ?? [];
    const customList = userOverrideIds
      .map((id) => this.allThirdPartyAndCustomPaints().find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({
        thirdPartyPaintId: p.id,
        brand: p.brand,
        range: p.range,
        code: p.code,
        name: p.name,
        category: p.category,
        hex: p.hex,
        deltaE: 0,
        matchQuality: 'exact' as const,
      }));

    const seen = new Set<string>();
    const combined = [];
    for (const item of [...customList, ...preseeded]) {
      if (!seen.has(item.thirdPartyPaintId)) {
        seen.add(item.thirdPartyPaintId);
        combined.push(item);
      }
    }
    return combined;
  });

  readonly coloursUsingPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) return [];
    return this.catalog.coloursUsingPaintMap().get(id) ?? [];
  });

  readonly modelsUsingPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) return [];
    return this.catalog.modelsUsingPaintMap().get(id) ?? [];
  });

  selectPaint(id: string): void {
    this.modalService.openPaint(id);
  }

  addCustomLink(citadelPaintId: string): void {
    if (!this.selectedOverridePaintId) return;
    this.userState.linkCustomEquivalent(citadelPaintId, this.selectedOverridePaintId);
    this.selectedOverridePaintId = '';
  }

  goToColour(colourId: string): void {
    this.close();
    this.router.navigate(['/colours', colourId]);
  }

  goToModel(modelId: string): void {
    this.close();
    this.router.navigate(['/models', modelId]);
  }

  close(): void {
    this.modalService.close();
  }
}
