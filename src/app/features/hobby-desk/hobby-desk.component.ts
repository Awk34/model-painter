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
  styleUrl: './hobby-desk.component.css',
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
  readonly activeTab = signal<'projects' | 'models' | 'paints' | 'converter' | 'settings'>('projects');
  readonly modelSubMode = signal<'inventory' | 'wishlist' | 'catalogue'>('inventory');
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
      if (
        tab === 'models' ||
        tab === 'paints' ||
        tab === 'projects' ||
        tab === 'converter' ||
        tab === 'settings'
      ) {
        this.activeTab.set(tab);
      }
      const sub = params.get('sub');
      if (sub === 'inventory' || sub === 'wishlist' || sub === 'catalogue') {
        if (tab === 'models') {
          this.modelSubMode.set(sub);
        } else {
          this.paintSubMode.set(sub);
        }
      }
    });
  }

  // Filters
  projectSearch = '';
  projectSort: 'updated' | 'created' | 'alpha' = 'updated';
  readonly modelSearch = signal('');
  readonly selectedModelGameFilter = signal('all');
  readonly modelVisibleLimit = signal(60);
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

  readonly filteredModels = computed(() => {
    const mode = this.modelSubMode();
    const inv = this.userState.modelInventorySet();
    const wish = this.userState.modelWishlistSet();
    const q = this.modelSearch().trim().toLowerCase();
    const gameId = this.selectedModelGameFilter();

    return this.catalog
      .models()
      .filter((m) => {
        if (mode === 'inventory' && !inv.has(m.id)) return false;
        if (mode === 'wishlist' && !wish.has(m.id)) return false;
        if (gameId !== 'all' && !m.gameIds.includes(gameId)) return false;
        if (q) {
          const matchName = m.name.toLowerCase().includes(q);
          const matchFac = m.factionNames.some((fn) => fn.toLowerCase().includes(q));
          const matchGame = m.gameNames.some((gn) => gn.toLowerCase().includes(q));
          if (!matchName && !matchFac && !matchGame) return false;
        }
        return true;
      })
      .map((model) => {
        const staged = this.readinessService.evaluateStagedReadiness({
          base: model.paintsByStage?.base,
          detail: model.paintsByStage?.detail,
          artificer: model.paintsByStage?.artificer,
          all: model.requiredPaintIds,
        });
        return {
          model,
          staged,
          readiness: staged.base,
        };
      });
  });

  readonly displayedModels = computed(() =>
    this.filteredModels().slice(0, this.modelVisibleLimit())
  );

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

  openModelsTab(sub: 'inventory' | 'wishlist' | 'catalogue'): void {
    if (this.isAccountPage()) {
      this.router.navigate(['/hobby-desk'], { queryParams: { tab: 'models', sub } });
      return;
    }
    this.activeTab.set('models');
    this.modelSubMode.set(sub);
    this.modelVisibleLimit.set(60);
  }

  openModel(modelId: string): void {
    this.router.navigate(['/models', modelId]);
  }

  loadMoreModels(): void {
    this.modelVisibleLimit.update((v) => v + 60);
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
    const baseIds = new Set<string>();
    const detailIds = new Set<string>();
    const artificerIds = new Set<string>();
    const allIds = new Set<string>();

    for (const rid of proj.recipeIds) {
      const m = this.catalog.modelById().get(rid);
      if (m) {
        (m.paintsByStage?.base ?? []).forEach((p) => baseIds.add(p));
        (m.paintsByStage?.detail ?? []).forEach((p) => detailIds.add(p));
        (m.paintsByStage?.artificer ?? []).forEach((p) => artificerIds.add(p));
        m.requiredPaintIds.forEach((p) => allIds.add(p));
      }
    }
    for (const cid of proj.colourIds) {
      const c = this.catalog.colourById().get(cid);
      if (c) {
        c.basePaintIds.forEach((p) => baseIds.add(p));
        c.detailPaintIds.forEach((p) => detailIds.add(p));
        c.artificerPaintIds.forEach((p) => artificerIds.add(p));
        c.requiredPaintIds.forEach((p) => allIds.add(p));
      }
    }
    if (allIds.size === 0) return null;
    return this.readinessService.evaluateStagedReadiness({
      base: Array.from(baseIds),
      detail: Array.from(detailIds),
      artificer: Array.from(artificerIds),
      all: Array.from(allIds),
    });
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
