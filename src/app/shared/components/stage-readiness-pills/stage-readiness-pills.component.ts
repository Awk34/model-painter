import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  FinishStageKey,
  InventoryReadinessResult,
  StagedReadinessResult,
} from '../../../core/models/catalog.models';
import { FINISH_STAGE_META } from '../../constants/finish-stage-meta';

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
    return FINISH_STAGE_META.map((meta) => ({
      key: meta.key,
      label: meta.shortLabel,
      data: s[meta.key],
    }));
  });
}

