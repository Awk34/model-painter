import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { CatalogService } from '../../../core/services/catalog.service';
import { UserStateService } from '../../../core/services/user-state.service';
import {
  getCitadelBrandLabel,
  getFallbackSwatch,
  getPaintRepresentativeHex,
} from '../../../core/utils/catalog-filter.util';
import { PaintActionRowComponent } from '../../../shared/components/paint-action-row/paint-action-row.component';

@Component({
  selector: 'app-hobby-desk-converter-tab',
  imports: [ReactiveFormsModule, PaintActionRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hobby-desk-converter-tab.component.ng.html',
  styleUrl: './hobby-desk-converter-tab.component.css',
})
export class HobbyDeskConverterTabComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);

  readonly converterMode = signal<'cross-brand' | 'tone-pro'>('cross-brand');
  readonly converterSearch = signal('');
  readonly converterTargetBrand = signal('all');
  readonly converterOnlyOwned = signal(false);

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly brandControl = new FormControl('all', { nonNullable: true });
  readonly onlyOwnedControl = new FormControl(false, { nonNullable: true });

  constructor() {
    effect(() => {
      const q = this.converterSearch();
      if (this.searchControl.value !== q) {
        this.searchControl.setValue(q, { emitEvent: false });
      }
    });
    effect(() => {
      const b = this.converterTargetBrand();
      if (this.brandControl.value !== b) {
        this.brandControl.setValue(b, { emitEvent: false });
      }
    });
    effect(() => {
      const owned = this.converterOnlyOwned();
      if (this.onlyOwnedControl.value !== owned) {
        this.onlyOwnedControl.setValue(owned, { emitEvent: false });
      }
    });

    this.searchControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.converterSearch.set(v);
    });
    this.brandControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.converterTargetBrand.set(v);
    });
    this.onlyOwnedControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.converterOnlyOwned.set(v);
    });
  }

  readonly filteredCrossBrandRows = computed(() => {
    const q = this.converterSearch().trim().toLowerCase();
    const brandFilter = this.converterTargetBrand();
    const onlyOwned = this.converterOnlyOwned();
    const inv = this.userState.inventorySet();
    const map = this.catalog.citadelToThirdPartyMap();
    const tpById = this.catalog.thirdPartyPaintById();

    const results = [];
    for (const cp of this.catalog.paints()) {
      let matches = (Object.hasOwn(map, cp.id) ? map[cp.id] : undefined) ?? [];
      if (brandFilter !== 'all') {
        matches = matches.filter((m) => m.brand === brandFilter);
      }
      if (matches.length === 0) {
        continue;
      }

      if (onlyOwned) {
        const ownsCitadel = inv.has(cp.id);
        const ownsAnyTp = matches.some((m) => inv.has(m.thirdPartyPaintId));
        if (!ownsCitadel && !ownsAnyTp) {
          continue;
        }
      }

      if (q) {
        const matchCitadel =
          cp.name.toLowerCase().includes(q) || cp.category.toLowerCase().includes(q);
        const matchTp = matches.some(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.brand.toLowerCase().includes(q) ||
            m.range.toLowerCase().includes(q)
        );
        if (!matchCitadel && !matchTp) {
          continue;
        }
      }

      results.push({
        citadel: cp,
        citadelSubtitle: `${getCitadelBrandLabel(cp.range)} • ${cp.category}`,
        matches: matches.slice(0, 6).map((m) => ({
          ...m,
          subtitle: `${m.brand} • ${m.range} • ΔE ${m.deltaE}`,
          swatch: tpById.get(m.thirdPartyPaintId) ?? getFallbackSwatch(m.category),
        })),
      });
    }
    return results;
  });

  readonly visibleCrossBrandRows = computed(() =>
    this.filteredCrossBrandRows().slice(0, 120)
  );

  readonly filteredToneProGroups = computed(() => {
    const q = this.converterSearch().trim().toLowerCase();
    const paintById = this.catalog.paintById();
    const groups = [];

    for (const [classicId, links] of this.catalog.classicToToneProMap().entries()) {
      const classicPaint = paintById.get(classicId);
      const classicName = links[0]?.classic_paint_name ?? classicPaint?.name ?? classicId;
      const classicCategory = links[0]?.classic_category ?? classicPaint?.category ?? '';
      const classicHex = getPaintRepresentativeHex(classicPaint);

      if (q) {
        const matchClassic = classicName.toLowerCase().includes(q);
        const matchPro = links.some((l) => l.tone_pro_paint_name.toLowerCase().includes(q));
        if (!matchClassic && !matchPro) {
          continue;
        }
      }

      groups.push({
        classicId,
        classicName,
        classicSubtitle: `Citadel Classic • ${classicCategory}`,
        classicHex,
        classicPaint,
        toneProItems: links.map((tp) => ({
          ...tp,
          paint: paintById.get(tp.tone_pro_paint_id),
        })),
      });
    }
    return groups;
  });
}
