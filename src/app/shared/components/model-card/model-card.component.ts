import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  FinishStageKey,
  ModelSummary,
  StagedReadinessResult,
} from '../../../core/models/catalog.models';
import { ImageService } from '../../../core/services/image.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { StageReadinessPillsComponent } from '../stage-readiness-pills/stage-readiness-pills.component';

@Component({
  selector: 'app-model-card',
  imports: [RouterLink, StageReadinessPillsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './model-card.component.ng.html',
  styleUrl: './model-card.component.css',
})
export class ModelCardComponent {
  readonly userState = inject(UserStateService);
  readonly img = inject(ImageService);

  readonly model = input.required<ModelSummary>();
  readonly staged = input<StagedReadinessResult | null>(null);
  readonly activeStage = input<FinishStageKey | null>(null);
  readonly headingLevel = input<'h2' | 'h3'>('h2');
  readonly showRangeTag = input<boolean>(false);
  readonly compact = input<boolean>(false);
  readonly subtitleFallback = input<string>('Miniature');

  readonly subtitleText = computed(() => {
    const m = this.model();
    return m.factionNames.slice(0, 2).join(' • ') || m.gameNames[0] || this.subtitleFallback();
  });
}
