import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { UserStateService } from '../../core/services/user-state.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { ImageService } from '../../core/services/image.service';
import { ModelRecipe } from '../../core/models/warhammer.models';

@Component({
  selector: 'app-model-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="detail-page">
      <!-- Top Bar -->
      <div class="top-bar">
        <a routerLink="/models" class="btn btn-ghost btn-sm">← Back to Paint A Model</a>

        @if (recipe(); as r) {
          <div class="top-actions">
            @if (readiness().missingCount > 0) {
              <button
                class="btn btn-gold btn-sm"
                (click)="userState.addManyToWishlist(readiness().missingPaintIds)"
              >
                ★ Add {{ readiness().missingCount }} Missing Paints to Wishlist
              </button>
            }
            <button class="btn btn-secondary btn-sm" (click)="showProjectModal.set(true)">
              + Add Model to Project
            </button>
          </div>
        }
      </div>

      @if (loading()) {
        <div class="loading-card studio-card">
          <p>Loading model recipe & interactive colour points...</p>
        </div>
      } @else {
        @if (recipe(); as r) {
        <!-- Top Split Layout: Interactive Model Image + Colour Points on Left, Summary & Colours on Right -->
        <div class="hero-split">
          <!-- Left Column: High-Res Image Viewer with Interactive (x,y) Colour Point Pins -->
          <div class="viewer-panel studio-card">
            <div class="main-img-stage">
              <div class="img-overlay-box">
                <img
                  [src]="activeImageUrl()"
                  [alt]="r.name"
                  class="stage-img"
                />

                <!-- Interactive Normalized (x,y) Colour Pins on Primary Angle -->
                @if (selectedImageIndex() === 0 && showPins() && r.colourPoints?.length) {
                  @for (cp of r.colourPoints; track cp.id) {
                    <button
                      class="colour-pin"
                      [class.active]="selectedColourPointId() === cp.id"
                      [style.left.%]="cp.point.x * 100"
                      [style.top.%]="cp.point.y * 100"
                      [style.background]="cp.hex"
                      (click)="selectColourPoint(cp.id)"
                      [title]="cp.name"
                    >
                      <span class="pin-ring"></span>
                    </button>
                  }
                }
              </div>
            </div>

            <!-- Viewer Footer: Angle Thumbnails & Pin Toggle -->
            <div class="viewer-controls">
              @if (r.images.length > 1) {
                <div class="angle-thumbs">
                  @for (imgUrl of r.images; track $index; let idx = $index) {
                    <button
                      class="angle-thumb"
                      [class.active]="selectedImageIndex() === idx"
                      (click)="selectedImageIndex.set(idx)"
                    >
                      <img
                        [src]="img.resolve(r.localImagePaths?.[idx], imgUrl)"
                        alt=""
                      />
                    </button>
                  }
                </div>
              }

              @if (r.colourPoints?.length) {
                <button
                  class="btn btn-sm btn-ghost"
                  (click)="showPins.set(!showPins())"
                >
                  {{ showPins() ? '👁 Hide Colour Pins' : '👁 Show Colour Pins' }} ({{ r.colourPoints.length }})
                </button>
              }
            </div>
          </div>

          <!-- Right Column: Model Metadata, Readiness & "Colours On This Model" -->
          <div class="meta-panel studio-card">
            <div class="badge-row">
              @if (r.range === 'warhammer_pro') {
                <span class="badge badge-pro">Citadel Tone Pro Guide</span>
              } @else {
                <span class="badge badge-gold">Citadel Colour Guide</span>
              }
              @for (g of r.games; track g.id) {
                <span class="badge game-badge">{{ g.name }}</span>
              }
            </div>

            <h1 class="model-title">{{ r.name }}</h1>

            @if (r.factions?.length) {
              <p class="factions-line">
                {{ formatFactions(r) }}
              </p>
            }

            <!-- "Can I Paint This?" Readiness Box -->
            <div class="readiness-box">
              <div class="ready-header">
                <strong>
                  Can I Paint This? — {{ readiness().matchPercent }}% Ready
                </strong>
                <span>
                  {{ readiness().ownedDirectCount }} Owned •
                  {{ readiness().substitutedCount }} Substituted •
                  {{ readiness().missingCount }} Missing
                </span>
              </div>
              <div class="progress-track">
                <div
                  class="progress-fill"
                  [style.width.%]="readiness().matchPercent"
                  [class.complete]="readiness().matchPercent === 100"
                ></div>
              </div>
            </div>

            <!-- Colours On This Model (Linked to interactive pins) -->
            @if (r.colourPoints?.length) {
              <div class="colours-on-model">
                <h3>Colours On This Model ({{ r.colourPoints.length }})</h3>
                <p class="hint">Click a pin on the miniature or a colour below to inspect or open its Colour Guide.</p>

                <div class="cp-list">
                  @for (cp of r.colourPoints; track cp.id) {
                    <div
                      class="cp-card"
                      [class.active]="selectedColourPointId() === cp.id"
                      (click)="selectColourPoint(cp.id)"
                    >
                      <span class="paint-swatch" [style.background]="cp.hex"></span>
                      <div class="cp-info">
                        <strong>{{ cp.name }}</strong>
                        <span>Normalized Pin ({{ (cp.point.x * 100) | number:'1.0-0' }}%, {{ (cp.point.y * 100) | number:'1.0-0' }}%)</span>
                      </div>
                      @if (cp.colourId) {
                        <button
                          class="btn btn-sm btn-secondary"
                          (click)="$event.stopPropagation(); goToColour(cp.colourId)"
                        >
                          Open Guide →
                        </button>
                      }
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Painting Areas & Step-by-Step Instructions -->
        @if (r.paintingAreas?.length) {
          <section class="areas-section">
            <div class="areas-header">
              <div>
                <h2>Step-by-Step Painting Areas ({{ r.paintingAreas.length }})</h2>
                <p class="subtitle">
                  Filter steps by progressive finish tier or click any paint pot to inspect Tone Pro & 3rd-party equivalents.
                </p>
              </div>

              <div class="chip-bar">
                <button
                  class="chip"
                  [class.active]="stageFilter() === 'all'"
                  (click)="stageFilter.set('all')"
                >
                  All Stages
                </button>
                <button
                  class="chip"
                  [class.active]="stageFilter() === 'Base Finish'"
                  (click)="stageFilter.set('Base Finish')"
                >
                  Base Finish (Battle Ready)
                </button>
                <button
                  class="chip"
                  [class.active]="stageFilter() === 'Detail Finish'"
                  (click)="stageFilter.set('Detail Finish')"
                >
                  Detail Finish (Parade Ready)
                </button>
                <button
                  class="chip"
                  [class.active]="stageFilter() === 'Artificer Finish'"
                  (click)="stageFilter.set('Artificer Finish')"
                >
                  Artificer Finish
                </button>
              </div>
            </div>

            <div class="areas-list">
              @for (area of r.paintingAreas; track area.id) {
                <div class="area-card studio-card">
                  <div class="area-header">
                    <div class="area-title-group">
                      @if (area.localImagePath || area.imageUrl) {
                        <img
                          [src]="img.resolve(area.localImagePath, area.imageUrl)"
                          [alt]="area.name"
                          class="area-thumb"
                        />
                      }
                      <div>
                        <h3>{{ area.name }}</h3>
                        @if (area.subsectionName) {
                          <span class="area-sub">{{ area.subsectionName }}</span>
                        }
                      </div>
                    </div>
                  </div>

                  <div class="steps-grid">
                    @for (step of filterSteps(area.paintingSteps); track step.id) {
                      <div class="step-card">
                        <div class="step-top">
                          <span class="step-num-badge">Step {{ step.stepNumber || step.stepOrder }}</span>
                          <span class="stage-pill">{{ step.paintingStage }}</span>
                          @if (step.techniqueName) {
                            <span class="tech-pill">{{ step.techniqueName }}</span>
                          }
                          @if (step.brushName) {
                            <span class="brush-pill">🖌 {{ step.brushName }}</span>
                          }
                        </div>

                        @if (step.localImagePath || step.imageUrl) {
                          <div class="step-img-box">
                            <img
                              [src]="img.resolve(step.localImagePath, step.imageUrl)"
                              [alt]="step.title || step.techniqueName || ''"
                              loading="lazy"
                            />
                          </div>
                        }

                        @if (step.text) {
                          <p class="step-text">{{ step.text }}</p>
                        }

                        @if (step.paint; as sp) {
                          <div class="step-paint-box">
                            <button
                              class="step-paint-main"
                              (click)="paintModal.openPaint(sp.id)"
                            >
                              <span
                                class="paint-swatch"
                                [style.background]="sp.gradientStartHex || '#888'"
                              ></span>
                              <div class="sp-info">
                                <strong>{{ sp.name }}</strong>
                                <span>{{ sp.category }}</span>
                              </div>
                            </button>

                            <div class="sp-actions">
                              @if (userState.isOwned(sp.id)) {
                                <button
                                  class="btn btn-sm btn-owned"
                                  (click)="userState.toggleInventory(sp.id)"
                                >
                                  ✓ Owned
                                </button>
                              } @else {
                                @if (readiness().substitutedByPaintId[sp.id]; as sub) {
                                  <button
                                    class="btn btn-sm badge-sub"
                                    (click)="paintModal.openPaint(sp.id)"
                                    title="Covered by equivalent in your Inventory"
                                  >
                                    ⇄ Covered by {{ sub.substituteName }}
                                  </button>
                                } @else {
                                  <button
                                    class="btn btn-sm btn-ghost"
                                    (click)="userState.toggleInventory(sp.id)"
                                  >
                                    + Own
                                  </button>
                                  <button
                                    class="btn btn-sm"
                                    [class.btn-wishlist]="userState.isWishlisted(sp.id)"
                                    [class.btn-ghost]="!userState.isWishlisted(sp.id)"
                                    (click)="userState.toggleWishlist(sp.id)"
                                  >
                                    {{ userState.isWishlisted(sp.id) ? '★' : '☆' }}
                                  </button>
                                }
                              }
                            </div>
                          </div>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          </section>
        }
        }
      }

      <!-- Modal: Add Model to Project -->
      @if (showProjectModal() && recipe(); as r) {
        <div class="modal-backdrop" (click)="showProjectModal.set(false)">
          <div class="modal-panel" style="max-width: 480px" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3>Add "{{ r.name }}" to Project</h3>
              <button class="close-btn" (click)="showProjectModal.set(false)">✕</button>
            </div>
            <div class="modal-body">
              @if (userState.projects().length > 0) {
                <div class="proj-list">
                  @for (p of userState.projects(); track p.id) {
                    <button
                      class="proj-pick-btn studio-card"
                      (click)="addToExistingProject(p.id, r)"
                    >
                      <strong>{{ p.name }}</strong>
                      <span>{{ p.recipeIds.includes(r.id) ? '✓ Already Added' : '+ Add to Project' }}</span>
                    </button>
                  }
                </div>
              }
              <hr class="divider" />
              <label class="field-label">Or Create a New Project with This Model:</label>
              <div style="display: flex; gap: 8px">
                <input
                  type="text"
                  class="input-control"
                  placeholder="New project name..."
                  [(ngModel)]="newProjectName"
                />
                <button class="btn btn-gold" (click)="createProjectWithModel(r)">
                  Create & Add
                </button>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .detail-page {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .top-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
      }
      .top-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .loading-card {
        padding: 40px;
        text-align: center;
      }
      .hero-split {
        display: grid;
        grid-template-columns: minmax(320px, 1.15fr) minmax(320px, 1fr);
        gap: 20px;
      }
      @media (max-width: 920px) {
        .hero-split {
          grid-template-columns: 1fr;
        }
      }
      .viewer-panel {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 18px;
        background: radial-gradient(circle at center, #282e3b 0%, #14171e 100%);
      }
      .main-img-stage {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 390px;
      }
      .img-overlay-box {
        position: relative;
        display: inline-block;
        max-width: 100%;
      }
      .stage-img {
        display: block;
        max-width: 100%;
        max-height: 440px;
        object-fit: contain;
      }
      .colour-pin {
        position: absolute;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid #ffffff;
        transform: translate(-50%, -50%);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.75);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        z-index: 5;
      }
      .colour-pin:hover,
      .colour-pin.active {
        transform: translate(-50%, -50%) scale(1.35);
        border-color: var(--gold-bright);
        box-shadow: 0 0 0 4px rgba(237, 179, 4, 0.45);
        z-index: 10;
      }
      .viewer-controls {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border-subtle);
      }
      .angle-thumbs {
        display: flex;
        gap: 8px;
        overflow-x: auto;
      }
      .angle-thumb {
        width: 54px;
        height: 54px;
        border-radius: var(--radius-xs);
        border: 2px solid var(--border-subtle);
        background: var(--bg-void);
        padding: 4px;
      }
      .angle-thumb.active {
        border-color: var(--gold-bright);
      }
      .angle-thumb img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }
      .meta-panel {
        padding: 22px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .game-badge {
        background: rgba(255, 255, 255, 0.08);
        color: var(--text-secondary);
      }
      .model-title {
        font-size: 2rem;
        color: var(--gold-bright);
      }
      .factions-line {
        font-family: var(--font-sans);
        font-size: 0.86rem;
        color: var(--text-secondary);
      }
      .readiness-box {
        padding: 12px 14px;
        background: var(--bg-void);
        border-radius: var(--radius-sm);
        border: 1px solid var(--border-subtle);
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .ready-header {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 0.82rem;
      }
      .ready-header span {
        color: var(--text-secondary);
      }
      .progress-track {
        height: 8px;
        background: #232832;
        border-radius: 999px;
        overflow: hidden;
      }
      .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--gold-primary), var(--gold-bright));
      }
      .progress-fill.complete {
        background: var(--status-owned);
      }
      .colours-on-model {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 4px;
      }
      .colours-on-model h3 {
        font-size: 1.1rem;
      }
      .hint {
        font-family: var(--font-sans);
        font-size: 0.78rem;
        color: var(--text-muted);
      }
      .cp-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 270px;
        overflow-y: auto;
      }
      .cp-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
        cursor: pointer;
      }
      .cp-card.active {
        border-color: var(--gold-bright);
        background: var(--gold-soft);
      }
      .cp-info {
        display: flex;
        flex-direction: column;
        flex: 1;
        font-family: var(--font-sans);
        font-size: 0.84rem;
      }
      .cp-info span {
        font-size: 0.72rem;
        color: var(--text-secondary);
      }
      .areas-section {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .areas-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .areas-list {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .area-card {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .area-header {
        border-bottom: 1px solid var(--border-subtle);
        padding-bottom: 12px;
      }
      .area-title-group {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .area-thumb {
        width: 56px;
        height: 56px;
        object-fit: contain;
        background: var(--bg-void);
        border-radius: var(--radius-xs);
        padding: 4px;
      }
      .area-sub {
        font-family: var(--font-sans);
        font-size: 0.8rem;
        color: var(--text-secondary);
      }
      .steps-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
        gap: 14px;
      }
      .step-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
      }
      .step-top {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        font-family: var(--font-sans);
        font-size: 0.72rem;
        font-weight: 700;
      }
      .step-num-badge {
        padding: 2px 8px;
        border-radius: 4px;
        background: var(--gold-soft);
        color: var(--gold-bright);
      }
      .stage-pill {
        padding: 2px 8px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.07);
        color: var(--text-secondary);
      }
      .tech-pill {
        padding: 2px 8px;
        border-radius: 4px;
        background: rgba(56, 189, 248, 0.14);
        color: var(--status-sub);
      }
      .brush-pill {
        color: var(--text-muted);
      }
      .step-img-box {
        height: 150px;
        background: var(--bg-void);
        border-radius: var(--radius-xs);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 8px;
      }
      .step-img-box img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .step-text {
        font-size: 0.86rem;
        color: var(--text-secondary);
      }
      .step-paint-box {
        margin-top: auto;
        padding-top: 10px;
        border-top: 1px solid var(--border-subtle);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .step-paint-main {
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
        min-width: 0;
      }
      .sp-info {
        display: flex;
        flex-direction: column;
        font-family: var(--font-sans);
        font-size: 0.82rem;
      }
      .sp-info span {
        font-size: 0.72rem;
        color: var(--text-secondary);
      }
      .sp-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }
      .proj-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .proj-pick-btn {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        font-family: var(--font-sans);
        font-size: 0.86rem;
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border-subtle);
      }
      .modal-body {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
    `,
  ],
})
export class ModelDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly readinessService = inject(InventoryMatchService);
  readonly paintModal = inject(PaintModalService);
  readonly img = inject(ImageService);

  readonly loading = signal(true);
  readonly recipe = signal<ModelRecipe | null>(null);
  readonly selectedImageIndex = signal(0);
  readonly showPins = signal(true);
  readonly selectedColourPointId = signal<string | null>(null);
  readonly stageFilter = signal<'all' | 'Base Finish' | 'Detail Finish' | 'Artificer Finish'>('all');

  readonly showProjectModal = signal(false);
  newProjectName = '';

  constructor() {
    this.route.paramMap.subscribe(async (params) => {
      const id = params.get('id');
      if (!id) return;
      this.loading.set(true);
      this.selectedImageIndex.set(0);
      const data = await this.catalog.getModelRecipe(id);
      this.recipe.set(data);
      this.selectedColourPointId.set(data?.colourPoints?.[0]?.id ?? null);
      this.loading.set(false);
    });
  }

  readonly activeImageUrl = computed(() => {
    const r = this.recipe();
    if (!r) return '/icons/ic_models.svg';
    const idx = this.selectedImageIndex();
    return this.img.resolve(r.localImagePaths?.[idx], r.images?.[idx]);
  });

  readonly readiness = computed(() => {
    const r = this.recipe();
    if (!r) return this.readinessService.evaluateReadiness([]);
    const paintIds: string[] = [];
    for (const area of r.paintingAreas ?? []) {
      for (const step of area.paintingSteps ?? []) {
        if (step.paint?.id) paintIds.push(step.paint.id);
      }
    }
    if (paintIds.length === 0) {
      const summary = this.catalog.modelById().get(r.id);
      if (summary) return this.readinessService.evaluateReadiness(summary.requiredPaintIds);
    }
    return this.readinessService.evaluateReadiness(paintIds);
  });

  formatFactions(r: ModelRecipe): string {
    const names = new Set<string>();
    for (const f of r.factions ?? []) {
      if (f.parentFactionName) names.add(f.parentFactionName);
      if (f.factionName) names.add(f.factionName);
    }
    return Array.from(names).join(' • ');
  }

  selectColourPoint(cpId: string): void {
    this.selectedColourPointId.set(cpId);
  }

  filterSteps(steps: ModelRecipe['paintingAreas'][0]['paintingSteps']) {
    const sf = this.stageFilter();
    if (sf === 'all') return steps;
    return steps.filter((s) => s.paintingStage === sf);
  }

  goToColour(colourId: string): void {
    this.router.navigate(['/colours', colourId]);
  }

  addToExistingProject(projectId: string, r: ModelRecipe): void {
    this.userState.addRecipeToProject(projectId, r.id, r.localImagePaths?.[0]);
    this.showProjectModal.set(false);
  }

  createProjectWithModel(r: ModelRecipe): void {
    const created = this.userState.createProject(
      this.newProjectName || r.name,
      r.images?.[0],
      r.localImagePaths?.[0]
    );
    this.userState.addRecipeToProject(created.id, r.id, r.localImagePaths?.[0]);
    this.newProjectName = '';
    this.showProjectModal.set(false);
  }
}
