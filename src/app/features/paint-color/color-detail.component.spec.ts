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

  beforeEach(async () => {
    paramMap$ = new BehaviorSubject<ParamMap>(convertToParamMap({ id: 'color-a' }));
    getColorDetailsSpy = jasmine.createSpy('getColorDetails');

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
            modelsUsingColorMap: signal(new Map()),
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
});
