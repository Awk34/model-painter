import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ModelRecipe, ProjectModelEntry, UserProject } from '../../../core/models/catalog.models';
import { CatalogService } from '../../../core/services/catalog.service';
import { ImageService } from '../../../core/services/image.service';
import { UserMediaService } from '../../../core/services/user-media.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { ProjectModelFeaturedImageModalComponent } from './project-model-featured-image-modal.component';

const SAMPLE_PROJECT: UserProject = {
  id: 'proj_1',
  name: 'Test Project',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  models: [],
  colorIds: [],
  notes: [],
  photos: [],
};

const SAMPLE_ENTRY: ProjectModelEntry = {
  id: 'pmod_1',
  recipeId: 'm1',
  quantity: 1,
  notes: '',
  completedStepIds: [],
  photos: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const SAMPLE_RECIPE: ModelRecipe = {
  id: 'm1',
  name: 'Intercessor',
  range: 'warhammer_colour',
  images: ['https://example.invalid/a.png', 'https://example.invalid/b.png'],
  localImagePaths: ['/data/a.png', '/data/b.png'],
  games: [],
  factions: [],
  colorPoints: [],
  paintingAreas: [],
};

describe('ProjectModelFeaturedImageModalComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectModelFeaturedImageModalComponent],
      providers: [
        {
          provide: CatalogService,
          useValue: {
            models: signal([]),
          },
        },
        {
          provide: UserStateService,
          useValue: {
            setProjectModelFeaturedImage: jasmine.createSpy('setProjectModelFeaturedImage'),
            uploadPhotos: jasmine.createSpy('uploadPhotos').and.resolveTo({ uploaded: [], errors: [] }),
          },
        },
        {
          provide: UserMediaService,
          useValue: {
            resolvePhotoUrl: () => '/icons/ic_image_loading_placeholder.svg',
          },
        },
        {
          provide: ImageService,
          useValue: {
            resolve: (local?: string | null, remote?: string | null) => local || remote || '',
          },
        },
      ],
    }).compileComponents();
  });

  it('opens in a native <dialog> with aria-labelledby, WAI-ARIA tablist keyboard nav, and labeled catalog search', () => {
    const fixture = TestBed.createComponent(ProjectModelFeaturedImageModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('project', SAMPLE_PROJECT);
    fixture.componentRef.setInput('entry', SAMPLE_ENTRY);
    fixture.componentRef.setInput('recipe', SAMPLE_RECIPE);
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.open).toBeTrue();
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(fixture.nativeElement.querySelector(`#${labelledBy}`)?.textContent?.trim()).toBe(
      'Choose Featured Image'
    );

    const tabs = Array.from(
      fixture.nativeElement.querySelectorAll('[role="tab"]')
    ) as HTMLButtonElement[];
    expect(tabs.length).toBe(3);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('aria-controls')).toBe('panel-featured-angles');

    let tabpanel = fixture.nativeElement.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(tabpanel.id).toBe('panel-featured-angles');
    expect(tabpanel.getAttribute('aria-labelledby')).toBe(tabs[0].id);

    // ArrowRight switches to 'uploaded'
    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTab()).toBe('uploaded');
    expect(document.activeElement).toBe(tabs[1]);

    // End jumps to 'catalog' and renders labeled search input
    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.activeTab()).toBe('catalog');
    tabpanel = fixture.nativeElement.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(tabpanel.id).toBe('panel-featured-catalog');

    const searchInput = fixture.nativeElement.querySelector('#featured-catalog-search') as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();
    expect(searchInput?.type).toBe('search');
    expect(searchInput?.labels?.length).toBe(1);
  });

  it('resets activeTab, catalogSearch, and uploadError when parent sets [open]="false" or entry changes', () => {
    const fixture = TestBed.createComponent(ProjectModelFeaturedImageModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('project', SAMPLE_PROJECT);
    fixture.componentRef.setInput('entry', SAMPLE_ENTRY);
    fixture.componentRef.setInput('recipe', SAMPLE_RECIPE);
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    comp.activeTab.set('catalog');
    comp.catalogSearch.set('intercessor');
    comp.uploadError.set('Upload failed');
    fixture.detectChanges();

    // Sibling update on the same entry.id while open must preserve draft state
    fixture.componentRef.setInput('entry', { ...SAMPLE_ENTRY, notes: 'Updated notes' });
    fixture.detectChanges();
    expect(comp.activeTab()).toBe('catalog');
    expect(comp.catalogSearch()).toBe('intercessor');
    expect(comp.uploadError()).toBe('Upload failed');

    // Parent-driven close [open]="false" must reset all draft state
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    expect(comp.activeTab()).toBe('angles');
    expect(comp.catalogSearch()).toBe('');
    expect(comp.uploadError()).toBeNull();

    // Reopen, dirty state again, and switch entry.id while open -> must reset
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    comp.activeTab.set('uploaded');
    comp.catalogSearch.set('dread');
    comp.uploadError.set('Another error');
    fixture.detectChanges();

    fixture.componentRef.setInput('entry', { ...SAMPLE_ENTRY, id: 'pmod_2' });
    fixture.detectChanges();
    expect(comp.activeTab()).toBe('angles');
    expect(comp.catalogSearch()).toBe('');
    expect(comp.uploadError()).toBeNull();
  });
});
