import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { USER_LIMITS } from '../../../core/config/user-limits.config';
import {
  InventoryReadinessResult,
  StagedReadinessResult,
  UserProject,
} from '../../../core/models/catalog.models';
import { InventoryMatchService } from '../../../core/services/inventory-match.service';
import { ProjectImageResolverService } from '../../../core/services/project-image-resolver.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { HobbyDeskProjectsTabComponent } from './hobby-desk-projects-tab.component';

function makeStage(overrides: Partial<InventoryReadinessResult>): InventoryReadinessResult {
  return {
    totalRequired: 4,
    ownedDirectCount: 2,
    substitutedCount: 1,
    missingCount: 1,
    matchPercent: 75,
    ownedDirectIds: ['p1', 'p2'],
    substitutedByPaintId: {},
    missingPaintIds: ['p4'],
    ...overrides,
  };
}

const SAMPLE_STAGED: StagedReadinessResult = {
  base: makeStage({ matchPercent: 100, missingCount: 0, missingPaintIds: [] }),
  detail: makeStage({ matchPercent: 75, missingCount: 1, missingPaintIds: ['p4'] }),
  artificer: makeStage({ totalRequired: 0, matchPercent: 100, missingCount: 0, missingPaintIds: [] }),
  overall: makeStage({ matchPercent: 80 }),
};

const EMPTY_STAGED: StagedReadinessResult = {
  base: makeStage({ totalRequired: 0, matchPercent: 100, missingCount: 0, missingPaintIds: [] }),
  detail: makeStage({ totalRequired: 0, matchPercent: 100, missingCount: 0, missingPaintIds: [] }),
  artificer: makeStage({ totalRequired: 0, matchPercent: 100, missingCount: 0, missingPaintIds: [] }),
  overall: makeStage({ totalRequired: 0, matchPercent: 100, missingCount: 0, missingPaintIds: [] }),
};

function makeProject(overrides: Partial<UserProject> & { id: string; name: string }): UserProject {
  return {
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    models: [],
    colorIds: [],
    notes: [],
    photos: [],
    ...overrides,
  };
}

