import { ChangeDetectionStrategy, Component, inject, input, model } from '@angular/core';
import {
  InventoryReadinessResult,
  ModelPaintingArea,
  ModelPaintingStep,
} from '../../../core/models/catalog.models';
import { normalizePaintingStageLabel } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import {
  getPaintSwatchBackground,
  isMetallicPaint,
} from '../../../core/utils/catalog-filter.util';

export type ModelStageFilter = 'all' | 'Base Finish' | 'Detail Finish' | 'Artificer Finish';

@Component({
  selector: 'app-model-painting-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './model-painting-steps.component.ng.html',
  styleUrl: './model-painting-steps.component.css',
})
export class ModelPaintingStepsComponent {
  readonly userState = inject(UserStateService);
  readonly paintModal = inject(PaintModalService);
  readonly img = inject(ImageService);
  readonly getPaintSwatchBackground = getPaintSwatchBackground;
  readonly isMetallicPaint = isMetallicPaint;

  readonly paintingAreas = input.required<ModelPaintingArea[]>();
  readonly readiness = input.required<InventoryReadinessResult>();
  readonly stageFilter = model<ModelStageFilter>('all');

  filterSteps(steps: ModelPaintingStep[]): ModelPaintingStep[] {
    const sf = this.stageFilter();
    if (sf === 'all') {
      return steps;
    }
    return steps.filter((s) => normalizePaintingStageLabel(s.paintingStage) === sf);
  }
}

