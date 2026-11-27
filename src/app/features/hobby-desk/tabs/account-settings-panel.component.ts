import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { USER_LIMITS, formatBytes } from '../../../core/config/user-limits.config';
import { CatalogService } from '../../../core/services/catalog.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { WarhammerImportService } from '../../../core/services/warhammer-import.service';
import { AppIconComponent } from '../../../shared/components/app-icon/app-icon.component';

@Component({
  selector: 'app-account-settings-panel',
  imports: [DatePipe, FormsModule, AppIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-settings-panel.component.ng.html',
  styleUrl: './account-settings-panel.component.css',
})
export class AccountSettingsPanelComponent implements OnInit {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly importer = inject(WarhammerImportService);

  readonly maxPhotoSizeLabel = `${USER_LIMITS.MAX_PHOTO_FILE_SIZE_MB} MB`;

  importMode: 'merge' | 'replace' = 'merge';
  pastedCallbackUrl = '';
  readonly pkceBusy = signal(false);
  readonly pkceError = signal<string | null>(null);
  readonly pkceUrlCopied = signal(false);

  readonly snapshotBusy = signal(false);
  readonly snapshotError = signal<string | null>(null);
  readonly snapshotAvailable = signal<boolean | null>(null);

  authEmail = '';
  authPassword = '';
  readonly authError = signal<string | null>(null);
  readonly avatarFailed = signal(false);

  constructor() {
    effect(() => {
      this.userState.currentUser()?.photoURL;
      this.avatarFailed.set(false);
    });
  }

  onAvatarError(): void {
    this.avatarFailed.set(true);
  }

  readonly showcasePhotoCount = computed(
    () => this.userState.allUploadedPhotos().filter((p) => p.kind === 'showcase').length
  );

  readonly referencePhotoCount = computed(
    () => this.userState.allUploadedPhotos().filter((p) => p.kind === 'reference').length
  );

  readonly totalUploadedBytesLabel = computed(() => {
    const total = this.userState.allUploadedPhotos().reduce((acc, p) => acc + p.sizeBytes, 0);
    return formatBytes(total);
  });

  readonly manifestBundlesList = computed(() => {
    const mf = this.catalog.manifest();
    if (!mf?.bundles) {
      return [];
    }
    return Object.entries(mf.bundles).map(([key, val]) => ({
      key,
      hash: typeof val === 'string' ? val : val?.hash ?? '',
      updatedAt: typeof val === 'string' ? mf.updatedAt : val?.updatedAt ?? mf.updatedAt,
    }));
  });

  ngOnInit(): void {
    void this.probeBundledSnapshot();
  }

  private async probeBundledSnapshot(): Promise<void> {
    if (typeof fetch !== 'function') {
      this.snapshotAvailable.set(false);
      return;
    }
    try {
      const resp = await fetch('/data/user_account_snapshot.json', {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
      this.snapshotAvailable.set(resp.ok && contentType.includes('application/json'));
    } catch {
      this.snapshotAvailable.set(false);
    }
  }

  async loadExtractedSnapshot(): Promise<void> {
    this.snapshotBusy.set(true);
    this.snapshotError.set(null);
    try {
      await this.userState.loadExtractedAccountSnapshot(this.importMode);
    } catch (e: unknown) {
      this.snapshotError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.snapshotBusy.set(false);
    }
  }

  async startPkceLogin(): Promise<void> {
    this.pkceError.set(null);
    try {
      const { authorizeUrl } = await this.importer.generateMyWarhammerLoginUrl();
      window.open(authorizeUrl, '_blank', 'noopener');
    } catch (e: unknown) {
      this.pkceError.set(e instanceof Error ? e.message : String(e));
    }
  }

  async copyPkceLoginUrl(): Promise<void> {
    this.pkceError.set(null);
    try {
      const { authorizeUrl } = await this.importer.generateMyWarhammerLoginUrl();
      await navigator.clipboard.writeText(authorizeUrl);
      this.pkceUrlCopied.set(true);
      setTimeout(() => this.pkceUrlCopied.set(false), 2500);
    } catch (e: unknown) {
      this.pkceError.set(e instanceof Error ? e.message : String(e));
    }
  }

  async submitPkceCallback(): Promise<void> {
    this.pkceBusy.set(true);
    this.pkceError.set(null);
    try {
      await this.importer.exchangeCallbackAndImport(this.pastedCallbackUrl, this.importMode);
      this.pastedCallbackUrl = '';
    } catch (e: unknown) {
      this.pkceError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.pkceBusy.set(false);
    }
  }

  async onFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      await this.importer.importFromFile(file, this.importMode);
    } catch (e: unknown) {
      this.pkceError.set(e instanceof Error ? e.message : String(e));
    } finally {
      input.value = '';
    }
  }

  confirmResetData(): void {
    if (confirm('Reset all local browser Inventory, Wishlist, and Projects to a blank slate?')) {
      this.userState.resetLocalData();
    }
  }

  async handleEmailAuth(isSignUp: boolean): Promise<void> {
    this.authError.set(null);
    try {
      await this.userState.signInWithEmail(this.authEmail, this.authPassword, isSignUp);
    } catch (e: unknown) {
      this.authError.set(e instanceof Error ? e.message : String(e));
    }
  }

  async handleGoogleAuth(): Promise<void> {
    this.authError.set(null);
    try {
      await this.userState.signInWithGoogle();
    } catch (e: unknown) {
      this.authError.set(e instanceof Error ? e.message : String(e));
    }
  }
}
