import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  CitadelPaintRange,
  KNOWN_THIRD_PARTY_BRANDS,
  PaintBrand,
} from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import {
  normalizePaintBrand,
  PaintBrandBadgeVariant,
  PaintBrandLike,
} from '../../../core/utils/catalog-filter.util';

/**
 * Reusable badge component for rendering paint & guide brands ("Citadel Colour",
 * "Citadel Tone Pro", hard-coded 3rd-party brands in `PaintBrand`, and newly added
 * brands pulled dynamically from the Firestore catalog).
 */
@Component({
  selector: 'app-paint-brand-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paint-brand-badge.component.ng.html',
  styleUrl: './paint-brand-badge.component.css',
})
export class PaintBrandBadgeComponent {
  private readonly catalog = inject(CatalogService, { optional: true });

  readonly paint = input<PaintBrandLike | null | undefined>(null);
  readonly brand = input<PaintBrand | string | null | undefined>(undefined);
  readonly range = input<CitadelPaintRange | string | null | undefined>(undefined);
  readonly suffix = input<string | null | undefined>(undefined);
  readonly showRange = input<boolean>(true);

  private readonly catalogBrands = computed<readonly string[]>(() =>
    typeof this.catalog?.thirdPartyBrands === 'function'
      ? this.catalog.thirdPartyBrands()
      : KNOWN_THIRD_PARTY_BRANDS
  );

  private readonly resolved = computed(() => {
    const p = this.paint();
    const rawBrand = this.brand() ?? p?.brand;
    const rawRange = this.range() ?? p?.range;
    return normalizePaintBrand(rawBrand, rawRange, this.catalogBrands(), PaintBrand.CitadelColour);
  });

  readonly resolvedBrand = computed(() => this.resolved().brand);
  readonly isKnownBrand = computed(() => this.resolved().isKnownBrand);
  readonly variant = computed<PaintBrandBadgeVariant>(() => this.resolved().variant);

  readonly label = computed(() => {
    const res = this.resolved();
    let text = res.brand;

    if (!res.isCitadel && this.showRange()) {
      const rawRange = (this.range() ?? this.paint()?.range ?? '').trim();
      if (
        rawRange &&
        rawRange !== CitadelPaintRange.WarhammerColour &&
        rawRange !== CitadelPaintRange.WarhammerPro
      ) {
        text = `${text} — ${rawRange}`;
      }
    }

    const sfx = (this.suffix() ?? '').trim();
    if (sfx) {
      text = `${text} ${sfx}`;
    }

    return text;
  });
}
