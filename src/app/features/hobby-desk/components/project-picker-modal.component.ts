import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
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

  private lastProjectId: string | null = null;

  constructor() {
    effect(() => {
      const currentMode = this.mode();
      const currentProjectId = this.project().id;
      if (
        currentMode === null ||
        (this.lastProjectId !== null && currentProjectId !== this.lastProjectId)
      ) {
        this.pickerSearch.set('');
      }
      this.lastProjectId = currentProjectId;
    });
  }

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

  readonly modelCountByRecipeId = computed(() => {
    const counts = new Map<string, number>();
    for (const entry of this.project().models) {
      counts.set(entry.recipeId, (counts.get(entry.recipeId) ?? 0) + 1);
    }
    return counts;
  });

  getModelCount(recipeId: string): number {
    return this.modelCountByRecipeId().get(recipeId) ?? 0;
  }

  addModel(recipeId: string, modelImageLocal?: string): void {
    this.userState.addModelToProject(this.project().id, recipeId, { modelImageLocal });
  }

  selectThumbnail(localPath: string, remoteUrl?: string): void {
    this.userState.setProjectThumbnail(this.project().id, localPath, remoteUrl);
    this.close();
  }

  close(): void {
    this.pickerSearch.set('');
    this.closed.emit();
  }
}

