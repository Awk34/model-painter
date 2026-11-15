import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UserProject } from '../../../core/models/catalog.models';
import { UserStateService } from '../../../core/services/user-state.service';

@Component({
  selector: 'app-add-to-project-modal',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './add-to-project-modal.component.ng.html',
  styleUrl: './add-to-project-modal.component.css',
})
export class AddToProjectModalComponent {
  readonly userState = inject(UserStateService);

  readonly open = input<boolean>(false);
  readonly itemType = input.required<'model' | 'color'>();
  readonly itemId = input.required<string>();
  readonly itemName = input.required<string>();
  readonly thumbnailUrl = input<string | undefined>(undefined);
  readonly localThumbnailPath = input<string | undefined>(undefined);

  readonly closed = output<void>();

  readonly newProjectName = signal('');

  isAlreadyInProject(project: UserProject): boolean {
    if (this.itemType() === 'model') {
      return project.recipeIds.includes(this.itemId());
    }
    return project.colorIds.includes(this.itemId());
  }

  addToExistingProject(projectId: string): void {
    this.attachItem(projectId);
    this.closed.emit();
  }

  createProjectWithItem(): void {
    const fallbackName =
      this.itemType() === 'color' ? `${this.itemName()} Scheme` : this.itemName();
    const created = this.userState.createProject(
      this.newProjectName().trim() || fallbackName,
      this.thumbnailUrl(),
      this.localThumbnailPath()
    );
    if (!created) {
      return;
    }
    this.attachItem(created.id);
    this.newProjectName.set('');
    this.closed.emit();
  }

  private attachItem(projectId: string): void {
    if (this.itemType() === 'model') {
      this.userState.addRecipeToProject(projectId, this.itemId(), this.localThumbnailPath());
      return;
    }
    this.userState.addColorToProject(projectId, this.itemId());
  }
}

