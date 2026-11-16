import { ChangeDetectionStrategy, Component, inject, input, model } from '@angular/core';
import {
  ColorStageStep,
  FinishStageKey,
  InventoryReadinessResult,
} from '../../../core/models/catalog.models';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { PaintSwatchComponent } from '../../../shared/components/paint-swatch/paint-swatch.component';

export interface ColorTierBlock {
  key: FinishStageKey;
  label: string;
  steps: ColorStageStep[];
}

@Component({
  selector: 'app-color-tier-steps',
  imports: [PaintSwatchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './color-tier-steps.component.ng.html',
  styleUrl: './color-tier-steps.component.css',
})
export class ColorTierStepsComponent {
  readonly userState = inject(UserStateService);
  readonly paintModal = inject(PaintModalService);

  readonly tierBlocks = input.required<ColorTierBlock[]>();
  readonly readiness = input.required<InventoryReadinessResult>();
  readonly activeTier = model<FinishStageKey>('base');
}

