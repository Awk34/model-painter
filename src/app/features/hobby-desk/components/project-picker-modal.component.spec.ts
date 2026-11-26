import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ColorSummary, ModelSummary, UserProject } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { ProjectPickerModalComponent } from './project-picker-modal.component';

function makeProject(overrides: Partial<UserProject> = {}): UserProject {
  return {
    id: 'proj-1',
    name: 'Blood Angels',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    models: [
      {
        id: 'pmod-1',
        recipeId: 'm-1',
        quantity: 1,
        notes: '',
        completedStepIds: [],
        photos: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
    colorIds: [],
    notes: [],
    photos: [],
    ...overrides,
  };
}

function makeModels(count: number): ModelSummary[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m-${i + 1}`,
    name: i === 0 ? 'Commander Dante' : `Marine ${i + 1}`,
    range: 'warhammer_colour',
    primaryImage: `https://cdn.example/m-${i + 1}.jpg`,
    localPrimaryImage: `assets/images/models/m-${i + 1}.jpg`,
    gameIds: ['g1'],
    gameNames: ['Warhammer 40,000'],
    factionIds: ['f1'],
    factionNames: ['Blood Angels'],
    colorIds: [],
    requiredPaintIds: [],
  }));
}

function makeColors(count: number): ColorSummary[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `c-${i + 1}`,
    name: i === 0 ? 'Baal Red' : `Color ${i + 1}`,
    hex: '#991111',
    range: 'warhammer_colour',
    guideType: 'miniature',
    colorGroups: ['Reds'],
    basePaintIds: [],
    detailPaintIds: [],
    artificerPaintIds: [],
    requiredPaintIds: [],
  }));
}

describe('ProjectPickerModalComponent', () => {
  let addModelSpy: jasmine.Spy;
  let addColorSpy: jasmine.Spy;
  let setThumbSpy: jasmine.Spy;

  beforeEach(() => {
    addModelSpy = jasmine.createSpy('addModelToProject');
    addColorSpy = jasmine.createSpy('addColorToProject');
    setThumbSpy = jasmine.createSpy('setProjectThumbnail');

    TestBed.configureTestingModule({
      imports: [ProjectPickerModalComponent],
      providers: [
        {
          provide: CatalogService,
          useValue: {
            models: signal(makeModels(45)),
            colors: signal(makeColors(45)),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            addModelToProject: addModelSpy,
            addColorToProject: addColorSpy,
            setProjectThumbnail: setThumbSpy,
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) => local || remote || '/icons/ic_models.svg',
          },
        },
      ],
    });
  });

  it('renders model/color/thumbnail titles, caps grids at 40 items, filters, and invokes add/thumbnail actions', () => {
    const fixture = TestBed.createComponent(ProjectPickerModalComponent);
    const comp = fixture.componentInstance;
    let closedCount = 0;
    comp.closed.subscribe(() => (closedCount += 1));

    fixture.componentRef.setInput('project', makeProject());
    fixture.componentRef.setInput('mode', 'model');
    fixture.detectChanges();

    expect(comp.modalTitle()).toBe('Add Model Guide to "Blood Angels"');
    expect(comp.pickerModels().length).toBe(40);
    expect(comp.getModelCount('m-1')).toBe(1);
    expect(comp.getModelCount('m-2')).toBe(0);

    const root = fixture.nativeElement as HTMLElement;
    const items = Array.from(root.querySelectorAll('.picker-item')) as HTMLElement[];
    expect(items.length).toBe(40);
    expect(items[0].textContent).toContain('1 in project');
    expect(items[0].querySelector('button')?.textContent?.trim()).toBe('+ Add Another');
    expect(items[1].querySelector('button')?.textContent?.trim()).toBe('+ Add');

    (items[0].querySelector('button') as HTMLButtonElement).click();
    expect(addModelSpy).toHaveBeenCalledWith('proj-1', 'm-1', {
      modelImageLocal: 'assets/images/models/m-1.jpg',
    });

    // Switch to color mode
    fixture.componentRef.setInput('mode', 'color');
    fixture.detectChanges();
    expect(comp.modalTitle()).toBe('Add Color Guide to "Blood Angels"');
    expect(comp.pickerColors().length).toBe(40);
    comp.searchControl.setValue('Baal');
    fixture.detectChanges();
    expect(comp.pickerColors().map((c) => c.id)).toEqual(['c-1']);

    (root.querySelector('.picker-item button') as HTMLButtonElement).click();
    expect(addColorSpy).toHaveBeenCalledWith('proj-1', 'c-1');

    // Switch to thumbnail mode & pick cover -> sets thumbnail, resets search, emits closed
    fixture.componentRef.setInput('mode', 'thumbnail');
    fixture.detectChanges();
    expect(comp.modalTitle()).toBe('Choose Project Thumbnail');
    comp.searchControl.setValue('Dante');
    fixture.detectChanges();
    expect(comp.pickerModels().map((m) => m.id)).toEqual(['m-1']);

    (root.querySelector('.picker-item button') as HTMLButtonElement).click();
    expect(setThumbSpy).toHaveBeenCalledWith(
      'proj-1',
      'assets/images/models/m-1.jpg',
      'https://cdn.example/m-1.jpg'
    );
    expect(comp.pickerSearch()).toBe('');
    expect(closedCount).toBe(1);
  });

  it('resets pickerSearch on mode switch, mode === null, and project().id change while preserving search on same-project updates', () => {
    const fixture = TestBed.createComponent(ProjectPickerModalComponent);
    const comp = fixture.componentInstance;

    const proj1 = makeProject({ id: 'proj-1' });
    fixture.componentRef.setInput('project', proj1);
    fixture.componentRef.setInput('mode', 'model');
    fixture.detectChanges();

    comp.searchControl.setValue('Dante');
    fixture.detectChanges();
    expect(comp.pickerSearch()).toBe('Dante');

    // Sibling project update with same ID (e.g. model added) preserves search
    fixture.componentRef.setInput(
      'project',
      makeProject({
        id: 'proj-1',
        models: [
          ...proj1.models,
          {
            id: 'pmod-2',
            recipeId: 'm-1',
            quantity: 1,
            notes: '',
            completedStepIds: [],
            photos: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      })
    );
    fixture.detectChanges();
    expect(comp.pickerSearch()).toBe('Dante');

    // Switching mode clears search
    fixture.componentRef.setInput('mode', 'color');
    fixture.detectChanges();
    expect(comp.pickerSearch()).toBe('');

    // Project ID change clears search
    comp.searchControl.setValue('Red');
    fixture.detectChanges();
    fixture.componentRef.setInput('project', makeProject({ id: 'proj-2', name: 'Ultramarines' }));
    fixture.detectChanges();
    expect(comp.pickerSearch()).toBe('');

    // Setting mode to null clears search
    comp.searchControl.setValue('Blue');
    fixture.detectChanges();
    fixture.componentRef.setInput('mode', null);
    fixture.detectChanges();
    expect(comp.pickerSearch()).toBe('');
  });
});
