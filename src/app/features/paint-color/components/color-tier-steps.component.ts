import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import {
  ColorStageStep,
  FinishStageKey,
  InventoryReadinessResult,
} from '../../../core/models/catalog.models';
import { PaintActionRowComponent } from '../../../shared/components/paint-action-row/paint-action-row.component';

export interface ColorTierBlock {
  key: FinishStageKey;
  label: string;
  steps: ColorStageStep[];
}

@Component({
  selector: 'app-color-tier-steps',
  imports: [PaintActionRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './color-tier-steps.component.ng.html',
  styleUrl: './color-tier-steps.component.css',
})
export class ColorTierStepsComponent {
  readonly tierBlocks = input.required<ColorTierBlock[]>();
  readonly readiness = input.required<InventoryReadinessResult>();
  readonly activeTier = model<FinishStageKey>('base');
}
