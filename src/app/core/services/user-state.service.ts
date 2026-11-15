import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CloudSyncStatus,
  ThirdPartyPaint,
  UserAccountState,
  UserPhotoKind,
  UserPhotoTargetType,
  UserPreferences,
  UserProject,
  UserProjectNote,
  UserProjectNoteComponent,
  UserUploadedPhoto,
} from '../models/catalog.models';
import { USER_LIMITS } from '../config/user-limits.config';
import { createEntityId } from '../utils/catalog-filter.util';
import { CatalogService } from './catalog.service';
import { getFirebaseHandles } from './firebase.config';
import { ImageService } from './image.service';
import { UserMediaService } from './user-media.service';
import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';

const STORAGE_KEY = 'whc_user_state_v1';
const DEFAULT_PROJECT_THUMBNAIL = 'assets/images/games/d8d81a80-7bf7-4fd3-8630-059a722a8bd7.png';

function createDefaultState(): UserAccountState {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    inventoryPaintIds: [],
    wishlistPaintIds: [],
    inventoryModelIds: [],
    wishlistModelIds: [],
    customPaints: [],
    customCompatibilityOverrides: {},
    projects: [],
    uploadedPhotos: [],
    preferences: {
      defaultRangeFilter: 'all',
      allowCompatibleSubstitutions: true,
      allowThirdPartySubstitutions: true,
      preferredThirdPartyBrands: [
        'The Army Painter',
        'Vallejo',
        'Two Thin Coats',
        'Monument Hobbies',
        'AK Interactive',
      ],
    },
  };
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function dedupeBoundedIds(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return Array.from(new Set(raw.map((id) => String(id)).filter(Boolean))).slice(0, max);
}

function extractIdArray(
  primaryIds: unknown,
  legacyObjects?: unknown
): string[] {
  if (Array.isArray(primaryIds)) {
    return primaryIds.map((id) => String(id));
  }
  if (Array.isArray(legacyObjects)) {
    return (legacyObjects as Record<string, unknown>[]).map((item) => String(item['id'] ?? ''));
  }
  return [];
}

function normalizeIncomingNote(
  rn: Record<string, unknown>,
  projectId: string,
  idx: number,
  defaultTimestamp: string
): UserProjectNote {
  const rawComps = Array.isArray(rn['components'])
    ? (rn['components'] as Record<string, unknown>[])
    : [];
  const components: UserProjectNoteComponent[] = rawComps
    .slice(0, USER_LIMITS.MAX_NOTE_BLOCKS_PER_NOTE)
    .map((rc) => ({
      type: rc['type'] === 'checkbox' ? 'checkbox' : 'text',
      value: String(rc['value'] ?? rc['text'] ?? '').slice(0, USER_LIMITS.MAX_NOTE_TEXT_LENGTH),
      checked: Boolean(rc['checked'] ?? false),
    }));

  return {
    id: String(rn['id'] ?? `note_${projectId}_${idx}`),
    title: String(rn['title'] ?? rn['name'] ?? 'Project Note').slice(
      0,
      USER_LIMITS.MAX_TITLE_LENGTH
    ),
    createdAt: String(rn['createdAt'] ?? defaultTimestamp),
    updatedAt: String(rn['updatedAt'] ?? defaultTimestamp),
    components,
  };
}

function normalizeIncomingProject(rp: Record<string, unknown>): UserProject {
  const id = String(rp['id'] ?? createEntityId('proj'));
  const name = String(rp['name'] ?? 'Imported Project').slice(0, USER_LIMITS.MAX_TITLE_LENGTH);
  const createdAt = String(rp['createdAt'] ?? new Date().toISOString());
  const updatedAt = String(rp['updatedAt'] ?? createdAt);

  const recipeIds = extractIdArray(rp['recipeIds'], rp['recipes']);
  const colorIds = Array.isArray(rp['colorIds'])
    ? (rp['colorIds'] as string[])
    : Array.isArray(rp['colourIds'])
    ? (rp['colourIds'] as string[])
    : extractIdArray(undefined, rp['colors'] ?? rp['colours']);

  const rawNotes = Array.isArray(rp['notes']) ? (rp['notes'] as Record<string, unknown>[]) : [];
  const notes = rawNotes
    .slice(0, USER_LIMITS.MAX_NOTES_PER_PROJECT)
    .map((rn, idx) => normalizeIncomingNote(rn, id, idx, updatedAt));

  const firstRecipe = Array.isArray(rp['recipes'])
    ? (rp['recipes'][0] as Record<string, unknown> | undefined)
    : undefined;
  const firstRecipeImg = Array.isArray(firstRecipe?.['images'])
    ? (firstRecipe['images'][0] as string | undefined)
    : undefined;
  const firstRecipeLocalImg = Array.isArray(firstRecipe?.['localImagePaths'])
    ? (firstRecipe['localImagePaths'][0] as string | undefined)
    : undefined;

  const thumbUrl = rp['thumbnailUrl'] ?? rp['imageUrl'] ?? firstRecipeImg;
  const localThumb = rp['localThumbnailPath'] ?? rp['localImagePath'] ?? firstRecipeLocalImg;
  const coverPhotoId = rp['coverPhotoId'] ? String(rp['coverPhotoId']) : undefined;

  return {
    id,
    name,
    thumbnailUrl: thumbUrl ? String(thumbUrl) : undefined,
    localThumbnailPath: localThumb ? String(localThumb) : undefined,
    coverPhotoId,
    createdAt,
    updatedAt,
    recipeIds: dedupeBoundedIds(recipeIds, USER_LIMITS.MAX_MODELS_PER_PROJECT),
    colorIds: dedupeBoundedIds(colorIds, USER_LIMITS.MAX_COLORS_PER_PROJECT),
    notes,
  };
}

