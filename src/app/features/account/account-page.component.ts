import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CollectionSubMode } from '../../core/models/catalog.models';
import { DeskHeaderComponent } from '../../shared/components/desk-header/desk-header.component';
import { AccountSettingsPanelComponent } from '../hobby-desk/tabs/account-settings-panel.component';

@Component({
  selector: 'app-account-page',
  imports: [DeskHeaderComponent, AccountSettingsPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './account-page.component.ng.html',
  styleUrl: './account-page.component.css',
})
export class AccountPageComponent {
  private readonly router = inject(Router);

  openProjectsTab(): void {
    void this.router.navigate(['/hobby-desk'], { queryParams: { tab: 'projects' } });
  }

  openModelsTab(sub: CollectionSubMode): void {
    void this.router.navigate(['/hobby-desk'], { queryParams: { tab: 'models', sub } });
  }

  openPaintsTab(sub: CollectionSubMode): void {
    void this.router.navigate(['/hobby-desk'], { queryParams: { tab: 'paints', sub } });
  }
}