describe('HobbyDeskProjectsTabComponent', () => {
  function setupModule(options: {
    projects?: UserProject[];
    createProject?: jasmine.Spy;
    deleteProject?: jasmine.Spy;
    duplicateProject?: jasmine.Spy;
    evaluateProjectStagedReadiness?: (p: UserProject) => StagedReadinessResult;
  } = {}) {
    const projectsSignal = signal<UserProject[]>(options.projects ?? []);
    const createProject = options.createProject ?? jasmine.createSpy('createProject').and.returnValue(null);
    const deleteProject = options.deleteProject ?? jasmine.createSpy('deleteProject');
    const duplicateProject = options.duplicateProject ?? jasmine.createSpy('duplicateProject');

    TestBed.configureTestingModule({
      imports: [HobbyDeskProjectsTabComponent],
      providers: [
        provideRouter([]),
        {
          provide: UserStateService,
          useValue: {
            projects: projectsSignal,
            limits: { MAX_PROJECTS: USER_LIMITS.MAX_PROJECTS },
            getTargetPhotoCount: () => 0,
            getProjectTotalMiniatures: (p: UserProject) =>
              p.models.reduce((sum, m) => sum + m.quantity, 0),
            getProjectTotalPhotoCount: () => 0,
            createProject,
            deleteProject,
            duplicateProject,
          },
        },
        {
          provide: ProjectImageResolverService,
          useValue: {
            resolveProjectCoverUrl: () => '/logo.svg',
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateProjectStagedReadiness:
              options.evaluateProjectStagedReadiness ?? (() => SAMPLE_STAGED),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(HobbyDeskProjectsTabComponent);
    fixture.detectChanges();
    return {
      fixture,
      comp: fixture.componentInstance,
      projectsSignal,
      createProject,
      deleteProject,
      duplicateProject,
      router: TestBed.inject(Router),
    };
  }

  it('reactively filters and sorts projects across updated, created, and alpha modes', () => {
    const { fixture, comp } = setupModule({
      projects: [
        makeProject({
          id: 'p-zeta',
          name: 'Zeta Terminators',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
          models: [
            {
              id: 'pmod_1',
              recipeId: 'm1',
              quantity: 5,
              notes: '',
              completedStepIds: [],
              photos: [],
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-02-01T00:00:00Z',
            },
          ],
        }),
        makeProject({
          id: 'p-alpha',
          name: 'Alpha Intercessors',
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-01-15T00:00:00Z',
        }),
      ],
    });

    // Default sort is 'updated' descending
    expect(comp.filteredProjectCards().map((c) => c.project.id)).toEqual([
      'p-zeta',
      'p-alpha',
    ]);

    comp.projectSort.set('created');
    fixture.detectChanges();
    expect(comp.filteredProjectCards().map((c) => c.project.id)).toEqual([
      'p-alpha',
      'p-zeta',
    ]);

    comp.projectSort.set('alpha');
    fixture.detectChanges();
    expect(comp.filteredProjectCards().map((c) => c.project.id)).toEqual([
      'p-alpha',
      'p-zeta',
    ]);

    comp.projectSearch.set('terminator');
    fixture.detectChanges();
    expect(comp.filteredProjectCards().map((c) => c.project.id)).toEqual([
      'p-zeta',
    ]);
  });

  it('resets newProjectName when closing the new project modal', () => {
    const { comp } = setupModule();

    comp.openNewProjectModal();
    comp.newProjectName.set('Stale Project Draft');
    comp.closeNewProjectModal();

    expect(comp.showNewProjectModal()).toBeFalse();
    expect(comp.newProjectName()).toBe('');
  });

  it('navigates on createNewProject() success and keeps modal open when createProject returns null', () => {
    const createdProject = makeProject({ id: 'proj_new_1', name: 'Salamanders' });
    let returnProject: UserProject | null = null;
    const createSpy = jasmine
      .createSpy('createProject')
      .and.callFake(() => returnProject);
    const { comp, router } = setupModule({ createProject: createSpy });
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);

    comp.openNewProjectModal();
    comp.newProjectName.set('   ');
    comp.createNewProject();

    expect(createSpy).toHaveBeenCalledWith('   ');
    expect(comp.showNewProjectModal()).toBeTrue();
    expect(navSpy).not.toHaveBeenCalled();

    returnProject = createdProject;
    comp.newProjectName.set('Salamanders');
    comp.createNewProject();

    expect(comp.showNewProjectModal()).toBeFalse();
    expect(comp.newProjectName()).toBe('');
    expect(navSpy).toHaveBeenCalledWith(['/projects', 'proj_new_1']);
  });

  it('disables + New Project button at USER_LIMITS.MAX_PROJECTS (50)', () => {
    const fullProjects = Array.from({ length: USER_LIMITS.MAX_PROJECTS }, (_, i) =>
      makeProject({ id: `p_${i}`, name: `Project ${i}` })
    );
    const { fixture, projectsSignal } = setupModule({ projects: fullProjects });

    const findNewProjectBtn = () =>
      (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
        b.textContent?.includes('+ New Project')
      );

    expect(findNewProjectBtn()?.disabled).toBeTrue();

    projectsSignal.set(fullProjects.slice(0, USER_LIMITS.MAX_PROJECTS - 1));
    fixture.detectChanges();
    expect(findNewProjectBtn()?.disabled).toBeFalse();
  });

  it('deletes project only when window.confirm returns true', () => {
    const deleteSpy = jasmine.createSpy('deleteProject');
    const { comp } = setupModule({ deleteProject: deleteSpy });
    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);

    comp.confirmDeleteProject('p-1', 'Ultramarines');
    expect(confirmSpy).toHaveBeenCalledWith('Delete project "Ultramarines"?');
    expect(deleteSpy).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    comp.confirmDeleteProject('p-1', 'Ultramarines');
    expect(deleteSpy).toHaveBeenCalledWith('p-1');
  });

  it('renders empty state when no projects exist and populates card attributes and pills conditionally', () => {
    const { fixture, projectsSignal } = setupModule({
      projects: [],
      evaluateProjectStagedReadiness: (p) => (p.id === 'p-with-paints' ? SAMPLE_STAGED : EMPTY_STAGED),
    });

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.empty-state')).not.toBeNull();
    expect(root.querySelectorAll('.project-card').length).toBe(0);

    projectsSignal.set([
      makeProject({
        id: 'p-with-paints',
        name: 'With Paints',
        updatedAt: '2026-02-02T00:00:00Z',
      }),
      makeProject({
        id: 'p-empty-paints',
        name: 'No Paints Yet',
        updatedAt: '2026-02-01T00:00:00Z',
      }),
    ]);
    fixture.detectChanges();

    expect(root.querySelector('.empty-state')).toBeNull();
    const cards = Array.from(root.querySelectorAll('.project-card')) as HTMLElement[];
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('app-stage-readiness-pills')).not.toBeNull();
    expect(cards[1].querySelector('app-stage-readiness-pills')).toBeNull();

    const img = cards[0].querySelector('img.project-thumb') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('width')).toBe('200');
    expect(img.getAttribute('height')).toBe('146');
  });
});
