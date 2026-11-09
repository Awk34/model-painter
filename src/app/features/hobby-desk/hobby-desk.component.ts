import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { UserStateService } from '../../core/services/user-state.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { ImageService } from '../../core/services/image.service';
import { WarhammerImportService } from '../../core/services/warhammer-import.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import {
  FirebaseClientConfig,
  getStoredFirebaseConfig,
  saveFirebaseConfig,
} from '../../core/services/firebase.config';

interface UnifiedPaintRow {
  id: string;
  name: string;
  brand: string;
  rangeLabel: string;
  category: string;
  hex: string;
  localImagePath?: string;
  imageUrl?: string;
  isCitadel: boolean;
  isTonePro: boolean;
  code?: string;
}

@Component({
  selector: 'app-hobby-desk',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  template: `
    <div class="page-container">
      <!-- Top Hero Header -->
      <header class="desk-header">
        <div class="desk-title-group">
          <img src="/icons/ic_hobby_desk.svg" alt="" class="desk-icon" />
          <div>
            <h1>Hobby Desk</h1>
            <p class="subtitle">
              Manage your projects, paint inventory, wishlist, cross-brand equivalents, and My Warhammer account sync.
            </p>
          </div>
        </div>

        <div class="desk-kpi-strip">
          <button class="kpi-pill" (click)="activeTab.set('projects')">
            <span class="kpi-num">{{ userState.projects().length }}</span>
            <span class="kpi-label">Projects</span>
          </button>
          <button class="kpi-pill owned" (click)="openPaintsTab('inventory')">
            <span class="kpi-num">{{ userState.state().inventoryPaintIds.length }}</span>
            <span class="kpi-label">Owned Paints</span>
          </button>
          <button class="kpi-pill wishlist" (click)="openPaintsTab('wishlist')">
            <span class="kpi-num">{{ userState.state().wishlistPaintIds.length }}</span>
            <span class="kpi-label">Wishlist</span>
          </button>
        </div>
      </header>

      <!-- Sub-Navigation Tabs -->
      <nav class="subtab-bar">
        <button
          class="subtab-btn"
          [class.active]="activeTab() === 'projects'"
          (click)="activeTab.set('projects')"
        >
          <img src="/icons/ic_project.svg" alt="" class="tab-ic" />
          <span>My Projects ({{ userState.projects().length }})</span>
        </button>

        <button
          class="subtab-btn"
          [class.active]="activeTab() === 'paints'"
          (click)="activeTab.set('paints')"
        >
          <img src="/icons/ic_paint.svg" alt="" class="tab-ic" />
          <span>My Paints & Catalogue</span>
        </button>

        <button
          class="subtab-btn"
          [class.active]="activeTab() === 'converter'"
          (click)="activeTab.set('converter')"
        >
          <img src="/icons/ic_compare.svg" alt="" class="tab-ic" />
          <span>Cross-Brand Converter</span>
        </button>

        <button
          class="subtab-btn"
          [class.active]="activeTab() === 'settings'"
          (click)="activeTab.set('settings')"
        >
          <img src="/icons/ic_inventory.svg" alt="" class="tab-ic" />
          <span>Account & Data Sync</span>
        </button>
      </nav>

      <!-- Quick Onboarding Banner when Blank Slate -->
      @if (
        userState.projects().length === 0 &&
        userState.state().inventoryPaintIds.length === 0 &&
        userState.state().wishlistPaintIds.length === 0 &&
        activeTab() !== 'settings'
      ) {
        <div class="onboarding-banner studio-card">
          <div class="onboarding-text">
            <h3>Start Fresh or Import a My Warhammer Account</h3>
            <p>
              Your local browser Hobby Desk starts with a clean slate. Create projects and track paints below, import your own live
              <strong>My Warhammer</strong> account via Auth0 PKCE, or load the extracted APK account snapshot (64 owned paints, 34 wishlist paints, and 5 projects) with one click.
            </p>
          </div>
          <div class="onboarding-actions">
            <button class="btn btn-gold" (click)="loadExtractedSnapshot()">
              ⚡ Load Extracted Account Snapshot
            </button>
            <button class="btn btn-secondary" (click)="activeTab.set('settings')">
              Import Another My Warhammer Account →
            </button>
          </div>
        </div>
      }

      <!-- ====================================================================
           SUB-TAB 1: MY PROJECTS
           ==================================================================== -->
      @if (activeTab() === 'projects') {
        <section class="tab-content">
          <div class="toolbar-row">
            <div class="search-box">
              <input
                type="text"
                class="input-control"
                placeholder="Search your projects..."
                [(ngModel)]="projectSearch"
              />
            </div>

            <div class="toolbar-right">
              <select class="input-control sort-select" [(ngModel)]="projectSort">
                <option value="updated">Recently Updated</option>
                <option value="created">Newest Created</option>
                <option value="alpha">Alphabetical (A–Z)</option>
              </select>

              <button class="btn btn-gold" (click)="showNewProjectModal.set(true)">
                + New Project
              </button>
            </div>
          </div>

          @if (filteredProjects().length > 0) {
            <div class="projects-grid">
              @for (proj of filteredProjects(); track proj.id) {
                <div class="project-card studio-card interactive" (click)="openProject(proj.id)">
                  <div class="project-thumb-wrap">
                    <img
                      [src]="getProjectCover(proj)"
                      [alt]="proj.name"
                      class="project-thumb"
                    />
                    @if (getProjectReadiness(proj); as ready) {
                      <span
                        class="readiness-pill"
                        [class.full]="ready.matchPercent === 100"
                      >
                        {{ ready.matchPercent }}% Paint Ready ({{ ready.ownedDirectCount + ready.substitutedCount }}/{{ ready.totalRequired }})
                      </span>
                    }
                  </div>

                  <div class="project-body">
                    <h3 class="project-title">{{ proj.name }}</h3>
                    <div class="project-counts">
                      <span>{{ proj.recipeIds.length }} Models</span>
                      <span>•</span>
                      <span>{{ proj.colourIds.length }} Colours</span>
                      <span>•</span>
                      <span>{{ proj.notes.length }} Notes</span>
                    </div>
                  </div>

                  <div class="project-footer" (click)="$event.stopPropagation()">
                    <button
                      class="btn btn-sm btn-ghost"
                      (click)="userState.duplicateProject(proj.id)"
                      title="Duplicate Project"
                    >
                      Duplicate
                    </button>
                    <button
                      class="btn btn-sm btn-ghost danger-text"
                      (click)="confirmDeleteProject(proj.id, proj.name)"
                      title="Delete Project"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <div class="empty-state studio-card">
              <img src="/icons/ic_project.svg" alt="" class="empty-ic" />
              <h3>No Projects Yet</h3>
              <p>
                Create a hobby project to group model recipes, colour guides, painting checklists, and see an automatic rollup of required & missing paints.
              </p>
              <div class="empty-btn-row">
                <button class="btn btn-gold" (click)="showNewProjectModal.set(true)">
                  + Create First Project
                </button>
                <button class="btn btn-secondary" (click)="loadExtractedSnapshot()">
                  Load Extracted Account Snapshot (5 Projects)
                </button>
              </div>
            </div>
          }
        </section>
      }

      <!-- ====================================================================
           SUB-TAB 2: MY PAINTS (INVENTORY, WISHLIST, CATALOGUE & CUSTOM PAINTS)
           ==================================================================== -->
      @if (activeTab() === 'paints') {
        <section class="tab-content">
          <div class="paints-mode-row">
            <div class="chip-bar">
              <button
                class="chip"
                [class.active]="paintSubMode() === 'inventory'"
                (click)="paintSubMode.set('inventory')"
              >
                ✓ My Inventory ({{ userState.state().inventoryPaintIds.length }})
              </button>
              <button
                class="chip"
                [class.active]="paintSubMode() === 'wishlist'"
                (click)="paintSubMode.set('wishlist')"
              >
                ★ My Wishlist ({{ userState.state().wishlistPaintIds.length }})
              </button>
              <button
                class="chip"
                [class.active]="paintSubMode() === 'catalogue'"
                (click)="paintSubMode.set('catalogue')"
              >
                All Paints Catalogue ({{ allUnifiedPaints().length }})
              </button>
            </div>

            <button class="btn btn-secondary" (click)="showCustomPaintModal.set(true)">
              + Add Custom 3rd-Party Paint
            </button>
          </div>

          <div class="toolbar-row">
            <div class="search-box">
              <input
                type="text"
                class="input-control"
                placeholder="Search by paint name, hex code, brand, or SKU..."
                [(ngModel)]="paintSearch"
              />
            </div>

            <div class="toolbar-right">
              <select class="input-control filter-select" [(ngModel)]="selectedBrandFilter">
                <option value="all">All Brands</option>
                <option value="Citadel Classic">Citadel Colour (Classic)</option>
                <option value="Citadel Tone Pro">Citadel Tone Pro</option>
                @for (b of catalog.thirdPartyBrands(); track b) {
                  <option [value]="b">{{ b }}</option>
                }
              </select>

              <select class="input-control filter-select" [(ngModel)]="selectedCategoryFilter">
                <option value="all">All Categories</option>
                @for (cat of availableCategories(); track cat) {
                  <option [value]="cat">{{ cat }}</option>
                }
              </select>
            </div>
          </div>

          @if (filteredPaints().length > 0) {
            <div class="paints-grid">
              @for (p of filteredPaints(); track p.id) {
                <div class="paint-card studio-card">
                  <button class="paint-card-main" (click)="paintModal.openPaint(p.id)">
                    @if (p.localImagePath) {
                      <img
                        [src]="img.resolve(p.localImagePath, p.imageUrl)"
                        [alt]="p.name"
                        class="paint-pot-thumb"
                        loading="lazy"
                      />
                    } @else {
                      <span class="paint-swatch" [style.background]="p.hex"></span>
                    }

                    <div class="paint-card-info">
                      <span class="paint-card-name">{{ p.name }}</span>
                      <div class="paint-card-meta">
                        <span
                          class="mini-brand"
                          [class.pro]="p.isTonePro"
                          [class.tp]="!p.isCitadel"
                        >
                          {{ p.rangeLabel }}
                        </span>
                        <span>• {{ p.category }}</span>
                      </div>
                    </div>
                  </button>

                  <div class="paint-card-actions">
                    <button
                      class="icon-toggle"
                      [class.active-owned]="userState.isOwned(p.id)"
                      (click)="userState.toggleInventory(p.id)"
                      title="Toggle Inventory"
                    >
                      {{ userState.isOwned(p.id) ? '✓ Owned' : '+ Own' }}
                    </button>
                    <button
                      class="icon-toggle"
                      [class.active-wish]="userState.isWishlisted(p.id)"
                      (click)="userState.toggleWishlist(p.id)"
                      title="Toggle Wishlist"
                    >
                      {{ userState.isWishlisted(p.id) ? '★' : '☆' }}
                    </button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <div class="empty-state studio-card">
              <h3>No Matching Paints</h3>
              <p>
                @if (paintSubMode() === 'inventory') {
                  Your Inventory has no paints matching the current filters. Switch to "All Paints Catalogue" to add pots you own, or import your My Warhammer account.
                } @else if (paintSubMode() === 'wishlist') {
                  Your Wishlist is currently empty. Add missing paints from any Model, Colour, or Project guide!
                } @else {
                  No paints match your current search or brand/category filter.
                }
              </p>
              @if (paintSubMode() !== 'catalogue') {
                <button class="btn btn-gold" (click)="paintSubMode.set('catalogue')">
                  Browse Full Paint Catalogue
                </button>
              }
            </div>
          }
        </section>
      }

      <!-- ====================================================================
           SUB-TAB 3: COMPARISON & CROSS-BRAND CONVERTER TOOL
           ==================================================================== -->
      @if (activeTab() === 'converter') {
        <section class="tab-content">
          <div class="converter-header studio-card">
            <div class="chip-bar">
              <button
                class="chip"
                [class.active]="converterMode() === 'cross-brand'"
                (click)="converterMode.set('cross-brand')"
              >
                🌐 Multi-Brand Converter (Citadel ↔ Army Painter / Vallejo / Two Thin Coats / Pro Acryl / AK 3G)
              </button>
              <button
                class="chip"
                [class.active]="converterMode() === 'tone-pro'"
                (click)="converterMode.set('tone-pro')"
              >
                ✨ Official Citadel Classic ↔ Tone Pro ({{ catalog.compatibilityLinks().length }} Mappings)
              </button>
            </div>

            <div class="toolbar-row" style="margin-top: 12px">
              <div class="search-box">
                <input
                  type="text"
                  class="input-control"
                  placeholder="Search any Citadel or 3rd-party paint to find equivalents..."
                  [(ngModel)]="converterSearch"
                />
              </div>

              @if (converterMode() === 'cross-brand') {
                <div class="toolbar-right">
                  <select class="input-control filter-select" [(ngModel)]="converterTargetBrand">
                    <option value="all">All 3rd-Party Brands</option>
                    @for (b of catalog.thirdPartyBrands(); track b) {
                      <option [value]="b">{{ b }}</option>
                    }
                  </select>
                  <label class="checkbox-inline">
                    <input type="checkbox" [(ngModel)]="converterOnlyOwned" />
                    <span>Only show paints where I own either side</span>
                  </label>
                </div>
              }
            </div>
          </div>

          @if (converterMode() === 'cross-brand') {
            <div class="converter-list">
              @for (row of filteredCrossBrandRows().slice(0, 120); track row.citadel.id) {
                <div class="converter-row studio-card">
                  <!-- Left: Citadel Paint -->
                  <div class="conv-side citadel-side">
                    <button class="conv-paint-btn" (click)="paintModal.openPaint(row.citadel.id)">
                      <span
                        class="paint-swatch"
                        [style.background]="row.citadel.gradientStartHex"
                      ></span>
                      <div class="conv-info">
                        <span class="conv-name">{{ row.citadel.name }}</span>
                        <span class="conv-meta">
                          {{ row.citadel.range === 'warhammer_pro' ? 'Citadel Tone Pro' : 'Citadel Classic' }} • {{ row.citadel.category }}
                        </span>
                      </div>
                    </button>
                    <button
                      class="btn btn-sm"
                      [class.btn-owned]="userState.isOwned(row.citadel.id)"
                      [class.btn-ghost]="!userState.isOwned(row.citadel.id)"
                      (click)="userState.toggleInventory(row.citadel.id)"
                    >
                      {{ userState.isOwned(row.citadel.id) ? '✓ Owned' : '+ Own' }}
                    </button>
                  </div>

                  <!-- Arrow -->
                  <div class="conv-arrow">⇄</div>

                  <!-- Right: Equivalent 3rd-Party Paints -->
                  <div class="conv-equivalents">
                    @for (eq of row.matches; track eq.thirdPartyPaintId) {
                      <div class="conv-eq-pill">
                        <button
                          class="conv-eq-main"
                          (click)="paintModal.openPaint(eq.thirdPartyPaintId)"
                        >
                          <span class="mini-swatch" [style.background]="eq.hex"></span>
                          <div class="conv-eq-text">
                            <span class="conv-eq-name">{{ eq.name }}</span>
                            <span class="conv-eq-brand">
                              {{ eq.brand }} • {{ eq.range }} • ΔE {{ eq.deltaE }}
                            </span>
                          </div>
                        </button>
                        <button
                          class="btn btn-sm"
                          [class.btn-owned]="userState.isOwned(eq.thirdPartyPaintId)"
                          [class.btn-ghost]="!userState.isOwned(eq.thirdPartyPaintId)"
                          (click)="userState.toggleInventory(eq.thirdPartyPaintId)"
                        >
                          {{ userState.isOwned(eq.thirdPartyPaintId) ? '✓' : '+' }}
                        </button>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          } @else {
            <!-- Mode 2: Official Classic <-> Tone Pro -->
            <div class="converter-list">
              @for (group of filteredToneProGroups(); track group.classicId) {
                <div class="converter-row studio-card">
                  <div class="conv-side citadel-side">
                    <button class="conv-paint-btn" (click)="paintModal.openPaint(group.classicId)">
                      <span class="paint-swatch" [style.background]="group.classicHex"></span>
                      <div class="conv-info">
                        <span class="conv-name">{{ group.classicName }}</span>
                        <span class="conv-meta">Citadel Classic • {{ group.classicCategory }}</span>
                      </div>
                    </button>
                    <button
                      class="btn btn-sm"
                      [class.btn-owned]="userState.isOwned(group.classicId)"
                      [class.btn-ghost]="!userState.isOwned(group.classicId)"
                      (click)="userState.toggleInventory(group.classicId)"
                    >
                      {{ userState.isOwned(group.classicId) ? '✓ Owned' : '+ Own' }}
                    </button>
                  </div>

                  <div class="conv-arrow">⇄</div>

                  <div class="conv-equivalents">
                    @for (tp of group.toneProList; track tp.tone_pro_paint_id) {
                      <div class="conv-eq-pill">
                        <button
                          class="conv-eq-main"
                          (click)="paintModal.openPaint(tp.tone_pro_paint_id)"
                        >
                          <span class="mini-swatch" [style.background]="tp.tone_pro_hex"></span>
                          <div class="conv-eq-text">
                            <span class="conv-eq-name">{{ tp.tone_pro_paint_name }}</span>
                            <span class="conv-eq-brand">Citadel Tone Pro</span>
                          </div>
                        </button>
                        <button
                          class="btn btn-sm"
                          [class.btn-owned]="userState.isOwned(tp.tone_pro_paint_id)"
                          [class.btn-ghost]="!userState.isOwned(tp.tone_pro_paint_id)"
                          (click)="userState.toggleInventory(tp.tone_pro_paint_id)"
                        >
                          {{ userState.isOwned(tp.tone_pro_paint_id) ? '✓' : '+' }}
                        </button>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </section>
      }

      <!-- ====================================================================
           SUB-TAB 4: ACCOUNT, MY WARHAMMER IMPORTER & SETTINGS
           ==================================================================== -->
      @if (activeTab() === 'settings') {
        <section class="tab-content settings-grid">
          <!-- Card 1: Multi-User My Warhammer Account Importer -->
          <div class="settings-card studio-card">
            <span class="badge badge-gold">Multi-User Importer</span>
            <h3>Import from Any "My Warhammer" Account</h3>
            <p class="settings-desc">
              Any user can import their live Inventory, Wishlist, and custom Projects from the official Citadel Colour app using either the self-service Auth0 PKCE flow or a file upload.
            </p>

            <div class="import-mode-selector">
              <label class="radio-label">
                <input type="radio" name="importMode" value="merge" [(ngModel)]="importMode" />
                <span>Merge with current browser data (Recommended)</span>
              </label>
              <label class="radio-label">
                <input type="radio" name="importMode" value="replace" [(ngModel)]="importMode" />
                <span>Replace current browser data</span>
              </label>
            </div>

            <div class="wizard-steps">
              <div class="wizard-step">
                <div class="step-num">1</div>
                <div class="step-content">
                  <strong>Quick Snapshot (Extracted APK Account)</strong>
                  <p>Load the pre-extracted account snapshot (64 owned paints, 34 wishlist paints, 5 projects).</p>
                  <button class="btn btn-gold btn-sm" (click)="loadExtractedSnapshot()">
                    ⚡ Import Extracted Account Snapshot
                  </button>
                </div>
              </div>

              <div class="wizard-step">
                <div class="step-num">2</div>
                <div class="step-content">
                  <strong>Self-Service My Warhammer Login (Auth0 PKCE)</strong>
                  <p>
                    Click below to open <code>login.mywarhammer.com</code> in a new tab. After signing in, open DevTools Network tab, copy the <code>citadel-colour://.../callback?code=...</code> redirect URL, and paste it below.
                  </p>
                  <div class="step-actions">
                    <button class="btn btn-secondary btn-sm" (click)="startPkceLogin()">
                      🔑 Open My Warhammer Login
                    </button>
                    <button class="btn btn-ghost btn-sm" (click)="copyPkceLoginUrl()">
                      {{ pkceUrlCopied() ? '✓ Copied Login URL!' : '📋 Copy Login URL to Clipboard' }}
                    </button>
                  </div>
                  <div class="pkce-paste-row">
                    <input
                      type="text"
                      class="input-control"
                      placeholder="Paste citadel-colour://login.mywarhammer.com/.../callback?code=... here"
                      [(ngModel)]="pastedCallbackUrl"
                    />
                    <button
                      class="btn btn-gold btn-sm"
                      [disabled]="!pastedCallbackUrl.trim() || pkceBusy()"
                      (click)="submitPkceCallback()"
                    >
                      {{ pkceBusy() ? 'Importing...' : 'Exchange & Import' }}
                    </button>
                  </div>
                  @if (pkceError()) {
                    <p class="error-msg">{{ pkceError() }}</p>
                  }
                </div>
              </div>

              <div class="wizard-step">
                <div class="step-num">3</div>
                <div class="step-content">
                  <strong>Upload JSON or CSV File</strong>
                  <p>
                    Upload any <code>user_account.json</code>, web app backup JSON, or <code>user_inventory_wishlist.csv</code>.
                  </p>
                  <input
                    type="file"
                    accept=".json,.csv"
                    (change)="onFileUpload($event)"
                    class="file-input"
                  />
                </div>
              </div>
            </div>
          </div>

          <!-- Card 2: Substitution Preferences & Local Backup -->
          <div class="settings-card studio-card">
            <span class="badge badge-sub">Readiness & Portability</span>
            <h3>"Can I Paint This?" Rules & Browser Backups</h3>
            <p class="settings-desc">
              Configure how the app calculates model and colour paint readiness across your inventory.
            </p>

            <div class="pref-toggles">
              <label class="toggle-row">
                <input
                  type="checkbox"
                  [ngModel]="userState.preferences().allowCompatibleSubstitutions"
                  (ngModelChange)="userState.updatePreferences({ allowCompatibleSubstitutions: $event })"
                />
                <div>
                  <strong>Allow Official Citadel ↔ Tone Pro Substitutions</strong>
                  <p>Count a required paint as covered if you own its official Tone Pro or Classic Citadel counterpart.</p>
                </div>
              </label>

              <label class="toggle-row">
                <input
                  type="checkbox"
                  [ngModel]="userState.preferences().allowThirdPartySubstitutions"
                  (ngModelChange)="userState.updatePreferences({ allowThirdPartySubstitutions: $event })"
                />
                <div>
                  <strong>Allow 3rd-Party Brand Paint Substitutions</strong>
                  <p>Count a required Citadel paint as covered if you own a linked equivalent from The Army Painter, Vallejo, Two Thin Coats, Pro Acryl, or AK 3G.</p>
                </div>
              </label>
            </div>

            <hr class="divider" />

            <h4>Local Browser Backup & Reset</h4>
            <div class="backup-btn-row">
              <button class="btn btn-secondary" (click)="userState.exportBackupJson()">
                ⬇ Export Full JSON Backup
              </button>
              <button class="btn btn-ghost danger-text" (click)="confirmResetData()">
                🗑 Reset Local Data to Blank Slate
              </button>
            </div>
          </div>

          <!-- Card 3: Catalog Manifest & Cache Freshness -->
          <div class="settings-card studio-card">
            <span class="badge badge-owned">Smart IndexedDB Cache</span>
            <h3>Catalog Manifest & Cache Freshness</h3>
            <p class="settings-desc">
              On startup, the app hydrates immediately from browser IndexedDB and checks <code>catalog_meta/manifest</code> (1 read) to diff SHA-256 bundle hashes before downloading any updates.
            </p>

            @if (catalog.manifest(); as mf) {
              <div class="manifest-meta">
                <div><strong>Catalog Version:</strong> {{ mf.catalogVersion }}</div>
                <div><strong>Manifest Updated:</strong> {{ mf.updatedAt | date:'medium' }}</div>
                <div><strong>Sync Status:</strong> <span class="status-tag">{{ catalog.syncStatus() }}</span></div>
                @if (catalog.lastCheckedAt()) {
                  <div><strong>Last Checked:</strong> {{ catalog.lastCheckedAt() | date:'mediumTime' }}</div>
                }
              </div>

              <div class="bundle-table">
                @for (entry of manifestBundlesList(); track entry.key) {
                  <div class="bundle-row">
                    <span class="bundle-name">{{ entry.key }}</span>
                    <code class="bundle-hash">{{ entry.hash.slice(0, 12) }}…</code>
                  </div>
                }
              </div>
            }

            <div class="backup-btn-row" style="margin-top: 12px">
              <button class="btn btn-secondary btn-sm" (click)="catalog.initializeCatalog(false)">
                ↻ Check Manifest Now (1 Read)
              </button>
              <button class="btn btn-ghost btn-sm" (click)="catalog.initializeCatalog(true)">
                ⚡ Force Full Cache Rebuild
              </button>
            </div>
          </div>

          <!-- Card 4: Optional Firebase Cloud Sync & Auth -->
          <div class="settings-card studio-card">
            <span class="badge badge-pro">Optional Cloud Sync</span>
            <h3>Firebase Auth & Cross-Device Sync</h3>
            <p class="settings-desc">
              By default, all user data stays 100% private in your local browser. Optionally connect a Firebase project to sync <code>users/{{ '{' }}uid{{ '}' }}</code> across devices.
            </p>

            @if (userState.currentUser(); as user) {
              <div class="signed-in-box">
                <div>
                  <strong>Signed in as:</strong> {{ user.email || user.uid }}
                  <span class="badge badge-owned" style="margin-left: 8px">{{ userState.cloudSyncStatus() }}</span>
                </div>
                <button class="btn btn-secondary btn-sm" (click)="userState.signOutCloud()">
                  Sign Out
                </button>
              </div>
            } @else {
              <div class="auth-form">
                <div class="form-row">
                  <input
                    type="email"
                    class="input-control"
                    placeholder="Email address"
                    [(ngModel)]="authEmail"
                  />
                  <input
                    type="password"
                    class="input-control"
                    placeholder="Password"
                    [(ngModel)]="authPassword"
                  />
                </div>
                <div class="backup-btn-row">
                  <button class="btn btn-gold btn-sm" (click)="handleEmailAuth(false)">
                    Sign In
                  </button>
                  <button class="btn btn-secondary btn-sm" (click)="handleEmailAuth(true)">
                    Create Account
                  </button>
                  <button class="btn btn-secondary btn-sm" (click)="handleGoogleAuth()">
                    Sign In with Google
                  </button>
                </div>
                @if (authError()) {
                  <p class="error-msg">{{ authError() }}</p>
                }
              </div>
            }

            <details class="fb-config-details">
              <summary>Configure Firebase Project Credentials (JSON)</summary>
              <div class="fb-config-body">
                <textarea
                  class="input-control code-area"
                  rows="4"
                  placeholder='{"apiKey": "...", "authDomain": "...", "projectId": "...", "storageBucket": "..."}'
                  [(ngModel)]="firebaseConfigJson"
                ></textarea>
                <button class="btn btn-secondary btn-sm" (click)="applyFirebaseConfig()">
                  Save Firebase Config & Reload
                </button>
              </div>
            </details>
          </div>
        </section>
      }
    </div>

    <!-- Modal: Create New Project -->
    @if (showNewProjectModal()) {
      <div class="modal-backdrop" (click)="showNewProjectModal.set(false)">
        <div class="modal-panel small-modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>Create New Hobby Project</h3>
            <button class="close-btn" (click)="showNewProjectModal.set(false)">✕</button>
          </div>
          <div class="modal-body">
            <label class="field-label">Project Name</label>
            <input
              type="text"
              class="input-control"
              placeholder="e.g., Ultramarines 2nd Company, Spearhead Box..."
              [(ngModel)]="newProjectName"
              (keyup.enter)="createNewProject()"
            />
            <div class="modal-footer-btns">
              <button class="btn btn-ghost" (click)="showNewProjectModal.set(false)">Cancel</button>
              <button class="btn btn-gold" (click)="createNewProject()">Create Project</button>
            </div>
          </div>
        </div>
      </div>
    }

    <!-- Modal: Add Custom 3rd-Party Paint -->
    @if (showCustomPaintModal()) {
      <div class="modal-backdrop" (click)="showCustomPaintModal.set(false)">
        <div class="modal-panel small-modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>Add Custom 3rd-Party Paint</h3>
            <button class="close-btn" (click)="showCustomPaintModal.set(false)">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-grid">
              <div>
                <label class="field-label">Brand</label>
                <input
                  type="text"
                  class="input-control"
                  placeholder="e.g., The Army Painter, Scale75, Kimera..."
                  [(ngModel)]="customPaintForm.brand"
                />
              </div>
              <div>
                <label class="field-label">Range</label>
                <input
                  type="text"
                  class="input-control"
                  placeholder="e.g., Warpaints Fanatic, Speedpaint 2.0..."
                  [(ngModel)]="customPaintForm.range"
                />
              </div>
              <div>
                <label class="field-label">Paint Name</label>
                <input
                  type="text"
                  class="input-control"
                  placeholder="e.g., Matt Black"
                  [(ngModel)]="customPaintForm.name"
                />
              </div>
              <div>
                <label class="field-label">Category & Hex Swatch</label>
                <div style="display: flex; gap: 8px">
                  <select class="input-control" [(ngModel)]="customPaintForm.category">
                    <option value="Base">Base</option>
                    <option value="Layer">Layer</option>
                    <option value="Shade">Shade / Wash</option>
                    <option value="Contrast">Contrast / Speedpaint</option>
                    <option value="Metallic">Metallic</option>
                    <option value="Technical">Technical / Effect</option>
                  </select>
                  <input
                    type="color"
                    class="color-picker"
                    [(ngModel)]="customPaintForm.hex"
                  />
                </div>
              </div>
            </div>

            <div style="margin-top: 12px">
              <label class="field-label">Equivalent Citadel Paint (Optional)</label>
              <select class="input-control" [(ngModel)]="customPaintForm.citadelPaintId">
                <option value="">-- None / Standalone --</option>
                @for (cp of catalog.paints(); track cp.id) {
                  <option [value]="cp.id">{{ cp.name }} ({{ cp.category }})</option>
                }
              </select>
            </div>

            <div class="modal-footer-btns">
              <button class="btn btn-ghost" (click)="showCustomPaintModal.set(false)">Cancel</button>
              <button class="btn btn-gold" (click)="saveCustomPaint()">Save & Add to Inventory</button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .page-container {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      .desk-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 20px 24px;
        background: linear-gradient(135deg, #1b1f27 0%, #13151a 100%);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-md);
      }
      .desk-title-group {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .desk-icon {
        width: 44px;
        height: 44px;
        filter: drop-shadow(0 2px 8px rgba(237, 179, 4, 0.3));
      }
      .desk-title-group h1 {
        font-size: 2rem;
        color: var(--gold-bright);
      }
      .subtitle {
        font-family: var(--font-sans);
        font-size: 0.88rem;
        color: var(--text-secondary);
      }
      .desk-kpi-strip {
        display: flex;
        gap: 10px;
      }
      .kpi-pill {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 8px 16px;
        background: var(--bg-card);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
        min-width: 96px;
      }
      .kpi-pill:hover {
        border-color: var(--gold-bright);
      }
      .kpi-pill.owned .kpi-num {
        color: var(--status-owned);
      }
      .kpi-pill.wishlist .kpi-num {
        color: var(--status-wishlist);
      }
      .kpi-num {
        font-family: var(--font-display);
        font-size: 1.5rem;
        color: var(--gold-bright);
      }
      .kpi-label {
        font-family: var(--font-sans);
        font-size: 0.72rem;
        color: var(--text-secondary);
        text-transform: uppercase;
        font-weight: 700;
      }
      .subtab-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        border-bottom: 1px solid var(--border-subtle);
        padding-bottom: 10px;
      }
      .subtab-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border-radius: var(--radius-sm);
        font-family: var(--font-sans);
        font-weight: 600;
        font-size: 0.88rem;
        color: var(--text-secondary);
        background: var(--bg-elevated);
        border: 1px solid transparent;
        transition: all 0.15s ease;
      }
      .subtab-btn:hover {
        color: var(--text-primary);
        background: var(--bg-card);
      }
      .subtab-btn.active {
        background: var(--gold-soft);
        color: var(--gold-bright);
        border-color: var(--gold-border);
      }
      .tab-ic {
        width: 18px;
        height: 18px;
      }
      .onboarding-banner {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 22px;
        border-color: var(--gold-border);
        background: linear-gradient(90deg, rgba(237, 179, 4, 0.1) 0%, rgba(25, 28, 34, 0.95) 100%);
      }
      .onboarding-text {
        max-width: 680px;
      }
      .onboarding-text h3 {
        color: var(--gold-bright);
        font-size: 1.15rem;
        margin-bottom: 4px;
      }
      .onboarding-text p {
        font-family: var(--font-sans);
        font-size: 0.86rem;
        color: var(--text-secondary);
      }
      .onboarding-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .tab-content {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .toolbar-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .search-box {
        flex: 1;
        min-width: 240px;
      }
      .toolbar-right {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }
      .sort-select,
      .filter-select {
        width: auto;
        min-width: 175px;
      }
      .projects-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 16px;
      }
      .project-card {
        display: flex;
        flex-direction: column;
        cursor: pointer;
      }
      .project-thumb-wrap {
        position: relative;
        height: 170px;
        background: radial-gradient(circle at center, #2a303c 0%, #14171d 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
      }
      .project-thumb {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
      .readiness-pill {
        position: absolute;
        bottom: 10px;
        right: 10px;
        padding: 4px 9px;
        border-radius: var(--radius-pill);
        background: rgba(13, 14, 17, 0.85);
        border: 1px solid var(--border-strong);
        font-family: var(--font-sans);
        font-size: 0.72rem;
        font-weight: 700;
        color: var(--gold-bright);
      }
      .readiness-pill.full {
        color: var(--status-owned);
        border-color: rgba(41, 194, 106, 0.5);
      }
      .project-body {
        padding: 14px 16px;
        flex: 1;
      }
      .project-title {
        font-size: 1.2rem;
        margin-bottom: 4px;
      }
      .project-counts {
        display: flex;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 0.8rem;
        color: var(--text-secondary);
      }
      .project-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 10px 14px;
        border-top: 1px solid var(--border-subtle);
        background: rgba(0, 0, 0, 0.18);
      }
      .danger-text {
        color: #f87171 !important;
      }
      .paints-mode-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .paints-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(295px, 1fr));
        gap: 10px;
      }
      .paint-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        gap: 10px;
      }
      .paint-card-main {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
        min-width: 0;
        text-align: left;
      }
      .paint-pot-thumb {
        width: 38px;
        height: 38px;
        object-fit: contain;
        flex-shrink: 0;
      }
      .paint-card-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .paint-card-name {
        font-family: var(--font-sans);
        font-weight: 700;
        font-size: 0.88rem;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .paint-card-meta {
        display: flex;
        gap: 5px;
        font-family: var(--font-sans);
        font-size: 0.74rem;
        color: var(--text-secondary);
      }
      .mini-brand.pro {
        color: var(--pro-cyan);
        font-weight: 700;
      }
      .mini-brand.tp {
        color: var(--gold-bright);
      }
      .paint-card-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }
      .icon-toggle {
        padding: 5px 9px;
        border-radius: var(--radius-xs);
        font-family: var(--font-sans);
        font-size: 0.75rem;
        font-weight: 700;
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        color: var(--text-secondary);
      }
      .icon-toggle.active-owned {
        background: var(--status-owned-bg);
        color: var(--status-owned);
        border-color: rgba(41, 194, 106, 0.45);
      }
      .icon-toggle.active-wish {
        background: var(--status-wishlist-bg);
        color: var(--status-wishlist);
        border-color: rgba(245, 158, 11, 0.45);
      }
      /* Converter Styles */
      .converter-header {
        padding: 16px;
      }
      .checkbox-inline {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 0.82rem;
        color: var(--text-secondary);
        cursor: pointer;
      }
      .converter-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .converter-row {
        display: grid;
        grid-template-columns: minmax(250px, 320px) 36px 1fr;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
      }
      @media (max-width: 760px) {
        .converter-row {
          grid-template-columns: 1fr;
        }
        .conv-arrow {
          display: none;
        }
      }
      .conv-side {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .conv-paint-btn {
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
        min-width: 0;
      }
      .conv-info {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .conv-name {
        font-family: var(--font-sans);
        font-weight: 700;
        font-size: 0.88rem;
        color: var(--text-primary);
      }
      .conv-meta {
        font-family: var(--font-sans);
        font-size: 0.74rem;
        color: var(--text-secondary);
      }
      .conv-arrow {
        font-size: 1.2rem;
        color: var(--gold-bright);
        text-align: center;
      }
      .conv-equivalents {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .conv-eq-pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
      }
      .conv-eq-main {
        display: flex;
        align-items: center;
        gap: 8px;
        text-align: left;
      }
      .mini-swatch {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1px solid rgba(255, 255, 255, 0.3);
        flex-shrink: 0;
      }
      .conv-eq-text {
        display: flex;
        flex-direction: column;
      }
      .conv-eq-name {
        font-family: var(--font-sans);
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--text-primary);
      }
      .conv-eq-brand {
        font-family: var(--font-sans);
        font-size: 0.7rem;
        color: var(--text-muted);
      }
      /* Settings Grid */
      .settings-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
        gap: 18px;
      }
      .settings-card {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .settings-card h3 {
        font-size: 1.25rem;
      }
      .settings-desc {
        font-family: var(--font-sans);
        font-size: 0.84rem;
        color: var(--text-secondary);
      }
      .import-mode-selector {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px 12px;
        background: var(--bg-void);
        border-radius: var(--radius-sm);
        font-family: var(--font-sans);
        font-size: 0.82rem;
      }
      .radio-label {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
      }
      .wizard-steps {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .wizard-step {
        display: flex;
        gap: 12px;
        padding: 12px;
        background: var(--bg-elevated);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
      }
      .step-num {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: var(--gold-soft);
        color: var(--gold-bright);
        font-family: var(--font-display);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .step-content {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        font-family: var(--font-sans);
        font-size: 0.82rem;
      }
      .step-content p {
        color: var(--text-secondary);
      }
      .step-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .pkce-paste-row {
        display: flex;
        gap: 8px;
        margin-top: 4px;
      }
      .file-input {
        font-family: var(--font-sans);
        font-size: 0.8rem;
      }
      .pref-toggles {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .toggle-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        cursor: pointer;
        font-family: var(--font-sans);
        font-size: 0.84rem;
      }
      .toggle-row input {
        margin-top: 4px;
      }
      .toggle-row p {
        color: var(--text-secondary);
        font-size: 0.78rem;
      }
      .divider {
        border: none;
        border-top: 1px solid var(--border-subtle);
        margin: 6px 0;
      }
      .backup-btn-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .manifest-meta {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        font-family: var(--font-sans);
        font-size: 0.8rem;
        padding: 10px;
        background: var(--bg-void);
        border-radius: var(--radius-sm);
      }
      .status-tag {
        color: var(--status-owned);
        font-weight: 700;
        text-transform: uppercase;
      }
      .bundle-table {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 160px;
        overflow-y: auto;
        padding: 8px;
        background: var(--bg-elevated);
        border-radius: var(--radius-xs);
        font-family: monospace;
        font-size: 0.75rem;
      }
      .bundle-row {
        display: flex;
        justify-content: space-between;
      }
      .bundle-hash {
        color: var(--gold-bright);
      }
      .auth-form {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      .fb-config-details {
        font-family: var(--font-sans);
        font-size: 0.8rem;
        color: var(--text-secondary);
        margin-top: 6px;
      }
      .fb-config-details summary {
        cursor: pointer;
        color: var(--gold-bright);
      }
      .fb-config-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 8px;
      }
      .code-area {
        font-family: monospace;
        font-size: 0.78rem;
      }
      .error-msg {
        color: #f87171;
        font-family: var(--font-sans);
        font-size: 0.8rem;
      }
      .empty-state {
        padding: 40px 24px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
      .empty-ic {
        width: 48px;
        height: 48px;
        opacity: 0.7;
      }
      .empty-state p {
        max-width: 520px;
        font-family: var(--font-sans);
        color: var(--text-secondary);
      }
      .empty-btn-row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 6px;
      }
      .small-modal {
        max-width: 520px;
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
      .field-label {
        display: block;
        font-family: var(--font-sans);
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--text-secondary);
        margin-bottom: 4px;
      }
      .form-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .color-picker {
        width: 46px;
        height: 40px;
        border: 1px solid var(--border-strong);
        border-radius: var(--radius-xs);
        background: var(--bg-input);
        cursor: pointer;
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
export class HobbyDeskComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly paintModal = inject(PaintModalService);
  readonly img = inject(ImageService);
  readonly importer = inject(WarhammerImportService);
  private readonly readinessService = inject(InventoryMatchService);
  private readonly router = inject(Router);

  readonly activeTab = signal<'projects' | 'paints' | 'converter' | 'settings'>('projects');
  readonly paintSubMode = signal<'inventory' | 'wishlist' | 'catalogue'>('inventory');
  readonly converterMode = signal<'cross-brand' | 'tone-pro'>('cross-brand');

  // Filters
  projectSearch = '';
  projectSort: 'updated' | 'created' | 'alpha' = 'updated';
  paintSearch = '';
  selectedBrandFilter = 'all';
  selectedCategoryFilter = 'all';
  converterSearch = '';
  converterTargetBrand = 'all';
  converterOnlyOwned = false;

  // Modals
  readonly showNewProjectModal = signal(false);
  newProjectName = '';

  readonly showCustomPaintModal = signal(false);
  customPaintForm = {
    brand: 'The Army Painter',
    range: 'Warpaints Fanatic',
    name: '',
    category: 'Layer',
    hex: '#3b82f6',
    citadelPaintId: '',
  };

  // Account & PKCE state
  importMode: 'merge' | 'replace' = 'merge';
  pastedCallbackUrl = '';
  readonly pkceBusy = signal(false);
  readonly pkceError = signal<string | null>(null);
  readonly pkceUrlCopied = signal(false);

  // Auth & Firebase config
  authEmail = '';
  authPassword = '';
  readonly authError = signal<string | null>(null);
  firebaseConfigJson = JSON.stringify(getStoredFirebaseConfig() ?? {}, null, 2);

  readonly filteredProjects = computed(() => {
    const q = this.projectSearch.trim().toLowerCase();
    let list = [...this.userState.projects()];
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    if (this.projectSort === 'alpha') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (this.projectSort === 'created') {
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return list;
  });

  readonly allUnifiedPaints = computed<UnifiedPaintRow[]>(() => {
    const rows: UnifiedPaintRow[] = [];
    for (const cp of this.catalog.paints()) {
      const isPro = cp.range === 'warhammer_pro';
      rows.push({
        id: cp.id,
        name: cp.name,
        brand: isPro ? 'Citadel Tone Pro' : 'Citadel Classic',
        rangeLabel: isPro ? 'Citadel Tone Pro' : 'Citadel Colour',
        category: cp.category,
        hex: cp.gradientStartHex,
        localImagePath: cp.localImagePath,
        imageUrl: cp.imageUrl,
        isCitadel: true,
        isTonePro: isPro,
      });
    }
    for (const tp of [...this.userState.customPaints(), ...this.catalog.thirdPartyPaints()]) {
      rows.push({
        id: tp.id,
        name: tp.name,
        brand: tp.brand,
        rangeLabel: `${tp.brand} • ${tp.range}`,
        category: tp.category,
        hex: tp.hex,
        isCitadel: false,
        isTonePro: false,
        code: tp.code,
      });
    }
    return rows;
  });

  readonly availableCategories = computed(() => {
    const set = new Set<string>();
    for (const p of this.allUnifiedPaints()) {
      if (p.category) set.add(p.category);
    }
    return Array.from(set).sort();
  });

  readonly filteredPaints = computed(() => {
    const mode = this.paintSubMode();
    const inv = this.userState.inventorySet();
    const wish = this.userState.wishlistSet();
    const q = this.paintSearch.trim().toLowerCase();
    const brand = this.selectedBrandFilter;
    const cat = this.selectedCategoryFilter;

    return this.allUnifiedPaints().filter((p) => {
      if (mode === 'inventory' && !inv.has(p.id)) return false;
      if (mode === 'wishlist' && !wish.has(p.id)) return false;
      if (brand !== 'all' && p.brand !== brand) return false;
      if (cat !== 'all' && p.category !== cat) return false;
      if (q) {
        const hay = `${p.name} ${p.brand} ${p.rangeLabel} ${p.category} ${p.hex} ${p.code ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  readonly filteredCrossBrandRows = computed(() => {
    const q = this.converterSearch.trim().toLowerCase();
    const brandFilter = this.converterTargetBrand;
    const onlyOwned = this.converterOnlyOwned;
    const inv = this.userState.inventorySet();
    const map = this.catalog.citadelToThirdPartyMap();

    const results = [];
    for (const cp of this.catalog.paints()) {
      let matches = map[cp.id] ?? [];
      if (brandFilter !== 'all') {
        matches = matches.filter((m) => m.brand === brandFilter);
      }
      if (matches.length === 0) continue;

      if (onlyOwned) {
        const ownsCitadel = inv.has(cp.id);
        const ownsAnyTp = matches.some((m) => inv.has(m.thirdPartyPaintId));
        if (!ownsCitadel && !ownsAnyTp) continue;
      }

      if (q) {
        const matchCitadel = cp.name.toLowerCase().includes(q) || cp.category.toLowerCase().includes(q);
        const matchTp = matches.some(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.brand.toLowerCase().includes(q) ||
            m.range.toLowerCase().includes(q)
        );
        if (!matchCitadel && !matchTp) continue;
      }

      results.push({
        citadel: cp,
        matches: matches.slice(0, 6),
      });
    }
    return results;
  });

  readonly filteredToneProGroups = computed(() => {
    const q = this.converterSearch.trim().toLowerCase();
    const paintById = this.catalog.paintById();
    const groups = [];

    for (const [classicId, links] of this.catalog.classicToToneProMap().entries()) {
      const classicPaint = paintById.get(classicId);
      const classicName = links[0]?.classic_paint_name ?? classicPaint?.name ?? classicId;
      const classicCategory = links[0]?.classic_category ?? classicPaint?.category ?? '';
      const classicHex = classicPaint?.gradientStartHex ?? '#888888';

      if (q) {
        const matchClassic = classicName.toLowerCase().includes(q);
        const matchPro = links.some((l) => l.tone_pro_paint_name.toLowerCase().includes(q));
        if (!matchClassic && !matchPro) continue;
      }

      groups.push({
        classicId,
        classicName,
        classicCategory,
        classicHex,
        toneProList: links,
      });
    }
    return groups;
  });

  readonly manifestBundlesList = computed(() => {
    const mf = this.catalog.manifest();
    if (!mf) return [];
    return Object.entries(mf.bundles).map(([key, val]) => ({
      key,
      hash: val.hash,
      updatedAt: val.updatedAt,
    }));
  });

  openPaintsTab(sub: 'inventory' | 'wishlist' | 'catalogue'): void {
    this.activeTab.set('paints');
    this.paintSubMode.set(sub);
  }

  getProjectCover(proj: { localThumbnailPath?: string; thumbnailUrl?: string; recipeIds: string[] }): string {
    if (proj.localThumbnailPath || proj.thumbnailUrl) {
      return this.img.resolve(proj.localThumbnailPath, proj.thumbnailUrl);
    }
    const firstModelId = proj.recipeIds[0];
    if (firstModelId) {
      const m = this.catalog.modelById().get(firstModelId);
      if (m) {
        return this.img.resolve(m.localPrimaryImage, m.primaryImage);
      }
    }
    return '/icons/ic_project.svg';
  }

  getProjectReadiness(proj: { recipeIds: string[]; colourIds: string[] }) {
    const paintIds = new Set<string>();
    for (const rid of proj.recipeIds) {
      const m = this.catalog.modelById().get(rid);
      if (m) m.requiredPaintIds.forEach((p) => paintIds.add(p));
    }
    for (const cid of proj.colourIds) {
      const c = this.catalog.colourById().get(cid);
      if (c) c.requiredPaintIds.forEach((p) => paintIds.add(p));
    }
    if (paintIds.size === 0) return null;
    return this.readinessService.evaluateReadiness(Array.from(paintIds));
  }

  openProject(projectId: string): void {
    this.router.navigate(['/projects', projectId]);
  }

  createNewProject(): void {
    const created = this.userState.createProject(this.newProjectName);
    this.newProjectName = '';
    this.showNewProjectModal.set(false);
    this.router.navigate(['/projects', created.id]);
  }

  confirmDeleteProject(projectId: string, name: string): void {
    if (confirm(`Delete project "${name}"?`)) {
      this.userState.deleteProject(projectId);
    }
  }

  saveCustomPaint(): void {
    if (!this.customPaintForm.name.trim()) return;
    const citadelMatches = [];
    if (this.customPaintForm.citadelPaintId) {
      const cp = this.catalog.paintById().get(this.customPaintForm.citadelPaintId);
      if (cp) {
        citadelMatches.push({
          citadelPaintId: cp.id,
          citadelPaintName: cp.name,
          citadelRange: cp.range,
          citadelCategory: cp.category,
          citadelHex: cp.gradientStartHex,
          deltaE: 0,
          matchQuality: 'exact' as const,
        });
      }
    }
    const created = this.userState.addCustomPaint({
      brand: this.customPaintForm.brand.trim() || 'Custom Brand',
      range: this.customPaintForm.range.trim() || 'Custom Range',
      name: this.customPaintForm.name.trim(),
      category: this.customPaintForm.category,
      hex: this.customPaintForm.hex,
      citadelMatches,
    });
    this.userState.toggleInventory(created.id);
    this.customPaintForm.name = '';
    this.showCustomPaintModal.set(false);
  }

  async loadExtractedSnapshot(): Promise<void> {
    await this.userState.loadExtractedAccountSnapshot(this.importMode);
  }

  async startPkceLogin(): Promise<void> {
    this.pkceError.set(null);
    const { authorizeUrl } = await this.importer.generateMyWarhammerLoginUrl();
    window.open(authorizeUrl, '_blank', 'noopener');
  }

  async copyPkceLoginUrl(): Promise<void> {
    this.pkceError.set(null);
    try {
      const { authorizeUrl } = await this.importer.generateMyWarhammerLoginUrl();
      await navigator.clipboard.writeText(authorizeUrl);
      this.pkceUrlCopied.set(true);
      setTimeout(() => this.pkceUrlCopied.set(false), 2500);
    } catch (e: unknown) {
      this.pkceError.set(e instanceof Error ? e.message : String(e));
    }
  }

  async submitPkceCallback(): Promise<void> {
    this.pkceBusy.set(true);
    this.pkceError.set(null);
    try {
      await this.importer.exchangeCallbackAndImport(this.pastedCallbackUrl, this.importMode);
      this.pastedCallbackUrl = '';
    } catch (e: unknown) {
      this.pkceError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.pkceBusy.set(false);
    }
  }

  async onFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      await this.importer.importFromFile(file, this.importMode);
    } catch (e: unknown) {
      this.pkceError.set(e instanceof Error ? e.message : String(e));
    } finally {
      input.value = '';
    }
  }

  confirmResetData(): void {
    if (confirm('Reset all local browser Inventory, Wishlist, and Projects to a blank slate?')) {
      this.userState.resetLocalData();
    }
  }

  async handleEmailAuth(isSignUp: boolean): Promise<void> {
    this.authError.set(null);
    try {
      await this.userState.signInWithEmail(this.authEmail, this.authPassword, isSignUp);
    } catch (e: unknown) {
      this.authError.set(e instanceof Error ? e.message : String(e));
    }
  }

  async handleGoogleAuth(): Promise<void> {
    this.authError.set(null);
    try {
      await this.userState.signInWithGoogle();
    } catch (e: unknown) {
      this.authError.set(e instanceof Error ? e.message : String(e));
    }
  }

  applyFirebaseConfig(): void {
    try {
      const trimmed = this.firebaseConfigJson.trim();
      if (!trimmed || trimmed === '{}') {
        saveFirebaseConfig(null);
      } else {
        const parsed = JSON.parse(trimmed) as FirebaseClientConfig;
        saveFirebaseConfig(parsed);
      }
      window.location.reload();
    } catch {
      this.authError.set('Invalid Firebase config JSON format.');
    }
  }
}
