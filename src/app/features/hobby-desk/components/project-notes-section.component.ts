import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  UserProject,
  UserProjectNote,
  UserProjectNoteComponent,
} from '../../../core/models/catalog.models';
import { UserStateService } from '../../../core/services/user-state.service';
import { createEntityId } from '../../../core/utils/catalog-filter.util';

@Component({
  selector: 'app-project-notes-section',
  imports: [FormsModule, DragDropModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-notes-section.component.ng.html',
  styleUrl: './project-notes-section.component.css',
})
export class ProjectNotesSectionComponent {
  readonly userState = inject(UserStateService);

  readonly project = input.required<UserProject>();
  readonly expanded = model<boolean>(true);

  readonly editingNoteOpen = signal(false);
  readonly editingNoteId = signal<string | null>(null);
  readonly noteTitleDraft = signal('');
  readonly noteBlocksDraft = signal<UserProjectNoteComponent[]>([]);
  private lastProjectId: string | null = null;

  constructor() {
    effect(() => {
      const pid = this.project().id;
      if (this.lastProjectId !== null && pid !== this.lastProjectId) {
        this.closeNoteEditor();
      }
      this.lastProjectId = pid;
    });
  }

  openNoteEditor(note: UserProjectNote | null): void {
    if (note) {
      this.editingNoteId.set(note.id);
      this.noteTitleDraft.set(note.title);
      const seenBlockIds = new Set<string>();
      this.noteBlocksDraft.set(
        note.components.map((comp) => {
          const clone = structuredClone(comp);
          if (!clone.id || seenBlockIds.has(clone.id)) {
            clone.id = createEntityId('blk');
          }
          seenBlockIds.add(clone.id);
          return clone;
        })
      );
    } else {
      this.editingNoteId.set(null);
      this.noteTitleDraft.set('');
      this.noteBlocksDraft.set([
        { id: createEntityId('blk'), type: 'text', value: '' },
        {
          id: createEntityId('blk'),
          type: 'checkbox',
          value: 'Prime miniatures',
          checked: false,
        },
      ]);
    }
    this.editingNoteOpen.set(true);
  }

  closeNoteEditor(): void {
    this.editingNoteOpen.set(false);
    this.editingNoteId.set(null);
    this.noteTitleDraft.set('');
    this.noteBlocksDraft.set([]);
  }

  addNoteBlock(type: 'text' | 'checkbox'): void {
    this.noteBlocksDraft.update((blocks) => [
      ...blocks,
      { id: createEntityId('blk'), type, value: '', checked: false },
    ]);
  }

  removeNoteBlock(idx: number): void {
    this.noteBlocksDraft.update((blocks) => blocks.filter((_, i) => i !== idx));
  }

  updateBlockValue(idx: number, value: string): void {
    this.noteBlocksDraft.update((blocks) =>
      blocks.map((b, i) => (i === idx ? { ...b, value } : b))
    );
  }

  updateBlockChecked(idx: number, checked: boolean): void {
    this.noteBlocksDraft.update((blocks) =>
      blocks.map((b, i) => (i === idx ? { ...b, checked } : b))
    );
  }

  dropNoteBlock(event: CdkDragDrop<UserProjectNoteComponent[]>): void {
    const next = [...this.noteBlocksDraft()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.noteBlocksDraft.set(next);
  }

  saveNote(): void {
    const cleaned = this.noteBlocksDraft().filter((b) => b.value.trim().length > 0);
    this.userState.saveProjectNote(
      this.project().id,
      this.editingNoteId(),
      this.noteTitleDraft(),
      cleaned
    );
    this.closeNoteEditor();
  }
}

