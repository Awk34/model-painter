import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  FinishStageKey,
  InventoryReadinessResult,
  StagedReadinessResult,
} from '../../../core/models/catalog.models';

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
    return [
      {
        key: 'base',
        title: '1. Base Finish',
        tierHint: 'Battle Ready',
        primaryWishlistButton: true,
        data: s.base,
      },
      {
        key: 'detail',
        title: '2. Detail Finish',
        tierHint: 'Shade & Layer',
        primaryWishlistButton: false,
        data: s.detail,
      },
      {
        key: 'artificer',
        title: '3. Artificer Finish',
        tierHint: 'Edge Highlights',
        primaryWishlistButton: false,
        data: s.artificer,
      },
    ];
  });

  onWishlistClick(event: Event, paintIds: string[]): void {
    event.stopPropagation();
    this.wishlistMissing.emit(paintIds);
  }
}

