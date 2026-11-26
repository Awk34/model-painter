import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  FinishStageKey,
  ModelSummary,
  ProjectModelEntry,
} from '../../core/models/catalog.models';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { ProjectImageResolverService } from '../../core/services/project-image-resolver.service';
import { UserStateService } from '../../core/services/user-state.service';
import { CollapsibleSectionComponent } from '../../shared/components/collapsible-section/collapsible-section.component';
import { StageReadinessBarsComponent } from '../../shared/components/stage-readiness-bars/stage-readiness-bars.component';
import { UserPhotoGalleryComponent } from '../../shared/components/user-photo-gallery/user-photo-gallery.component';
import { ProjectNotesSectionComponent } from './components/project-notes-section.component';
import {
  ProjectPaintRollupComponent,
  ProjectRollupStage,
} from './components/project-paint-rollup.component';
import {
  ProjectPickerModalComponent,
  ProjectPickerMode,
} from './components/project-picker-modal.component';

export interface ProjectModelCardView {
  entry: ProjectModelEntry;
  summary: ModelSummary | null;
  displayName: string;
  catalogName: string;
  hasCustomName: boolean;
  gameLabel: string;
  imageUrl: string;
  hasNotes: boolean;
  hasCustomImage: boolean;
  completedStepCount: number;
  photoCount: number;
}

@Component({
  selector: 'app-project-detail',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    CollapsibleSectionComponent,
    UserPhotoGalleryComponent,
    StageReadinessBarsComponent,
    ProjectPaintRollupComponent,
    ProjectNotesSectionComponent,
    ProjectPickerModalComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-detail.component.ng.html',
  styleUrl: './project-detail.component.css',
})
export class ProjectDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly readinessService = inject(InventoryMatchService);
  readonly img = inject(ImageService);
  readonly projectImg = inject(ProjectImageResolverService);

  private readonly paramMap = toSignal(this.route.paramMap);
  readonly projectId = computed(() => this.paramMap()?.get('id') ?? '');

  readonly modelsExpanded = signal(true);
  readonly paintsExpanded = signal(true);
  readonly photosExpanded = signal(true);
  readonly colorsExpanded = signal(true);
  readonly notesExpanded = signal(true);
  readonly selectedRollupStage = signal<ProjectRollupStage>('base');
  readonly activePickerModal = signal<ProjectPickerMode>(null);
  readonly notesEditorOpen = signal(false);

  readonly editingTitle = signal(false);
  readonly titleDraft = signal('');
  readonly titleControl = new FormControl('', { nonNullable: true });
  readonly titleForm = new FormGroup({ title: this.titleControl });

  private lastProjectId: string | null = null;

  constructor() {
    effect(() => {
      const pid = this.projectId();
      if (this.lastProjectId !== null && pid !== this.lastProjectId) {
        this.modelsExpanded.set(true);
        this.paintsExpanded.set(true);
        this.photosExpanded.set(true);
        this.colorsExpanded.set(true);
        this.notesExpanded.set(true);
        this.editingTitle.set(false);
        this.titleDraft.set('');
        this.activePickerModal.set(null);
        this.notesEditorOpen.set(false);
        this.selectedRollupStage.set('base');
      }
      this.lastProjectId = pid;
    });

    effect(() => {
      const t = this.titleDraft();
      if (this.titleControl.value !== t) {
        this.titleControl.setValue(t, { emitEvent: false });
      }
    });

    this.titleControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.titleDraft.set(v);
    });
  }

  readonly project = computed(
    () => this.userState.projects().find((p) => p.id === this.projectId()) ?? null
  );

  readonly projectPhotoCount = computed(() => {
    const p = this.project();
    if (!p) {
      return 0;
    }
    return this.userState.getTargetPhotoCount('project', p.id);
  });

  readonly totalProjectPhotoCount = computed(() => {
    const p = this.project();
    if (!p) {
      return 0;
    }
    return this.userState.getProjectTotalPhotoCount(p);
  });

  readonly totalMiniatures = computed(() => {
    const p = this.project();
    if (!p) {
      return 0;
    }
    return this.userState.getProjectTotalMiniatures(p);
  });

  readonly attachedModels = computed<ProjectModelCardView[]>(() => {
    const p = this.project();
    if (!p) {
      return [];
    }
    const map = this.catalog.modelById();
    return p.models.map((entry) => {
      const summary = map.get(entry.recipeId) ?? null;
      const catalogName = summary?.name ?? entry.recipeId;
      const customName = entry.customName?.trim();
      return {
        entry,
        summary,
        displayName: customName || catalogName,
        catalogName,
        hasCustomName: Boolean(customName && customName !== catalogName),
        gameLabel: summary?.gameNames.join(', ') ?? '',
        imageUrl: this.projectImg.resolveProjectModelImageUrl(entry, summary),
        hasNotes: entry.notes.trim().length > 0,
        hasCustomImage: Boolean(entry.featuredImage),
        completedStepCount: entry.completedStepIds.length,
        photoCount: entry.photos.length,
      };
    });
  });

  readonly attachedColors = computed(() => {
    const p = this.project();
    if (!p) {
      return [];
    }
    const map = this.catalog.colorById();
    return p.colorIds
      .map((id) => map.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
  });

  readonly coverUrl = computed(() => {
    const p = this.project();
    if (!p) {
      return '/icons/ic_project.svg';
    }
    return this.projectImg.resolveProjectCoverUrl(p);
  });

  readonly stagedRollupReadiness = computed(() => {
    const p = this.project();
    if (!p) {
      return this.readinessService.evaluateStagedReadiness({});
    }
    return this.readinessService.evaluateProjectStagedReadiness(p);
  });

  readonly activeHeroStage = computed<FinishStageKey | null>(() => {
    const stage = this.selectedRollupStage();
    return stage === 'all' ? null : stage;
  });

  onHeroStageClick(stage: FinishStageKey): void {
    this.selectedRollupStage.set(stage);
    this.paintsExpanded.set(true);
  }

  startEditTitle(current: string): void {
    this.titleDraft.set(current);
    this.editingTitle.set(true);
  }

  saveTitle(projectId: string): void {
    this.userState.renameProject(projectId, this.titleDraft());
    this.editingTitle.set(false);
  }

  onSelectCoverPhoto(projectId: string, photoId: string | undefined): void {
    this.userState.setProjectCoverPhoto(projectId, photoId);
  }

  duplicateAndOpen(projectId: string): void {
    const copy = this.userState.duplicateProject(projectId);
    if (copy) {
      void this.router.navigate(['/projects', copy.id]);
    }
  }

  deleteProject(projectId: string, name: string): void {
    if (confirm(`Delete project "${name}"?`)) {
      this.userState.deleteProject(projectId);
      void this.router.navigate(['/hobby-desk']);
    }
  }

  adjustModelQuantity(projectId: string, entry: ProjectModelEntry, delta: number): void {
    this.userState.adjustProjectModelQuantity(projectId, entry.id, delta);
  }

  duplicateModelEntry(projectId: string, entryId: string): void {
    this.userState.duplicateProjectModel(projectId, entryId);
  }
}