function normalizeAccountState(raw: Partial<UserAccountState>): UserAccountState {
  const def = createDefaultState();
  const rawProjects = Array.isArray(raw.projects)
    ? (raw.projects as unknown as Record<string, unknown>[])
    : [];
  const rawPhotos = Array.isArray(raw.uploadedPhotos) ? raw.uploadedPhotos : [];

  return {
    schemaVersion: 1,
    updatedAt: raw.updatedAt ?? def.updatedAt,
    inventoryPaintIds: dedupeBoundedIds(raw.inventoryPaintIds, USER_LIMITS.MAX_INVENTORY_PAINTS),
    wishlistPaintIds: dedupeBoundedIds(raw.wishlistPaintIds, USER_LIMITS.MAX_WISHLIST_PAINTS),
    inventoryModelIds: dedupeBoundedIds(raw.inventoryModelIds, USER_LIMITS.MAX_INVENTORY_MODELS),
    wishlistModelIds: dedupeBoundedIds(raw.wishlistModelIds, USER_LIMITS.MAX_WISHLIST_MODELS),
    customPaints: Array.isArray(raw.customPaints)
      ? raw.customPaints.slice(0, USER_LIMITS.MAX_CUSTOM_PAINTS)
      : [],
    customCompatibilityOverrides:
      raw.customCompatibilityOverrides && typeof raw.customCompatibilityOverrides === 'object'
        ? raw.customCompatibilityOverrides
        : {},
    projects: rawProjects
      .slice(0, USER_LIMITS.MAX_PROJECTS)
      .map((p) => normalizeIncomingProject(p)),
    uploadedPhotos: rawPhotos
      .filter((ph): ph is UserUploadedPhoto => Boolean(ph && ph.id))
      .slice(0, USER_LIMITS.MAX_TOTAL_USER_PHOTOS)
      .map((ph) => ({
        ...ph,
        isPrivate: ph.kind === 'reference' ? true : Boolean(ph.isPrivate ?? true),
      })),
    preferences: {
      ...def.preferences,
      ...(raw.preferences ?? {}),
    },
  };
}

@Injectable({
  providedIn: 'root',
})
export class UserStateService {
  readonly media = inject(UserMediaService);
  private readonly catalog = inject(CatalogService);
  private readonly img = inject(ImageService);
  readonly limits = USER_LIMITS;

  readonly state = signal<UserAccountState>(this.loadInitialState());
  readonly currentUser = signal<User | null>(null);
  readonly cloudSyncStatus = signal<CloudSyncStatus>(CloudSyncStatus.LocalOnly);
  readonly toastMessage = signal<string | null>(null);

  /** Fast reactive sets and maps for O(1) lookup */
  readonly inventorySet = computed(() => new Set(this.state().inventoryPaintIds));
  readonly wishlistSet = computed(() => new Set(this.state().wishlistPaintIds));
  readonly modelInventorySet = computed(() => new Set(this.state().inventoryModelIds));
  readonly modelWishlistSet = computed(() => new Set(this.state().wishlistModelIds));
  readonly projects = computed(() => this.state().projects);
  readonly uploadedPhotos = computed(() => this.state().uploadedPhotos);
  readonly preferences = computed(() => this.state().preferences);
  readonly customPaints = computed(() => this.state().customPaints);
  readonly customPaintById = computed(
    () => new Map(this.customPaints().map((paint) => [paint.id, paint]))
  );
  readonly customCompatibilityOverrides = computed(
    () => this.state().customCompatibilityOverrides
  );

  private unsubscribeFirestore: (() => void) | null = null;

  constructor() {
    this.initAuthListener();
  }

