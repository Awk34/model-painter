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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  UserProject,
  UserProjectNote,
  UserProjectNoteComponent,
} from '../../../core/models/catalog.models';
import { UserStateService } from '../../../core/services/user-state.service';
import { createEntityId } from '../../../core/utils/catalog-filter.util';
import { CollapsibleSectionComponent } from '../../../shared/components/collapsible-section/collapsible-section.component';
import { AppModalDialogComponent } from '../../../shared/components/modal-dialog/modal-dialog.component';

@Component({
  selector: 'app-project-notes-section',
  imports: [
    ReactiveFormsModule,
    DragDropModule,
    CollapsibleSectionComponent,
    AppModalDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-notes-section.component.ng.html',
  styleUrl: './project-notes-section.component.css',
})
export class ProjectNotesSectionComponent {
  readonly userState = inject(UserStateService);

  readonly project = input.required<UserProject>();
  readonly expanded = model<boolean>(true);
  readonly editingNoteOpen = model<boolean>(false);
  readonly editingNoteId = signal<string | null>(null);
  readonly noteTitleDraft = signal('');
  readonly noteBlocksDraft = signal<UserProjectNoteComponent[]>([]);
  readonly noteTitleControl = new FormControl('', { nonNullable: true });
  readonly noteForm = new FormGroup({ title: this.noteTitleControl });
  private lastProjectId: string | null = null;

  constructor() {
    effect(() => {
      const pid = this.project().id;
      if (this.lastProjectId !== null && pid !== this.lastProjectId) {
        this.closeNoteEditor();
      }
      this.lastProjectId = pid;
    });

    effect(() => {
      const title = this.noteTitleDraft();
      if (this.noteTitleControl.value !== title) {
        this.noteTitleControl.setValue(title, { emitEvent: false });
      }
    });

    this.noteTitleControl.valueChanges.pipe(takeUntilDestroyed()).subscribe((val) => {
      this.noteTitleDraft.set(val);
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

  onBlockValueInput(idx: number, event: Event): void {
    this.updateBlockValue(idx, (event.target as HTMLInputElement).value);
  }

  onBlockCheckedChange(idx: number, event: Event): void {
    this.updateBlockChecked(idx, (event.target as HTMLInputElement).checked);
  }

  dropNoteBlock(event: CdkDragDrop<UserProjectNoteComponent[]>): void {
    const next = [...this.noteBlocksDraft()];
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.noteBlocksDraft.set(next);
  }

  moveNoteBlock(idx: number, delta: -1 | 1): void {
    const targetIdx = idx + delta;
    const list = this.noteBlocksDraft();
    if (targetIdx < 0 || targetIdx >= list.length) {
      return;
    }
    const next = [...list];
    moveItemInArray(next, idx, targetIdx);
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
