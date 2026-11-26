import { ChangeDetectionStrategy, Component, computed, inject, input, model } from '@angular/core';
import {
  InventoryReadinessResult,
  ModelPaintingArea,
  ModelPaintingStep,
} from '../../../core/models/catalog.models';
import { normalizePaintingStageLabel } from '../../../core/utils/catalog-normalizer.util';
import { ImageService } from '../../../core/services/image.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { PaintActionRowComponent } from '../../../shared/components/paint-action-row/paint-action-row.component';

export type ModelStageFilter = 'all' | 'Base Finish' | 'Detail Finish' | 'Artificer Finish';

export interface PaintingProgressSummary {
  done: number;
  total: number;
  isDone: boolean;
}

@Component({
  selector: 'app-model-painting-steps',
  imports: [PaintActionRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './model-painting-steps.component.ng.html',
  styleUrl: './model-painting-steps.component.css',
})
export class ModelPaintingStepsComponent {
  readonly userState = inject(UserStateService);
  readonly img = inject(ImageService);

  readonly modelId = input<string>('');
  readonly projectId = input<string | undefined>(undefined);
  readonly projectModelId = input<string | undefined>(undefined);
  readonly paintingAreas = input.required<ModelPaintingArea[]>();
  readonly readiness = input.required<InventoryReadinessResult>();
  readonly stageFilter = model<ModelStageFilter>('all');

  readonly completedStepSet = computed(() => {
    const pid = this.projectId();
    const entryId = this.projectModelId();
    if (pid && entryId) {
      return new Set(this.userState.getProjectModelCompletedStepIds(pid, entryId));
    }
    const id = this.modelId();
    if (!id) {
      return new Set<string>();
    }
    return new Set(this.userState.getCompletedStepIds(id));
  });

  readonly overallProgress = computed<PaintingProgressSummary & { percent: number }>(() => {
    const areas = this.paintingAreas();
    const completed = this.completedStepSet();
    let total = 0;
    let done = 0;
    for (const area of areas) {
      const ids = this.getAreaTrackingIds(area, false);
      total += ids.length;
      for (const id of ids) {
        if (completed.has(id)) {
          done += 1;
        }
      }
    }
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, isDone: total > 0 && done === total, percent };
  });

  filterSteps(steps: ModelPaintingStep[]): ModelPaintingStep[] {
    const sf = this.stageFilter();
    if (sf === 'all') {
      return steps;
    }
    return steps.filter((s) => normalizePaintingStageLabel(s.paintingStage) === sf);
  }

  isStepDone(stepId: string): boolean {
    return this.completedStepSet().has(stepId);
  }

  toggleStepDone(stepId: string): void {
    if (!stepId) {
      return;
    }
    const pid = this.projectId();
    const entryId = this.projectModelId();
    if (pid && entryId) {
      this.userState.toggleProjectModelStepDone(pid, entryId, stepId);
      return;
    }
    const id = this.modelId();
    if (!id) {
      return;
    }
    this.userState.toggleStepDone(id, stepId);
  }

  getAreaProgress(area: ModelPaintingArea): PaintingProgressSummary {
    const ids = this.getAreaTrackingIds(area, true);
    const completed = this.completedStepSet();
    let done = 0;
    for (const id of ids) {
      if (completed.has(id)) {
        done += 1;
      }
    }
    const total = ids.length;
    return { done, total, isDone: total > 0 && done === total };
  }

  toggleAreaDone(area: ModelPaintingArea): void {
    const ids = this.getAreaTrackingIds(area, true);
    if (ids.length === 0) {
      return;
    }
    const { isDone } = this.getAreaProgress(area);
    const pid = this.projectId();
    const entryId = this.projectModelId();
    if (pid && entryId) {
      this.userState.setProjectModelStepsDone(pid, entryId, ids, !isDone);
      return;
    }
    const id = this.modelId();
    if (!id) {
      return;
    }
    this.userState.setStepsDone(id, ids, !isDone);
  }

  getStageProgress(stage: Exclude<ModelStageFilter, 'all'>): PaintingProgressSummary {
    const completed = this.completedStepSet();
    let total = 0;
    let done = 0;
    for (const area of this.paintingAreas()) {
      for (const step of area.paintingSteps ?? []) {
        if (normalizePaintingStageLabel(step.paintingStage) === stage && step.id) {
          total += 1;
          if (completed.has(step.id)) {
            done += 1;
          }
        }
      }
    }
    return { done, total, isDone: total > 0 && done === total };
  }

  clearProgress(): void {
    const pid = this.projectId();
    const entryId = this.projectModelId();
    if (pid && entryId) {
      this.userState.clearProjectModelProgress(pid, entryId);
      return;
    }
    const id = this.modelId();
    if (!id) {
      return;
    }
    this.userState.clearModelProgress(id);
  }

  private getAreaTrackingIds(area: ModelPaintingArea, useFiltered: boolean): string[] {
    const rawSteps = area.paintingSteps ?? [];
    if (rawSteps.length === 0) {
      return area.id ? [`area:${area.id}`] : [];
    }
    const steps = useFiltered ? this.filterSteps(rawSteps) : rawSteps;
    return steps.map((s) => s.id).filter(Boolean);
  }
}

