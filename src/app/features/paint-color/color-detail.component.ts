import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { from, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { ColorDetails, ColorStageStep, FinishStageKey } from '../../core/models/catalog.models';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { UserStateService } from '../../core/services/user-state.service';
import { AddToProjectModalComponent } from '../../shared/components/add-to-project-modal/add-to-project-modal.component';
import { PaintBrandBadgeComponent } from '../../shared/components/paint-brand-badge/paint-brand-badge.component';
import { PaintSwatchComponent } from '../../shared/components/paint-swatch/paint-swatch.component';
import { StageReadinessBarsComponent } from '../../shared/components/stage-readiness-bars/stage-readiness-bars.component';
import { ColorTierBlock, ColorTierStepsComponent } from './components/color-tier-steps.component';

@Component({
  selector: 'app-color-detail',
  imports: [
    RouterModule,
    StageReadinessBarsComponent,
    ColorTierStepsComponent,
    AddToProjectModalComponent,
    PaintBrandBadgeComponent,
    PaintSwatchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './color-detail.component.ng.html',
  styleUrl: './color-detail.component.css',
})
export class ColorDetailComponent {
  private readonly route = inject(ActivatedRoute);
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly readinessService = inject(InventoryMatchService);
  readonly img = inject(ImageService);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly color = signal<ColorDetails | null>(null);
  readonly activeTier = signal<FinishStageKey>('base');
  readonly showProjectModal = signal(false);

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => params.get('id')),
        tap(() => {
          this.loading.set(true);
          this.loadError.set(null);
          this.activeTier.set('base');
          this.showProjectModal.set(false);
        }),
        switchMap((id) => {
          if (!id) {
            return of<{ data: ColorDetails | null; error: string | null }>({
              data: null,
              error: null,
            });
          }
          return from(this.catalog.getColorDetails(id)).pipe(
            map((data) => ({ data, error: null as string | null })),
            catchError((err: unknown) => {
              console.warn(`Failed to load color guide ${id}:`, err);
              return of({
                data: null as ColorDetails | null,
                error: 'Unable to load this color guide right now. Please try again.',
              });
            })
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe(({ data, error }) => {
        this.color.set(data);
        this.loadError.set(error);
        this.loading.set(false);
      });
  }

  readonly activeShowcaseImage = computed(() => {
    const c = this.color();
    if (!c) {
      return '/icons/ic_color.svg';
    }
    const finishByTier = {
      base: c.baseFinish,
      detail: c.detailFinish,
      artificer: c.artificerFinish,
    }[this.activeTier()];

    if (finishByTier?.localBackpackImagePath || finishByTier?.backpackImage) {
      return this.img.resolve(finishByTier.localBackpackImagePath, finishByTier.backpackImage);
    }
    return this.img.resolve(
      c.localImagePath || c.localHeaderImagePath,
      c.imageUrl || c.headerImage
    );
  });

  readonly allTierBlocks = computed<ColorTierBlock[]>(() => {
    const c = this.color();
    if (!c) {
      return [];
    }
    const blocks: ColorTierBlock[] = [];
    if (c.baseFinish?.stages?.length) {
      blocks.push({ key: 'base', label: 'Base Finish (Battle Ready)', steps: c.baseFinish.stages });
    }
    if (c.detailFinish?.stages?.length) {
      blocks.push({
        key: 'detail',
        label: 'Detail Finish (Parade Ready)',
        steps: c.detailFinish.stages,
      });
    }
    if (c.artificerFinish?.stages?.length) {
      blocks.push({
        key: 'artificer',
        label: 'Artificer Finish (Masterclass)',
        steps: c.artificerFinish.stages,
      });
    }
    return blocks;
  });

  readonly stagedReadiness = computed(() => {
    const c = this.color();
    if (!c) {
      return this.readinessService.evaluateStagedReadiness({});
    }
    const extractIds = (steps?: ColorStageStep[]) =>
      (steps ?? []).map((st) => st.paint?.id).filter((id): id is string => Boolean(id));

    return this.readinessService.evaluateStagedReadiness({
      base: extractIds(c.baseFinish?.stages),
      detail: extractIds(c.detailFinish?.stages),
      artificer: extractIds(c.artificerFinish?.stages),
    });
  });

  readonly readiness = computed(() => this.stagedReadiness().overall);

  readonly modelsUsingColor = computed(() => {
    const c = this.color();
    if (!c) {
      return [];
    }
    return this.catalog.modelsUsingColorMap().get(c.id) ?? [];
  });
}
