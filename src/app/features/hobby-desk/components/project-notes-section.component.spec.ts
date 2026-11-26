import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { UserProject, UserProjectNoteComponent } from '../../../core/models/catalog.models';
import { UserStateService } from '../../../core/services/user-state.service';
import { ProjectNotesSectionComponent } from './project-notes-section.component';

function makeProject(id: string, name: string): UserProject {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    models: [],
    colorIds: [],
    notes: [
      {
        id: 'note_1',
        title: 'Existing Note',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        components: [
          { type: 'text', value: 'First legacy block' },
          { type: 'checkbox', value: 'Second legacy block', checked: true },
        ],
      },
    ],
    photos: [],
  };
}

describe('ProjectNotesSectionComponent draft resets & block ID tracking', () => {
  let saveProjectNoteSpy: jasmine.Spy;

  beforeEach(async () => {
    saveProjectNoteSpy = jasmine.createSpy('saveProjectNote');

    await TestBed.configureTestingModule({
      imports: [ProjectNotesSectionComponent],
      providers: [
        {
          provide: UserStateService,
          useValue: {
            saveProjectNote: saveProjectNoteSpy,
            toggleNoteCheckbox: jasmine.createSpy('toggleNoteCheckbox'),
            deleteProjectNote: jasmine.createSpy('deleteProjectNote'),
          },
        },
      ],
    }).compileComponents();
  });

  it('assigns unique block IDs on open/add, preserves IDs across drag reorder and remove, and resets drafts on close', () => {
    const fixture = TestBed.createComponent(ProjectNotesSectionComponent);
    const projA = makeProject('proj_a', 'Project A');
    fixture.componentRef.setInput('project', projA);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.openNoteEditor(projA.notes[0]);
    fixture.detectChanges();

    const initialBlocks = comp.noteBlocksDraft();
    expect(initialBlocks.length).toBe(2);
    expect(initialBlocks[0].id).toBeTruthy();
    expect(initialBlocks[1].id).toBeTruthy();
    expect(initialBlocks[0].id).not.toBe(initialBlocks[1].id);

    const firstId = initialBlocks[0].id;
    const secondId = initialBlocks[1].id;

    comp.addNoteBlock('text');
    const addedId = comp.noteBlocksDraft()[2].id;
    expect(addedId).toBeTruthy();

    comp.dropNoteBlock({
      previousIndex: 0,
      currentIndex: 2,
    } as CdkDragDrop<UserProjectNoteComponent[]>);
    expect(comp.noteBlocksDraft().map((b) => b.id)).toEqual([secondId, addedId, firstId]);

    comp.removeNoteBlock(1);
    expect(comp.noteBlocksDraft().map((b) => b.id)).toEqual([secondId, firstId]);

    comp.closeNoteEditor();
    expect(comp.editingNoteOpen()).toBeFalse();
    expect(comp.editingNoteId()).toBeNull();
    expect(comp.noteTitleDraft()).toBe('');
    expect(comp.noteBlocksDraft()).toEqual([]);
  });

  it('preserves unsaved note draft on sibling updates of the same project.id, and resets when project.id changes', () => {
    const fixture = TestBed.createComponent(ProjectNotesSectionComponent);
    const projA = makeProject('proj_a', 'Project A');
    fixture.componentRef.setInput('project', projA);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.openNoteEditor(null);
    comp.noteTitleDraft.set('Unsaved Note Draft');
    fixture.detectChanges();

    // Sibling field update on same project.id must preserve unsaved edits
    fixture.componentRef.setInput('project', { ...projA, name: 'Project A Renamed' });
    fixture.detectChanges();
    expect(comp.editingNoteOpen()).toBeTrue();
    expect(comp.noteTitleDraft()).toBe('Unsaved Note Draft');

    // Switching to a different project.id closes and clears the editor draft
    fixture.componentRef.setInput('project', makeProject('proj_b', 'Project B'));
    fixture.detectChanges();
    expect(comp.editingNoteOpen()).toBeFalse();
    expect(comp.noteTitleDraft()).toBe('');
    expect(comp.noteBlocksDraft()).toEqual([]);
  });
});
