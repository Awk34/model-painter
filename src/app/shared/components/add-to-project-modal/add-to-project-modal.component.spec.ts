import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UserProject } from '../../../core/models/catalog.models';
import { UserStateService } from '../../../core/services/user-state.service';
import { AddToProjectModalComponent } from './add-to-project-modal.component';

describe('AddToProjectModalComponent draft reset', () => {
  let addModelToProjectSpy: jasmine.Spy;
  let createProjectSpy: jasmine.Spy;

  beforeEach(async () => {
    addModelToProjectSpy = jasmine.createSpy('addModelToProject');
    createProjectSpy = jasmine.createSpy('createProject').and.returnValue({
      id: 'proj_new',
      name: 'New',
      createdAt: '',
      updatedAt: '',
      models: [],
      colorIds: [],
      notes: [],
      photos: [],
    });

    const projects = signal<UserProject[]>([
      {
        id: 'proj_1',
        name: 'Existing Project',
        createdAt: '',
        updatedAt: '',
        models: [],
        colorIds: [],
        notes: [],
        photos: [],
      },
    ]);

    await TestBed.configureTestingModule({
      imports: [AddToProjectModalComponent],
      providers: [
        {
          provide: UserStateService,
          useValue: {
            projects,
            addModelToProject: addModelToProjectSpy,
            addColorToProject: jasmine.createSpy('addColorToProject'),
            createProject: createProjectSpy,
          },
        },
      ],
    }).compileComponents();
  });

  it('clears newProjectName on close(), addToExistingProject(), and itemId/open changes', () => {
    const fixture = TestBed.createComponent(AddToProjectModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('itemType', 'model');
    fixture.componentRef.setInput('itemId', 'model-1');
    fixture.componentRef.setInput('itemName', 'Intercessor');
    fixture.detectChanges();

    const closedSpy = jasmine.createSpy('closed');
    fixture.componentInstance.closed.subscribe(closedSpy);

    fixture.componentInstance.newProjectName.set('Abandoned Draft');
    fixture.componentInstance.close();
    expect(fixture.componentInstance.newProjectName()).toBe('');
    expect(closedSpy).toHaveBeenCalledTimes(1);

    fixture.componentInstance.newProjectName.set('Draft before existing pick');
    fixture.componentInstance.addToExistingProject('proj_1');
    expect(addModelToProjectSpy).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.newProjectName()).toBe('');
    expect(closedSpy).toHaveBeenCalledTimes(2);

    fixture.componentInstance.newProjectName.set('Draft before item switch');
    fixture.componentRef.setInput('itemId', 'model-2');
    fixture.detectChanges();
    expect(fixture.componentInstance.newProjectName()).toBe('');

    const root = fixture.nativeElement as HTMLElement;
    const dialog = root.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBeTrue();
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(root.querySelector(`#${labelledBy}`)?.textContent).toContain('Intercessor');

    const form = root.querySelector('form.create-proj-row') as HTMLFormElement;
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    fixture.componentInstance.newProjectName.set('Submitted Project');
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(createProjectSpy).toHaveBeenCalled();
  });
});
