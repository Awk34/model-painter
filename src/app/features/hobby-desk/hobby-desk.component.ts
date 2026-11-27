import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { formatBytes } from '../../core/config/user-limits.config';
import { UserStateService } from '../../core/services/user-state.service';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { AccountSettingsPanelComponent } from './tabs/account-settings-panel.component';
import { HobbyDeskConverterTabComponent } from './tabs/hobby-desk-converter-tab.component';
import {
  CollectionSubMode,
  HobbyDeskModelsTabComponent,
} from './tabs/hobby-desk-models-tab.component';
import { HobbyDeskPaintsTabComponent } from './tabs/hobby-desk-paints-tab.component';
import { HobbyDeskProjectsTabComponent } from './tabs/hobby-desk-projects-tab.component';

export type HobbyDeskTab = 'projects' | 'models' | 'paints' | 'converter' | 'settings';

@Component({
  selector: 'app-hobby-desk',
  imports: [
    AppIconComponent,
    HobbyDeskProjectsTabComponent,
    HobbyDeskModelsTabComponent,
    HobbyDeskPaintsTabComponent,
    HobbyDeskConverterTabComponent,
    AccountSettingsPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hobby-desk.component.ng.html',
  styleUrl: './hobby-desk.component.css',
})
export class HobbyDeskComponent {
  readonly userState = inject(UserStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly isAccountPage = signal(false);
  readonly activeTab = signal<HobbyDeskTab>('projects');
  readonly modelSubMode = signal<CollectionSubMode>('inventory');
  readonly paintSubMode = signal<CollectionSubMode>('inventory');

  readonly totalUploadedBytesLabel = computed(() => {
    const total = this.userState.allUploadedPhotos().reduce((acc, p) => acc + p.sizeBytes, 0);
    return formatBytes(total);
  });

  constructor() {
    this.route.data.subscribe((data) => {
      const isAccount = data['page'] === 'account' || this.router.url.startsWith('/account');
      this.isAccountPage.set(isAccount);
      if (isAccount) {
        this.activeTab.set('settings');
      }
    });
    this.route.queryParamMap.subscribe((params) => {
      const tab = params.get('tab');
      if (
        tab === 'models' ||
        tab === 'paints' ||
        tab === 'projects' ||
        tab === 'converter' ||
        tab === 'settings'
      ) {
        this.activeTab.set(tab);
      }
      const sub = params.get('sub');
      if (sub === 'inventory' || sub === 'wishlist' || sub === 'catalogue') {
        if (tab === 'models') {
          this.modelSubMode.set(sub);
        } else {
          this.paintSubMode.set(sub);
        }
      }
    });
  }

  openProjectsTab(): void {
    if (this.isAccountPage()) {
      this.router.navigate(['/hobby-desk'], { queryParams: { tab: 'projects' } });
      return;
    }
    this.activeTab.set('projects');
  }

  openModelsTab(sub: CollectionSubMode): void {
    if (this.isAccountPage()) {
      this.router.navigate(['/hobby-desk'], { queryParams: { tab: 'models', sub } });
      return;
    }
    this.activeTab.set('models');
    this.modelSubMode.set(sub);
  }

  openPaintsTab(sub: CollectionSubMode): void {
    if (this.isAccountPage()) {
      this.router.navigate(['/hobby-desk'], { queryParams: { tab: 'paints', sub } });
      return;
    }
    this.activeTab.set('paints');
    this.paintSubMode.set(sub);
  }
}
