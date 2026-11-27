import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AppComponent } from './app.component';
import { CatalogSyncStatus, CloudSyncStatus } from './core/models/catalog.models';
import { CatalogService } from './core/services/catalog.service';
import { ImageService } from './core/services/image.service';
import { PaintModalService } from './core/services/paint-modal.service';
import { ToastService } from './core/services/toast.service';
import { UserStateService } from './core/services/user-state.service';

interface MockUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let toastService: ToastService;
  let currentUserSig: WritableSignal<MockUser | null>;

  beforeEach(async () => {
    currentUserSig = signal<MockUser | null>(null);

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        ToastService,
        {
          provide: CatalogService,
          useValue: {
            models: signal([]),
            colors: signal([]),
            paints: signal([]),
            thirdPartyPaints: signal([]),
            thirdPartyBrands: signal([]),
            paintById: signal(new Map()),
            thirdPartyById: signal(new Map()),
            loading: signal(false),
            syncStatus: signal(CatalogSyncStatus.UpToDate),
          },
        },
        {
          provide: PaintModalService,
          useValue: {
            activePaintId: signal<string | null>(null),
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: () => '/icons/ic_models.svg',
          },
        },
        {
          provide: UserStateService,
          useFactory: () => {
            const toast = TestBed.inject(ToastService);
            return {
              projects: signal([]),
              inventoryPaintIds: signal([]),
              wishlistPaintIds: signal([]),
              inventoryModelIds: signal([]),
              wishlistModelIds: signal([]),
              state: signal({
                inventoryPaintIds: [],
                wishlistPaintIds: [],
                inventoryModelIds: [],
                wishlistModelIds: [],
                projects: [],
                customPaints: [],
                customCompatibilityOverrides: {},
                uploadedPhotos: [],
                preferences: {
                  allowCompatibleSubstitutions: true,
                  allowThirdPartySubstitutions: true,
                },
              }),
              currentUser: currentUserSig,
              cloudSyncStatus: signal(CloudSyncStatus.LocalOnly),
              toastMessage: toast.message,
              isOwned: () => false,
              isWishlisted: () => false,
            };
          },
        },
      ],
    }).compileComponents();

    toastService = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('renders currentColor inline SVG icons in desktop and mobile navigation with zero static icon <img> tags', () => {
    const root = fixture.nativeElement as HTMLElement;
    const legacyIconImgs = root.querySelectorAll(
      'img[src*="ic_hobby_desk"], img[src*="ic_models"], img[src*="ic_color"], img[src*="ic_search"], img[src*="ic_profile"]'
    );
    expect(legacyIconImgs.length).toBe(0);

    const sideNavSvgs = Array.from(root.querySelectorAll('.side-nav svg')) as SVGElement[];
    const mobileNavSvgs = Array.from(
      root.querySelectorAll('.mobile-bottom-nav svg')
    ) as SVGElement[];

    expect(sideNavSvgs.length).toBeGreaterThanOrEqual(4);
    expect(mobileNavSvgs.length).toBeGreaterThanOrEqual(5);

    for (const svg of [...sideNavSvgs, ...mobileNavSvgs]) {
      expect(svg.getAttribute('fill')).toBe('currentColor');
      expect(getComputedStyle(svg).color).not.toBe('rgb(0, 0, 0)');
    }
  });

  it('mounts a persistent notification region and toggles popover="manual" with pause and dismiss', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.isConnected).toBeTrue();

    const region = root.querySelector('[role="region"][aria-label="Notifications"]') as HTMLElement | null;
    const liveRegion = region?.querySelector('[aria-live="polite"]') as HTMLElement | null;
    const popoverEl = region?.querySelector('[popover="manual"]') as HTMLElement | null;

    expect(region).toBeTruthy();
    expect(liveRegion).toBeTruthy();
    expect(popoverEl).toBeTruthy();
    expect(popoverEl?.matches(':popover-open')).toBeFalse();

    toastService.show('Paint added');
    fixture.detectChanges();

    expect(liveRegion?.textContent?.trim()).toBe('Paint added');
    expect(popoverEl?.matches(':popover-open')).toBeTrue();

    const closeBtn = popoverEl?.querySelector(
      'button[type="button"][aria-label="Dismiss notification"]'
    ) as HTMLButtonElement | null;
    expect(closeBtn).toBeTruthy();

    popoverEl?.dispatchEvent(new MouseEvent('mouseenter'));
    expect(toastService.isPaused()).toBeTrue();

    popoverEl?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(toastService.isPaused()).toBeFalse();

    closeBtn?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(toastService.isPaused()).toBeTrue();

    closeBtn?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(toastService.isPaused()).toBeFalse();

    closeBtn?.click();
    fixture.detectChanges();

    expect(toastService.message()).toBeNull();
    expect(popoverEl?.matches(':popover-open')).toBeFalse();
  });

  it('keeps consecutive toasts paused when popover is hovered or focused and stays paused on focusout while hovered', () => {
    const root = fixture.nativeElement as HTMLElement;
    const popoverEl = root.querySelector('#app-toast-popover') as HTMLElement;
    expect(popoverEl).toBeTruthy();

    toastService.show('First');
    fixture.detectChanges();

    const closeBtn = popoverEl.querySelector(
      'button[type="button"][aria-label="Dismiss notification"]'
    ) as HTMLButtonElement;
    closeBtn.focus();
    expect(popoverEl.matches(':focus-within')).toBeTrue();
    expect(toastService.isPaused()).toBeTrue();

    // Consecutive toast while focus remains inside popover must re-pause immediately
    toastService.show('Second');
    fixture.detectChanges();
    expect(toastService.message()).toBe('Second');
    expect(toastService.isPaused()).toBeTrue();

    // Focus leaving while hovered must stay paused
    const origMatches = popoverEl.matches.bind(popoverEl);
    spyOn(popoverEl, 'matches').and.callFake((selector: string) =>
      selector === ':hover' ? true : origMatches(selector)
    );
    closeBtn.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(toastService.isPaused()).toBeTrue();
  });

  it('resets avatarFailed when currentUser photoURL changes', () => {
    currentUserSig.set({
      uid: 'u1',
      email: 'a@example.com',
      displayName: 'Alice',
      photoURL: 'https://example.invalid/a.png',
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.avatarUrl()).toBe('https://example.invalid/a.png');

    fixture.componentInstance.onAvatarError();
    fixture.detectChanges();
    expect(fixture.componentInstance.avatarUrl()).toBeNull();

    currentUserSig.set({
      uid: 'u2',
      email: 'b@example.com',
      displayName: 'Bob',
      photoURL: 'https://example.invalid/b.png',
    });
    fixture.detectChanges();
    expect(fixture.componentInstance.avatarUrl()).toBe('https://example.invalid/b.png');
  });

  it('renders skip link targeting #main-content, unique nav aria-labels, semantic links, and no stale boot counts', () => {
    const root = fixture.nativeElement as HTMLElement;
    const skipLink = root.querySelector('a.skip-link[href="#main-content"]') as HTMLAnchorElement | null;
    const mainEl = root.querySelector('main#main-content[tabindex="-1"]') as HTMLElement | null;
    expect(skipLink).not.toBeNull();
    expect(mainEl).not.toBeNull();

    skipLink?.click();
    expect(document.activeElement).toBe(mainEl);

    const navs = Array.from(root.querySelectorAll('nav'));
    expect(navs.length).toBe(2);
    const navLabels = navs.map((n) => n.getAttribute('aria-label'));
    expect(navLabels[0]).toBeTruthy();
    expect(navLabels[1]).toBeTruthy();
    expect(navLabels[0]).not.toBe(navLabels[1]);

    expect(root.querySelectorAll('div[routerLink], div[routerlink]').length).toBe(0);
    expect(root.querySelector('a.brand-box')).not.toBeNull();
    expect(root.querySelector('a.sidebar-user-widget')).not.toBeNull();
    expect(root.textContent ?? '').not.toContain('4,531');
  });

  it('navigates to /search on Ctrl+K / Cmd+K and restores focus on dismissToast()', () => {
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);

    const ctrlK = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
    window.dispatchEvent(ctrlK);
    expect(ctrlK.defaultPrevented).toBeTrue();
    expect(navSpy).toHaveBeenCalledWith(['/search']);

    navSpy.calls.reset();
    const metaK = new KeyboardEvent('keydown', { key: 'K', metaKey: true, cancelable: true });
    window.dispatchEvent(metaK);
    expect(metaK.defaultPrevented).toBeTrue();
    expect(navSpy).toHaveBeenCalledWith(['/search']);

    const root = fixture.nativeElement as HTMLElement;
    const triggerBtn = root.querySelector('main#main-content[tabindex="-1"]') as HTMLElement;
    triggerBtn.focus();
    expect(document.activeElement).toBe(triggerBtn);

    toastService.show('Saved!');
    fixture.detectChanges();

    const closeBtn = root.querySelector(
      '#app-toast-popover button[aria-label="Dismiss notification"]'
    ) as HTMLButtonElement;
    closeBtn.focus();
    expect(document.activeElement).toBe(closeBtn);

    closeBtn.click();
    fixture.detectChanges();
    expect(toastService.message()).toBeNull();
    expect(document.activeElement).toBe(triggerBtn);
  });
});
