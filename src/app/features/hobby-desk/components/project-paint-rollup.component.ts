import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';
import { FinishStageKey, StagedReadinessResult } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import {
  getPaintSwatchBackground,
  isMetallicPaint,
  isShadePaint,
} from '../../../core/utils/catalog-filter.util';

export type ProjectRollupStage = FinishStageKey | 'all';

@Component({
  selector: 'app-project-paint-rollup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-paint-rollup.component.ng.html',
  styleUrl: './project-paint-rollup.component.css',
})
export class ProjectPaintRollupComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly paintModal = inject(PaintModalService);
  readonly getPaintSwatchBackground = getPaintSwatchBackground;
  readonly isMetallicPaint = isMetallicPaint;
  readonly isShadePaint = isShadePaint;

  readonly staged = input.required<StagedReadinessResult>();
  readonly expanded = model<boolean>(true);
  readonly selectedStage = model<ProjectRollupStage>('base');

  readonly addModelClick = output<void>();
  readonly addColorClick = output<void>();

  readonly rollupReadiness = computed(() => {
    const s = this.staged();
    const stage = this.selectedStage();
    if (stage === 'all') {
      return s.overall;
    }
    return s[stage];
  });

  readonly missingPaintObjects = computed(() => {
    const map = this.catalog.paintById();
    return this.rollupReadiness()
      .missingPaintIds.map((id) => map.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  });

  readonly ownedDirectObjects = computed(() => {
    const map = this.catalog.paintById();
    return this.rollupReadiness()
      .ownedDirectIds.map((id) => map.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  });

  readonly substitutedList = computed(() => {
    const map = this.catalog.paintById();
    const subs = this.rollupReadiness().substitutedByPaintId;
    return Object.entries(subs)
      .map(([pid, sub]) => {
        const paint = map.get(pid);
        return paint ? { paint, sub } : null;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  });
}

