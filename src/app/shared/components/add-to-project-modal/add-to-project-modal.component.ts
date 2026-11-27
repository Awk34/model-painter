import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
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

  constructor() {
    effect(() => {
      this.open();
      this.itemId();
      this.newProjectName.set('');
    });
  }

  close(): void {
    this.newProjectName.set('');
    this.closed.emit();
  }

  getModelEntryCountInProject(project: UserProject): number {
    if (this.itemType() !== 'model') {
      return 0;
    }
    return project.models.filter((m) => m.recipeId === this.itemId()).length;
  }

  getActionLabel(project: UserProject): string {
    if (this.itemType() === 'model') {
      const count = this.getModelEntryCountInProject(project);
      if (count > 0) {
        return `${count} in project • + Add Another`;
      }
      return '+ Add to Project';
    }
    return project.colorIds.includes(this.itemId()) ? '✓ Already Added' : '+ Add to Project';
  }

  addToExistingProject(projectId: string): void {
    this.attachItem(projectId);
    this.close();
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
    this.close();
  }

  private attachItem(projectId: string): void {
    if (this.itemType() === 'model') {
      this.userState.addModelToProject(projectId, this.itemId(), {
        modelImageLocal: this.localThumbnailPath(),
      });
      return;
    }
    this.userState.addColorToProject(projectId, this.itemId());
  }
}

