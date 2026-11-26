import { ChangeDetectionStrategy, Component, computed, effect, inject, model, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CollectionSubMode } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { UserStateService } from '../../../core/services/user-state.service';
import {
  getCitadelBrandLabel,
  getPaintRepresentativeHex,
  PaintSwatchLike,
} from '../../../core/utils/catalog-filter.util';
import { AppModalDialogComponent } from '../../../shared/components/modal-dialog/modal-dialog.component';
import { PaintActionRowComponent } from '../../../shared/components/paint-action-row/paint-action-row.component';

interface UnifiedPaintRow {
  id: string;
  name: string;
  brand: string;
  rangeLabel: string;
  category: string;
  hex: string;
  paint: PaintSwatchLike;
  localImagePath?: string;
  imageUrl?: string;
  isCitadel: boolean;
  isTonePro: boolean;
  code?: string;
}

export interface CustomPaintFormState {
  brand: string;
  range: string;
  name: string;
  category: string;
  hex: string;
  citadelPaintId: string;
}

function createDefaultCustomPaintForm(): CustomPaintFormState {
  return {
    brand: 'The Army Painter',
    range: 'Warpaints Fanatic',
    name: '',
    category: 'Layer',
    hex: '#3b82f6',
    citadelPaintId: '',
  };
}

@Component({
  selector: 'app-hobby-desk-paints-tab',
  imports: [ReactiveFormsModule, AppModalDialogComponent, PaintActionRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hobby-desk-paints-tab.component.ng.html',
  styleUrl: './hobby-desk-paints-tab.component.css',
})
export class HobbyDeskPaintsTabComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly img = inject(ImageService);

  readonly subMode = model<CollectionSubMode>('inventory');
  readonly paintSearch = signal('');
  readonly selectedBrandFilter = signal('all');
  readonly selectedCategoryFilter = signal('all');
  readonly showCustomPaintModal = signal(false);

  readonly customPaintForm = signal<CustomPaintFormState>(createDefaultCustomPaintForm());

  readonly paintSearchControl = new FormControl('', { nonNullable: true });
  readonly brandFilterControl = new FormControl('all', { nonNullable: true });
  readonly categoryFilterControl = new FormControl('all', { nonNullable: true });

  readonly customPaintFormGroup = new FormGroup({
    brand: new FormControl(createDefaultCustomPaintForm().brand, { nonNullable: true }),
    range: new FormControl(createDefaultCustomPaintForm().range, { nonNullable: true }),
    name: new FormControl(createDefaultCustomPaintForm().name, { nonNullable: true }),
    category: new FormControl(createDefaultCustomPaintForm().category, { nonNullable: true }),
    hex: new FormControl(createDefaultCustomPaintForm().hex, { nonNullable: true }),
    citadelPaintId: new FormControl(createDefaultCustomPaintForm().citadelPaintId, { nonNullable: true }),
  });

  constructor() {
    effect(() => {
      const q = this.paintSearch();
      if (this.paintSearchControl.value !== q) {
        this.paintSearchControl.setValue(q, { emitEvent: false });
      }
    });
    effect(() => {
      const b = this.selectedBrandFilter();
      if (this.brandFilterControl.value !== b) {
        this.brandFilterControl.setValue(b, { emitEvent: false });
      }
    });
    effect(() => {
      const c = this.selectedCategoryFilter();
      if (this.categoryFilterControl.value !== c) {
        this.categoryFilterControl.setValue(c, { emitEvent: false });
      }
    });
    effect(() => {
      const f = this.customPaintForm();
      const raw = this.customPaintFormGroup.getRawValue();
      if (
        raw.brand !== f.brand ||
        raw.range !== f.range ||
        raw.name !== f.name ||
        raw.category !== f.category ||
        raw.hex !== f.hex ||
        raw.citadelPaintId !== f.citadelPaintId
      ) {
        this.customPaintFormGroup.setValue(f, { emitEvent: false });
      }
    });

    this.paintSearchControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.paintSearch.set(v);
    });
    this.brandFilterControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.selectedBrandFilter.set(v);
    });
    this.categoryFilterControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.selectedCategoryFilter.set(v);
    });
    this.customPaintFormGroup.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.customPaintForm.set(this.customPaintFormGroup.getRawValue());
    });
  }

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
        paint: cp,
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
        paint: tp,
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

  openCustomPaintModal(): void {
    this.customPaintForm.set(createDefaultCustomPaintForm());
    this.showCustomPaintModal.set(true);
  }

  closeCustomPaintModal(): void {
    this.customPaintForm.set(createDefaultCustomPaintForm());
    this.showCustomPaintModal.set(false);
  }

  patchCustomPaintForm(patch: Partial<CustomPaintFormState>): void {
    this.customPaintForm.update((prev) => ({ ...prev, ...patch }));
  }

  saveCustomPaint(): void {
    const form = this.customPaintForm();
    if (!form.name.trim()) {
      return;
    }
    const citadelMatches = [];
    if (form.citadelPaintId) {
      const cp = this.catalog.paintById().get(form.citadelPaintId);
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
      brand: form.brand.trim() || 'Custom Brand',
      range: form.range.trim() || 'Custom Range',
      name: form.name.trim(),
      category: form.category,
      hex: form.hex,
      citadelMatches,
    });
    if (!created) {
      return;
    }
    this.userState.toggleInventory(created.id);
    this.closeCustomPaintModal();
  }
}
