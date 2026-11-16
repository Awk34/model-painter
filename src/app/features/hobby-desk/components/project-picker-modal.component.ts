import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { UserProject } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { matchesModelSearch } from '../../../core/utils/catalog-filter.util';
import { PaintSwatchComponent } from '../../../shared/components/paint-swatch/paint-swatch.component';

export type ProjectPickerMode = 'model' | 'color' | 'thumbnail' | null;

@Component({
  selector: 'app-project-picker-modal',
  imports: [FormsModule, PaintSwatchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-picker-modal.component.ng.html',
  styleUrl: './project-picker-modal.component.css',
})
export class ProjectPickerModalComponent {
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly img = inject(ImageService);

  readonly mode = input<ProjectPickerMode>(null);
  readonly project = input.required<UserProject>();

  readonly closed = output<void>();

  readonly pickerSearch = signal('');

  readonly modalTitle = computed(() => {
    const m = this.mode();
    const pName = this.project().name;
    if (m === 'model') {
      return `Add Model Guide to "${pName}"`;
    }
    if (m === 'color') {
      return `Add Color Guide to "${pName}"`;
    }
    return 'Choose Project Thumbnail';
  });

  readonly searchPlaceholder = computed(() => {
    const m = this.mode();
    if (m === 'model') {
      return 'Search 4,531 models by name or faction...';
    }
    if (m === 'color') {
      return 'Search 596 color schemes...';
    }
    return 'Search any miniature artwork to use as project cover...';
  });

  readonly pickerModels = computed(() => {
    const q = this.pickerSearch().trim().toLowerCase();
    const list = this.catalog.models();
    if (!q) {
      return list.slice(0, 40);
    }
    return list.filter((m) => matchesModelSearch(m, q)).slice(0, 40);
  });

  readonly pickerColors = computed(() => {
    const q = this.pickerSearch().trim().toLowerCase();
    const list = this.catalog.colors();
    if (!q) {
      return list.slice(0, 40);
    }
    return list.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 40);
  });

  selectThumbnail(localPath: string, remoteUrl?: string): void {
    this.userState.setProjectThumbnail(this.project().id, localPath, remoteUrl);
    this.close();
  }

  close(): void {
    this.pickerSearch.set('');
    this.closed.emit();
  }
}

