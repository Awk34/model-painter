import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { InventoryMatchService } from '../../../core/services/inventory-match.service';
import { ProjectImageResolverService } from '../../../core/services/project-image-resolver.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';
import { AppModalDialogComponent } from '../../../shared/components/modal-dialog/modal-dialog.component';
import { StageReadinessPillsComponent } from '../../../shared/components/stage-readiness-pills/stage-readiness-pills.component';

export type ProjectSortMode = 'updated' | 'created' | 'alpha';

@Component({
  selector: 'app-hobby-desk-projects-tab',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AppIconComponent,
    AppModalDialogComponent,
    StageReadinessPillsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hobby-desk-projects-tab.component.ng.html',
  styleUrl: './hobby-desk-projects-tab.component.css',
})
export class HobbyDeskProjectsTabComponent {
  readonly userState = inject(UserStateService);
  private readonly readinessService = inject(InventoryMatchService);
  private readonly projectImg = inject(ProjectImageResolverService);
  private readonly router = inject(Router);

  readonly projectSearch = signal('');
  readonly projectSort = signal<ProjectSortMode>('updated');
  readonly showNewProjectModal = signal(false);
  readonly newProjectName = signal('');

  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly sortControl = new FormControl<ProjectSortMode>('updated', { nonNullable: true });
  readonly newProjectNameControl = new FormControl('', { nonNullable: true });
  readonly newProjectForm = new FormGroup({ name: this.newProjectNameControl });

  constructor() {
    effect(() => {
      const q = this.projectSearch();
      if (this.searchControl.value !== q) {
        this.searchControl.setValue(q, { emitEvent: false });
      }
    });
    effect(() => {
      const s = this.projectSort();
      if (this.sortControl.value !== s) {
        this.sortControl.setValue(s, { emitEvent: false });
      }
    });
    effect(() => {
      const n = this.newProjectName();
      if (this.newProjectNameControl.value !== n) {
        this.newProjectNameControl.setValue(n, { emitEvent: false });
      }
    });

    this.searchControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.projectSearch.set(v);
    });
    this.sortControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.projectSort.set(v);
    });
    this.newProjectNameControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.newProjectName.set(v);
    });
  }

  readonly filteredProjectCards = computed(() => {
    const q = this.projectSearch().trim().toLowerCase();
    const sort = this.projectSort();
    let list = [...this.userState.projects()];

    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }

    if (sort === 'alpha') {
      list.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sort === 'created') {
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } else {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    return list.map((project) => {
      const staged = this.readinessService.evaluateProjectStagedReadiness(project);
      return {
        project,
        entryCount: project.models.length,
        totalMiniatures: this.userState.getProjectTotalMiniatures(project),
        coverUrl: this.projectImg.resolveProjectCoverUrl(project),
        photoCount: this.userState.getProjectTotalPhotoCount(project),
        staged: staged.overall.totalRequired > 0 ? staged : null,
      };
    });
  });

  openNewProjectModal(): void {
    this.newProjectName.set('');
    this.showNewProjectModal.set(true);
  }

  closeNewProjectModal(): void {
    this.newProjectName.set('');
    this.showNewProjectModal.set(false);
  }

  createNewProject(): void {
    const created = this.userState.createProject(this.newProjectName());
    if (!created) {
      return;
    }
    this.closeNewProjectModal();
    void this.router.navigate(['/projects', created.id]);
  }

  confirmDeleteProject(projectId: string, name: string): void {
    if (confirm(`Delete project "${name}"?`)) {
      this.userState.deleteProject(projectId);
    }
  }
}
