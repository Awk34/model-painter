import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import {
  getCitadelBrandLabel,
  getPaintRepresentativeHex,
  PaintSwatchLike,
} from '../../../core/utils/catalog-filter.util';
import { AppModalDialogComponent } from '../modal-dialog/modal-dialog.component';
import { PaintBrandBadgeComponent } from '../paint-brand-badge/paint-brand-badge.component';
import { PaintSwatchComponent } from '../paint-swatch/paint-swatch.component';

@Component({
  selector: 'app-paint-detail-modal',
  imports: [FormsModule, AppModalDialogComponent, PaintBrandBadgeComponent, PaintSwatchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paint-detail-modal.component.ng.html',
  styleUrl: './paint-detail-modal.component.css',
})
export class PaintDetailModalComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly modalService = inject(PaintModalService);
  readonly img = inject(ImageService);
  readonly getCitadelBrandLabel = getCitadelBrandLabel;
  readonly getPaintRepresentativeHex = getPaintRepresentativeHex;
  private readonly router = inject(Router);

  readonly selectedOverridePaintId = signal('');

  readonly activePaintId = this.modalService.activePaintId;

  constructor() {
    effect(() => {
      this.activePaintId();
      this.selectedOverridePaintId.set('');
    });
  }

  readonly citadelPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) {
      return null;
    }
    return this.catalog.paintById().get(id) ?? null;
  });

  readonly thirdPartyPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) {
      return null;
    }
    return (
      this.catalog.thirdPartyPaintById().get(id) ??
      this.userState.customPaintById().get(id) ??
      null
    );
  });

  readonly allThirdPartyAndCustomPaints = computed(() => [
    ...this.userState.customPaints(),
    ...this.catalog.thirdPartyPaints(),
  ]);

  readonly officialCitadelEquivalents = computed(() => {
    const cp = this.citadelPaint();
    if (!cp) {
      return [];
    }
    const paintById = this.catalog.paintById();
    const results: {
      id: string;
      name: string;
      hex: string;
      paint: PaintSwatchLike | undefined;
      label: string;
    }[] = [];

    const proLinks = this.catalog.classicToToneProMap().get(cp.id) ?? [];
    for (const l of proLinks) {
      const proP = paintById.get(l.tone_pro_paint_id);
      results.push({
        id: l.tone_pro_paint_id,
        name: l.tone_pro_paint_name,
        hex: proP ? getPaintRepresentativeHex(proP) : l.tone_pro_hex,
        paint: proP,
        label: 'Citadel Tone Pro Equivalent',
      });
    }

    const classicLinks = this.catalog.toneProToClassicMap().get(cp.id) ?? [];
    for (const l of classicLinks) {
      const classicP = paintById.get(l.classic_paint_id);
      results.push({
        id: l.classic_paint_id,
        name: l.classic_paint_name,
        hex: getPaintRepresentativeHex(classicP),
        paint: classicP,
        label: `Citadel Classic (${l.classic_category})`,
      });
    }
    return results;
  });

  readonly crossBrandMatches = computed(() => {
    const cp = this.citadelPaint();
    if (!cp) {
      return [];
    }
    const preseededMap = this.catalog.citadelToThirdPartyMap();
    const preseeded = (Object.hasOwn(preseededMap, cp.id) ? preseededMap[cp.id] : undefined) ?? [];
    const overrides = this.userState.customCompatibilityOverrides();
    const userOverrideIds =
      (Object.hasOwn(overrides, cp.id) ? overrides[cp.id] : undefined) ?? [];
    const tpById = this.catalog.thirdPartyPaintById();
    const customById = this.userState.customPaintById();

    const customList = userOverrideIds
      .map((id) => customById.get(id) ?? tpById.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({
        thirdPartyPaintId: p.id,
        brand: p.brand,
        range: p.range,
        code: p.code,
        name: p.name,
        category: p.category,
        hex: p.hex,
        deltaE: 0,
        matchQuality: 'exact' as const,
      }));

    const seen = new Set<string>();
    const combined = [];
    for (const item of [...customList, ...preseeded]) {
      if (!seen.has(item.thirdPartyPaintId)) {
        seen.add(item.thirdPartyPaintId);
        combined.push(item);
      }
    }
    return combined;
  });

  readonly colorsUsingPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) {
      return [];
    }
    return this.catalog.colorsUsingPaintMap().get(id) ?? [];
  });

  readonly modelsUsingPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) {
      return [];
    }
    return this.catalog.modelsUsingPaintMap().get(id) ?? [];
  });

  resolveThirdPartySwatch(id: string, category?: string): PaintSwatchLike {
    return (
      this.catalog.thirdPartyPaintById().get(id) ??
      this.userState.customPaintById().get(id) ??
      { category }
    );
  }

  resolveCitadelSwatch(id: string, category?: string): PaintSwatchLike {
    return this.catalog.paintById().get(id) ?? { category };
  }

  selectPaint(id: string): void {
    this.modalService.openPaint(id);
  }

  addCustomLink(citadelPaintId: string): void {
    const overrideId = this.selectedOverridePaintId();
    if (!overrideId) {
      return;
    }
    this.userState.linkCustomEquivalent(citadelPaintId, overrideId);
    this.selectedOverridePaintId.set('');
  }

  goToColor(colorId: string): void {
    this.close();
    this.router.navigate(['/colors', colorId]);
  }

  goToModel(modelId: string): void {
    this.close();
    this.router.navigate(['/models', modelId]);
  }

  close(): void {
    this.selectedOverridePaintId.set('');
    this.modalService.close();
  }
}