  private loadInitialState(): UserAccountState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return createDefaultState();
      }
      const parsed = JSON.parse(raw) as Partial<UserAccountState>;
      return normalizeAccountState(parsed);
    } catch {
      return createDefaultState();
    }
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => {
      if (this.toastMessage() === msg) {
        this.toastMessage.set(null);
      }
    }, 3500);
  }

  private commit(updater: (prev: UserAccountState) => UserAccountState, syncCloud = true): void {
    const next = updater(this.state());
    next.updatedAt = new Date().toISOString();
    this.state.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('Failed to persist user state to localStorage:', e);
    }
    if (syncCloud && this.currentUser()) {
      void this.pushStateToFirestore(next);
    }
  }

  private toggleBoundedSetItem(params: {
    id: string;
    primaryKey: 'inventoryPaintIds' | 'wishlistPaintIds' | 'inventoryModelIds' | 'wishlistModelIds';
    clearFromKey?: 'wishlistPaintIds' | 'wishlistModelIds';
    maxLimit: number;
    limitLabel: string;
  }): void {
    const currentList = this.state()[params.primaryKey];
    const isPresent = currentList.includes(params.id);
    if (!isPresent && currentList.length >= params.maxLimit) {
      this.showToast(`${params.limitLabel} limit reached (${params.maxLimit} max).`);
      return;
    }

    this.commit((prev) => {
      const primarySet = new Set(prev[params.primaryKey]);
      if (primarySet.has(params.id)) {
        primarySet.delete(params.id);
        return {
          ...prev,
          [params.primaryKey]: Array.from(primarySet),
        };
      }

      primarySet.add(params.id);
      if (!params.clearFromKey) {
        return {
          ...prev,
          [params.primaryKey]: Array.from(primarySet),
        };
      }

      const secondarySet = new Set(prev[params.clearFromKey]);
      secondarySet.delete(params.id);
      return {
        ...prev,
        [params.primaryKey]: Array.from(primarySet),
        [params.clearFromKey]: Array.from(secondarySet),
      };
    });
  }

  private updateProjectById(
    projectId: string,
    updater: (project: UserProject, now: string) => UserProject
  ): void {
    const now = new Date().toISOString();
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => (p.id === projectId ? updater(p, now) : p)),
    }));
  }

  /* ========================================================================
     INVENTORY & WISHLIST ACTIONS (WITH QUOTA LIMITS)
     ======================================================================== */

  isOwned(paintId: string): boolean {
    return this.inventorySet().has(paintId);
  }

  isWishlisted(paintId: string): boolean {
    return this.wishlistSet().has(paintId);
  }

  toggleInventory(paintId: string): void {
    this.toggleBoundedSetItem({
      id: paintId,
      primaryKey: 'inventoryPaintIds',
      clearFromKey: 'wishlistPaintIds',
      maxLimit: USER_LIMITS.MAX_INVENTORY_PAINTS,
      limitLabel: 'Paint Inventory',
    });
  }

  toggleWishlist(paintId: string): void {
    this.toggleBoundedSetItem({
      id: paintId,
      primaryKey: 'wishlistPaintIds',
      maxLimit: USER_LIMITS.MAX_WISHLIST_PAINTS,
      limitLabel: 'Paint Wishlist',
    });
  }

  addManyToWishlist(paintIds: string[]): number {
    let added = 0;
    let hitLimit = false;
    this.commit((prev) => {
      const inv = new Set(prev.inventoryPaintIds);
      const wish = new Set(prev.wishlistPaintIds);
      for (const pid of paintIds) {
        if (!inv.has(pid) && !wish.has(pid)) {
          if (wish.size >= USER_LIMITS.MAX_WISHLIST_PAINTS) {
            hitLimit = true;
            break;
          }
          wish.add(pid);
          added++;
        }
      }
      return {
        ...prev,
        wishlistPaintIds: Array.from(wish),
      };
    });

    if (hitLimit) {
      this.showToast(
        `Added ${added} paint${added === 1 ? '' : 's'} (Wishlist limit of ${USER_LIMITS.MAX_WISHLIST_PAINTS} reached)`
      );
    } else if (added > 0) {
      this.showToast(`Added ${added} missing paint${added > 1 ? 's' : ''} to your Wishlist`);
    } else {
      this.showToast('All missing paints are already on your Wishlist');
    }
    return added;
  }

  addManyToInventory(paintIds: string[]): number {
    let added = 0;
    let hitLimit = false;
    this.commit((prev) => {
      const inv = new Set(prev.inventoryPaintIds);
      const wish = new Set(prev.wishlistPaintIds);
      for (const pid of paintIds) {
        if (!inv.has(pid)) {
          if (inv.size >= USER_LIMITS.MAX_INVENTORY_PAINTS) {
            hitLimit = true;
            break;
          }
          inv.add(pid);
          wish.delete(pid);
          added++;
        }
      }
      return {
        ...prev,
        inventoryPaintIds: Array.from(inv),
        wishlistPaintIds: Array.from(wish),
      };
    });

    if (hitLimit) {
      this.showToast(
        `Added ${added} paint${added === 1 ? '' : 's'} (Inventory limit of ${USER_LIMITS.MAX_INVENTORY_PAINTS} reached)`
      );
    } else if (added > 0) {
      this.showToast(`Added ${added} paint${added > 1 ? 's' : ''} to your Inventory`);
    }
    return added;
  }

  /* ========================================================================
     MODEL INVENTORY & WISHLIST ACTIONS (WITH QUOTA LIMITS)
     ======================================================================== */

  isModelOwned(modelId: string): boolean {
    return this.modelInventorySet().has(modelId);
  }

  isModelWishlisted(modelId: string): boolean {
    return this.modelWishlistSet().has(modelId);
  }

  toggleModelInventory(modelId: string): void {
    this.toggleBoundedSetItem({
      id: modelId,
      primaryKey: 'inventoryModelIds',
      clearFromKey: 'wishlistModelIds',
      maxLimit: USER_LIMITS.MAX_INVENTORY_MODELS,
      limitLabel: 'Model Inventory',
    });
  }

  toggleModelWishlist(modelId: string): void {
    this.toggleBoundedSetItem({
      id: modelId,
      primaryKey: 'wishlistModelIds',
      maxLimit: USER_LIMITS.MAX_WISHLIST_MODELS,
      limitLabel: 'Model Wishlist',
    });
  }

  /* ========================================================================
     PROJECTS & NOTES ACTIONS (WITH QUOTA LIMITS)
     ======================================================================== */

  resolveProjectCoverUrl(
    proj: Pick<
      UserProject,
      'id' | 'coverPhotoId' | 'localThumbnailPath' | 'thumbnailUrl' | 'recipeIds'
    >
  ): string {
    if (proj.coverPhotoId) {
      const customCover = this.getPhotoById(proj.coverPhotoId);
      if (customCover && customCover.kind === 'showcase') {
        const resolved = this.media.resolvePhotoUrl(customCover);
        if (resolved) {
          return resolved;
        }
      }
    }

    const showcaseFallback = this.getPhotosForTarget('project', proj.id, 'showcase')[0];
    if (showcaseFallback) {
      const resolved = this.media.resolvePhotoUrl(showcaseFallback);
      if (resolved) {
        return resolved;
      }
    }

    if (proj.localThumbnailPath || proj.thumbnailUrl) {
      return this.img.resolve(proj.localThumbnailPath, proj.thumbnailUrl);
    }

    const firstModelId = proj.recipeIds[0];
    if (firstModelId) {
      const firstModel = this.catalog.modelById().get(firstModelId);
      if (firstModel) {
        return this.img.resolve(firstModel.localPrimaryImage, firstModel.primaryImage);
      }
    }

    return '/icons/ic_project.svg';
  }

  getTargetPhotoCount(targetType: UserPhotoTargetType, targetId: string): number {
    return (
      this.getPhotosForTarget(targetType, targetId, 'showcase').length +
      this.getPhotosForTarget(targetType, targetId, 'reference').length
    );
  }

  createProject(
    name: string,
    thumbnailUrl?: string,
    localThumbnailPath?: string
  ): UserProject | null {
    if (this.state().projects.length >= USER_LIMITS.MAX_PROJECTS) {
      this.showToast(`Project limit reached (${USER_LIMITS.MAX_PROJECTS} projects max).`);
      return null;
    }
    const now = new Date().toISOString();
    const safeName = (name.trim() || 'Untitled Project').slice(0, USER_LIMITS.MAX_TITLE_LENGTH);
    const project: UserProject = {
      id: createEntityId('proj'),
      name: safeName,
      thumbnailUrl: thumbnailUrl || '',
      localThumbnailPath: localThumbnailPath || DEFAULT_PROJECT_THUMBNAIL,
      createdAt: now,
      updatedAt: now,
      recipeIds: [],
      colorIds: [],
      notes: [],
    };
    this.commit((prev) => ({
      ...prev,
      projects: [project, ...prev.projects],
    }));
    this.showToast(`Created project "${project.name}"`);
    return project;
  }

  renameProject(projectId: string, newName: string): void {
    const trimmed = newName.trim().slice(0, USER_LIMITS.MAX_TITLE_LENGTH);
    if (!trimmed) {
      return;
    }
    this.updateProjectById(projectId, (p, now) => ({
      ...p,
      name: trimmed,
      updatedAt: now,
    }));
  }

  setProjectThumbnail(projectId: string, localThumbnailPath: string, thumbnailUrl?: string): void {
    this.updateProjectById(projectId, (p, now) => ({
      ...p,
      coverPhotoId: undefined,
      localThumbnailPath,
      thumbnailUrl: thumbnailUrl ?? p.thumbnailUrl,
      updatedAt: now,
    }));
    this.showToast('Updated project thumbnail');
  }

  setProjectCoverPhoto(projectId: string, photoId: string | undefined): void {
    this.updateProjectById(projectId, (p, now) => ({
      ...p,
      coverPhotoId: photoId,
      updatedAt: now,
    }));
    this.showToast(photoId ? 'Set photo as project cover' : 'Cleared custom cover photo');
  }

  duplicateProject(projectId: string): UserProject | null {
    if (this.state().projects.length >= USER_LIMITS.MAX_PROJECTS) {
      this.showToast(`Project limit reached (${USER_LIMITS.MAX_PROJECTS} projects max).`);
      return null;
    }
    const orig = this.state().projects.find((p) => p.id === projectId);
    if (!orig) {
      return null;
    }
    const now = new Date().toISOString();
    const copy: UserProject = {
      ...structuredClone(orig),
      id: createEntityId('proj'),
      name: `${orig.name} (Copy)`.slice(0, USER_LIMITS.MAX_TITLE_LENGTH),
      coverPhotoId: undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.commit((prev) => ({
      ...prev,
      projects: [copy, ...prev.projects],
    }));
    this.showToast(`Duplicated "${orig.name}"`);
    return copy;
  }

  deleteProject(projectId: string): void {
    const projectPhotos = this.state().uploadedPhotos.filter(
      (ph) => ph.targetType === 'project' && ph.targetId === projectId
    );
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.filter((p) => p.id !== projectId),
      uploadedPhotos: prev.uploadedPhotos.filter(
        (ph) => !(ph.targetType === 'project' && ph.targetId === projectId)
      ),
    }));
    for (const ph of projectPhotos) {
      void this.media.deletePhotoAssets(ph);
    }
    this.showToast('Deleted project');
  }

  addRecipeToProject(projectId: string, recipeId: string, modelImageLocal?: string): void {
    const target = this.state().projects.find((p) => p.id === projectId);
    if (!target) {
      return;
    }
    if (
      !target.recipeIds.includes(recipeId) &&
      target.recipeIds.length >= USER_LIMITS.MAX_MODELS_PER_PROJECT
    ) {
      this.showToast(
        `Project model limit reached (${USER_LIMITS.MAX_MODELS_PER_PROJECT} models per project max).`
      );
      return;
    }
    this.updateProjectById(projectId, (p, now) => {
      const set = new Set(p.recipeIds);
      set.add(recipeId);
      return {
        ...p,
        recipeIds: Array.from(set),
        localThumbnailPath: p.localThumbnailPath || modelImageLocal,
        updatedAt: now,
      };
    });
    this.showToast('Added model guide to project');
  }

  removeRecipeFromProject(projectId: string, recipeId: string): void {
    this.updateProjectById(projectId, (p, now) => ({
      ...p,
      recipeIds: p.recipeIds.filter((id) => id !== recipeId),
      updatedAt: now,
    }));
  }

  addColorToProject(projectId: string, colorId: string): void {
    const target = this.state().projects.find((p) => p.id === projectId);
    if (!target) {
      return;
    }
    if (
      !target.colorIds.includes(colorId) &&
      target.colorIds.length >= USER_LIMITS.MAX_COLORS_PER_PROJECT
    ) {
      this.showToast(
        `Project color limit reached (${USER_LIMITS.MAX_COLORS_PER_PROJECT} colors per project max).`
      );
      return;
    }
    this.updateProjectById(projectId, (p, now) => {
      const set = new Set(p.colorIds);
      set.add(colorId);
      return {
        ...p,
        colorIds: Array.from(set),
        updatedAt: now,
      };
    });
    this.showToast('Added color guide to project');
  }

  removeColorFromProject(projectId: string, colorId: string): void {
    this.updateProjectById(projectId, (p, now) => ({
      ...p,
      colorIds: p.colorIds.filter((id) => id !== colorId),
      updatedAt: now,
    }));
  }

  saveProjectNote(
    projectId: string,
    noteId: string | null,
    title: string,
    components: UserProjectNoteComponent[]
  ): void {
    const target = this.state().projects.find((p) => p.id === projectId);
    if (!target) {
      return;
    }
    if (!noteId && target.notes.length >= USER_LIMITS.MAX_NOTES_PER_PROJECT) {
      this.showToast(
        `Project notes limit reached (${USER_LIMITS.MAX_NOTES_PER_PROJECT} notes per project max).`
      );
      return;
    }

    const safeComponents = components
      .slice(0, USER_LIMITS.MAX_NOTE_BLOCKS_PER_NOTE)
      .map((c) => ({
        ...c,
        value: c.value.slice(0, USER_LIMITS.MAX_NOTE_TEXT_LENGTH),
      }));
    const safeTitle = (title.trim() || (noteId ? 'Untitled Note' : 'Hobby Note')).slice(
      0,
      USER_LIMITS.MAX_TITLE_LENGTH
    );

    this.updateProjectById(projectId, (p, now) => {
      let nextNotes: UserProjectNote[];
      if (noteId) {
        nextNotes = p.notes.map((n) =>
          n.id === noteId
            ? { ...n, title: safeTitle, updatedAt: now, components: safeComponents }
            : n
        );
      } else {
        const newNote: UserProjectNote = {
          id: createEntityId('note'),
          title: safeTitle,
          createdAt: now,
          updatedAt: now,
          components: safeComponents,
        };
        nextNotes = [newNote, ...p.notes];
      }
      return {
        ...p,
        notes: nextNotes,
        updatedAt: now,
      };
    });
  }

  toggleNoteCheckbox(projectId: string, noteId: string, componentIndex: number): void {
    this.updateProjectById(projectId, (p, now) => ({
      ...p,
      updatedAt: now,
      notes: p.notes.map((n) => {
        if (n.id !== noteId) {
          return n;
        }
        const comps = n.components.map((c, idx) =>
          idx === componentIndex ? { ...c, checked: !c.checked } : c
        );
        return { ...n, updatedAt: now, components: comps };
      }),
    }));
  }

  deleteProjectNote(projectId: string, noteId: string): void {
    this.updateProjectById(projectId, (p, now) => ({
      ...p,
      notes: p.notes.filter((n) => n.id !== noteId),
      updatedAt: now,
    }));
  }

  /* ========================================================================
     USER-UPLOADED PHOTOS (PAINTED SHOWCASE & PRIVATE REFERENCE PHOTOS)
     ======================================================================== */

  getPhotoQuotaLimit(targetType: UserPhotoTargetType, kind: UserPhotoKind): number {
    if (targetType === 'model') {
      return kind === 'reference'
        ? USER_LIMITS.MAX_MODEL_REFERENCE_PHOTOS
        : USER_LIMITS.MAX_MODEL_SHOWCASE_PHOTOS;
    }
    return kind === 'reference'
      ? USER_LIMITS.MAX_PROJECT_REFERENCE_PHOTOS
      : USER_LIMITS.MAX_PROJECT_SHOWCASE_PHOTOS;
  }

  getPhotosForTarget(
    targetType: UserPhotoTargetType,
    targetId: string,
    kind: UserPhotoKind
  ): UserUploadedPhoto[] {
    return this.uploadedPhotos().filter(
      (ph) => ph.targetType === targetType && ph.targetId === targetId && ph.kind === kind
    );
  }

  getPhotoById(photoId?: string): UserUploadedPhoto | undefined {
    if (!photoId) {
      return undefined;
    }
    return this.uploadedPhotos().find((ph) => ph.id === photoId);
  }

  async uploadPhotos(params: {
    files: File[];
    targetType: UserPhotoTargetType;
    targetId: string;
    kind: UserPhotoKind;
    caption?: string;
  }): Promise<{ uploaded: UserUploadedPhoto[]; errors: string[] }> {
    const { files, targetType, targetId, kind } = params;
    const uploaded: UserUploadedPhoto[] = [];
    const errors: string[] = [];
    if (!files.length || !targetId) {
      return { uploaded, errors };
    }

    const sectionLimit = this.getPhotoQuotaLimit(targetType, kind);
    let remainingSectionSlots = Math.max(
      0,
      sectionLimit - this.getPhotosForTarget(targetType, targetId, kind).length
    );
    let remainingAccountSlots = Math.max(
      0,
      USER_LIMITS.MAX_TOTAL_USER_PHOTOS - this.uploadedPhotos().length
    );

    if (remainingSectionSlots === 0) {
      const label = kind === 'reference' ? 'private reference' : 'painted';
      errors.push(`Maximum of ${sectionLimit} ${label} photos reached for this ${targetType}.`);
      return { uploaded, errors };
    }
    if (remainingAccountSlots === 0) {
      errors.push(
        `Account photo storage limit reached (${USER_LIMITS.MAX_TOTAL_USER_PHOTOS} photos total). Delete an existing photo first.`
      );
      return { uploaded, errors };
    }

    const safeCaption = params.caption
      ? params.caption.trim().slice(0, USER_LIMITS.MAX_PHOTO_CAPTION_LENGTH)
      : undefined;
    const uid = this.currentUser()?.uid;
    let downscaledCount = 0;

    for (const file of files) {
      if (remainingSectionSlots <= 0) {
        errors.push(
          `Skipped "${file.name}": limit of ${sectionLimit} photos reached for this section.`
        );
        continue;
      }
      if (remainingAccountSlots <= 0) {
        errors.push(
          `Skipped "${file.name}": account limit of ${USER_LIMITS.MAX_TOTAL_USER_PHOTOS} total photos reached.`
        );
        continue;
      }

      try {
        const result = await this.uploadSingleValidatedPhoto({
          file,
          targetType,
          targetId,
          kind,
          caption: safeCaption || undefined,
          uid,
        });
        if (result.wasDownscaled) {
          downscaledCount++;
        }
        uploaded.push(result.photo);
        remainingSectionSlots--;
        remainingAccountSlots--;
      } catch (err: unknown) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (uploaded.length > 0) {
      this.commit((prev) => ({
        ...prev,
        uploadedPhotos: [...uploaded, ...prev.uploadedPhotos].slice(
          0,
          USER_LIMITS.MAX_TOTAL_USER_PHOTOS
        ),
      }));
      const resizeNote =
        downscaledCount > 0
          ? ` (${downscaledCount} auto-downscaled to ≤ ${USER_LIMITS.MAX_PHOTO_FILE_SIZE_MB} MB)`
          : '';
      this.showToast(
        `Uploaded ${uploaded.length} ${kind === 'reference' ? 'private reference ' : ''}photo${
          uploaded.length > 1 ? 's' : ''
        }${resizeNote}`
      );
    }

    return { uploaded, errors };
  }

  private async uploadSingleValidatedPhoto(params: {
    file: File;
    targetType: UserPhotoTargetType;
    targetId: string;
    kind: UserPhotoKind;
    caption?: string;
    uid?: string;
  }): Promise<{ photo: UserUploadedPhoto; wasDownscaled: boolean }> {
    const info = await this.media.validateImageFile(params.file);
    const photoId = createEntityId('ph');
    const safeFileName = params.file.name.replace(/[^\w.\- ]/g, '_').slice(0, 100) || 'photo.jpg';

    const photo: UserUploadedPhoto = {
      id: photoId,
      targetType: params.targetType,
      targetId: params.targetId,
      kind: params.kind,
      isPrivate: true,
      fileName: safeFileName,
      mimeType: info.mimeType,
      sizeBytes: info.blob.size,
      width: info.width,
      height: info.height,
      caption: params.caption,
      createdAt: new Date().toISOString(),
    };

    await this.media.storeLocalBlob(photoId, info.blob);

    if (params.uid) {
      const storagePath = await this.media.uploadToCloudStorage(photo, info.blob, params.uid);
      if (storagePath) {
        photo.storagePath = storagePath;
      }
    }

    return { photo, wasDownscaled: info.wasDownscaled };
  }

  updatePhotoCaption(photoId: string, caption: string): void {
    const cleaned = caption.trim().slice(0, USER_LIMITS.MAX_PHOTO_CAPTION_LENGTH);
    this.commit((prev) => ({
      ...prev,
      uploadedPhotos: prev.uploadedPhotos.map((ph) =>
        ph.id === photoId ? { ...ph, caption: cleaned || undefined } : ph
      ),
    }));
    this.showToast('Saved photo caption');
  }

  async deleteUserPhoto(photoId: string): Promise<void> {
    const target = this.getPhotoById(photoId);
    if (!target) {
      return;
    }

    const now = new Date().toISOString();
    this.commit((prev) => ({
      ...prev,
      uploadedPhotos: prev.uploadedPhotos.filter((ph) => ph.id !== photoId),
      projects: prev.projects.map((p) =>
        p.coverPhotoId === photoId ? { ...p, coverPhotoId: undefined, updatedAt: now } : p
      ),
    }));

    await this.media.deletePhotoAssets(target);
    this.showToast('Deleted photo');
  }

  /* ========================================================================
     CUSTOM 3RD-PARTY PAINTS & OVERRIDES (WITH QUOTA LIMITS)
     ======================================================================== */

  addCustomPaint(paint: Omit<ThirdPartyPaint, 'id' | 'isCustom'>): ThirdPartyPaint | null {
    if (this.state().customPaints.length >= USER_LIMITS.MAX_CUSTOM_PAINTS) {
      this.showToast(
        `Custom Paints limit reached (${USER_LIMITS.MAX_CUSTOM_PAINTS} custom paints max).`
      );
      return null;
    }
    const created: ThirdPartyPaint = {
      ...paint,
      name: paint.name.trim().slice(0, USER_LIMITS.MAX_TITLE_LENGTH),
      brand: paint.brand.trim().slice(0, USER_LIMITS.MAX_TITLE_LENGTH),
      range: paint.range.trim().slice(0, USER_LIMITS.MAX_TITLE_LENGTH),
      id: createEntityId('custom'),
      isCustom: true,
    };
    this.commit((prev) => {
      const nextOverrides = { ...prev.customCompatibilityOverrides };
      for (const m of created.citadelMatches) {
        const existingKeys = Object.keys(nextOverrides);
        if (
          !nextOverrides[m.citadelPaintId] &&
          existingKeys.length >= USER_LIMITS.MAX_COMPATIBILITY_OVERRIDE_KEYS
        ) {
          continue;
        }
        const list = new Set(nextOverrides[m.citadelPaintId] ?? []);
        if (list.size < USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT) {
          list.add(created.id);
          nextOverrides[m.citadelPaintId] = Array.from(list);
        }
      }
      return {
        ...prev,
        customPaints: [created, ...prev.customPaints],
        customCompatibilityOverrides: nextOverrides,
      };
    });
    this.showToast(`Added custom paint "${created.name}"`);
    return created;
  }

  linkCustomEquivalent(citadelPaintId: string, equivalentPaintId: string): void {
    const currentOverrides = this.state().customCompatibilityOverrides;
    const existingList = currentOverrides[citadelPaintId] ?? [];
    if (
      !currentOverrides[citadelPaintId] &&
      Object.keys(currentOverrides).length >= USER_LIMITS.MAX_COMPATIBILITY_OVERRIDE_KEYS
    ) {
      this.showToast(
        `Equivalence override limit reached (${USER_LIMITS.MAX_COMPATIBILITY_OVERRIDE_KEYS} paints max).`
      );
      return;
    }
    if (
      !existingList.includes(equivalentPaintId) &&
      existingList.length >= USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT
    ) {
      this.showToast(
        `Maximum of ${USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT} custom equivalents per paint reached.`
      );
      return;
    }
    this.commit((prev) => {
      const nextOverrides = { ...prev.customCompatibilityOverrides };
      const list = new Set(nextOverrides[citadelPaintId] ?? []);
      list.add(equivalentPaintId);
      nextOverrides[citadelPaintId] = Array.from(list);
      return {
        ...prev,
        customCompatibilityOverrides: nextOverrides,
      };
    });
    this.showToast('Saved custom paint equivalence link');
  }

  updatePreferences(patch: Partial<UserPreferences>): void {
    this.commit((prev) => ({
      ...prev,
      preferences: {
        ...prev.preferences,
        ...patch,
      },
    }));
  }

  /* ========================================================================
     ACCOUNT SNAPSHOT / BACKUP IMPORT & EXPORT
     ======================================================================== */

  importAccountPayload(
    rawPayload: Record<string, unknown>,
    mode: 'merge' | 'replace' = 'merge'
  ): void {
    this.commit((prev) => {
      const base = mode === 'replace' ? createDefaultState() : prev;
      const incoming = normalizeAccountState(rawPayload as Partial<UserAccountState>);

      const invSet = new Set([...base.inventoryPaintIds, ...incoming.inventoryPaintIds]);
      const wishSet = new Set([...base.wishlistPaintIds, ...incoming.wishlistPaintIds]);
      for (const id of invSet) {
        wishSet.delete(id);
      }

      const modelInvSet = new Set([...base.inventoryModelIds, ...incoming.inventoryModelIds]);
      const modelWishSet = new Set([...base.wishlistModelIds, ...incoming.wishlistModelIds]);
      for (const id of modelInvSet) {
        modelWishSet.delete(id);
      }

      const projectMap = new Map<string, UserProject>();
      for (const p of base.projects) {
        projectMap.set(p.id, p);
      }
      for (const incomingP of incoming.projects) {
        if (projectMap.has(incomingP.id) || projectMap.size < USER_LIMITS.MAX_PROJECTS) {
          projectMap.set(incomingP.id, incomingP);
        }
      }

      const customPaintMap = new Map<string, ThirdPartyPaint>();
      for (const cp of [...base.customPaints, ...incoming.customPaints]) {
        if (customPaintMap.has(cp.id) || customPaintMap.size < USER_LIMITS.MAX_CUSTOM_PAINTS) {
          customPaintMap.set(cp.id, cp);
        }
      }

      const photoMap = new Map<string, UserUploadedPhoto>();
      for (const ph of [...base.uploadedPhotos, ...incoming.uploadedPhotos]) {
        if (photoMap.has(ph.id) || photoMap.size < USER_LIMITS.MAX_TOTAL_USER_PHOTOS) {
          photoMap.set(ph.id, { ...ph, isPrivate: true });
        }
      }

      return {
        ...base,
        inventoryPaintIds: Array.from(invSet).slice(0, USER_LIMITS.MAX_INVENTORY_PAINTS),
        wishlistPaintIds: Array.from(wishSet).slice(0, USER_LIMITS.MAX_WISHLIST_PAINTS),
        inventoryModelIds: Array.from(modelInvSet).slice(0, USER_LIMITS.MAX_INVENTORY_MODELS),
        wishlistModelIds: Array.from(modelWishSet).slice(0, USER_LIMITS.MAX_WISHLIST_MODELS),
        customPaints: Array.from(customPaintMap.values()),
        projects: Array.from(projectMap.values()),
        uploadedPhotos: Array.from(photoMap.values()),
      };
    });

    this.showToast(
      `Imported account data (${this.state().inventoryPaintIds.length} owned, ${this.state().wishlistPaintIds.length} wishlist, ${this.state().projects.length} projects)`
    );
  }

  async loadExtractedAccountSnapshot(mode: 'merge' | 'replace' = 'merge'): Promise<void> {
    const resp = await fetch('/data/user_account_snapshot.json');
    if (!resp.ok) {
      throw new Error(`Could not load /data/user_account_snapshot.json (${resp.status})`);
    }
    const data = (await resp.json()) as Record<string, unknown>;
    this.importAccountPayload(data, mode);
  }

  exportBackupJson(): void {
    const dataStr = JSON.stringify(this.state(), null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `model_painter_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('Exported JSON backup');
  }

  resetLocalData(): void {
    const fresh = createDefaultState();
    this.state.set(fresh);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    void this.media.clearAllLocalMedia();
    this.showToast('Reset local browser data to a blank slate');
  }

  /* ========================================================================
     OPTIONAL FIREBASE AUTH & CLOUD FIRESTORE SYNC (`users/{uid}`)
     ======================================================================== */

  initAuthListener(): void {
    const fb = getFirebaseHandles();
    if (!fb) {
      this.cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
      return;
    }
    onAuthStateChanged(fb.auth, async (user) => {
      this.currentUser.set(user);
      if (this.unsubscribeFirestore) {
        this.unsubscribeFirestore();
        this.unsubscribeFirestore = null;
      }
      if (user) {
        this.cloudSyncStatus.set(CloudSyncStatus.Syncing);
        const userDocRef = doc(fb.db, 'users', user.uid);
        try {
          const snap = await getDoc(userDocRef);
          if (snap.exists()) {
            this.importAccountPayload(snap.data() as Record<string, unknown>, 'merge');
          }
          const uploadedMap = await this.media.syncPendingBlobsToCloud(
            this.state().uploadedPhotos,
            user.uid
          );
          if (uploadedMap.size > 0) {
            this.commit(
              (prev) => ({
                ...prev,
                uploadedPhotos: prev.uploadedPhotos.map((ph) =>
                  uploadedMap.has(ph.id) ? { ...ph, storagePath: uploadedMap.get(ph.id) } : ph
                ),
              }),
              false
            );
          }
          await this.pushStateToFirestore(this.state());
          this.unsubscribeFirestore = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
              const remote = docSnap.data() as Partial<UserAccountState>;
              if (remote.updatedAt && remote.updatedAt > this.state().updatedAt) {
                const normalized = normalizeAccountState(remote);
                this.state.set(normalized);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
              }
            }
          });
          this.cloudSyncStatus.set(CloudSyncStatus.Synced);
        } catch (err) {
          console.warn('Firestore user sync failed:', err);
          this.cloudSyncStatus.set(CloudSyncStatus.Error);
        }
      } else {
        this.cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
      }
    });
  }

  private async pushStateToFirestore(stateToSave: UserAccountState): Promise<void> {
    const fb = getFirebaseHandles();
    const user = this.currentUser();
    if (!fb || !user) {
      return;
    }
    try {
      this.cloudSyncStatus.set(CloudSyncStatus.Syncing);
      const cleaned = stripUndefinedDeep(stateToSave);
      await setDoc(doc(fb.db, 'users', user.uid), cleaned, { merge: true });
      this.cloudSyncStatus.set(CloudSyncStatus.Synced);
    } catch {
      this.cloudSyncStatus.set(CloudSyncStatus.Error);
    }
  }

  async signInWithGoogle(): Promise<void> {
    const fb = getFirebaseHandles();
    if (!fb) {
      throw new Error('Configure your Firebase Project credentials first to enable Cloud Auth.');
    }
    const provider = new GoogleAuthProvider();
    await signInWithPopup(fb.auth, provider);
    this.showToast('Signed in with Google & synced hobby desk');
  }

  async signInWithEmail(email: string, pass: string, isSignUp = false): Promise<void> {
    const fb = getFirebaseHandles();
    if (!fb) {
      throw new Error('Configure your Firebase Project credentials first to enable Cloud Auth.');
    }
    if (isSignUp) {
      await createUserWithEmailAndPassword(fb.auth, email, pass);
      this.showToast('Created account & synced hobby desk');
    } else {
      await signInWithEmailAndPassword(fb.auth, email, pass);
      this.showToast('Signed in & synced hobby desk');
    }
  }

  async signOutCloud(): Promise<void> {
    const fb = getFirebaseHandles();
    if (!fb) {
      return;
    }
    await signOut(fb.auth);
    this.showToast('Signed out of Cloud Sync (local data preserved)');
  }
}
