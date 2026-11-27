import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  FinishStageKey,
  InventoryReadinessResult,
  StagedReadinessResult,
} from '../../../core/models/catalog.models';
import { FINISH_STAGE_META } from '../../constants/finish-stage-meta';

interface StageBarItem {
  key: FinishStageKey;
  title: string;
  tierHint: string;
  primaryWishlistButton: boolean;
  data: InventoryReadinessResult;
}

@Component({
  selector: 'app-stage-readiness-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './stage-readiness-bars.component.ng.html',
  styleUrl: './stage-readiness-bars.component.css',
})
export class StageReadinessBarsComponent {
  readonly staged = input.required<StagedReadinessResult>();
  readonly activeStage = input<FinishStageKey | null>(null);
  readonly heading = input<string>('Can I Paint This? — Readiness by Detail Level');
  readonly hint = input<string>('');
  readonly layout = input<'stack' | 'grid'>('stack');

  readonly stageClick = output<FinishStageKey>();
  readonly wishlistMissing = output<string[]>();

  readonly stages = computed<StageBarItem[]>(() => {
    const s = this.staged();
    return FINISH_STAGE_META.map((meta) => ({
      key: meta.key,
      title: meta.title,
      tierHint: meta.tierHint,
      primaryWishlistButton: meta.primaryWishlistButton,
      data: s[meta.key],
    }));
  });

  onWishlistClick(event: Event, paintIds: string[]): void {
    event.stopPropagation();
    this.wishlistMissing.emit(paintIds);
  }
}

