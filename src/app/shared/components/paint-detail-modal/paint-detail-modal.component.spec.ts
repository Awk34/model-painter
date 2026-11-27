import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Paint } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { PaintModalService } from '../../../core/services/paint-modal.service';
import { UserStateService } from '../../../core/services/user-state.service';
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
});
