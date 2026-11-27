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
import { ProjectImageResolverService } from '../../core/services/project-image-resolver.service';
import { UserMediaService } from '../../core/services/user-media.service';
import { UserStateService } from '../../core/services/user-state.service';
import { UserPhotoGalleryComponent } from '../../shared/components/user-photo-gallery/user-photo-gallery.component';
import { ProjectNotesSectionComponent } from './components/project-notes-section.component';
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
            isOwned: () => false,
            isWishlisted: () => false,
          },
        },
        {
          provide: ProjectImageResolverService,
          useValue: {
            resolveProjectCoverUrl: () => '/icons/ic_project.svg',
            resolveProjectModelImageUrl: () => '/icons/ic_models.svg',
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

    // Switching directly between non-null modes ('model' -> 'color' -> 'thumbnail') clears pickerSearch
    comp.activePickerModal.set('model');
    fixture.detectChanges();
    pickerModal.pickerSearch.set('Intercessor');
    fixture.detectChanges();
    expect(pickerModal.pickerSearch()).toBe('Intercessor');

    comp.activePickerModal.set('color');
    fixture.detectChanges();
    expect(pickerModal.pickerSearch()).toBe('');

    pickerModal.pickerSearch.set('Retributor');
    fixture.detectChanges();
    comp.activePickerModal.set('thumbnail');
    fixture.detectChanges();
    expect(pickerModal.pickerSearch()).toBe('');
  });

  it('disables allowGlobalPaste when picker or notes editor modal is open and renders semantic cards, <time>, and <dialog>', () => {
    const paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id: 'proj_a' }));
    const projects = signal<UserProject[]>([
      {
        id: 'proj_a',
        name: 'Alpha Project',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        models: [
          {
            id: 'pmod_1',
            recipeId: 'm1',
            quantity: 2,
            notes: '',
            completedStepIds: [],
            photos: [],
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
          },
        ],
        colorIds: ['c1'],
        notes: [],
        photos: [],
      },
    ]);

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
            modelById: signal(
              new Map([
                [
                  'm1',
                  {
                    id: 'm1',
                    name: 'Intercessor',
                    gameNames: ['Warhammer 40,000'],
                    factionNames: [],
                    requiredPaintIds: [],
                  },
                ],
              ])
            ),
            colorById: signal(
              new Map([
                [
                  'c1',
                  {
                    id: 'c1',
                    name: 'Ultramarine Blue',
                    hex: '#0D407F',
                    colorGroups: ['Blue'],
                    requiredPaintIds: [],
                  },
                ],
              ])
            ),
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
            getProjectTotalMiniatures: () => 2,
            getPhotoQuotaLimit: () => 12,
            getPhotosForTarget: () => [],
            isOwned: () => false,
            isWishlisted: () => false,
          },
        },
        {
          provide: ProjectImageResolverService,
          useValue: {
            resolveProjectCoverUrl: () => '/icons/ic_project.svg',
            resolveProjectModelImageUrl: () => '/icons/ic_models.svg',
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

    const showcaseGallery = fixture.debugElement
      .queryAll(By.directive(UserPhotoGalleryComponent))[0]
      .componentInstance as UserPhotoGalleryComponent;
    expect(showcaseGallery.allowGlobalPaste()).toBeTrue();

    // Picker modal open disables global paste and opens native <dialog>
    comp.activePickerModal.set('model');
    fixture.detectChanges();
    expect(showcaseGallery.allowGlobalPaste()).toBeFalse();
    const pickerDialog = fixture.nativeElement.querySelector(
      'app-project-picker-modal dialog'
    ) as HTMLDialogElement;
    expect(pickerDialog.open).toBeTrue();
    const pickerSearch = pickerDialog.querySelector('#project-picker-search') as HTMLInputElement;
    expect(pickerSearch.type).toBe('search');
    expect(pickerSearch.labels?.length).toBe(1);
    expect(pickerSearch.placeholder).not.toContain('4,531');

    comp.activePickerModal.set(null);
    fixture.detectChanges();
    expect(showcaseGallery.allowGlobalPaste()).toBeTrue();

    // Notes editor open disables global paste
    const notesSection = fixture.debugElement
      .query(By.directive(ProjectNotesSectionComponent))
      .componentInstance as ProjectNotesSectionComponent;
    notesSection.openNoteEditor(null);
    fixture.detectChanges();
    expect(comp.notesEditorOpen()).toBeTrue();
    expect(showcaseGallery.allowGlobalPaste()).toBeFalse();
    notesSection.closeNoteEditor();
    fixture.detectChanges();
    expect(showcaseGallery.allowGlobalPaste()).toBeTrue();

    // Semantic checks: <time>, no aria-label on plain stepper div, heading order h1 -> h2 -> h3
    const root = fixture.nativeElement as HTMLElement;
    const timeEl = root.querySelector('time');
    expect(timeEl?.getAttribute('datetime')).toBe('2026-01-02T00:00:00Z');
    const qtyStepper = root.querySelector('.card-qty-stepper');
    expect(qtyStepper?.hasAttribute('aria-label')).toBeFalse();
    expect(root.querySelector('a.card-stretched-link')).not.toBeNull();
    expect(root.querySelectorAll('h4').length).toBe(0);

    // Not-found state uses <h1>
    paramMap$.next(convertToParamMap({ id: 'missing_proj' }));
    fixture.detectChanges();
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Project Not Found');
  });
});
