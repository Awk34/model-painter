import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InventoryReadinessResult, ModelPaintingArea } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { InventoryMatchService } from '../../../core/services/inventory-match.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { ModelPaintingStepsComponent } from './model-painting-steps.component';

const EMPTY_READINESS: InventoryReadinessResult = {
  totalRequired: 0,
  ownedDirectCount: 0,
  substitutedCount: 0,
  missingCount: 0,
  matchPercent: 100,
  ownedDirectIds: [],
  substitutedByPaintId: {},
  missingPaintIds: [],
};

describe('ModelPaintingStepsComponent', () => {
  function configureStepsTestingModule(userStateOverrides: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({
      imports: [ModelPaintingStepsComponent],
      providers: [
        {
          provide: UserStateService,
          useValue: {
            isOwned: () => false,
            isWishlisted: () => false,
            toggleInventory: () => undefined,
            toggleWishlist: () => undefined,
            getCompletedStepIds: () => [],
            getProjectModelCompletedStepIds: () => [],
            toggleStepDone: () => undefined,
            toggleProjectModelStepDone: () => undefined,
            setStepsDone: () => undefined,
            setProjectModelStepsDone: () => undefined,
            clearModelProgress: () => undefined,
            clearProjectModelProgress: () => undefined,
            ...userStateOverrides,
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {},
        },
        {
          provide: CatalogService,
          useValue: {
            paints: signal([]),
            paintById: signal(new Map()),
          },
        },
      ],
    });
  }

  it('filters both normalized and raw paintingStage values', () => {
    configureStepsTestingModule();

    const fixture = TestBed.createComponent(ModelPaintingStepsComponent);
    const comp = fixture.componentInstance;
    const steps = [
      { id: 's1', stepOrder: 1, stepNumber: 1, paintingStage: 'base' },
      { id: 's2', stepOrder: 2, stepNumber: 2, paintingStage: 'Detail Finish' },
      { id: 's3', stepOrder: 3, stepNumber: 3, paintingStage: 'artificer' },
    ];

    comp.stageFilter.set('Base Finish');
    expect(comp.filterSteps(steps).map((s) => s.id)).toEqual(['s1']);

    comp.stageFilter.set('Detail Finish');
    expect(comp.filterSteps(steps).map((s) => s.id)).toEqual(['s2']);

    comp.stageFilter.set('Artificer Finish');
    expect(comp.filterSteps(steps).map((s) => s.id)).toEqual(['s3']);

    comp.stageFilter.set('all');
    expect(comp.filterSteps(steps).map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('renders metallic gradient background and .metallic class on metallic step swatches', () => {
    configureStepsTestingModule();

    const fixture = TestBed.createComponent(ModelPaintingStepsComponent);
    fixture.componentRef.setInput('paintingAreas', [
      {
        id: 'area-base',
        areaOrder: 1,
        name: 'Base Finish',
        paintingSteps: [
          {
            id: 'step-gold',
            stepOrder: 1,
            stepNumber: 6,
            paintingStage: 'Base Finish',
            techniqueName: 'Basecoat',
            text: '• Gold areas',
            paint: {
              id: 'paint-retributor',
              name: 'Retributor Armour',
              category: 'base',
              potStyle: 'metallic',
              gradientStartHex: '#FFFFFF',
              gradientMiddleHex: '#EBB854',
              gradientEndHex: '#89571D',
            },
          },
          {
            id: 'step-black',
            stepOrder: 2,
            stepNumber: 7,
            paintingStage: 'Base Finish',
            techniqueName: 'Basecoat',
            text: '• Black areas',
            paint: {
              id: 'paint-abaddon',
              name: 'Abaddon Black',
              category: 'base',
              potStyle: 'flat',
              gradientStartHex: '#000000',
            },
          },
          {
            id: 'step-shade',
            stepOrder: 3,
            stepNumber: 9,
            paintingStage: 'Base Finish',
            techniqueName: 'Shade',
            text: '• Gold areas',
            paint: {
              id: 'paint-reikland',
              name: 'Reikland Fleshshade',
              category: 'shade',
              potStyle: 'shade',
              gradientStartHex: '#FFD5B7',
              gradientMiddleHex: '#AC491D',
              gradientEndHex: '#311908',
            },
          },
        ],
      },
    ]);
    fixture.componentRef.setInput('readiness', {
      totalRequired: 3,
      ownedDirectCount: 0,
      substitutedCount: 0,
      missingCount: 3,
      matchPercent: 0,
      ownedDirectIds: [],
      substitutedByPaintId: {},
      missingPaintIds: ['paint-retributor', 'paint-abaddon', 'paint-reikland'],
    });
    fixture.detectChanges();

    const swatches = Array.from(
      fixture.nativeElement.querySelectorAll('.paint-swatch')
    ) as HTMLElement[];
    expect(swatches.length).toBe(3);

    const goldSwatch = swatches[0];
    expect(goldSwatch.classList.contains('metallic')).toBeTrue();
    expect(goldSwatch.classList.contains('shade')).toBeFalse();
    const goldBg = goldSwatch.style.background || goldSwatch.style.backgroundImage;
    expect(goldBg).toContain('linear-gradient');
    expect(goldBg).toContain('235, 184, 84'); // #EBB854 in rgb

    const blackSwatch = swatches[1];
    expect(blackSwatch.classList.contains('metallic')).toBeFalse();
    expect(blackSwatch.classList.contains('shade')).toBeFalse();
    expect(blackSwatch.style.background).toContain('rgb(0, 0, 0)');

    const shadeSwatch = swatches[2];
    expect(shadeSwatch.classList.contains('shade')).toBeTrue();
    expect(shadeSwatch.classList.contains('metallic')).toBeFalse();
    const shadeBg = shadeSwatch.style.background || shadeSwatch.style.backgroundImage;
    expect(shadeBg).toContain('linear-gradient');
    expect(shadeBg).toContain('172, 73, 29'); // #AC491D in rgb
  });

  it('tracks individual color area steps, whole stage completion, and Reset Progress button', () => {
    const progressSignal = signal<Record<string, string[]>>({});
    const clearModelProgressSpy = jasmine.createSpy('clearModelProgress').and.callFake((modelId: string) => {
      const next = { ...progressSignal() };
      delete next[modelId];
      progressSignal.set(next);
    });
    configureStepsTestingModule({
      getCompletedStepIds: (modelId: string) => progressSignal()[modelId] ?? [],
      toggleStepDone: (modelId: string, stepId: string) => {
        const cur = new Set(progressSignal()[modelId] ?? []);
        if (cur.has(stepId)) cur.delete(stepId);
        else cur.add(stepId);
        progressSignal.set({ ...progressSignal(), [modelId]: Array.from(cur) });
      },
      setStepsDone: (modelId: string, stepIds: string[], done: boolean) => {
        const cur = new Set(progressSignal()[modelId] ?? []);
        for (const id of stepIds) {
          if (done) cur.add(id);
          else cur.delete(id);
        }
        progressSignal.set({ ...progressSignal(), [modelId]: Array.from(cur) });
      },
      clearModelProgress: clearModelProgressSpy,
    });

    const fixture = TestBed.createComponent(ModelPaintingStepsComponent);
    const comp = fixture.componentInstance;
    const baseArea: ModelPaintingArea = {
      id: 'area-base',
      areaOrder: 1,
      name: 'Base Finish',
      paintingSteps: [
        { id: 'step-1', stepOrder: 1, stepNumber: 1, paintingStage: 'Base Finish', text: '• Blue areas' },
        { id: 'step-2', stepOrder: 2, stepNumber: 2, paintingStage: 'Base Finish', text: '• Gold areas' },
      ],
    };
    fixture.componentRef.setInput('modelId', 'model-1');
    fixture.componentRef.setInput('paintingAreas', [baseArea]);
    fixture.componentRef.setInput('readiness', EMPTY_READINESS);
    fixture.detectChanges();

    expect(comp.overallProgress()).toEqual({ done: 0, total: 2, isDone: false, percent: 0 });
    expect(comp.getAreaProgress(baseArea)).toEqual({ done: 0, total: 2, isDone: false });

    // Reset Progress hidden when done === 0
    const findResetBtn = () =>
      (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find((b) =>
        b.textContent?.includes('Reset Progress')
      ) ?? null;
    expect(findResetBtn()).toBeNull();

    const progressBar = fixture.nativeElement.querySelector('[role="progressbar"]') as HTMLElement | null;
    expect(progressBar).not.toBeNull();
    expect(progressBar?.getAttribute('aria-label')).toBeTruthy();

    const stageBtn = fixture.nativeElement.querySelector('.stage-done-btn') as HTMLButtonElement;
    const stepBtns = Array.from(
      fixture.nativeElement.querySelectorAll('.step-done-btn')
    ) as HTMLButtonElement[];
    expect(stageBtn).toBeTruthy();
    expect(stageBtn.title).toContain('Mark stage done: Base Finish');
    expect(stepBtns.length).toBe(2);
    expect(stepBtns[0].title).toContain('Mark done: • Blue areas');

    // Mark an individual color area step done
    stepBtns[0].click();
    fixture.detectChanges();
    expect(comp.isStepDone('step-1')).toBeTrue();
    expect(comp.isStepDone('step-2')).toBeFalse();
    expect(stepBtns[0].getAttribute('aria-pressed')).toBe('true');
    expect(stageBtn.classList.contains('partial')).toBeTrue();
    expect(comp.overallProgress()).toEqual({ done: 1, total: 2, isDone: false, percent: 50 });

    // Reset Progress button now visible
    const resetBtn = findResetBtn();
    expect(resetBtn).not.toBeNull();

    // Mark entire stage done
    stageBtn.click();
    fixture.detectChanges();
    expect(comp.isStepDone('step-1')).toBeTrue();
    expect(comp.isStepDone('step-2')).toBeTrue();
    expect(stageBtn.getAttribute('aria-pressed')).toBe('true');
    expect(stageBtn.classList.contains('done')).toBeTrue();
    expect(stageBtn.classList.contains('partial')).toBeFalse();
    expect(comp.getAreaProgress(baseArea)).toEqual({ done: 2, total: 2, isDone: true });
    expect(comp.overallProgress()).toEqual({ done: 2, total: 2, isDone: true, percent: 100 });

    // Clicking Reset Progress invokes clearModelProgress and clears completion
    findResetBtn()?.click();
    fixture.detectChanges();
    expect(clearModelProgressSpy).toHaveBeenCalledWith('model-1');
    expect(comp.overallProgress()).toEqual({ done: 0, total: 2, isDone: false, percent: 0 });
    expect(findResetBtn()).toBeNull();

    // Re-mark stage done then toggle stage off
    stageBtn.click();
    fixture.detectChanges();
    expect(comp.overallProgress().isDone).toBeTrue();
    stageBtn.click();
    fixture.detectChanges();
    expect(stageBtn.getAttribute('aria-pressed')).toBe('false');
    expect(comp.overallProgress()).toEqual({ done: 0, total: 2, isDone: false, percent: 0 });
  });

  it('updates stageProgressByKey and areaViewModels reactively and sets image dimensions/lazy attributes', () => {
    const progressSignal = signal<Record<string, string[]>>({ 'model-2': ['s-base'] });
    configureStepsTestingModule({
      getCompletedStepIds: (modelId: string) => progressSignal()[modelId] ?? [],
    });

    const fixture = TestBed.createComponent(ModelPaintingStepsComponent);
    const comp = fixture.componentInstance;
    fixture.componentRef.setInput('modelId', 'model-2');
    fixture.componentRef.setInput('paintingAreas', [
      {
        id: 'area-1',
        areaOrder: 1,
        name: 'Armor',
        localImagePath: '/areas/armor.png',
        paintingSteps: [
          {
            id: 's-base',
            stepOrder: 1,
            stepNumber: 1,
            paintingStage: 'Base Finish',
            localImagePath: '/steps/s1.png',
          },
          {
            id: 's-detail',
            stepOrder: 2,
            stepNumber: 2,
            paintingStage: 'Detail Finish',
          },
        ],
      },
    ]);
    fixture.componentRef.setInput('readiness', EMPTY_READINESS);
    fixture.detectChanges();

    expect(comp.stageProgressByKey()['Base Finish']).toEqual({ done: 1, total: 1, isDone: true });
    expect(comp.stageProgressByKey()['Detail Finish']).toEqual({ done: 0, total: 1, isDone: false });
    expect(comp.areaViewModels()[0].steps.map((s) => s.step.id)).toEqual(['s-base', 's-detail']);

    comp.stageFilter.set('Detail Finish');
    fixture.detectChanges();
    expect(comp.areaViewModels()[0].steps.map((s) => s.step.id)).toEqual(['s-detail']);
    expect(comp.areaViewModels()[0].progress).toEqual({ done: 0, total: 1, isDone: false });

    progressSignal.set({ 'model-2': ['s-base', 's-detail'] });
    fixture.detectChanges();
    expect(comp.stageProgressByKey()['Detail Finish']).toEqual({ done: 1, total: 1, isDone: true });
    expect(comp.areaViewModels()[0].progress).toEqual({ done: 1, total: 1, isDone: true });

    comp.stageFilter.set('all');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const areaThumb = root.querySelector('.area-thumb') as HTMLImageElement;
    expect(areaThumb.getAttribute('width')).toBe('56');
    expect(areaThumb.getAttribute('height')).toBe('56');
    expect(areaThumb.getAttribute('loading')).toBe('lazy');
    expect(areaThumb.getAttribute('decoding')).toBe('async');

    const stepImg = root.querySelector('.step-img-box img') as HTMLImageElement;
    expect(stepImg.getAttribute('width')).toBe('200');
    expect(stepImg.getAttribute('height')).toBe('134');
    expect(stepImg.getAttribute('loading')).toBe('lazy');
    expect(stepImg.getAttribute('decoding')).toBe('async');
  });

  it('routes progress reads and mutations to project-model methods when projectId and projectModelId are provided', () => {
    const pmProgress = signal<string[]>(['pm-step-1']);
    const getModelSpy = jasmine.createSpy('getCompletedStepIds').and.returnValue([]);
    const toggleModelSpy = jasmine.createSpy('toggleStepDone');
    const setModelSpy = jasmine.createSpy('setStepsDone');
    const clearModelSpy = jasmine.createSpy('clearModelProgress');

    const getPmSpy = jasmine
      .createSpy('getProjectModelCompletedStepIds')
      .and.callFake(() => pmProgress());
    const togglePmSpy = jasmine
      .createSpy('toggleProjectModelStepDone')
      .and.callFake((_pid: string, _entryId: string, stepId: string) => {
        const cur = new Set(pmProgress());
        if (cur.has(stepId)) cur.delete(stepId);
        else cur.add(stepId);
        pmProgress.set(Array.from(cur));
      });
    const setPmSpy = jasmine
      .createSpy('setProjectModelStepsDone')
      .and.callFake((_pid: string, _entryId: string, ids: string[], done: boolean) => {
        const cur = new Set(pmProgress());
        for (const id of ids) {
          if (done) cur.add(id);
          else cur.delete(id);
        }
        pmProgress.set(Array.from(cur));
      });
    const clearPmSpy = jasmine.createSpy('clearProjectModelProgress').and.callFake(() => {
      pmProgress.set([]);
    });

    configureStepsTestingModule({
      getCompletedStepIds: getModelSpy,
      toggleStepDone: toggleModelSpy,
      setStepsDone: setModelSpy,
      clearModelProgress: clearModelSpy,
      getProjectModelCompletedStepIds: getPmSpy,
      toggleProjectModelStepDone: togglePmSpy,
      setProjectModelStepsDone: setPmSpy,
      clearProjectModelProgress: clearPmSpy,
    });

    const fixture = TestBed.createComponent(ModelPaintingStepsComponent);
    const area: ModelPaintingArea = {
      id: 'area-pm',
      areaOrder: 1,
      name: 'Cloak',
      paintingSteps: [
        { id: 'pm-step-1', stepOrder: 1, stepNumber: 1, paintingStage: 'Base Finish' },
        { id: 'pm-step-2', stepOrder: 2, stepNumber: 2, paintingStage: 'Base Finish' },
      ],
    };
    fixture.componentRef.setInput('modelId', 'model-recipe-1');
    fixture.componentRef.setInput('projectId', 'proj-1');
    fixture.componentRef.setInput('projectModelId', 'entry-1');
    fixture.componentRef.setInput('paintingAreas', [area]);
    fixture.componentRef.setInput('readiness', EMPTY_READINESS);
    fixture.detectChanges();

    expect(getPmSpy).toHaveBeenCalledWith('proj-1', 'entry-1');
    expect(getModelSpy).not.toHaveBeenCalled();
    expect(fixture.componentInstance.overallProgress()).toEqual({
      done: 1,
      total: 2,
      isDone: false,
      percent: 50,
    });

    const stepBtns = fixture.nativeElement.querySelectorAll('.step-done-btn') as NodeListOf<HTMLButtonElement>;
    stepBtns[1].click();
    fixture.detectChanges();
    expect(togglePmSpy).toHaveBeenCalledWith('proj-1', 'entry-1', 'pm-step-2');
    expect(toggleModelSpy).not.toHaveBeenCalled();

    const stageBtn = fixture.nativeElement.querySelector('.stage-done-btn') as HTMLButtonElement;
    stageBtn.click();
    fixture.detectChanges();
    expect(setPmSpy).toHaveBeenCalledWith('proj-1', 'entry-1', ['pm-step-1', 'pm-step-2'], false);
    expect(setModelSpy).not.toHaveBeenCalled();

    // Mark one step again so Reset Progress appears
    stepBtns[0].click();
    fixture.detectChanges();
    const resetBtn = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(
      (b) => b.textContent?.includes('Reset Progress')
    );
    expect(resetBtn).toBeDefined();
    resetBtn!.click();
    fixture.detectChanges();
    expect(clearPmSpy).toHaveBeenCalledWith('proj-1', 'entry-1');
    expect(clearModelSpy).not.toHaveBeenCalled();
  });

  it('tracks empty-steps areas using synthetic area:<id> key and handles empty modelId safely', () => {
    const progressSignal = signal<Record<string, string[]>>({});
    const toggleSpy = jasmine.createSpy('toggleStepDone');
    const setStepsSpy = jasmine
      .createSpy('setStepsDone')
      .and.callFake((modelId: string, ids: string[], done: boolean) => {
        progressSignal.set({ ...progressSignal(), [modelId]: done ? ids : [] });
      });
    const clearSpy = jasmine.createSpy('clearModelProgress');

    configureStepsTestingModule({
      getCompletedStepIds: (id: string) => progressSignal()[id] ?? [],
      toggleStepDone: toggleSpy,
      setStepsDone: setStepsSpy,
      clearModelProgress: clearSpy,
    });

    const emptyStepsArea: ModelPaintingArea = {
      id: 'area-wings',
      areaOrder: 1,
      name: 'Jump Pack',
      paintingSteps: [],
    };

    const fixture = TestBed.createComponent(ModelPaintingStepsComponent);
    const comp = fixture.componentInstance;

    // 1. Empty modelId guard
    fixture.componentRef.setInput('modelId', '');
    fixture.componentRef.setInput('paintingAreas', [emptyStepsArea]);
    fixture.componentRef.setInput('readiness', EMPTY_READINESS);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
    expect(root.querySelector('.stage-done-btn')).toBeNull();
    expect(root.querySelector('.step-done-btn')).toBeNull();
    expect(root.textContent).not.toContain('Reset Progress');

    comp.toggleStepDone('step-x');
    comp.toggleAreaDone(emptyStepsArea);
    comp.clearProgress();
    expect(toggleSpy).not.toHaveBeenCalled();
    expect(setStepsSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();

    // 2. Non-empty modelId tracks empty-steps area via area:area-wings
    fixture.componentRef.setInput('modelId', 'model-empty-steps');
    fixture.detectChanges();

    expect(comp.overallProgress()).toEqual({ done: 0, total: 1, isDone: false, percent: 0 });
    expect(comp.getAreaProgress(emptyStepsArea)).toEqual({ done: 0, total: 1, isDone: false });

    const stageBtn = root.querySelector('.stage-done-btn') as HTMLButtonElement;
    expect(stageBtn).not.toBeNull();
    stageBtn.click();
    fixture.detectChanges();

    expect(setStepsSpy).toHaveBeenCalledWith('model-empty-steps', ['area:area-wings'], true);
    expect(comp.getAreaProgress(emptyStepsArea)).toEqual({ done: 1, total: 1, isDone: true });
    expect(comp.overallProgress()).toEqual({ done: 1, total: 1, isDone: true, percent: 100 });
  });
});
