import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { USER_LIMITS } from '../../../core/config/user-limits.config';
import { CatalogService } from '../../../core/services/catalog.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { WarhammerImportService } from '../../../core/services/warhammer-import.service';
import { AccountPreferencesBackupCardComponent } from './account-preferences-backup-card.component';
import { AccountQuotasCardComponent } from './account-quotas-card.component';
import { CatalogCacheCardComponent } from './catalog-cache-card.component';
import { CloudAuthSyncCardComponent } from './cloud-auth-sync-card.component';
import { WarhammerImporterCardComponent } from './warhammer-importer-card.component';

describe('Account decomposed cards', () => {
  it('CloudAuthSyncCardComponent submits reactive authForm and surfaces signInWithEmail error', async () => {
    const signInWithEmail = jasmine
      .createSpy('signInWithEmail')
      .and.rejectWith(new Error('Wrong password'));
    const signInWithGoogle = jasmine.createSpy('signInWithGoogle').and.resolveTo();

    TestBed.configureTestingModule({
      imports: [CloudAuthSyncCardComponent],
      providers: [
        {
          provide: UserStateService,
          useValue: {
            currentUser: signal(null),
            cloudSyncStatus: signal('local-only'),
            signInWithEmail,
            signInWithGoogle,
            signOutCloud: () => Promise.resolve(),
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(CloudAuthSyncCardComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.authForm.setValue({ email: 'test@example.com', password: 'secret' });
    await comp.handleEmailAuth(false);
    fixture.detectChanges();

    expect(signInWithEmail).toHaveBeenCalledWith('test@example.com', 'secret', false);
    expect(comp.authError()).toBe('Wrong password');
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Wrong password'
    );
  });

  it('WarhammerImporterCardComponent exchanges PKCE callback URL and clears input', async () => {
    const exchangeCallbackAndImport = jasmine
      .createSpy('exchangeCallbackAndImport')
      .and.resolveTo();
    const importerMock = {
      generateMyWarhammerLoginUrl: jasmine
        .createSpy('generateMyWarhammerLoginUrl')
        .and.resolveTo({ authorizeUrl: 'https://login.mywarhammer.com/auth' }),
      exchangeCallbackAndImport,
      importFromFile: jasmine.createSpy('importFromFile').and.resolveTo(),
    };

    TestBed.configureTestingModule({
      imports: [WarhammerImporterCardComponent],
      providers: [{ provide: WarhammerImportService, useValue: importerMock }],
    });

    const fixture = TestBed.createComponent(WarhammerImporterCardComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    comp.importModeControl.setValue('replace');
    comp.callbackUrlControl.setValue('citadel-colour://callback?code=abc&state=xyz');
    fixture.detectChanges();

    await comp.submitPkceCallback();
    expect(exchangeCallbackAndImport).toHaveBeenCalledWith(
      'citadel-colour://callback?code=abc&state=xyz',
      'replace'
    );
    expect(comp.callbackUrlControl.value).toBe('');
  });

  it('AccountPreferencesBackupCardComponent syncs preference checkboxes via ReactiveFormsModule', () => {
    const updatePreferences = jasmine.createSpy('updatePreferences');
    const exportBackupJson = jasmine.createSpy('exportBackupJson');
    const resetLocalData = jasmine.createSpy('resetLocalData');

    TestBed.configureTestingModule({
      imports: [AccountPreferencesBackupCardComponent],
      providers: [
        {
          provide: UserStateService,
          useValue: {
            preferences: signal({
              defaultRangeFilter: 'all',
              allowCompatibleSubstitutions: true,
              allowThirdPartySubstitutions: false,
              preferredThirdPartyBrands: [],
            }),
            updatePreferences,
            exportBackupJson,
            resetLocalData,
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(AccountPreferencesBackupCardComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;

    expect(comp.prefsForm.value).toEqual({
      allowCompatibleSubstitutions: true,
      allowThirdPartySubstitutions: false,
    });

    comp.prefsForm.controls.allowThirdPartySubstitutions.setValue(true);
    expect(updatePreferences).toHaveBeenCalledWith({ allowThirdPartySubstitutions: true });

    const root = fixture.nativeElement as HTMLElement;
    const btns = Array.from(root.querySelectorAll('.backup-btn-row button')) as HTMLButtonElement[];
    expect(btns.length).toBe(2);

    btns[0].click();
    expect(exportBackupJson).toHaveBeenCalledTimes(1);

    const confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    btns[1].click();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(resetLocalData).not.toHaveBeenCalled();

    confirmSpy.and.returnValue(true);
    btns[1].click();
    expect(resetLocalData).toHaveBeenCalledTimes(1);
  });

  it('CatalogCacheCardComponent renders manifest <time> and triggers refresh', () => {
    const initializeCatalog = jasmine.createSpy('initializeCatalog').and.resolveTo();

    TestBed.configureTestingModule({
      imports: [CatalogCacheCardComponent],
      providers: [
        {
          provide: CatalogService,
          useValue: {
            manifest: signal({
              catalogVersion: 3,
              updatedAt: '2026-11-26T00:00:00Z',
              bundles: { paints: { hash: 'abcdef1234567890abcdef', updatedAt: '2026-11-26T00:00:00Z' } },
            }),
            syncStatus: signal('up-to-date'),
            lastCheckedAt: signal('2026-11-26T01:00:00Z'),
            initializeCatalog,
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(CatalogCacheCardComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('time[datetime]').length).toBe(2);
    expect(root.querySelector('.bundle-name')?.textContent?.trim()).toBe('paints');

    (root.querySelector('.cache-actions-row button') as HTMLButtonElement).click();
    expect(initializeCatalog).toHaveBeenCalledWith(false);
  });

  it('AccountQuotasCardComponent displays photo counts and limits', () => {
    TestBed.configureTestingModule({
      imports: [AccountQuotasCardComponent],
      providers: [
        {
          provide: UserStateService,
          useValue: {
            projects: signal([{ id: 'p1' }]),
            inventoryModelIds: signal(['m1', 'm2']),
            wishlistModelIds: signal([]),
            inventoryPaintIds: signal(['pt1']),
            wishlistPaintIds: signal(['pt2']),
            customPaints: signal([]),
            allUploadedPhotos: signal([
              { kind: 'showcase', sizeBytes: 1024 },
              { kind: 'reference', sizeBytes: 2048 },
            ]),
            limits: USER_LIMITS,
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(AccountQuotasCardComponent);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('1 / 50');
    expect(text).toContain('Showcase Photos: 1 uploaded');
    expect(text).toContain('Private Reference Photos: 1 uploaded');
  });
});
