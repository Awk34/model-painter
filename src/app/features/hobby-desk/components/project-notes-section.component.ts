import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  UserProject,
  UserProjectNote,
  UserProjectNoteComponent,
} from '../../../core/models/catalog.models';
import { UserStateService } from '../../../core/services/user-state.service';

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

  openNoteEditor(note: UserProjectNote | null): void {
    if (note) {
      this.editingNoteId.set(note.id);
      this.noteTitleDraft.set(note.title);
      this.noteBlocksDraft.set(structuredClone(note.components));
    } else {
      this.editingNoteId.set(null);
      this.noteTitleDraft.set('');
      this.noteBlocksDraft.set([
        { type: 'text', value: '' },
        { type: 'checkbox', value: 'Prime miniatures', checked: false },
      ]);
    }
    this.editingNoteOpen.set(true);
  }

  addNoteBlock(type: 'text' | 'checkbox'): void {
    this.noteBlocksDraft.update((blocks) => [...blocks, { type, value: '', checked: false }]);
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
    this.editingNoteOpen.set(false);
  }
}

