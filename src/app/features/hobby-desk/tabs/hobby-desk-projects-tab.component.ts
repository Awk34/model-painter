import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
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
    FormsModule,
    RouterModule,
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
    this.router.navigate(['/projects', created.id]);
  }

  confirmDeleteProject(projectId: string, name: string): void {
    if (confirm(`Delete project "${name}"?`)) {
      this.userState.deleteProject(projectId);
    }
  }
}

