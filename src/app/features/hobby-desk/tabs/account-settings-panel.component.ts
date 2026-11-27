import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { UserStateService } from '../../../core/services/user-state.service';
import { AccountPreferencesBackupCardComponent } from '../../account/components/account-preferences-backup-card.component';
import { AccountQuotasCardComponent } from '../../account/components/account-quotas-card.component';
import { CatalogCacheCardComponent } from '../../account/components/catalog-cache-card.component';
import { CloudAuthSyncCardComponent } from '../../account/components/cloud-auth-sync-card.component';
import { WarhammerImporterCardComponent } from '../../account/components/warhammer-importer-card.component';

@Component({
  selector: 'app-account-settings-panel',
  imports: [
    CloudAuthSyncCardComponent,
    WarhammerImporterCardComponent,
    AccountPreferencesBackupCardComponent,
    CatalogCacheCardComponent,
    AccountQuotasCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-settings-panel.component.ng.html',
  styleUrl: './account-settings-panel.component.css',
})
export class AccountSettingsPanelComponent implements OnInit {
  readonly userState = inject(UserStateService);

  readonly importMode = signal<'merge' | 'replace'>('merge');
  readonly snapshotBusy = signal(false);
  readonly snapshotError = signal<string | null>(null);
  readonly snapshotAvailable = signal<boolean | null>(null);

  readonly authError = signal<string | null>(null);
  readonly avatarFailed = signal(false);

  onAvatarError(): void {
    this.avatarFailed.set(true);
  }

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
      await this.userState.loadExtractedAccountSnapshot(this.importMode());
    } catch (e: unknown) {
      this.snapshotError.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.snapshotBusy.set(false);
    }
  }
}
