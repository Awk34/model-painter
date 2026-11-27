import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { USER_LIMITS } from '../../../core/config/user-limits.config';
import { ProjectModelEntry, UserProject } from '../../../core/models/catalog.models';
import { UserStateService } from '../../../core/services/user-state.service';
import { ProjectModelWorkspaceBarComponent } from './project-model-workspace-bar.component';

function makeEntry(overrides: Partial<ProjectModelEntry> = {}): ProjectModelEntry {
  return {
    id: 'pmod_1',
    recipeId: 'model-1',
    quantity: 1,
    notes: 'Initial note',
    completedStepIds: [],
    photos: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeProject(entry: ProjectModelEntry): UserProject {
  return {
    id: 'proj_1',
    name: 'Test Project',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    models: [entry],
    colorIds: [],
    notes: [],
    photos: [],
  };
}

describe('ProjectModelWorkspaceBarComponent', () => {
  let updateProjectModelSpy: jasmine.Spy;

  beforeEach(async () => {
    updateProjectModelSpy = jasmine.createSpy('updateProjectModel');

    await TestBed.configureTestingModule({
      imports: [ProjectModelWorkspaceBarComponent],
      providers: [
        provideRouter([]),
        {
          provide: UserStateService,
          useValue: {
            limits: USER_LIMITS,
            updateProjectModel: updateProjectModelSpy,
            adjustProjectModelQuantity: jasmine.createSpy('adjustProjectModelQuantity'),
            setProjectModelQuantity: jasmine.createSpy('setProjectModelQuantity'),
            setProjectModelFeaturedImage: jasmine.createSpy('setProjectModelFeaturedImage'),
          },
        },
      ],
    }).compileComponents();
  });

  it('syncs external entry.notes updates when draft has no local edits and preserves dirty local edits', () => {
    const initialEntry = makeEntry({ notes: 'Initial note' });
    const fixture = TestBed.createComponent(ProjectModelWorkspaceBarComponent);
    fixture.componentRef.setInput('project', makeProject(initialEntry));
    fixture.componentRef.setInput('entry', initialEntry);
    fixture.detectChanges();

    expect(fixture.componentInstance.notesDraft()).toBe('Initial note');
    expect(fixture.componentInstance.hasUnsavedNotes()).toBeFalse();

    // External update when untouched -> updates draft cleanly
    const syncedEntry = makeEntry({ notes: 'Cloud synced note' });
    fixture.componentRef.setInput('entry', syncedEntry);
    fixture.detectChanges();
    expect(fixture.componentInstance.notesDraft()).toBe('Cloud synced note');
    expect(fixture.componentInstance.hasUnsavedNotes()).toBeFalse();

    // User edits locally -> external update preserves local draft
    fixture.componentInstance.notesDraft.set('Local unsaved edit');
    fixture.detectChanges();
    expect(fixture.componentInstance.hasUnsavedNotes()).toBeTrue();

    const laterRemoteEntry = makeEntry({ notes: 'Later remote note' });
    fixture.componentRef.setInput('entry', laterRemoteEntry);
    fixture.detectChanges();
    expect(fixture.componentInstance.notesDraft()).toBe('Local unsaved edit');
    expect(fixture.componentInstance.hasUnsavedNotes()).toBeTrue();

    // Switching entry.id resets draft, lastSyncedNotes, and editingName
    fixture.componentInstance.editingName.set(true);
    const otherEntry = makeEntry({ id: 'pmod_2', notes: 'Entry 2 notes' });
    fixture.componentRef.setInput('entry', otherEntry);
    fixture.detectChanges();
    expect(fixture.componentInstance.notesDraft()).toBe('Entry 2 notes');
    expect(fixture.componentInstance.editingName()).toBeFalse();
    expect(fixture.componentInstance.hasUnsavedNotes()).toBeFalse();
  });

  it('keeps Save Notes button rendered with disabled binding, prevents mousedown blur race, and saves on click/blur', () => {
    const entry = makeEntry({ notes: 'Start' });
    const fixture = TestBed.createComponent(ProjectModelWorkspaceBarComponent);
    fixture.componentRef.setInput('project', makeProject(entry));
    fixture.componentRef.setInput('entry', entry);
    fixture.detectChanges();

    const getSaveBtn = (): HTMLButtonElement =>
      Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find(
        (b) => b.textContent?.includes('Save Notes')
      )!;

    const saveBtn = getSaveBtn();
    expect(saveBtn).toBeDefined();
    expect(saveBtn.disabled).toBeTrue();

    fixture.componentInstance.notesDraft.set('Edited notes');
    fixture.detectChanges();
    expect(saveBtn.disabled).toBeFalse();

    const mousedownEvent = new MouseEvent('mousedown', { cancelable: true });
    saveBtn.dispatchEvent(mousedownEvent);
    expect(mousedownEvent.defaultPrevented).toBeTrue();

    saveBtn.click();
    fixture.detectChanges();
    expect(updateProjectModelSpy).toHaveBeenCalledTimes(1);
    expect(updateProjectModelSpy).toHaveBeenCalledWith('proj_1', 'pmod_1', {
      notes: 'Edited notes',
    });

    // Simulate parent updating entry after save; blur when clean should not double-save
    const savedEntry = makeEntry({ notes: 'Edited notes' });
    fixture.componentRef.setInput('entry', savedEntry);
    fixture.detectChanges();

    const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('#project-model-notes');
    textarea.dispatchEvent(new Event('blur'));
    expect(updateProjectModelSpy).toHaveBeenCalledTimes(1);

    // Dirty blur outside saves
    fixture.componentInstance.notesDraft.set('Saved on blur');
    fixture.detectChanges();
    textarea.dispatchEvent(new Event('blur'));
    expect(updateProjectModelSpy).toHaveBeenCalledTimes(2);
    expect(updateProjectModelSpy).toHaveBeenCalledWith('proj_1', 'pmod_1', {
      notes: 'Saved on blur',
    });
  });
});
