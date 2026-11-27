import { ChangeDetectionStrategy, Component, effect, input, model } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { FinishStageKey } from '../../../core/models/catalog.models';
import { FINISH_STAGE_META } from '../../constants/finish-stage-meta';

export type RangeFilterValue = 'all' | 'warhammer_colour' | 'warhammer_pro';

@Component({
  selector: 'app-catalog-filter-bar',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './catalog-filter-bar.component.ng.html',
  styleUrl: './catalog-filter-bar.component.css',
})
export class CatalogFilterBarComponent {
  readonly searchId = input.required<string>();
  readonly searchLabel = input.required<string>();
  readonly searchPlaceholder = input.required<string>();
  readonly stageSelectId = input.required<string>();
  readonly readinessSelectId = input.required<string>();
  readonly rangeSelectId = input.required<string>();
  readonly readinessAllLabel = input<string>('Can I Paint This? — All');
  readonly missingThreshold = input<1 | 2>(2);

  readonly searchQuery = model<string>('');
  readonly targetStage = model<FinishStageKey>('base');
  readonly readinessFilter = model<string>('all');
  readonly rangeFilter = model<RangeFilterValue>('all');

  readonly stages = FINISH_STAGE_META;

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly stageControl = new FormControl<FinishStageKey>('base', { nonNullable: true });
  readonly readinessControl = new FormControl('all', { nonNullable: true });
  readonly rangeControl = new FormControl<RangeFilterValue>('all', { nonNullable: true });

  constructor() {
    effect(() => {
      const value = this.searchQuery();
      if (this.searchControl.value !== value) {
        this.searchControl.setValue(value, { emitEvent: false });
      }
    });
    effect(() => {
      const value = this.targetStage();
      if (this.stageControl.value !== value) {
        this.stageControl.setValue(value, { emitEvent: false });
      }
    });
    effect(() => {
      const value = this.readinessFilter();
      if (this.readinessControl.value !== value) {
        this.readinessControl.setValue(value, { emitEvent: false });
      }
    });
    effect(() => {
      const value = this.rangeFilter();
      if (this.rangeControl.value !== value) {
        this.rangeControl.setValue(value, { emitEvent: false });
      }
    });

    this.searchControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.searchQuery.set(v);
    });
    this.stageControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.targetStage.set(v);
    });
    this.readinessControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.readinessFilter.set(v);
    });
    this.rangeControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.rangeFilter.set(v);
    });
  }
}
