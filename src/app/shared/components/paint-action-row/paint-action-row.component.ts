import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { PaintSubstituteMatch } from '../../../core/models/catalog.models';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { PaintSwatchLike } from '../../../core/utils/catalog-filter.util';
import { PaintSwatchComponent, PaintSwatchSize } from '../paint-swatch/paint-swatch.component';

export type PaintActionMode =
  | 'full'
  | 'own-wish-text'
  | 'own-only'
  | 'compact-own'
  | 'owned-badge'
  | 'none';

export type PaintActionRowVariant = 'row' | 'card' | 'pill' | 'step';

@Component({
  selector: 'app-paint-action-row',
  imports: [PaintSwatchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './paint-action-row.component.ng.html',
  styleUrl: './paint-action-row.component.css',
})
export class PaintActionRowComponent {
  readonly userState = inject(UserStateService);
  readonly paintModal = inject(PaintModalService);

  readonly paintId = input.required<string>();
  readonly name = input.required<string>();
  readonly subtitle = input<string | undefined>('');
  readonly paint = input<PaintSwatchLike | null | undefined>(undefined);
  readonly hex = input<string | null | undefined>(undefined);
  readonly swatchSize = input<PaintSwatchSize>('md');
  readonly imageUrl = input<string | null | undefined>(undefined);
  readonly stepOrder = input<number | null>(null);
  readonly substitute = input<PaintSubstituteMatch | null | undefined>(null);
  readonly substituteFormat = input<'full' | 'short'>('full');
  readonly deltaE = input<number | null>(null);
  readonly matchQuality = input<'exact' | 'close' | 'similar' | null>(null);
  readonly actionMode = input<PaintActionMode>('full');
  readonly variant = input<PaintActionRowVariant>('row');
  readonly useIconToggle = input<boolean>(false);

  readonly inspect = output<string>();

  readonly isOwned = computed(() => this.userState.isOwned(this.paintId()));
  readonly isWishlisted = computed(() => this.userState.isWishlisted(this.paintId()));

  onInspect(): void {
    const id = this.paintId();
    this.paintModal.openPaint(id);
    this.inspect.emit(id);
  }
}
