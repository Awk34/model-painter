import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogService } from '../../../core/services/catalog.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { getCitadelBrandLabel } from '../../../core/utils/catalog-filter.util';

@Component({
  selector: 'app-hobby-desk-converter-tab',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hobby-desk-converter-tab.component.ng.html',
  styleUrl: './hobby-desk-converter-tab.component.css',
})
export class HobbyDeskConverterTabComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly paintModal = inject(PaintModalService);
  readonly getCitadelBrandLabel = getCitadelBrandLabel;

  readonly converterMode = signal<'cross-brand' | 'tone-pro'>('cross-brand');
  readonly converterSearch = signal('');
  readonly converterTargetBrand = signal('all');
  readonly converterOnlyOwned = signal(false);

  readonly filteredCrossBrandRows = computed(() => {
    const q = this.converterSearch().trim().toLowerCase();
    const brandFilter = this.converterTargetBrand();
    const onlyOwned = this.converterOnlyOwned();
    const inv = this.userState.inventorySet();
    const map = this.catalog.citadelToThirdPartyMap();

    const results = [];
    for (const cp of this.catalog.paints()) {
      let matches = map[cp.id] ?? [];
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
        matches: matches.slice(0, 6),
      });
    }
    return results;
  });

  readonly filteredToneProGroups = computed(() => {
    const q = this.converterSearch().trim().toLowerCase();
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
        if (!matchClassic && !matchPro) {
          continue;
        }
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
}

