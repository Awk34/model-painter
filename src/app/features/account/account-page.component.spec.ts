import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { USER_LIMITS } from '../../core/config/user-limits.config';
import { CatalogService } from '../../core/services/catalog.service';
import { UserStateService } from '../../core/services/user-state.service';
import { WarhammerImportService } from '../../core/services/warhammer-import.service';
import { AccountPageComponent } from './account-page.component';

describe('AccountPageComponent', () => {
  beforeEach(async () => {
    spyOn(window, 'fetch').and.resolveTo(
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    await TestBed.configureTestingModule({
      imports: [AccountPageComponent],
      providers: [
        provideRouter([]),
        {
          provide: UserStateService,
          useValue: {
            currentUser: signal(null),
            cloudSyncStatus: signal('local-only'),
            allUploadedPhotos: signal([]),
            projects: signal([]),
            inventoryPaintIds: signal([]),
            wishlistPaintIds: signal([]),
            inventoryModelIds: signal([]),
            wishlistModelIds: signal([]),
            customPaints: signal([]),
            preferences: signal({
              defaultRangeFilter: 'all',
              allowCompatibleSubstitutions: true,
              allowThirdPartySubstitutions: true,
              preferredThirdPartyBrands: [],
            }),
            limits: USER_LIMITS,
            updatePreferences: () => {},
            exportBackupJson: () => {},
            resetLocalData: () => {},
          },
        },
        {
          provide: CatalogService,
          useValue: {
            manifest: signal(null),
            syncStatus: signal('ready'),
            lastCheckedAt: signal(null),
            initializeCatalog: () => Promise.resolve(),
          },
        },
        {
          provide: WarhammerImportService,
          useValue: jasmine.createSpyObj('WarhammerImportService', [
            'generateMyWarhammerLoginUrl',
            'exchangeCallbackAndImport',
            'importFromFile',
          ]),
        },
      ],
    }).compileComponents();
  });

  it('renders Account & Data Sync header and navigates back to /hobby-desk tabs on KPI pill click', () => {
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate').and.resolveTo(true);

    const fixture = TestBed.createComponent(AccountPageComponent);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Account & Data Sync');
    expect(root.querySelector('app-account-settings-panel')).not.toBeNull();

    fixture.componentInstance.openProjectsTab();
    expect(navSpy).toHaveBeenCalledWith(['/hobby-desk'], { queryParams: { tab: 'projects' } });

    fixture.componentInstance.openModelsTab('wishlist');
    expect(navSpy).toHaveBeenCalledWith(['/hobby-desk'], {
      queryParams: { tab: 'models', sub: 'wishlist' },
    });

    fixture.componentInstance.openPaintsTab('inventory');
    expect(navSpy).toHaveBeenCalledWith(['/hobby-desk'], {
      queryParams: { tab: 'paints', sub: 'inventory' },
    });
  });
});
