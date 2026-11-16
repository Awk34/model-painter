import { ChangeDetectionStrategy, Component, computed, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import {
  getCitadelBrandLabel,
  getPaintRepresentativeHex,
  getPaintSwatchBackground,
  isMetallicPaint,
  isShadePaint,
} from '../../../core/utils/catalog-filter.util';
import { CollectionSubMode } from './hobby-desk-models-tab.component';

interface UnifiedPaintRow {
  id: string;
  name: string;
  brand: string;
  rangeLabel: string;
  category: string;
  hex: string;
  swatchBg: string;
  isMetallic: boolean;
  isShade: boolean;
  localImagePath?: string;
  imageUrl?: string;
  isCitadel: boolean;
  isTonePro: boolean;
  code?: string;
}

@Component({
  selector: 'app-hobby-desk-paints-tab',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hobby-desk-paints-tab.component.ng.html',
  styleUrl: './hobby-desk-paints-tab.component.css',
})
export class HobbyDeskPaintsTabComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly paintModal = inject(PaintModalService);
  readonly img = inject(ImageService);

  readonly subMode = model<CollectionSubMode>('inventory');
  readonly paintSearch = signal('');
  readonly selectedBrandFilter = signal('all');
  readonly selectedCategoryFilter = signal('all');
  readonly showCustomPaintModal = signal(false);

  customPaintForm = {
    brand: 'The Army Painter',
    range: 'Warpaints Fanatic',
    name: '',
    category: 'Layer',
    hex: '#3b82f6',
    citadelPaintId: '',
  };

  readonly allUnifiedPaints = computed<UnifiedPaintRow[]>(() => {
    const rows: UnifiedPaintRow[] = [];
    for (const cp of this.catalog.paints()) {
      const isPro = cp.range === 'warhammer_pro';
      rows.push({
        id: cp.id,
        name: cp.name,
        brand: getCitadelBrandLabel(cp.range),
        rangeLabel: getCitadelBrandLabel(cp.range, 'Citadel Colour'),
        category: cp.category,
        hex: getPaintRepresentativeHex(cp),
        swatchBg: getPaintSwatchBackground(cp),
        isMetallic: isMetallicPaint(cp),
        isShade: isShadePaint(cp),
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
        swatchBg: getPaintSwatchBackground(tp),
        isMetallic: isMetallicPaint(tp),
        isShade: isShadePaint(tp),
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
      if (p.category) {
        set.add(p.category);
      }
    }
    return Array.from(set).sort();
  });

  readonly filteredPaints = computed(() => {
    const mode = this.subMode();
    const inv = this.userState.inventorySet();
    const wish = this.userState.wishlistSet();
    const q = this.paintSearch().trim().toLowerCase();
    const brand = this.selectedBrandFilter();
    const cat = this.selectedCategoryFilter();

    return this.allUnifiedPaints().filter((p) => {
      if (mode === 'inventory' && !inv.has(p.id)) {
        return false;
      }
      if (mode === 'wishlist' && !wish.has(p.id)) {
        return false;
      }
      if (brand !== 'all' && p.brand !== brand) {
        return false;
      }
      if (cat !== 'all' && p.category !== cat) {
        return false;
      }
      if (q) {
        const hay = `${p.name} ${p.brand} ${p.rangeLabel} ${p.category} ${p.hex} ${p.code ?? ''}`.toLowerCase();
        if (!hay.includes(q)) {
          return false;
        }
      }
      return true;
    });
  });

  saveCustomPaint(): void {
    if (!this.customPaintForm.name.trim()) {
      return;
    }
    const citadelMatches = [];
    if (this.customPaintForm.citadelPaintId) {
      const cp = this.catalog.paintById().get(this.customPaintForm.citadelPaintId);
      if (cp) {
        citadelMatches.push({
          citadelPaintId: cp.id,
          citadelPaintName: cp.name,
          citadelRange: cp.range,
          citadelCategory: cp.category,
          citadelHex: getPaintRepresentativeHex(cp),
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
    if (!created) {
      return;
    }
    this.userState.toggleInventory(created.id);
    this.customPaintForm.name = '';
    this.showCustomPaintModal.set(false);
  }
}

