import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CatalogService } from '../../../core/services/catalog.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { ImageService } from '../../../core/services/image.service';

@Component({
  selector: 'app-paint-detail-modal',
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paint-detail-modal.component.ng.html',
  styleUrl: './paint-detail-modal.component.css',
})
export class PaintDetailModalComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly modalService = inject(PaintModalService);
  readonly img = inject(ImageService);
  private readonly router = inject(Router);

  selectedOverridePaintId = '';

  readonly activePaintId = this.modalService.activePaintId;

  readonly citadelPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) return null;
    return this.catalog.paintById().get(id) ?? null;
  });

  readonly thirdPartyPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) return null;
    return (
      this.catalog.thirdPartyPaintById().get(id) ??
      this.userState.customPaints().find((c) => c.id === id) ??
      null
    );
  });

  readonly allThirdPartyAndCustomPaints = computed(() => [
    ...this.userState.customPaints(),
    ...this.catalog.thirdPartyPaints(),
  ]);

  readonly officialCitadelEquivalents = computed(() => {
    const cp = this.citadelPaint();
    if (!cp) return [];
    const results: { id: string; name: string; hex: string; label: string }[] = [];

    const proLinks = this.catalog.classicToToneProMap().get(cp.id) ?? [];
    for (const l of proLinks) {
      results.push({
        id: l.tone_pro_paint_id,
        name: l.tone_pro_paint_name,
        hex: l.tone_pro_hex,
        label: 'Citadel Tone Pro Equivalent',
      });
    }

    const classicLinks = this.catalog.toneProToClassicMap().get(cp.id) ?? [];
    for (const l of classicLinks) {
      const classicP = this.catalog.paintById().get(l.classic_paint_id);
      results.push({
        id: l.classic_paint_id,
        name: l.classic_paint_name,
        hex: classicP?.gradientStartHex ?? '#888888',
        label: `Citadel Classic (${l.classic_category})`,
      });
    }
    return results;
  });

  readonly crossBrandMatches = computed(() => {
    const cp = this.citadelPaint();
    if (!cp) return [];
    const preseeded = this.catalog.citadelToThirdPartyMap()[cp.id] ?? [];
    const userOverrideIds = this.userState.customCompatibilityOverrides()[cp.id] ?? [];
    const customList = userOverrideIds
      .map((id) => this.allThirdPartyAndCustomPaints().find((p) => p.id === id))
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

  readonly coloursUsingPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) return [];
    return this.catalog.coloursUsingPaintMap().get(id) ?? [];
  });

  readonly modelsUsingPaint = computed(() => {
    const id = this.activePaintId();
    if (!id) return [];
    return this.catalog.modelsUsingPaintMap().get(id) ?? [];
  });

  selectPaint(id: string): void {
    this.modalService.openPaint(id);
  }

  addCustomLink(citadelPaintId: string): void {
    if (!this.selectedOverridePaintId) return;
    this.userState.linkCustomEquivalent(citadelPaintId, this.selectedOverridePaintId);
    this.selectedOverridePaintId = '';
  }

  goToColour(colourId: string): void {
    this.close();
    this.router.navigate(['/colours', colourId]);
  }

  goToModel(modelId: string): void {
    this.close();
    this.router.navigate(['/models', modelId]);
  }

  close(): void {
    this.modalService.close();
  }
}
