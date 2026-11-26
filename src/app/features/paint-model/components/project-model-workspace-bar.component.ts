import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  ModelRecipe,
  ProjectModelEntry,
  UserProject,
} from '../../../core/models/catalog.models';
import { UserStateService } from '../../../core/services/user-state.service';

@Component({
  selector: 'app-project-model-workspace-bar',
  imports: [FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-model-workspace-bar.component.ng.html',
  styleUrl: './project-model-workspace-bar.component.css',
})
export class ProjectModelWorkspaceBarComponent {
  readonly userState = inject(UserStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly project = input.required<UserProject>();
  readonly entry = input.required<ProjectModelEntry>();
  readonly recipe = input<ModelRecipe | null>(null);

  readonly openFeaturedImagePicker = output<void>();
  readonly duplicateRequested = output<void>();
  readonly removeRequested = output<void>();

  readonly editingName = signal(false);
  readonly nameDraft = signal('');
  readonly notesDraft = signal('');
  readonly notesSaved = signal(false);
  private lastSyncedEntryId: string | null = null;
  private lastSyncedNotes: string | null = null;
  private savedTimer: ReturnType<typeof setTimeout> | null = null;

  readonly displayName = computed(() => {
    const custom = this.entry().customName?.trim();
    return custom || this.recipe()?.name || this.entry().recipeId;
  });

  readonly hasCustomName = computed(() => {
    const custom = this.entry().customName?.trim();
    const catalogName = this.recipe()?.name;
    return Boolean(custom && custom !== catalogName);
  });

  readonly hasCustomFeaturedImage = computed(() => Boolean(this.entry().featuredImage));

  readonly hasUnsavedNotes = computed(() => this.notesDraft() !== (this.entry().notes ?? ''));

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.savedTimer) {
        clearTimeout(this.savedTimer);
        this.savedTimer = null;
      }
    });

    effect(() => {
      const currentEntry = this.entry();
      const currentNotes = currentEntry.notes ?? '';
      if (currentEntry.id !== this.lastSyncedEntryId) {
        this.lastSyncedEntryId = currentEntry.id;
        this.lastSyncedNotes = currentNotes;
        this.notesDraft.set(currentNotes);
        this.editingName.set(false);
        this.notesSaved.set(false);
      } else if (currentNotes !== this.lastSyncedNotes) {
        const localDraft = untracked(() => this.notesDraft());
        const hadLocalEdits = localDraft !== (this.lastSyncedNotes ?? '');
        if (!hadLocalEdits || localDraft === currentNotes) {
          this.lastSyncedNotes = currentNotes;
          this.notesDraft.set(currentNotes);
        }
      }
    });
  }

  startEditName(): void {
    this.nameDraft.set(this.entry().customName ?? this.recipe()?.name ?? '');
    this.editingName.set(true);
  }

  saveCustomName(): void {
    const raw = this.nameDraft().trim();
    const catalogName = this.recipe()?.name ?? '';
    const nextCustom = raw && raw !== catalogName ? raw : '';
    this.userState.updateProjectModel(this.project().id, this.entry().id, {
      customName: nextCustom,
    });
    this.editingName.set(false);
  }

  resetCustomName(): void {
    this.userState.updateProjectModel(this.project().id, this.entry().id, {
      customName: '',
    });
    this.editingName.set(false);
  }

  stepQuantity(delta: number): void {
    this.userState.adjustProjectModelQuantity(this.project().id, this.entry().id, delta);
  }

  onQuantityInputChange(event: Event): void {
    const inputEl = event.target as HTMLInputElement;
    const parsed = Number(inputEl.value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      inputEl.value = String(this.entry().quantity);
      return;
    }
    this.userState.setProjectModelQuantity(this.project().id, this.entry().id, parsed);
    inputEl.value = String(this.entry().quantity);
  }

  resetFeaturedImage(): void {
    this.userState.setProjectModelFeaturedImage(this.project().id, this.entry().id, undefined);
  }

  saveNotes(): void {
    if (!this.hasUnsavedNotes()) {
      return;
    }
    const nextNotes = this.notesDraft();
    this.lastSyncedNotes = nextNotes;
    this.userState.updateProjectModel(this.project().id, this.entry().id, {
      notes: nextNotes,
    });
    if (this.savedTimer) {
      clearTimeout(this.savedTimer);
    }
    this.notesSaved.set(true);
    this.savedTimer = setTimeout(() => {
      this.savedTimer = null;
      this.notesSaved.set(false);
    }, 2000);
  }
}
