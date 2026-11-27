import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ColorDetails, InventoryReadinessResult, StagedReadinessResult } from '../../core/models/catalog.models';
import { CatalogService } from '../../core/services/catalog.service';
import { ImageService } from '../../core/services/image.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { UserStateService } from '../../core/services/user-state.service';
import { ColorDetailComponent } from './color-detail.component';

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

function makeColor(id: string, name: string): ColorDetails {
  return {
    id,
    name,
    hex: '#123456',
    range: 'warhammer_colour',
    guideType: 'miniature',
    colorGroups: ['Blue'],
  };
}

describe('ColorDetailComponent async race, error, and 404 UI', () => {
  let paramMap$: BehaviorSubject<ParamMap>;
  let getColorDetailsSpy: jasmine.Spy;
  let modelsUsingColorMapSignal: ReturnType<
    typeof signal<
      Map<
        string,
        Array<{
          id: string;
          name: string;
          gameNames: string[];
          localPrimaryImage?: string;
          primaryImage?: string;
        }>
      >
    >
  >;

  beforeEach(async () => {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id: 'color-a' }));
    getColorDetailsSpy = jasmine.createSpy('getColorDetails');
    modelsUsingColorMapSignal = signal(new Map());

    await TestBed.configureTestingModule({
      imports: [ColorDetailComponent],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { paramMap: paramMap$.asObservable() },
        },
        {
          provide: CatalogService,
          useValue: {
            getColorDetails: getColorDetailsSpy,
            modelsUsingColorMap: modelsUsingColorMapSignal,
          },
        },
        {
          provide: UserStateService,
          useValue: {
            projects: signal([]),
            addManyToWishlist: () => {},
          },
        },
        {
          provide: InventoryMatchService,
          useValue: {
            evaluateStagedReadiness: () => SAMPLE_STAGED,
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) =>
              local || remote || '/icons/ic_color.svg',
          },
        },
      ],
    }).compileComponents();
  });

  it('cancels stale paramMap responses with switchMap when route changes rapidly', async () => {
    let resolveA!: (v: ColorDetails | null) => void;
    let resolveB!: (v: ColorDetails | null) => void;

    getColorDetailsSpy.and.callFake((id: string) => {
      if (id === 'color-a') {
        return new Promise<ColorDetails | null>((res) => {
          resolveA = res;
        });
      }
      return new Promise<ColorDetails | null>((res) => {
        resolveB = res;
      });
    });

    const fixture = TestBed.createComponent(ColorDetailComponent);
    fixture.detectChanges();

    paramMap$.next(convertToParamMap({ id: 'color-b' }));
    fixture.detectChanges();

    resolveB(makeColor('color-b', 'Color B'));
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.componentInstance.color()?.id).toBe('color-b');
    expect(fixture.componentInstance.loading()).toBeFalse();

    // Late resolution for color-a must NOT overwrite color-b
    resolveA(makeColor('color-a', 'Color A'));
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.componentInstance.color()?.id).toBe('color-b');
  });

  it('clears loading() and renders role="alert" error UI with <h1> on getColorDetails rejection', async () => {
    spyOn(console, 'warn');
    getColorDetailsSpy.and.rejectWith(new Error('Network down'));

    const fixture = TestBed.createComponent(ColorDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.loading()).toBeFalse();
    expect(fixture.componentInstance.loadError()).toBeTruthy();

    const alertEl: HTMLElement | null = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alertEl).not.toBeNull();
    expect(alertEl?.querySelector('h1')?.textContent).toContain('Color Guide Unavailable');
  });

  it('renders not-found @else UI with <h1> and /colors link when getColorDetails returns null', async () => {
    getColorDetailsSpy.and.resolveTo(null);

    const fixture = TestBed.createComponent(ColorDetailComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.componentInstance.loading()).toBeFalse();
    expect(fixture.componentInstance.color()).toBeNull();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toContain(
      'Color Guide Not Found'
    );
    const backLinks = Array.from(
      fixture.nativeElement.querySelectorAll('a') as NodeListOf<HTMLAnchorElement>
    );
    expect(backLinks.some((a) => a.getAttribute('href')?.includes('/colors'))).toBeTrue();
  });

  it('caps visibleModelsUsingColor at 24 and sets hero fetchpriority="high" and mini-card lazy attributes', async () => {
    const models = Array.from({ length: 30 }, (_, i) => ({
      id: `m-${i}`,
      name: `Model ${i}`,
      gameNames: ['Warhammer 40,000'],
      localPrimaryImage: `/models/m-${i}.png`,
    }));
    modelsUsingColorMapSignal.set(new Map([['color-a', models]]));
    getColorDetailsSpy.and.resolveTo({
      ...makeColor('color-a', 'Macragge Blue'),
      localImagePath: '/colors/macragge.png',
    });

    const fixture = TestBed.createComponent(ColorDetailComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(comp.modelsUsingColor().length).toBe(30);
    expect(comp.visibleModelsUsingColor().length).toBe(24);

    const root = fixture.nativeElement as HTMLElement;
    const heroImg = root.querySelector('.backpack-img') as HTMLImageElement;
    expect(heroImg.getAttribute('fetchpriority')).toBe('high');
    expect(heroImg.getAttribute('decoding')).toBe('async');
    expect(heroImg.getAttribute('width')).toBe('500');
    expect(heroImg.getAttribute('height')).toBe('500');
    expect(heroImg.hasAttribute('loading')).toBeFalse();

    const miniCards = root.querySelectorAll('.model-mini-card');
    expect(miniCards.length).toBe(24);
    const miniImg = miniCards[0].querySelector('img') as HTMLImageElement;
    expect(miniImg.getAttribute('loading')).toBe('lazy');
    expect(miniImg.getAttribute('decoding')).toBe('async');
    expect(miniImg.getAttribute('width')).toBe('170');
    expect(miniImg.getAttribute('height')).toBe('120');
  });
});
