import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { UserStateService } from '../../core/services/user-state.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { ImageService } from '../../core/services/image.service';
import { ColourDetails, ColourStageStep } from '../../core/models/warhammer.models';

@Component({
  selector: 'app-colour-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="detail-page">
      <!-- Top Bar -->
      <div class="top-bar">
        <a routerLink="/colours" class="btn btn-ghost btn-sm">← Back to Paint A Colour</a>

        @if (colour(); as c) {
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
              + Add Colour to Project
            </button>
          </div>
        }
      </div>

      @if (loading()) {
        <div class="loading-card studio-card">
          <p>Loading colour guide & showcase stages...</p>
        </div>
      } @else {
        @if (colour(); as c) {
        <div class="hero-split">
          <!-- Left: Interactive Space Marine Backpack Showcase Image Switcher -->
          <div class="showcase-panel studio-card">
            <div class="showcase-stage">
              <img [src]="activeShowcaseImage()" [alt]="c.name" class="backpack-img" />
            </div>

            <!-- Interactive Finish Stage Switcher -->
            <div class="tier-switcher">
              <button
                class="tier-btn"
                [class.active]="activeTier() === 'base'"
                (click)="activeTier.set('base')"
              >
                <strong>1. Base Finish</strong>
                <span>Battle Ready</span>
              </button>
              <button
                class="tier-btn"
                [class.active]="activeTier() === 'detail'"
                (click)="activeTier.set('detail')"
              >
                <strong>2. Detail Finish</strong>
                <span>Shade & Layer</span>
              </button>
              <button
                class="tier-btn"
                [class.active]="activeTier() === 'artificer'"
                (click)="activeTier.set('artificer')"
              >
                <strong>3. Artificer Finish</strong>
                <span>Edge Highlights</span>
              </button>
            </div>
          </div>

          <!-- Right: Colour Metadata & Ordered Paint Steps -->
          <div class="steps-panel studio-card">
            <div class="colour-header">
              <span class="paint-swatch large" [style.background]="c.hex"></span>
              <div>
                <div class="badge-row">
                  @if (c.guideType === 'basing') {
                    <span class="badge badge-gold">Miniature Basing Guide</span>
                  } @else if (c.range === 'warhammer_pro') {
                    <span class="badge badge-pro">Citadel Tone Pro</span>
                  } @else {
                    <span class="badge badge-gold">Citadel Colour</span>
                  }
                  @for (grp of c.colourGroups; track grp) {
                    <span class="badge group-badge">{{ grp }}</span>
                  }
                  <span class="hex-pill">{{ c.hex }}</span>
                </div>
                <h1 class="colour-title">{{ c.name }}</h1>
              </div>
            </div>

            <!-- Readiness Bar -->
            <div class="readiness-box">
              <div class="ready-header">
                <strong>
                  Can I Paint This Colour? — {{ readiness().matchPercent }}% Ready
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

            <!-- Finish Tiers Breakdown -->
            <div class="tiers-list">
              @for (tierBlock of allTierBlocks(); track tierBlock.key) {
                <div
                  class="tier-block"
                  [class.highlighted]="activeTier() === tierBlock.key"
                  (click)="activeTier.set(tierBlock.key)"
                >
                  <div class="tier-block-header">
                    <h3>{{ tierBlock.label }}</h3>
                    <span class="tier-sub">{{ tierBlock.steps.length }} Step{{ tierBlock.steps.length === 1 ? '' : 's' }}</span>
                  </div>

                  <div class="stage-steps">
                    @for (st of tierBlock.steps; track st.id) {
                      @if (st.paint; as sp) {
                        <div class="stage-step-row" (click)="$event.stopPropagation()">
                          <button
                            class="step-paint-btn"
                            (click)="paintModal.openPaint(sp.id)"
                          >
                            <span class="step-order-num">{{ st.stepOrder }}</span>
                            <span
                              class="paint-swatch"
                              [style.background]="sp.hex || sp.gradientStartHex || '#888'"
                            ></span>
                            <div class="step-paint-info">
                              <strong>{{ sp.name }}</strong>
                              <span>{{ st.technique || sp.category }}</span>
                            </div>
                          </button>

                          <div class="step-paint-actions">
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
                                >
                                  ⇄ {{ sub.substituteName }}
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
                    }
                  </div>
                </div>
              }
            </div>
          </div>
        </div>

        <!-- Models Using This Colour -->
        @if (modelsUsingColour().length > 0) {
          <section class="reverse-section studio-card">
            <h2>Models Using "{{ c.name }}" ({{ modelsUsingColour().length }})</h2>
            <div class="models-grid">
              @for (m of modelsUsingColour().slice(0, 24); track m.id) {
                <div class="model-mini-card studio-card interactive" (click)="goToModel(m.id)">
                  <img
                    [src]="img.resolve(m.localPrimaryImage, m.primaryImage)"
                    [alt]="m.name"
                    loading="lazy"
                  />
                  <div class="mm-info">
                    <strong>{{ m.name }}</strong>
                    <span>{{ m.gameNames[0] }}</span>
                  </div>
                </div>
              }
            </div>
          </section>
        }
        }
      }

      <!-- Modal: Add Colour to Project -->
      @if (showProjectModal() && colour(); as c) {
        <div class="modal-backdrop" (click)="showProjectModal.set(false)">
          <div class="modal-panel" style="max-width: 480px" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3>Add "{{ c.name }}" to Project</h3>
              <button class="close-btn" (click)="showProjectModal.set(false)">✕</button>
            </div>
            <div class="modal-body">
              @if (userState.projects().length > 0) {
                <div class="proj-list">
                  @for (p of userState.projects(); track p.id) {
                    <button
                      class="proj-pick-btn studio-card"
                      (click)="addToExistingProject(p.id, c.id)"
                    >
                      <strong>{{ p.name }}</strong>
                      <span>{{ p.colourIds.includes(c.id) ? '✓ Already Added' : '+ Add to Project' }}</span>
                    </button>
                  }
                </div>
              }
              <hr class="divider" />
              <label class="field-label">Or Create a New Project with This Colour:</label>
              <div style="display: flex; gap: 8px">
                <input
                  type="text"
                  class="input-control"
                  placeholder="New project name..."
                  [(ngModel)]="newProjectName"
                />
                <button class="btn btn-gold" (click)="createProjectWithColour(c)">
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
        gap: 8px;
      }
      .loading-card {
        padding: 40px;
        text-align: center;
      }
      .hero-split {
        display: grid;
        grid-template-columns: minmax(300px, 1fr) minmax(340px, 1.2fr);
        gap: 20px;
      }
      @media (max-width: 900px) {
        .hero-split {
          grid-template-columns: 1fr;
        }
      }
      .showcase-panel {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 20px;
        background: radial-gradient(circle at center, #292f3b 0%, #14171d 100%);
      }
      .showcase-stage {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 340px;
      }
      .backpack-img {
        max-width: 100%;
        max-height: 360px;
        object-fit: contain;
        filter: drop-shadow(0 12px 24px rgba(0, 0, 0, 0.55));
      }
      .tier-switcher {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 8px;
        margin-top: 14px;
      }
      .tier-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 10px 8px;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
        font-family: var(--font-sans);
      }
      .tier-btn strong {
        font-size: 0.82rem;
        color: var(--text-primary);
      }
      .tier-btn span {
        font-size: 0.7rem;
        color: var(--text-secondary);
      }
      .tier-btn.active {
        border-color: var(--gold-bright);
        background: var(--gold-soft);
      }
      .tier-btn.active strong {
        color: var(--gold-bright);
      }
      .steps-panel {
        padding: 22px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .colour-header {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .paint-swatch.large {
        width: 56px;
        height: 56px;
      }
      .badge-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 4px;
      }
      .group-badge {
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
      .colour-title {
        font-size: 1.9rem;
        color: var(--gold-bright);
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
      .tiers-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .tier-block {
        padding: 14px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
        cursor: pointer;
      }
      .tier-block.highlighted {
        border-color: var(--gold-border);
      }
      .tier-block-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .tier-block-header h3 {
        font-size: 1.05rem;
        color: var(--gold-bright);
      }
      .tier-sub {
        font-family: var(--font-sans);
        font-size: 0.76rem;
        color: var(--text-secondary);
      }
      .stage-steps {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .stage-step-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 10px;
        background: var(--bg-card);
        border-radius: var(--radius-xs);
      }
      .step-paint-btn {
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
        flex: 1;
        min-width: 0;
      }
      .step-order-num {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: var(--bg-void);
        color: var(--gold-bright);
        font-family: var(--font-display);
        font-size: 0.78rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .step-paint-info {
        display: flex;
        flex-direction: column;
        font-family: var(--font-sans);
        font-size: 0.84rem;
      }
      .step-paint-info span {
        font-size: 0.72rem;
        color: var(--text-secondary);
      }
      .step-paint-actions {
        display: flex;
        gap: 6px;
      }
      .reverse-section {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .models-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 12px;
      }
      .model-mini-card {
        display: flex;
        flex-direction: column;
        padding: 10px;
        gap: 8px;
        cursor: pointer;
      }
      .model-mini-card img {
        width: 100%;
        height: 120px;
        object-fit: contain;
      }
      .mm-info {
        display: flex;
        flex-direction: column;
        font-family: var(--font-sans);
        font-size: 0.8rem;
      }
      .mm-info span {
        font-size: 0.72rem;
        color: var(--text-secondary);
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
export class ColourDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly readinessService = inject(InventoryMatchService);
  readonly paintModal = inject(PaintModalService);
  readonly img = inject(ImageService);

  readonly loading = signal(true);
  readonly colour = signal<ColourDetails | null>(null);
  readonly activeTier = signal<'base' | 'detail' | 'artificer'>('artificer');
  readonly showProjectModal = signal(false);
  newProjectName = '';

  constructor() {
    this.route.paramMap.subscribe(async (params) => {
      const id = params.get('id');
      if (!id) return;
      this.loading.set(true);
      const data = await this.catalog.getColourDetails(id);
      this.colour.set(data);
      this.loading.set(false);
    });
  }

  readonly activeShowcaseImage = computed(() => {
    const c = this.colour();
    if (!c) return '/icons/ic_colour.svg';
    const tier = this.activeTier();
    if (tier === 'base' && (c.baseFinish?.localBackpackImagePath || c.baseFinish?.backpackImage)) {
      return this.img.resolve(c.baseFinish.localBackpackImagePath, c.baseFinish.backpackImage);
    }
    if (
      tier === 'detail' &&
      (c.detailFinish?.localBackpackImagePath || c.detailFinish?.backpackImage)
    ) {
      return this.img.resolve(c.detailFinish.localBackpackImagePath, c.detailFinish.backpackImage);
    }
    if (
      tier === 'artificer' &&
      (c.artificerFinish?.localBackpackImagePath || c.artificerFinish?.backpackImage)
    ) {
      return this.img.resolve(
        c.artificerFinish.localBackpackImagePath,
        c.artificerFinish.backpackImage
      );
    }
    return this.img.resolve(
      c.localImagePath || c.localHeaderImagePath,
      c.imageUrl || c.headerImage
    );
  });

  readonly allTierBlocks = computed(() => {
    const c = this.colour();
    if (!c) return [];
    const blocks: {
      key: 'base' | 'detail' | 'artificer';
      label: string;
      steps: ColourStageStep[];
    }[] = [];
    if (c.baseFinish?.stages?.length) {
      blocks.push({ key: 'base', label: 'Base Finish (Battle Ready)', steps: c.baseFinish.stages });
    }
    if (c.detailFinish?.stages?.length) {
      blocks.push({
        key: 'detail',
        label: 'Detail Finish (Parade Ready)',
        steps: c.detailFinish.stages,
      });
    }
    if (c.artificerFinish?.stages?.length) {
      blocks.push({
        key: 'artificer',
        label: 'Artificer Finish (Masterclass)',
        steps: c.artificerFinish.stages,
      });
    }
    return blocks;
  });

  readonly readiness = computed(() => {
    const c = this.colour();
    if (!c) return this.readinessService.evaluateReadiness([]);
    const pids: string[] = [];
    for (const block of this.allTierBlocks()) {
      for (const st of block.steps) {
        if (st.paint?.id) pids.push(st.paint.id);
      }
    }
    return this.readinessService.evaluateReadiness(pids);
  });

  readonly modelsUsingColour = computed(() => {
    const c = this.colour();
    if (!c) return [];
    return this.catalog.modelsUsingColourMap().get(c.id) ?? [];
  });

  goToModel(id: string): void {
    this.router.navigate(['/models', id]);
  }

  addToExistingProject(projectId: string, colourId: string): void {
    this.userState.addColourToProject(projectId, colourId);
    this.showProjectModal.set(false);
  }

  createProjectWithColour(c: ColourDetails): void {
    const created = this.userState.createProject(
      this.newProjectName || `${c.name} Scheme`,
      c.imageUrl,
      c.localImagePath
    );
    this.userState.addColourToProject(created.id, c.id);
    this.newProjectName = '';
    this.showProjectModal.set(false);
  }
}
