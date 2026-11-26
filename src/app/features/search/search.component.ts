import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CatalogService } from '../../core/services/catalog.service';
import { UserStateService } from '../../core/services/user-state.service';
import {
  getCitadelBrandLabel,
  matchesModelSearch,
} from '../../core/utils/catalog-filter.util';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { ModelCardComponent } from '../../shared/components/model-card/model-card.component';
import { PaintActionRowComponent } from '../../shared/components/paint-action-row/paint-action-row.component';

@Component({
  selector: 'app-search',
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    AppIconComponent,
    ModelCardComponent,
    PaintActionRowComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './search.component.ng.html',
  styleUrl: './search.component.css',
})
export class SearchComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly getCitadelBrandLabel = getCitadelBrandLabel;

  readonly query = signal<string>('');
  readonly tab = signal<'all' | 'models' | 'colors' | 'paints'>('all');
  readonly queryControl = new FormControl('', { nonNullable: true });

  constructor() {
    effect(() => {
      const value = this.query();
      if (this.queryControl.value !== value) {
        this.queryControl.setValue(value, { emitEvent: false });
      }
    });

    this.queryControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((val) => {
      this.query.set(val);
    });
  }

  readonly matchedCitadelPaints = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) {
      return this.catalog.paints().slice(0, 12);
    }
    return this.catalog
      .paints()
      .filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  });

  readonly matchedThirdPartyPaints = computed(() => {
    const q = this.query().trim().toLowerCase();
    const allTp = [...this.userState.customPaints(), ...this.catalog.thirdPartyPaints()];
    if (!q) {
      return allTp.slice(0, 12);
    }
    return allTp.filter(
      (tp) =>
        tp.name.toLowerCase().includes(q) ||
        tp.brand.toLowerCase().includes(q) ||
        tp.range.toLowerCase().includes(q)
    );
  });

  readonly matchedColors = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) {
      return this.catalog.colors().slice(0, 12);
    }
    return this.catalog
      .colors()
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.colorGroups.some((g) => g.toLowerCase().includes(q))
      );
  });

  readonly matchedModels = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) {
      return this.catalog.models().slice(0, 16);
    }
    return this.catalog.models().filter((m) => matchesModelSearch(m, q));
  });

  readonly totalCount = computed(
    () =>
      this.matchedCitadelPaints().length +
      this.matchedThirdPartyPaints().length +
      this.matchedColors().length +
      this.matchedModels().length
  );
}
