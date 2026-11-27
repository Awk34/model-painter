import { ChangeDetectionStrategy, Component, effect, inject, input, linkedSignal } from '@angular/core';
import { Router } from '@angular/router';
import { CollectionSubMode } from '../../core/models/catalog.models';
import { UserStateService } from '../../core/services/user-state.service';
import { AppIconComponent } from '../../shared/components/app-icon/app-icon.component';
import { DeskHeaderComponent } from '../../shared/components/desk-header/desk-header.component';
import { HobbyDeskConverterTabComponent } from './tabs/hobby-desk-converter-tab.component';
import { HobbyDeskModelsTabComponent } from './tabs/hobby-desk-models-tab.component';
import { HobbyDeskPaintsTabComponent } from './tabs/hobby-desk-paints-tab.component';
import { HobbyDeskProjectsTabComponent } from './tabs/hobby-desk-projects-tab.component';

export type HobbyDeskTab = 'projects' | 'models' | 'paints' | 'converter';

function isHobbyDeskTab(value: string | undefined): value is HobbyDeskTab {
  return value === 'projects' || value === 'models' || value === 'paints' || value === 'converter';
}

function isCollectionSubMode(value: string | undefined): value is CollectionSubMode {
  return value === 'inventory' || value === 'wishlist' || value === 'catalogue';
}

@Component({
  selector: 'app-hobby-desk',
  imports: [
    AppIconComponent,
    DeskHeaderComponent,
    HobbyDeskProjectsTabComponent,
    HobbyDeskModelsTabComponent,
    HobbyDeskPaintsTabComponent,
    HobbyDeskConverterTabComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hobby-desk.component.ng.html',
  styleUrl: './hobby-desk.component.css',
})
export class HobbyDeskComponent {
  readonly userState = inject(UserStateService);
  private readonly router = inject(Router);

  readonly tab = input<string | undefined>(undefined);
  readonly sub = input<string | undefined>(undefined);

  readonly activeTab = linkedSignal<string | undefined, HobbyDeskTab>({
    source: () => this.tab(),
    computation: (tabParam) => (isHobbyDeskTab(tabParam) ? tabParam : 'projects'),
  });

  readonly modelSubMode = linkedSignal<{ tab: string | undefined; sub: string | undefined }, CollectionSubMode>({
    source: () => ({ tab: this.tab(), sub: this.sub() }),
    computation: ({ tab, sub }) =>
      tab === 'models' && isCollectionSubMode(sub) ? sub : 'inventory',
  });

  readonly paintSubMode = linkedSignal<{ tab: string | undefined; sub: string | undefined }, CollectionSubMode>({
    source: () => ({ tab: this.tab(), sub: this.sub() }),
    computation: ({ tab, sub }) =>
      tab !== 'models' && isCollectionSubMode(sub) ? sub : 'inventory',
  });

  constructor() {
    effect(() => {
      if (this.tab() === 'settings') {
        void this.router.navigate(['/account'], { replaceUrl: true });
      }
    });
  }

  openProjectsTab(): void {
    this.activeTab.set('projects');
  }

  openModelsTab(sub: CollectionSubMode): void {
    this.activeTab.set('models');
    this.modelSubMode.set(sub);
  }

  openPaintsTab(sub: CollectionSubMode): void {
    this.activeTab.set('paints');
    this.paintSubMode.set(sub);
  }
}
