import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CatalogService } from '../../core/services/catalog.service';
import { UserStateService } from '../../core/services/user-state.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { ImageService } from '../../core/services/image.service';
import { UserProjectNote, UserProjectNoteComponent } from '../../core/models/warhammer.models';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, DragDropModule],
  template: `
    @if (project(); as proj) {
      <div class="project-page">
        <!-- Back & Breadcrumb -->
        <div class="top-nav-row">
          <a routerLink="/hobby-desk" class="btn btn-ghost btn-sm">← Back to Hobby Desk</a>
          <div class="top-actions">
            <button class="btn btn-secondary btn-sm" (click)="showThumbnailModal.set(true)">
              🖼 Change Thumbnail
            </button>
            <button class="btn btn-secondary btn-sm" (click)="duplicateAndOpen(proj.id)">
              ⧉ Duplicate Project
            </button>
            <button class="btn btn-ghost btn-sm danger-text" (click)="deleteProject(proj.id, proj.name)">
              🗑 Delete
            </button>
          </div>
        </div>

        <!-- Project Hero Banner -->
        <header class="project-hero studio-card">
          <div class="hero-thumb-box" (click)="showThumbnailModal.set(true)" title="Click to change thumbnail">
            <img [src]="coverUrl()" [alt]="proj.name" />
          </div>

          <div class="hero-info">
            @if (editingTitle()) {
              <div class="title-edit-row">
                <input
                  type="text"
                  class="input-control"
                  [(ngModel)]="titleDraft"
                  (keyup.enter)="saveTitle(proj.id)"
                />
                <button class="btn btn-gold btn-sm" (click)="saveTitle(proj.id)">Save</button>
                <button class="btn btn-ghost btn-sm" (click)="editingTitle.set(false)">Cancel</button>
              </div>
            } @else {
              <div class="title-display-row">
                <h1>{{ proj.name }}</h1>
                <button class="btn btn-ghost btn-sm" (click)="startEditTitle(proj.name)">✎ Rename</button>
              </div>
            }

            <div class="hero-meta">
              <span>{{ proj.recipeIds.length }} Model Guides</span>
              <span>•</span>
              <span>{{ proj.colourIds.length }} Colour Guides</span>
              <span>•</span>
              <span>{{ proj.notes.length }} Notes</span>
              <span>•</span>
              <span>Updated {{ proj.updatedAt | date:'mediumDate' }}</span>
            </div>

            <!-- Overall Readiness Progress Bar -->
            @if (rollupReadiness(); as ready) {
              <div class="readiness-summary">
                <div class="readiness-bar-header">
                  <strong>
                    Project Paint Readiness: {{ ready.matchPercent }}%
                    ({{ ready.ownedDirectCount + ready.substitutedCount }} / {{ ready.totalRequired }} Required Paints Covered)
                  </strong>
                  @if (ready.missingCount > 0) {
                    <button
                      class="btn btn-gold btn-sm"
                      (click)="userState.addManyToWishlist(ready.missingPaintIds)"
                    >
                      ★ Add All {{ ready.missingCount }} Missing Paints to Wishlist
                    </button>
                  }
                </div>
                <div class="progress-track">
                  <div
                    class="progress-fill"
                    [style.width.%]="ready.matchPercent"
                    [class.complete]="ready.matchPercent === 100"
                  ></div>
                </div>
              </div>
            }
          </div>
        </header>

        <!-- Sub-Tabs -->
        <nav class="subtab-bar">
          <button
            class="subtab-btn"
            [class.active]="activeTab() === 'paints'"
            (click)="activeTab.set('paints')"
          >
            🎨 Required & Missing Paints ({{ rollupReadiness().totalRequired }})
          </button>
          <button
            class="subtab-btn"
            [class.active]="activeTab() === 'models'"
            (click)="activeTab.set('models')"
          >
            🛡 Models ({{ attachedModels().length }})
          </button>
          <button
            class="subtab-btn"
            [class.active]="activeTab() === 'colours'"
            (click)="activeTab.set('colours')"
          >
            💧 Colours ({{ attachedColours().length }})
          </button>
          <button
            class="subtab-btn"
            [class.active]="activeTab() === 'notes'"
            (click)="activeTab.set('notes')"
          >
            📝 Notes & Checklists ({{ proj.notes.length }})
          </button>
        </nav>

        <!-- ==================================================================
             TAB 1: AGGREGATED REQUIRED & MISSING PAINTS ROLLUP
             ================================================================== -->
        @if (activeTab() === 'paints') {
          <section class="rollup-section">
            @if (rollupReadiness().totalRequired === 0) {
              <div class="empty-box studio-card">
                <h3>No Paints Required Yet</h3>
                <p>Add Model Painting Guides or Colour Guides to this project to automatically compute all required & missing paints.</p>
                <div style="display: flex; gap: 10px">
                  <button class="btn btn-gold" (click)="showAddModelModal.set(true)">+ Add Model Guide</button>
                  <button class="btn btn-secondary" (click)="showAddColourModal.set(true)">+ Add Colour Guide</button>
                </div>
              </div>
            } @else {
              <!-- Missing Paints Group -->
              <div class="paint-group studio-card">
                <div class="group-header">
                  <div>
                    <span class="badge badge-missing">Missing Paints ({{ missingPaintObjects().length }})</span>
                    <p class="group-sub">Paints required by your project's models & colours that are not yet in your Inventory.</p>
                  </div>
                  @if (missingPaintObjects().length > 0) {
                    <div class="group-actions">
                      <button
                        class="btn btn-gold btn-sm"
                        (click)="userState.addManyToWishlist(rollupReadiness().missingPaintIds)"
                      >
                        ★ Add All Missing to Wishlist
                      </button>
                      <button
                        class="btn btn-secondary btn-sm"
                        (click)="userState.addManyToInventory(rollupReadiness().missingPaintIds)"
                      >
                        ✓ Mark All as Owned
                      </button>
                    </div>
                  }
                </div>

                @if (missingPaintObjects().length > 0) {
                  <div class="rollup-paint-grid">
                    @for (p of missingPaintObjects(); track p.id) {
                      <div class="rollup-paint-card">
                        <button class="rp-main" (click)="paintModal.openPaint(p.id)">
                          <span class="paint-swatch" [style.background]="p.gradientStartHex"></span>
                          <div class="rp-info">
                            <span class="rp-name">{{ p.name }}</span>
                            <span class="rp-meta">{{ p.category }}</span>
                          </div>
                        </button>
                        <div class="rp-btns">
                          <button
                            class="btn btn-sm"
                            [class.btn-owned]="userState.isOwned(p.id)"
                            [class.btn-ghost]="!userState.isOwned(p.id)"
                            (click)="userState.toggleInventory(p.id)"
                          >
                            + Own
                          </button>
                          <button
                            class="btn btn-sm"
                            [class.btn-wishlist]="userState.isWishlisted(p.id)"
                            [class.btn-ghost]="!userState.isWishlisted(p.id)"
                            (click)="userState.toggleWishlist(p.id)"
                          >
                            {{ userState.isWishlisted(p.id) ? '★ Wishlisted' : '☆ Wishlist' }}
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                } @else {
                  <p class="all-covered-msg">🎉 You own every paint (or a valid equivalent) needed for this project!</p>
                }
              </div>

              <!-- Covered by Equivalent (Tone Pro or 3rd-Party) -->
              @if (substitutedList().length > 0) {
                <div class="paint-group studio-card">
                  <div class="group-header">
                    <div>
                      <span class="badge badge-sub">Covered by Equivalent in Inventory ({{ substitutedList().length }})</span>
                      <p class="group-sub">Required Citadel paints satisfied by Tone Pro or 3rd-party paints you already own.</p>
                    </div>
                  </div>
                  <div class="rollup-paint-grid">
                    @for (item of substitutedList(); track item.paint.id) {
                      <div class="rollup-paint-card sub-card">
                        <button class="rp-main" (click)="paintModal.openPaint(item.paint.id)">
                          <span class="paint-swatch" [style.background]="item.paint.gradientStartHex"></span>
                          <div class="rp-info">
                            <span class="rp-name">{{ item.paint.name }}</span>
                            <span class="sub-note">
                              ⇄ Covered by <strong>{{ item.sub.substituteName }}</strong> ({{ item.sub.substituteBrand }})
                            </span>
                          </div>
                        </button>
                      </div>
                    }
                  </div>
                </div>
              }

              <!-- Owned Directly -->
              @if (ownedDirectObjects().length > 0) {
                <div class="paint-group studio-card">
                  <div class="group-header">
                    <div>
                      <span class="badge badge-owned">Owned Directly in Inventory ({{ ownedDirectObjects().length }})</span>
                    </div>
                  </div>
                  <div class="rollup-paint-grid">
                    @for (p of ownedDirectObjects(); track p.id) {
                      <div class="rollup-paint-card">
                        <button class="rp-main" (click)="paintModal.openPaint(p.id)">
                          <span class="paint-swatch" [style.background]="p.gradientStartHex"></span>
                          <div class="rp-info">
                            <span class="rp-name">{{ p.name }}</span>
                            <span class="rp-meta">{{ p.category }}</span>
                          </div>
                        </button>
                        <span class="badge badge-owned">✓ Owned</span>
                      </div>
                    }
                  </div>
                </div>
              }
            }
          </section>
        }

        <!-- ==================================================================
             TAB 2: ATTACHED MODELS
             ================================================================== -->
        @if (activeTab() === 'models') {
          <section class="tab-section">
            <div class="section-bar">
              <h3>Attached Model Painting Guides ({{ attachedModels().length }})</h3>
              <button class="btn btn-gold btn-sm" (click)="showAddModelModal.set(true)">
                + Add Model to Project
              </button>
            </div>

            @if (attachedModels().length > 0) {
              <div class="cards-grid">
                @for (m of attachedModels(); track m.id) {
                  <div class="attached-card studio-card interactive" (click)="goToModel(m.id)">
                    <div class="attached-img-wrap">
                      <img [src]="img.resolve(m.localPrimaryImage, m.primaryImage)" [alt]="m.name" />
                    </div>
                    <div class="attached-body">
                      <h4>{{ m.name }}</h4>
                      <p>{{ m.gameNames.join(', ') }}</p>
                    </div>
                    <div class="attached-footer" (click)="$event.stopPropagation()">
                      <button
                        class="btn btn-ghost btn-sm danger-text"
                        (click)="userState.removeRecipeFromProject(proj.id, m.id)"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <div class="empty-box studio-card">
                <p>No Model Painting Guides attached to this project yet.</p>
                <button class="btn btn-gold btn-sm" (click)="showAddModelModal.set(true)">
                  + Add Model Guide
                </button>
              </div>
            }
          </section>
        }

        <!-- ==================================================================
             TAB 3: ATTACHED COLOURS
             ================================================================== -->
        @if (activeTab() === 'colours') {
          <section class="tab-section">
            <div class="section-bar">
              <h3>Attached Colour Guides ({{ attachedColours().length }})</h3>
              <button class="btn btn-gold btn-sm" (click)="showAddColourModal.set(true)">
                + Add Colour to Project
              </button>
            </div>

            @if (attachedColours().length > 0) {
              <div class="cards-grid">
                @for (c of attachedColours(); track c.id) {
                  <div class="attached-card studio-card interactive" (click)="goToColour(c.id)">
                    <div class="colour-banner" [style.background]="c.hex"></div>
                    <div class="attached-body">
                      <h4>{{ c.name }}</h4>
                      <p>{{ c.colourGroups.join(', ') }} • {{ c.requiredPaintIds.length }} Paints</p>
                    </div>
                    <div class="attached-footer" (click)="$event.stopPropagation()">
                      <button
                        class="btn btn-ghost btn-sm danger-text"
                        (click)="userState.removeColourFromProject(proj.id, c.id)"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                }
              </div>
            } @else {
              <div class="empty-box studio-card">
                <p>No Colour Guides attached to this project yet.</p>
                <button class="btn btn-gold btn-sm" (click)="showAddColourModal.set(true)">
                  + Add Colour Guide
                </button>
              </div>
            }
          </section>
        }

        <!-- ==================================================================
             TAB 4: PROJECT NOTES & CHECKLISTS (WITH DRAG-AND-DROP)
             ================================================================== -->
        @if (activeTab() === 'notes') {
          <section class="tab-section">
            <div class="section-bar">
              <h3>Hobby Notes & Painting Checklists ({{ proj.notes.length }})</h3>
              <button class="btn btn-gold btn-sm" (click)="openNoteEditor(null)">
                + New Note / Checklist
              </button>
            </div>

            @if (proj.notes.length > 0) {
              <div class="notes-grid">
                @for (note of proj.notes; track note.id) {
                  <div class="note-card studio-card">
                    <div class="note-header">
                      <h4>{{ note.title }}</h4>
                      <div class="note-actions">
                        <button class="btn btn-ghost btn-sm" (click)="openNoteEditor(note)">
                          ✎ Edit
                        </button>
                        <button
                          class="btn btn-ghost btn-sm danger-text"
                          (click)="userState.deleteProjectNote(proj.id, note.id)"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    <div class="note-components">
                      @for (comp of note.components; track $index; let idx = $index) {
                        @if (comp.type === 'checkbox') {
                          <label class="note-checkbox-row" [class.done]="comp.checked">
                            <input
                              type="checkbox"
                              [checked]="comp.checked"
                              (change)="userState.toggleNoteCheckbox(proj.id, note.id, idx)"
                            />
                            <span>{{ comp.value }}</span>
                          </label>
                        } @else {
                          <p class="note-text-block">{{ comp.value }}</p>
                        }
                      }
                    </div>
                  </div>
                }
              </div>
            } @else {
              <div class="empty-box studio-card">
                <p>Add free-form painting notes, army recipe reminders, or interactive step checklists.</p>
                <button class="btn btn-gold btn-sm" (click)="openNoteEditor(null)">
                  + Create First Note
                </button>
              </div>
            }
          </section>
        }
      </div>

      <!-- Modal: Block Note & Checklist Editor (with CDK Drag & Drop) -->
      @if (editingNoteOpen()) {
        <div class="modal-backdrop" (click)="editingNoteOpen.set(false)">
          <div class="modal-panel" style="max-width: 640px" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3>{{ editingNoteId() ? 'Edit Project Note' : 'New Project Note' }}</h3>
              <button class="close-btn" (click)="editingNoteOpen.set(false)">✕</button>
            </div>
            <div class="modal-body">
              <label class="field-label">Note Title</label>
              <input
                type="text"
                class="input-control"
                placeholder="e.g., Batch Painting Checklist, Basing Recipe..."
                [(ngModel)]="noteTitleDraft"
              />

              <div class="blocks-toolbar">
                <span class="field-label">Blocks (Drag handle ☰ to reorder):</span>
                <div style="display: flex; gap: 8px">
                  <button class="btn btn-secondary btn-sm" (click)="addNoteBlock('text')">
                    + Text Paragraph
                  </button>
                  <button class="btn btn-secondary btn-sm" (click)="addNoteBlock('checkbox')">
                    ☑ + Checklist Item
                  </button>
                </div>
              </div>

              <div
                cdkDropList
                class="blocks-list"
                (cdkDropListDropped)="dropNoteBlock($event)"
              >
                @for (block of noteBlocksDraft; track $index; let idx = $index) {
                  <div class="block-item" cdkDrag>
                    <span class="drag-handle" cdkDragHandle title="Drag to reorder">☰</span>
                    @if (block.type === 'checkbox') {
                      <input type="checkbox" [(ngModel)]="block.checked" />
                    } @else {
                      <span class="block-tag">TXT</span>
                    }
                    <input
                      type="text"
                      class="input-control"
                      [placeholder]="block.type === 'checkbox' ? 'Checklist step...' : 'Note text...'"
                      [(ngModel)]="block.value"
                    />
                    <button class="btn btn-ghost btn-sm danger-text" (click)="removeNoteBlock(idx)">
                      ✕
                    </button>
                  </div>
                }
              </div>

              <div class="modal-footer-btns">
                <button class="btn btn-ghost" (click)="editingNoteOpen.set(false)">Cancel</button>
                <button class="btn btn-gold" (click)="saveNote(proj.id)">Save Note</button>
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Modal: Add Model Picker -->
      @if (showAddModelModal()) {
        <div class="modal-backdrop" (click)="showAddModelModal.set(false)">
          <div class="modal-panel" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3>Add Model Guide to "{{ proj.name }}"</h3>
              <button class="close-btn" (click)="showAddModelModal.set(false)">✕</button>
            </div>
            <div class="modal-body">
              <input
                type="text"
                class="input-control"
                placeholder="Search 4,531 models by name or faction..."
                [(ngModel)]="pickerSearch"
              />
              <div class="picker-grid">
                @for (m of pickerModels(); track m.id) {
                  <div class="picker-item studio-card">
                    <img [src]="img.resolve(m.localPrimaryImage, m.primaryImage)" [alt]="m.name" />
                    <div class="picker-info">
                      <strong>{{ m.name }}</strong>
                      <span>{{ m.gameNames[0] }}</span>
                    </div>
                    <button
                      class="btn btn-sm btn-gold"
                      (click)="userState.addRecipeToProject(proj.id, m.id, m.localPrimaryImage)"
                    >
                      + Add
                    </button>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Modal: Add Colour Picker -->
      @if (showAddColourModal()) {
        <div class="modal-backdrop" (click)="showAddColourModal.set(false)">
          <div class="modal-panel" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3>Add Colour Guide to "{{ proj.name }}"</h3>
              <button class="close-btn" (click)="showAddColourModal.set(false)">✕</button>
            </div>
            <div class="modal-body">
              <input
                type="text"
                class="input-control"
                placeholder="Search 596 colour schemes..."
                [(ngModel)]="pickerSearch"
              />
              <div class="picker-grid">
                @for (c of pickerColours(); track c.id) {
                  <div class="picker-item studio-card">
                    <span class="paint-swatch" [style.background]="c.hex"></span>
                    <div class="picker-info">
                      <strong>{{ c.name }}</strong>
                      <span>{{ c.colourGroups.join(', ') }}</span>
                    </div>
                    <button
                      class="btn btn-sm btn-gold"
                      (click)="userState.addColourToProject(proj.id, c.id)"
                    >
                      + Add
                    </button>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      }

      <!-- Modal: Change Project Thumbnail -->
      @if (showThumbnailModal()) {
        <div class="modal-backdrop" (click)="showThumbnailModal.set(false)">
          <div class="modal-panel" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h3>Choose Project Thumbnail</h3>
              <button class="close-btn" (click)="showThumbnailModal.set(false)">✕</button>
            </div>
            <div class="modal-body">
              <input
                type="text"
                class="input-control"
                placeholder="Search any miniature artwork to use as project cover..."
                [(ngModel)]="pickerSearch"
              />
              <div class="picker-grid">
                @for (m of pickerModels(); track m.id) {
                  <div class="picker-item studio-card">
                    <img [src]="img.resolve(m.localPrimaryImage, m.primaryImage)" [alt]="m.name" />
                    <div class="picker-info">
                      <strong>{{ m.name }}</strong>
                    </div>
                    <button
                      class="btn btn-sm btn-gold"
                      (click)="selectThumbnail(proj.id, m.localPrimaryImage || '', m.primaryImage)"
                    >
                      Use Cover
                    </button>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      }
    } @else {
      <div class="empty-box studio-card">
        <h3>Project Not Found</h3>
        <a routerLink="/hobby-desk" class="btn btn-gold">Return to Hobby Desk</a>
      </div>
    }
  `,
  styles: [
    `
      .project-page {
        display: flex;
        flex-direction: column;
        gap: 18px;
      }
      .top-nav-row {
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
      .project-hero {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        padding: 20px;
        align-items: center;
      }
      .hero-thumb-box {
        width: 140px;
        height: 140px;
        border-radius: var(--radius-md);
        background: radial-gradient(circle, #2a303c 0%, #13161c 100%);
        border: 1px solid var(--border-strong);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 10px;
        cursor: pointer;
      }
      .hero-thumb-box img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .hero-info {
        flex: 1;
        min-width: 260px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .title-display-row,
      .title-edit-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .title-display-row h1 {
        font-size: 1.85rem;
        color: var(--gold-bright);
      }
      .hero-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        font-family: var(--font-sans);
        font-size: 0.84rem;
        color: var(--text-secondary);
      }
      .readiness-summary {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 4px;
        padding: 12px 14px;
        background: var(--bg-void);
        border-radius: var(--radius-sm);
        border: 1px solid var(--border-subtle);
      }
      .readiness-bar-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        font-family: var(--font-sans);
        font-size: 0.85rem;
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
        transition: width 0.25s ease;
      }
      .progress-fill.complete {
        background: var(--status-owned);
      }
      .subtab-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        border-bottom: 1px solid var(--border-subtle);
        padding-bottom: 10px;
      }
      .subtab-btn {
        padding: 9px 15px;
        border-radius: var(--radius-sm);
        font-family: var(--font-sans);
        font-weight: 600;
        font-size: 0.86rem;
        color: var(--text-secondary);
        background: var(--bg-elevated);
      }
      .subtab-btn.active {
        background: var(--gold-soft);
        color: var(--gold-bright);
        border: 1px solid var(--gold-border);
      }
      .rollup-section {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .paint-group {
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .group-header {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .group-sub {
        font-family: var(--font-sans);
        font-size: 0.8rem;
        color: var(--text-secondary);
        margin-top: 4px;
      }
      .group-actions {
        display: flex;
        gap: 8px;
      }
      .rollup-paint-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
        gap: 10px;
      }
      .rollup-paint-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
      }
      .rp-main {
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
        flex: 1;
        min-width: 0;
      }
      .rp-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .rp-name {
        font-family: var(--font-sans);
        font-weight: 700;
        font-size: 0.86rem;
        color: var(--text-primary);
      }
      .rp-meta {
        font-family: var(--font-sans);
        font-size: 0.74rem;
        color: var(--text-secondary);
      }
      .sub-note {
        font-family: var(--font-sans);
        font-size: 0.74rem;
        color: var(--status-sub);
      }
      .rp-btns {
        display: flex;
        gap: 6px;
      }
      .all-covered-msg {
        font-family: var(--font-sans);
        color: var(--status-owned);
        font-weight: 600;
      }
      .tab-section {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .section-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .cards-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
        gap: 14px;
      }
      .attached-card {
        display: flex;
        flex-direction: column;
        cursor: pointer;
      }
      .attached-img-wrap {
        height: 150px;
        background: #161920;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 10px;
      }
      .attached-img-wrap img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .colour-banner {
        height: 76px;
      }
      .attached-body {
        padding: 12px;
        flex: 1;
      }
      .attached-body p {
        font-family: var(--font-sans);
        font-size: 0.78rem;
        color: var(--text-secondary);
      }
      .attached-footer {
        padding: 8px 12px;
        border-top: 1px solid var(--border-subtle);
        display: flex;
        justify-content: flex-end;
      }
      .notes-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 14px;
      }
      .note-card {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .note-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--border-subtle);
        padding-bottom: 8px;
      }
      .note-components {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .note-checkbox-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: var(--font-sans);
        font-size: 0.88rem;
        cursor: pointer;
      }
      .note-checkbox-row.done span {
        text-decoration: line-through;
        color: var(--text-muted);
      }
      .note-text-block {
        font-family: var(--font-body);
        font-size: 0.9rem;
        color: var(--text-secondary);
        white-space: pre-wrap;
      }
      .blocks-toolbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 8px;
      }
      .blocks-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 300px;
        overflow-y: auto;
      }
      .block-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-xs);
      }
      .drag-handle {
        cursor: grab;
        color: var(--text-muted);
        padding: 0 4px;
      }
      .block-tag {
        font-family: monospace;
        font-size: 0.7rem;
        color: var(--gold-bright);
      }
      .picker-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 10px;
        max-height: 400px;
        overflow-y: auto;
        margin-top: 10px;
      }
      .picker-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
      }
      .picker-item img {
        width: 48px;
        height: 48px;
        object-fit: contain;
      }
      .picker-info {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        font-family: var(--font-sans);
        font-size: 0.8rem;
      }
      .picker-info span {
        font-size: 0.72rem;
        color: var(--text-secondary);
      }
      .empty-box {
        padding: 32px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
      .danger-text {
        color: #f87171 !important;
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
      .modal-footer-btns {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 12px;
      }
    `,
  ],
})
export class ProjectDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly readinessService = inject(InventoryMatchService);
  readonly paintModal = inject(PaintModalService);
  readonly img = inject(ImageService);

  readonly projectId = signal<string>('');
  readonly activeTab = signal<'paints' | 'models' | 'colours' | 'notes'>('paints');

  readonly editingTitle = signal(false);
  titleDraft = '';

  // Modals
  readonly showAddModelModal = signal(false);
  readonly showAddColourModal = signal(false);
  readonly showThumbnailModal = signal(false);
  pickerSearch = '';

  // Note editor
  readonly editingNoteOpen = signal(false);
  readonly editingNoteId = signal<string | null>(null);
  noteTitleDraft = '';
  noteBlocksDraft: UserProjectNoteComponent[] = [];

  constructor() {
    this.route.paramMap.subscribe((params) => {
      this.projectId.set(params.get('id') ?? '');
    });
  }

  readonly project = computed(() =>
    this.userState.projects().find((p) => p.id === this.projectId()) ?? null
  );

  readonly attachedModels = computed(() => {
    const p = this.project();
    if (!p) return [];
    const map = this.catalog.modelById();
    return p.recipeIds.map((id) => map.get(id)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  });

  readonly attachedColours = computed(() => {
    const p = this.project();
    if (!p) return [];
    const map = this.catalog.colourById();
    return p.colourIds.map((id) => map.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  });

  readonly coverUrl = computed(() => {
    const p = this.project();
    if (!p) return '/icons/ic_project.svg';
    if (p.localThumbnailPath || p.thumbnailUrl) {
      return this.img.resolve(p.localThumbnailPath, p.thumbnailUrl);
    }
    const firstModel = this.attachedModels()[0];
    if (firstModel) {
      return this.img.resolve(firstModel.localPrimaryImage, firstModel.primaryImage);
    }
    return '/icons/ic_project.svg';
  });

  readonly rollupReadiness = computed(() => {
    const paintIds = new Set<string>();
    for (const m of this.attachedModels()) {
      m.requiredPaintIds.forEach((id) => paintIds.add(id));
    }
    for (const c of this.attachedColours()) {
      c.requiredPaintIds.forEach((id) => paintIds.add(id));
    }
    return this.readinessService.evaluateReadiness(Array.from(paintIds));
  });

  readonly missingPaintObjects = computed(() => {
    const map = this.catalog.paintById();
    return this.rollupReadiness()
      .missingPaintIds.map((id) => map.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  });

  readonly ownedDirectObjects = computed(() => {
    const map = this.catalog.paintById();
    return this.rollupReadiness()
      .ownedDirectIds.map((id) => map.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  });

  readonly substitutedList = computed(() => {
    const map = this.catalog.paintById();
    const subs = this.rollupReadiness().substitutedByPaintId;
    return Object.entries(subs)
      .map(([pid, sub]) => {
        const paint = map.get(pid);
        return paint ? { paint, sub } : null;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  });

  readonly pickerModels = computed(() => {
    const q = this.pickerSearch.trim().toLowerCase();
    const list = this.catalog.models();
    if (!q) return list.slice(0, 40);
    return list
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.factionNames.some((f) => f.toLowerCase().includes(q))
      )
      .slice(0, 40);
  });

  readonly pickerColours = computed(() => {
    const q = this.pickerSearch.trim().toLowerCase();
    const list = this.catalog.colours();
    if (!q) return list.slice(0, 40);
    return list.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 40);
  });

  startEditTitle(current: string): void {
    this.titleDraft = current;
    this.editingTitle.set(true);
  }

  saveTitle(projectId: string): void {
    this.userState.renameProject(projectId, this.titleDraft);
    this.editingTitle.set(false);
  }

  selectThumbnail(projectId: string, localPath: string, remoteUrl?: string): void {
    this.userState.setProjectThumbnail(projectId, localPath, remoteUrl);
    this.showThumbnailModal.set(false);
  }

  duplicateAndOpen(projectId: string): void {
    const copy = this.userState.duplicateProject(projectId);
    if (copy) {
      this.router.navigate(['/projects', copy.id]);
    }
  }

  deleteProject(projectId: string, name: string): void {
    if (confirm(`Delete project "${name}"?`)) {
      this.userState.deleteProject(projectId);
      this.router.navigate(['/hobby-desk']);
    }
  }

  openNoteEditor(note: UserProjectNote | null): void {
    if (note) {
      this.editingNoteId.set(note.id);
      this.noteTitleDraft = note.title;
      this.noteBlocksDraft = structuredClone(note.components);
    } else {
      this.editingNoteId.set(null);
      this.noteTitleDraft = '';
      this.noteBlocksDraft = [
        { type: 'text', value: '' },
        { type: 'checkbox', value: 'Prime miniatures', checked: false },
      ];
    }
    this.editingNoteOpen.set(true);
  }

  addNoteBlock(type: 'text' | 'checkbox'): void {
    this.noteBlocksDraft.push({ type, value: '', checked: false });
  }

  removeNoteBlock(idx: number): void {
    this.noteBlocksDraft.splice(idx, 1);
  }

  dropNoteBlock(event: CdkDragDrop<UserProjectNoteComponent[]>): void {
    moveItemInArray(this.noteBlocksDraft, event.previousIndex, event.currentIndex);
  }

  saveNote(projectId: string): void {
    const cleaned = this.noteBlocksDraft.filter((b) => b.value.trim().length > 0);
    this.userState.saveProjectNote(
      projectId,
      this.editingNoteId(),
      this.noteTitleDraft,
      cleaned
    );
    this.editingNoteOpen.set(false);
  }

  goToModel(id: string): void {
    this.router.navigate(['/models', id]);
  }

  goToColour(id: string): void {
    this.router.navigate(['/colours', id]);
  }
}
