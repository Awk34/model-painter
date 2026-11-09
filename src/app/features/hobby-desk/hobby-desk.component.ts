import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
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
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hobby-desk.component.ng.html',
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
      .signed-in-profile {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .account-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        object-fit: cover;
        border: 1px solid var(--gold-border);
        background: var(--bg-elevated);
      }
      .account-email {
        font-size: 0.78rem;
        color: var(--text-secondary);
        margin-top: 2px;
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
  private readonly route = inject(ActivatedRoute);

  readonly isAccountPage = signal(false);
  readonly activeTab = signal<'projects' | 'paints' | 'converter' | 'settings'>('projects');
  readonly paintSubMode = signal<'inventory' | 'wishlist' | 'catalogue'>('inventory');
  readonly converterMode = signal<'cross-brand' | 'tone-pro'>('cross-brand');

  constructor() {
    this.route.data.subscribe((data) => {
      const isAccount = data['page'] === 'account' || this.router.url.startsWith('/account');
      this.isAccountPage.set(isAccount);
      if (isAccount) {
        this.activeTab.set('settings');
      }
    });
    this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');
      if (tab === 'paints' || tab === 'projects' || tab === 'converter' || tab === 'settings') {
        this.activeTab.set(tab);
      }
      const sub = params.get('sub');
      if (sub === 'inventory' || sub === 'wishlist' || sub === 'catalogue') {
        this.paintSubMode.set(sub);
      }
    });
  }

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
    if (!mf?.bundles) return [];
    return Object.entries(mf.bundles).map(([key, val]) => ({
      key,
      hash: typeof val === 'string' ? val : val?.hash ?? '',
      updatedAt: typeof val === 'string' ? mf.updatedAt : val?.updatedAt ?? mf.updatedAt,
    }));
  });

  openProjectsTab(): void {
    if (this.isAccountPage()) {
      this.router.navigate(['/hobby-desk'], { queryParams: { tab: 'projects' } });
      return;
    }
    this.activeTab.set('projects');
  }

  openPaintsTab(sub: 'inventory' | 'wishlist' | 'catalogue'): void {
    if (this.isAccountPage()) {
      this.router.navigate(['/hobby-desk'], { queryParams: { tab: 'paints', sub } });
      return;
    }
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
