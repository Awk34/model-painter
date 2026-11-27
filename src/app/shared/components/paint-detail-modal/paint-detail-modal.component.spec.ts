import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Paint } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { getFallbackSwatch } from '../../../core/utils/catalog-filter.util';
import { PaintDetailModalComponent } from './paint-detail-modal.component';

describe('PaintDetailModalComponent draft reset', () => {
  it('resets selectedOverridePaintId on close() and when activePaintId() changes', async () => {
    const activePaintId = signal<string | null>('p1');
    const closeSpy = jasmine.createSpy('close').and.callFake(() => activePaintId.set(null));
    const paint1: Paint = {
      id: 'p1',
      name: 'Macragge Blue',
      range: 'warhammer_colour',
      category: 'Base',
      gradientStartHex: '#0D407F',
    };
    const paint2: Paint = {
      id: 'p2',
      name: 'Mephiston Red',
      range: 'warhammer_colour',
      category: 'Base',
      gradientStartHex: '#960C09',
    };

    await TestBed.configureTestingModule({
      imports: [PaintDetailModalComponent],
      providers: [
        provideRouter([]),
        {
          provide: PaintModalService,
          useValue: {
            activePaintId,
            openPaint: (id: string) => activePaintId.set(id),
            close: closeSpy,
          },
        },
        {
          provide: CatalogService,
          useValue: {
            paintById: signal(new Map([['p1', paint1], ['p2', paint2]])),
            thirdPartyPaintById: signal(new Map()),
            thirdPartyPaints: signal([]),
            classicToToneProMap: signal(new Map()),
            toneProToClassicMap: signal(new Map()),
            citadelToThirdPartyMap: signal({}),
            colorsUsingPaintMap: signal(new Map()),
            modelsUsingPaintMap: signal(new Map()),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            customPaints: signal([]),
            customPaintById: signal(new Map()),
            customCompatibilityOverrides: signal({}),
            isOwned: () => false,
            isWishlisted: () => false,
            toggleInventory: () => {},
            toggleWishlist: () => {},
            linkCustomEquivalent: () => {},
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) => local || remote || '',
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PaintDetailModalComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const dialog = root.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBeTrue();
    expect(dialog.matches(':modal')).toBeTrue();
    expect(dialog.getAttribute('aria-labelledby')).toBe('paint-detail-modal-title');
    expect(root.querySelector('#paint-detail-modal-title')?.textContent?.trim()).toBe('Macragge Blue');
    const overrideSelect = root.querySelector('#paint-override-select') as HTMLSelectElement | null;
    expect(overrideSelect?.labels?.length).toBe(1);
    const closeBtn = root.querySelector('.close-btn') as HTMLButtonElement;
    expect(closeBtn.type).toBe('button');
    expect(closeBtn.getAttribute('aria-label')).toBe('Close paint details');

    comp.selectedOverridePaintId.set('tp-1');
    comp.selectPaint('p2');
    fixture.detectChanges();
    expect(comp.selectedOverridePaintId()).toBe('');

    comp.selectedOverridePaintId.set('tp-2');
    comp.close();
    fixture.detectChanges();
    expect(comp.selectedOverridePaintId()).toBe('');
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('returns [] from crossBrandMatches() without throwing when activePaintId is an Object.prototype key', async () => {
    const protoIds = ['toString', 'constructor', 'valueOf', '__proto__'] as const;
    const activePaintId = signal<string | null>(protoIds[0]);
    const paintMap = new Map<string, Paint>(
      protoIds.map((id) => [
        id,
        {
          id,
          name: `Paint ${id}`,
          range: 'warhammer_colour',
          category: 'Base',
          gradientStartHex: '#123456',
        },
      ])
    );

    await TestBed.configureTestingModule({
      imports: [PaintDetailModalComponent],
      providers: [
        provideRouter([]),
        {
          provide: PaintModalService,
          useValue: {
            activePaintId,
            openPaint: (id: string) => activePaintId.set(id),
            close: () => activePaintId.set(null),
          },
        },
        {
          provide: CatalogService,
          useValue: {
            paintById: signal(paintMap),
            thirdPartyPaintById: signal(new Map()),
            thirdPartyPaints: signal([]),
            classicToToneProMap: signal(new Map()),
            toneProToClassicMap: signal(new Map()),
            citadelToThirdPartyMap: signal({}),
            colorsUsingPaintMap: signal(new Map()),
            modelsUsingPaintMap: signal(new Map()),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            customPaints: signal([]),
            customPaintById: signal(new Map()),
            customCompatibilityOverrides: signal({}),
            isOwned: () => false,
            isWishlisted: () => false,
            toggleInventory: () => {},
            toggleWishlist: () => {},
            linkCustomEquivalent: () => {},
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) => local || remote || '',
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PaintDetailModalComponent);
    const comp = fixture.componentInstance;

    for (const key of protoIds) {
      activePaintId.set(key);
      fixture.detectChanges();
      expect(comp.citadelPaint()?.id).toBe(key);
      expect(comp.crossBrandMatches()).toEqual([]);
    }
  });

  it('caps visibleColorsUsingPaint at 24 and visibleModelsUsingPaint at 12, reuses memoized swatches, and sets image attributes', async () => {
    const activePaintId = signal<string | null>('p1');
    const paint1: Paint = {
      id: 'p1',
      name: 'Macragge Blue',
      range: 'warhammer_colour',
      category: 'Base',
      gradientStartHex: '#0D407F',
      localImagePath: '/paints/macragge.png',
    };
    const colors = Array.from({ length: 30 }, (_, i) => ({
      id: `col-${i}`,
      name: `Color ${i}`,
      hex: '#0D407F',
    }));
    const models = Array.from({ length: 16 }, (_, i) => ({
      id: `mod-${i}`,
      name: `Model ${i}`,
      localPrimaryImage: `/models/m-${i}.png`,
    }));

    await TestBed.configureTestingModule({
      imports: [PaintDetailModalComponent],
      providers: [
        provideRouter([]),
        {
          provide: PaintModalService,
          useValue: {
            activePaintId,
            openPaint: (id: string) => activePaintId.set(id),
            close: () => activePaintId.set(null),
          },
        },
        {
          provide: CatalogService,
          useValue: {
            paintById: signal(new Map([['p1', paint1]])),
            thirdPartyPaintById: signal(new Map()),
            thirdPartyPaints: signal([]),
            classicToToneProMap: signal(new Map()),
            toneProToClassicMap: signal(new Map()),
            citadelToThirdPartyMap: signal({
              p1: [
                {
                  thirdPartyPaintId: 'tp-missing-1',
                  brand: 'Vallejo',
                  range: 'Model Color',
                  name: 'Blue 1',
                  category: 'Base',
                  hex: '#112233',
                  deltaE: 1.0,
                  matchQuality: 'exact' as const,
                },
                {
                  thirdPartyPaintId: 'tp-missing-2',
                  brand: 'Army Painter',
                  range: 'Fanatic',
                  name: 'Blue 2',
                  category: 'Base',
                  hex: '#112244',
                  deltaE: 1.5,
                  matchQuality: 'close' as const,
                },
              ],
            }),
            colorsUsingPaintMap: signal(new Map([['p1', colors]])),
            modelsUsingPaintMap: signal(new Map([['p1', models]])),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            customPaints: signal([]),
            customPaintById: signal(new Map()),
            customCompatibilityOverrides: signal({}),
            isOwned: () => false,
            isWishlisted: () => false,
            toggleInventory: () => {},
            toggleWishlist: () => {},
            linkCustomEquivalent: () => {},
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) => local || remote || '',
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(PaintDetailModalComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    expect(comp.colorsUsingPaint().length).toBe(30);
    expect(comp.visibleColorsUsingPaint().length).toBe(24);
    expect(comp.modelsUsingPaint().length).toBe(16);
    expect(comp.visibleModelsUsingPaint().length).toBe(12);

    const rows = comp.crossBrandMatchRows();
    expect(rows[0].swatch).toBe(getFallbackSwatch('Base'));
    expect(rows[0].swatch).toBe(rows[1].swatch);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('.reverse-chip').length).toBe(24);
    expect(root.querySelectorAll('.reverse-model-card').length).toBe(12);

    const potImg = root.querySelector('.pot-img') as HTMLImageElement;
    expect(potImg.getAttribute('width')).toBe('60');
    expect(potImg.getAttribute('height')).toBe('60');
    expect(potImg.getAttribute('decoding')).toBe('async');
    expect(potImg.hasAttribute('loading')).toBeFalse();

    const reverseImg = root.querySelector('.reverse-model-card img') as HTMLImageElement;
    expect(reverseImg.getAttribute('width')).toBe('120');
    expect(reverseImg.getAttribute('height')).toBe('84');
    expect(reverseImg.getAttribute('loading')).toBe('lazy');
    expect(reverseImg.getAttribute('decoding')).toBe('async');
  });
});
