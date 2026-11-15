import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  FinishStageKey,
  InventoryReadinessResult,
  StagedReadinessResult,
} from '../../../core/models/catalog.models';

interface StagePillItem {
  key: FinishStageKey;
  label: string;
  data: InventoryReadinessResult;
}

@Component({
  selector: 'app-stage-readiness-pills',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stage-readiness-pills.component.ng.html',
  styleUrl: './stage-readiness-pills.component.css',
})
export class StageReadinessPillsComponent {
  readonly staged = input.required<StagedReadinessResult>();
  readonly activeStage = input<FinishStageKey | null>(null);

  readonly stages = computed<StagePillItem[]>(() => {
    const s = this.staged();
    return [
      { key: 'base', label: '1. Base', data: s.base },
      { key: 'detail', label: '2. Detail', data: s.detail },
      { key: 'artificer', label: '3. Artificer', data: s.artificer },
    ];
  });
}

