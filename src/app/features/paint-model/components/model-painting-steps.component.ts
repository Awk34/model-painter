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

export interface ModelPaintingStepViewModel {
  step: ModelPaintingStep;
  stepNum: string | number;
  done: boolean;
  stepLabel: string;
  imageUrl: string | null;
}

export interface ModelPaintingAreaViewModel {
  area: ModelPaintingArea;
  progress: PaintingProgressSummary;
  thumbUrl: string | null;
  stageLabel: string;
  steps: ModelPaintingStepViewModel[];
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

  readonly stageProgressByKey = computed<
    Record<Exclude<ModelStageFilter, 'all'>, PaintingProgressSummary>
  >(() => {
    const completed = this.completedStepSet();
    const counts: Record<
      Exclude<ModelStageFilter, 'all'>,
      { done: number; total: number }
    > = {
      'Base Finish': { done: 0, total: 0 },
      'Detail Finish': { done: 0, total: 0 },
      'Artificer Finish': { done: 0, total: 0 },
    };

    for (const area of this.paintingAreas()) {
      for (const step of area.paintingSteps ?? []) {
        if (!step.id) {
          continue;
        }
        const normalized = normalizePaintingStageLabel(step.paintingStage);
        if (
          normalized === 'Base Finish' ||
          normalized === 'Detail Finish' ||
          normalized === 'Artificer Finish'
        ) {
          counts[normalized].total += 1;
          if (completed.has(step.id)) {
            counts[normalized].done += 1;
          }
        }
      }
    }

    return {
      'Base Finish': {
        done: counts['Base Finish'].done,
        total: counts['Base Finish'].total,
        isDone: counts['Base Finish'].total > 0 && counts['Base Finish'].done === counts['Base Finish'].total,
      },
      'Detail Finish': {
        done: counts['Detail Finish'].done,
        total: counts['Detail Finish'].total,
        isDone:
          counts['Detail Finish'].total > 0 &&
          counts['Detail Finish'].done === counts['Detail Finish'].total,
      },
      'Artificer Finish': {
        done: counts['Artificer Finish'].done,
        total: counts['Artificer Finish'].total,
        isDone:
          counts['Artificer Finish'].total > 0 &&
          counts['Artificer Finish'].done === counts['Artificer Finish'].total,
      },
    };
  });

  readonly areaViewModels = computed<ModelPaintingAreaViewModel[]>(() => {
    const areas = this.paintingAreas();
    const completed = this.completedStepSet();
    const hasModelId = Boolean(this.modelId());
    const sf = this.stageFilter();

    return areas.map((area) => {
      const rawSteps = area.paintingSteps ?? [];
      const filteredSteps =
        sf === 'all'
          ? rawSteps
          : rawSteps.filter((s) => normalizePaintingStageLabel(s.paintingStage) === sf);
      const progress = this.computeAreaProgress(area, completed, filteredSteps);
      const thumbUrl =
        area.localImagePath || area.imageUrl
          ? this.img.resolve(area.localImagePath, area.imageUrl)
          : null;
      const stageLabel = `${progress.isDone ? 'Unmark stage done: ' : 'Mark stage done: '}${area.name}`;

      const steps: ModelPaintingStepViewModel[] = filteredSteps.map((step) => {
        const stepNum = step.stepNumber || step.stepOrder;
        const done = hasModelId && completed.has(step.id);
        const stepLabel = `${done ? 'Mark not done: ' : 'Mark done: '}${
          step.text || step.paint?.name || `Step ${stepNum}`
        }`;
        const imageUrl =
          step.localImagePath || step.imageUrl
            ? this.img.resolve(step.localImagePath, step.imageUrl)
            : null;
        return {
          step,
          stepNum,
          done,
          stepLabel,
          imageUrl,
        };
      });

      return {
        area,
        progress,
        thumbUrl,
        stageLabel,
        steps,
      };
    });
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
    return this.computeAreaProgress(area, this.completedStepSet());
  }

  private computeAreaProgress(
    area: ModelPaintingArea,
    completed: ReadonlySet<string>,
    filteredSteps?: ModelPaintingStep[]
  ): PaintingProgressSummary {
    const rawSteps = area.paintingSteps ?? [];
    const ids =
      rawSteps.length === 0
        ? area.id
          ? [`area:${area.id}`]
          : []
        : (filteredSteps ?? this.filterSteps(rawSteps)).map((s) => s.id).filter(Boolean);

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
    return this.stageProgressByKey()[stage];
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

