import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CatalogService } from '../../core/services/catalog.service';
import { UserStateService } from '../../core/services/user-state.service';
import { InventoryMatchService } from '../../core/services/inventory-match.service';
import { PaintModalService } from '../../core/services/paint-modal.service';
import { ImageService } from '../../core/services/image.service';
import { UserProjectNote, UserProjectNoteComponent } from '../../core/models/warhammer.models';

@Component({
  selector: 'app-project-detail',
  imports: [CommonModule, FormsModule, RouterModule, DragDropModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-detail.component.ng.html',
  styleUrl: './project-detail.component.css',
})
export class ProjectDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly catalog = inject(CatalogService);
  readonly userState = inject(UserStateService);
  readonly readinessService = inject(InventoryMatchService);
  readonly paintModal = inject(PaintModalService);
  readonly img = inject(ImageService);

  readonly projectId = signal<string>('');
  readonly activeTab = signal<'paints' | 'models' | 'colours' | 'notes'>('paints');
  readonly selectedRollupStage = signal<'base' | 'detail' | 'artificer' | 'all'>('base');

  readonly editingTitle = signal(false);
  titleDraft = '';

  // Modals
  readonly showAddModelModal = signal(false);
  readonly showAddColourModal = signal(false);
  readonly showThumbnailModal = signal(false);
  pickerSearch = '';

  // Note editor
  readonly editingNoteOpen = signal(false);
  readonly editingNoteId = signal<string | null>(null);
  noteTitleDraft = '';
  noteBlocksDraft: UserProjectNoteComponent[] = [];

  constructor() {
    this.route.paramMap.subscribe((params) => {
      this.projectId.set(params.get('id') ?? '');
    });
  }

  readonly project = computed(() =>
    this.userState.projects().find((p) => p.id === this.projectId()) ?? null
  );

  readonly attachedModels = computed(() => {
    const p = this.project();
    if (!p) return [];
    const map = this.catalog.modelById();
    return p.recipeIds.map((id) => map.get(id)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  });

  readonly attachedColours = computed(() => {
    const p = this.project();
    if (!p) return [];
    const map = this.catalog.colourById();
    return p.colourIds.map((id) => map.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  });

  readonly coverUrl = computed(() => {
    const p = this.project();
    if (!p) return '/icons/ic_project.svg';
    if (p.localThumbnailPath || p.thumbnailUrl) {
      return this.img.resolve(p.localThumbnailPath, p.thumbnailUrl);
    }
    const firstModel = this.attachedModels()[0];
    if (firstModel) {
      return this.img.resolve(firstModel.localPrimaryImage, firstModel.primaryImage);
    }
    return '/icons/ic_project.svg';
  });

  readonly stagedRollupReadiness = computed(() => {
    const baseIds = new Set<string>();
    const detailIds = new Set<string>();
    const artificerIds = new Set<string>();
    const allIds = new Set<string>();

    for (const m of this.attachedModels()) {
      (m.paintsByStage?.base ?? []).forEach((id) => baseIds.add(id));
      (m.paintsByStage?.detail ?? []).forEach((id) => detailIds.add(id));
      (m.paintsByStage?.artificer ?? []).forEach((id) => artificerIds.add(id));
      m.requiredPaintIds.forEach((id) => allIds.add(id));
    }
    for (const c of this.attachedColours()) {
      c.basePaintIds.forEach((id) => baseIds.add(id));
      c.detailPaintIds.forEach((id) => detailIds.add(id));
      c.artificerPaintIds.forEach((id) => artificerIds.add(id));
      c.requiredPaintIds.forEach((id) => allIds.add(id));
    }

    return this.readinessService.evaluateStagedReadiness({
      base: Array.from(baseIds),
      detail: Array.from(detailIds),
      artificer: Array.from(artificerIds),
      all: Array.from(allIds),
    });
  });

  readonly rollupReadiness = computed(() => {
    const staged = this.stagedRollupReadiness();
    const stage = this.selectedRollupStage();
    if (stage === 'all') return staged.overall;
    return staged[stage];
  });

  readonly missingPaintObjects = computed(() => {
    const map = this.catalog.paintById();
    return this.rollupReadiness()
      .missingPaintIds.map((id) => map.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  });

  readonly ownedDirectObjects = computed(() => {
    const map = this.catalog.paintById();
    return this.rollupReadiness()
      .ownedDirectIds.map((id) => map.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
  });

  readonly substitutedList = computed(() => {
    const map = this.catalog.paintById();
    const subs = this.rollupReadiness().substitutedByPaintId;
    return Object.entries(subs)
      .map(([pid, sub]) => {
        const paint = map.get(pid);
        return paint ? { paint, sub } : null;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));
  });

  readonly pickerModels = computed(() => {
    const q = this.pickerSearch.trim().toLowerCase();
    const list = this.catalog.models();
    if (!q) return list.slice(0, 40);
    return list
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.factionNames.some((f) => f.toLowerCase().includes(q))
      )
      .slice(0, 40);
  });

  readonly pickerColours = computed(() => {
    const q = this.pickerSearch.trim().toLowerCase();
    const list = this.catalog.colours();
    if (!q) return list.slice(0, 40);
    return list.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 40);
  });

  startEditTitle(current: string): void {
    this.titleDraft = current;
    this.editingTitle.set(true);
  }

  saveTitle(projectId: string): void {
    this.userState.renameProject(projectId, this.titleDraft);
    this.editingTitle.set(false);
  }

  selectThumbnail(projectId: string, localPath: string, remoteUrl?: string): void {
    this.userState.setProjectThumbnail(projectId, localPath, remoteUrl);
    this.showThumbnailModal.set(false);
  }

  duplicateAndOpen(projectId: string): void {
    const copy = this.userState.duplicateProject(projectId);
    if (copy) {
      this.router.navigate(['/projects', copy.id]);
    }
  }

  deleteProject(projectId: string, name: string): void {
    if (confirm(`Delete project "${name}"?`)) {
      this.userState.deleteProject(projectId);
      this.router.navigate(['/hobby-desk']);
    }
  }

  openNoteEditor(note: UserProjectNote | null): void {
    if (note) {
      this.editingNoteId.set(note.id);
      this.noteTitleDraft = note.title;
      this.noteBlocksDraft = structuredClone(note.components);
    } else {
      this.editingNoteId.set(null);
      this.noteTitleDraft = '';
      this.noteBlocksDraft = [
        { type: 'text', value: '' },
        { type: 'checkbox', value: 'Prime miniatures', checked: false },
      ];
    }
    this.editingNoteOpen.set(true);
  }

  addNoteBlock(type: 'text' | 'checkbox'): void {
    this.noteBlocksDraft.push({ type, value: '', checked: false });
  }

  removeNoteBlock(idx: number): void {
    this.noteBlocksDraft.splice(idx, 1);
  }

  dropNoteBlock(event: CdkDragDrop<UserProjectNoteComponent[]>): void {
    moveItemInArray(this.noteBlocksDraft, event.previousIndex, event.currentIndex);
  }

  saveNote(projectId: string): void {
    const cleaned = this.noteBlocksDraft.filter((b) => b.value.trim().length > 0);
    this.userState.saveProjectNote(
      projectId,
      this.editingNoteId(),
      this.noteTitleDraft,
      cleaned
    );
    this.editingNoteOpen.set(false);
  }

  goToModel(id: string): void {
    this.router.navigate(['/models', id]);
  }

  goToColour(id: string): void {
    this.router.navigate(['/colours', id]);
  }
}
