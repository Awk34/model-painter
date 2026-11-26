import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { USER_LIMITS } from '../../core/config/user-limits.config';
import { InventoryReadinessResult, StagedReadinessResult, UserProject } from '../../core/models/catalog.models';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { UserMediaService } from '../../core/services/user-media.service';
import { UserStateService } from '../../core/services/user-state.service';
import { ProjectPickerModalComponent } from './components/project-picker-modal.component';
import { ProjectDetailComponent } from './project-detail.component';

function makeReadiness(): InventoryReadinessResult {
  return {
    totalRequired: 0,
    ownedDirectCount: 0,
    substitutedCount: 0,
    missingCount: 0,
    matchPercent: 100,
    ownedDirectIds: [],
    substitutedByPaintId: {},
    missingPaintIds: [],
  };
}

const SAMPLE_STAGED: StagedReadinessResult = {
  base: makeReadiness(),
  detail: makeReadiness(),
  artificer: makeReadiness(),
  overall: makeReadiness(),
};

function makeProject(id: string, name: string): UserProject {
  return {
    id,
    name,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    models: [],
    colorIds: [],
    notes: [],
    photos: [],
  };
}

describe('ProjectDetailComponent route switch state reset', () => {
  it('resets editingTitle, titleDraft, activePickerModal, and selectedRollupStage when route project id changes', () => {
    const paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id: 'proj_a' }));
    const projects = signal([makeProject('proj_a', 'Alpha'), makeProject('proj_b', 'Beta')]);

    TestBed.configureTestingModule({
      imports: [ProjectDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
        {
          provide: CatalogService,
          useValue: {
            modelById: signal(new Map()),
            colorById: signal(new Map()),
            paintById: signal(new Map()),
            models: signal([]),
            colors: signal([]),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            projects,
            allUploadedPhotos: signal([]),
            limits: USER_LIMITS,
            getTargetPhotoCount: () => 0,
            getProjectTotalPhotoCount: () => 0,
            getProjectTotalMiniatures: () => 0,
            getPhotoQuotaLimit: () => 12,
            getPhotosForTarget: () => [],
            resolveProjectCoverUrl: () => '/icons/ic_project.svg',
            resolveProjectModelImageUrl: () => '/icons/ic_models.svg',
            isOwned: () => false,
            isWishlisted: () => false,
          },
        },
        {
          provide: UserMediaService,
          useValue: {
            resolvePhotoUrl: () => '/icons/ic_image_loading_placeholder.svg',
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateProjectStagedReadiness: () => SAMPLE_STAGED,
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) =>
              local || remote || '/icons/ic_project.svg',
          },
        },
        {
          provide: PaintModalService,
          useValue: {
            activePaintId: signal(null),
            openPaint: () => {},
            close: () => {},
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ProjectDetailComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    comp.startEditTitle('Unsaved Title');
    comp.activePickerModal.set('model');
    comp.selectedRollupStage.set('artificer');
    fixture.detectChanges();

    const pickerModal = fixture.debugElement
      .query(By.directive(ProjectPickerModalComponent))
      .componentInstance as ProjectPickerModalComponent;
    pickerModal.pickerSearch.set('Stale Search Text');
    fixture.detectChanges();
    expect(pickerModal.pickerSearch()).toBe('Stale Search Text');

    expect(comp.editingTitle()).toBeTrue();
    expect(comp.titleDraft()).toBe('Unsaved Title');
    expect(comp.activePickerModal()).toBe('model');
    expect(comp.selectedRollupStage()).toBe('artificer');

    // Sibling update on same project.id while picker is open preserves pickerSearch
    projects.update((list) =>
      list.map((p) => (p.id === 'proj_a' ? { ...p, updatedAt: '2026-01-02T00:00:00Z' } : p))
    );
    fixture.detectChanges();
    expect(pickerModal.pickerSearch()).toBe('Stale Search Text');

    paramMap$.next(convertToParamMap({ id: 'proj_b' }));
    fixture.detectChanges();

    expect(comp.projectId()).toBe('proj_b');
    expect(comp.editingTitle()).toBeFalse();
    expect(comp.titleDraft()).toBe('');
    expect(comp.activePickerModal()).toBeNull();
    expect(comp.selectedRollupStage()).toBe('base');
    expect(pickerModal.pickerSearch()).toBe('');

    // Closing directly via activePickerModal.set(null) on same project also clears pickerSearch
    comp.activePickerModal.set('color');
    fixture.detectChanges();
    pickerModal.pickerSearch.set('Abaddon');
    fixture.detectChanges();
    comp.activePickerModal.set(null);
    fixture.detectChanges();
    expect(pickerModal.pickerSearch()).toBe('');
  });
});
