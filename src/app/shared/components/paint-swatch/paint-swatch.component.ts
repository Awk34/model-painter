import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  getPaintSwatchBackground,
  isMetallicPaint,
  isShadePaint,
  PaintSwatchLike,
} from '../../../core/utils/catalog-filter.util';

export type PaintSwatchSize = 'mini' | 'md' | 'large';

/**
 * Reusable circular paint swatch that renders solid colors, metallic specular sheens,
 * and deep wash/shade gradients from either a paint-like object or a fallback hex string.
 */
@Component({
  selector: 'app-paint-swatch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paint-swatch.component.ng.html',
  styleUrl: './paint-swatch.component.css',
})
export class PaintSwatchComponent {
  readonly paint = input<PaintSwatchLike | null | undefined>(null);
  readonly hex = input<string | null | undefined>(undefined);
  readonly size = input<PaintSwatchSize>('md');

  private readonly effectivePaint = computed<PaintSwatchLike | null>(() => {
    const p = this.paint();
    const fallbackHex = this.hex();
    if (p) {
      if (fallbackHex && !p.hex && !p.gradientStartHex) {
        return { ...p, hex: fallbackHex };
      }
      return p;
    }
    return fallbackHex ? { hex: fallbackHex } : null;
  });

  readonly isMetallic = computed(() => isMetallicPaint(this.effectivePaint()));
  readonly isShade = computed(() => isShadePaint(this.effectivePaint()));
  readonly background = computed(() =>
    getPaintSwatchBackground(this.effectivePaint(), this.hex() || '#888888')
  );
}

