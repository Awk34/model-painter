import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { UserStateService } from '../../core/services/user-state.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { ImageService } from '../../core/services/image.service';

@Component({
  selector: 'app-search',
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './search.component.ng.html',
  styleUrl: './search.component.css',
})
export class SearchComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly paintModal = inject(PaintModalService);
  readonly img = inject(ImageService);
  readonly router = inject(Router);

  readonly query = signal<string>('');
  readonly tab = signal<'all' | 'models' | 'colours' | 'paints'>('all');

  readonly matchedCitadelPaints = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.catalog.paints().slice(0, 12);
    return this.catalog
      .paints()
      .filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  });

  readonly matchedThirdPartyPaints = computed(() => {
    const q = this.query().trim().toLowerCase();
    const allTp = [...this.userState.customPaints(), ...this.catalog.thirdPartyPaints()];
    if (!q) return allTp.slice(0, 12);
    return allTp.filter(
      (tp) =>
        tp.name.toLowerCase().includes(q) ||
        tp.brand.toLowerCase().includes(q) ||
        tp.range.toLowerCase().includes(q)
    );
  });

  readonly matchedColours = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.catalog.colours().slice(0, 12);
    return this.catalog
      .colours()
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.colourGroups.some((g) => g.toLowerCase().includes(q))
      );
  });

  readonly matchedModels = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.catalog.models().slice(0, 16);
    return this.catalog
      .models()
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.factionNames.some((f) => f.toLowerCase().includes(q)) ||
          m.gameNames.some((g) => g.toLowerCase().includes(q))
      );
  });

  readonly totalCount = computed(
    () =>
      this.matchedCitadelPaints().length +
      this.matchedThirdPartyPaints().length +
      this.matchedColours().length +
      this.matchedModels().length
  );
}
