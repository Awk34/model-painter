import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { USER_LIMITS } from '../../../core/config/user-limits.config';
import { CatalogService } from '../../../core/services/catalog.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { WarhammerImportService } from '../../../core/services/warhammer-import.service';
import { AccountSettingsPanelComponent } from './account-settings-panel.component';

describe('AccountSettingsPanelComponent', () => {
  let fixture: ComponentFixture<AccountSettingsPanelComponent>;
  let component: AccountSettingsPanelComponent;
  let userStateMock: jasmine.SpyObj<UserStateService>;
  let fetchSpy: jasmine.Spy<typeof window.fetch>;

  beforeEach(async () => {
    fetchSpy = spyOn(window, 'fetch').and.resolveTo(
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    userStateMock = jasmine.createSpyObj<UserStateService>(
      'UserStateService',
      [
        'loadExtractedAccountSnapshot',
        'updatePreferences',
        'exportBackupJson',
        'resetLocalData',
        'signInWithEmail',
        'signInWithGoogle',
        'signOutCloud',
      ],
      {
        currentUser: signal(null),
        cloudSyncStatus: signal('local_only' as never),
        allUploadedPhotos: signal([]),
        projects: signal([]),
        preferences: signal({
          defaultRangeFilter: 'all',
          allowCompatibleSubstitutions: true,
          allowThirdPartySubstitutions: true,
          preferredThirdPartyBrands: [],
        }),
        state: signal({
          inventoryPaintIds: [],
          wishlistPaintIds: [],
          inventoryModelIds: [],
          wishlistModelIds: [],
          customPaints: [],
          preferences: {
            defaultRangeFilter: 'all',
            allowCompatibleSubstitutions: true,
            allowThirdPartySubstitutions: true,
            preferredThirdPartyBrands: [],
          },
        } as never),
        limits: USER_LIMITS,
      }
    );

    const catalogMock = {
      manifest: signal(null),
      syncStatus: signal('ready'),
      lastCheckedAt: signal(null),
      initializeCatalog: jasmine.createSpy('initializeCatalog').and.resolveTo(),
    };

    const importerMock = jasmine.createSpyObj<WarhammerImportService>('WarhammerImportService', [
      'generateMyWarhammerLoginUrl',
      'exchangeCallbackAndImport',
      'importFromFile',
    ]);

    await TestBed.configureTestingModule({
      imports: [AccountSettingsPanelComponent],
      providers: [
        { provide: UserStateService, useValue: userStateMock },
        { provide: CatalogService, useValue: catalogMock },
        { provide: WarhammerImportService, useValue: importerMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AccountSettingsPanelComponent);
    component = fixture.componentInstance;
  });

  it('hides snapshot import actions when /data/user_account_snapshot.json probe returns text/html SPA fallback', async () => {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();

    expect(fetchSpy).toHaveBeenCalledWith(
      '/data/user_account_snapshot.json',
      jasmine.objectContaining({ method: 'HEAD' })
    );
    expect(component.snapshotAvailable()).toBeFalse();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Load Extracted Account Snapshot');
  });

  it('keeps snapshot import actions hidden before probe resolves and renders them when HEAD returns application/json', async () => {
    let resolveProbe!: (resp: Response) => void;
    fetchSpy.and.returnValue(
      new Promise<Response>((resolve) => {
        resolveProbe = resolve;
      })
    );

    fixture.detectChanges();
    expect(component.snapshotAvailable()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').not.toContain('Load Extracted Account Snapshot');
    expect((fixture.nativeElement as HTMLElement).textContent ?? '').not.toContain('Import Extracted Account Snapshot');

    resolveProbe(
      new Response(null, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();

    expect(component.snapshotAvailable()).toBeTrue();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Load Extracted Account Snapshot');
    expect(text).toContain('Import Extracted Account Snapshot');
  });

  it('catches loadExtractedSnapshot errors into snapshotError without throwing an unhandled rejection', async () => {
    userStateMock.loadExtractedAccountSnapshot.and.rejectWith(
      new Error('Bundled account snapshot is not available in this environment.')
    );

    await expectAsync(component.loadExtractedSnapshot()).toBeResolved();
    expect(component.snapshotBusy()).toBeFalse();
    expect(component.snapshotError()).toContain('not available in this environment');
  });
});
