import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  InventoryReadinessResult,
  StagedReadinessResult,
  UserProject,
} from '../../core/models/catalog.models';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { UserStateService } from '../../core/services/user-state.service';
import { HobbyDeskProjectsTabComponent } from '../../features/hobby-desk/tabs/hobby-desk-projects-tab.component';
import { StageReadinessBarsComponent } from './stage-readiness-bars/stage-readiness-bars.component';
import { StageReadinessPillsComponent } from './stage-readiness-pills/stage-readiness-pills.component';

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

describe('Extracted UI Components & Reactive Filter Signals', () => {
  it('renders 3 stage pills with expected readiness states in StageReadinessPillsComponent', () => {
    TestBed.configureTestingModule({
      imports: [StageReadinessPillsComponent],
    });
    const fixture = TestBed.createComponent(StageReadinessPillsComponent);
    fixture.componentRef.setInput('staged', SAMPLE_STAGED);
    fixture.detectChanges();

    const pills = fixture.nativeElement.querySelectorAll('.card-stage-pill');
    expect(pills.length).toBe(3);
    expect(pills[0].textContent).toContain('100%');
    expect(pills[1].textContent).toContain('75%');
    expect(pills[2].textContent).toContain('—');
  });

  it('emits stageClick and wishlistMissing from StageReadinessBarsComponent', () => {
    TestBed.configureTestingModule({
      imports: [StageReadinessBarsComponent],
    });
    const fixture = TestBed.createComponent(StageReadinessBarsComponent);
    fixture.componentRef.setInput('staged', SAMPLE_STAGED);
    fixture.detectChanges();

    let clickedStage: string | undefined;
    let wishlistedIds: string[] | undefined;
    fixture.componentInstance.stageClick.subscribe((s) => {
      clickedStage = s;
    });
    fixture.componentInstance.wishlistMissing.subscribe((ids) => {
      wishlistedIds = ids;
    });

    const rows = fixture.nativeElement.querySelectorAll('.stage-ready-row');
    expect(rows.length).toBe(3);
    rows[1].click();
    expect(clickedStage).toBe('detail');

    const wishlistBtn: HTMLButtonElement | null = rows[1].querySelector('button');
    expect(wishlistBtn).not.toBeNull();
    wishlistBtn?.click();
    expect(wishlistedIds).toEqual(['p4']);
  });

  it('reactively filters and sorts projects when signal fields change in HobbyDeskProjectsTabComponent', () => {
    const projects = signal<UserProject[]>([
      {
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
        colorIds: [],
        notes: [],
        photos: [],
      },
      {
        id: 'p-alpha',
        name: 'Alpha Intercessors',
        createdAt: '2026-02-01T00:00:00Z',
        updatedAt: '2026-01-15T00:00:00Z',
        models: [],
        colorIds: [],
        notes: [],
        photos: [],
      },
    ]);

    TestBed.configureTestingModule({
      imports: [HobbyDeskProjectsTabComponent],
      providers: [
        provideRouter([]),
        {
          provide: UserStateService,
          useValue: {
            projects,
            limits: { MAX_PROJECTS: 200 },
            resolveProjectCoverUrl: () => '/logo.svg',
            getTargetPhotoCount: () => 0,
            getProjectTotalMiniatures: (p: UserProject) =>
              p.models.reduce((sum, m) => sum + m.quantity, 0),
            getProjectTotalPhotoCount: () => 0,
            createProject: () => null,
            deleteProject: () => {},
            duplicateProject: () => {},
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateProjectStagedReadiness: () => SAMPLE_STAGED,
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(HobbyDeskProjectsTabComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.filteredProjectCards().map((c) => c.project.id)).toEqual([
      'p-zeta',
      'p-alpha',
    ]);

    fixture.componentInstance.projectSort.set('alpha');
    fixture.detectChanges();
    expect(fixture.componentInstance.filteredProjectCards().map((c) => c.project.id)).toEqual([
      'p-alpha',
      'p-zeta',
    ]);

    fixture.componentInstance.projectSearch.set('terminator');
    fixture.detectChanges();
    expect(fixture.componentInstance.filteredProjectCards().map((c) => c.project.id)).toEqual([
      'p-zeta',
    ]);
  });
});
