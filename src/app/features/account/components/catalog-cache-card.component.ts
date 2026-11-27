import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CatalogService } from '../../../core/services/catalog.service';

@Component({
  selector: 'app-catalog-cache-card',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog-cache-card.component.ng.html',
  styleUrl: './account-card.shared.css',
})
export class CatalogCacheCardComponent {
  readonly catalog = inject(CatalogService);

  readonly manifestBundlesList = computed(() => {
    const mf = this.catalog.manifest();
    if (!mf?.bundles) {
      return [];
    }
    return Object.entries(mf.bundles).map(([key, val]) => {
      const hash = typeof val === 'string' ? val : val?.hash ?? '';
      return {
        key,
        hash,
        shortHash: hash.slice(0, 19),
        updatedAt: typeof val === 'string' ? mf.updatedAt : val?.updatedAt ?? mf.updatedAt,
      };
    });
  });
}
