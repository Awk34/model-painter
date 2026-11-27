import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { UserProject } from '../../../core/models/catalog.models';
import { UserStateService } from '../../../core/services/user-state.service';
import { AppModalDialogComponent } from '../modal-dialog/modal-dialog.component';

@Component({
  selector: 'app-add-to-project-modal',
  imports: [ReactiveFormsModule, AppModalDialogComponent],
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
  readonly projectNameControl = new FormControl('', { nonNullable: true });
  readonly createProjectForm = new FormGroup({ name: this.projectNameControl });
  readonly modalTitle = computed(() => `Add "${this.itemName()}" to Project`);

  constructor() {
    effect(() => {
      this.open();
      this.itemId();
      this.newProjectName.set('');
    });

    effect(() => {
      const name = this.newProjectName();
      if (this.projectNameControl.value !== name) {
        this.projectNameControl.setValue(name, { emitEvent: false });
      }
    });

    this.projectNameControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((val) => {
      this.newProjectName.set(val);
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

