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
import { getFirebaseHandles } from './firebase.config';
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

@Injectable({
  providedIn: 'root',
})
export class UserStateService {
  readonly media = inject(UserMediaService);
  readonly limits = USER_LIMITS;

  readonly state = signal<UserAccountState>(this.loadInitialState());
  readonly currentUser = signal<User | null>(null);
  readonly cloudSyncStatus = signal<CloudSyncStatus>(CloudSyncStatus.LocalOnly);
  readonly toastMessage = signal<string | null>(null);

  /** Fast reactive sets for O(1) lookup */
  readonly inventorySet = computed(() => new Set(this.state().inventoryPaintIds));
  readonly wishlistSet = computed(() => new Set(this.state().wishlistPaintIds));
  readonly modelInventorySet = computed(() => new Set(this.state().inventoryModelIds ?? []));
  readonly modelWishlistSet = computed(() => new Set(this.state().wishlistModelIds ?? []));
  readonly projects = computed(() => this.state().projects);
  readonly uploadedPhotos = computed(() => this.state().uploadedPhotos ?? []);
  readonly preferences = computed(() => this.state().preferences);
  readonly customPaints = computed(() => this.state().customPaints);
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
      if (!raw) return createDefaultState();
      const parsed = JSON.parse(raw) as Partial<UserAccountState>;
      const def = createDefaultState();
      return {
        schemaVersion: 1,
        updatedAt: parsed.updatedAt ?? def.updatedAt,
        inventoryPaintIds: Array.isArray(parsed.inventoryPaintIds)
          ? Array.from(new Set(parsed.inventoryPaintIds)).slice(0, USER_LIMITS.MAX_INVENTORY_PAINTS)
          : [],
        wishlistPaintIds: Array.isArray(parsed.wishlistPaintIds)
          ? Array.from(new Set(parsed.wishlistPaintIds)).slice(0, USER_LIMITS.MAX_WISHLIST_PAINTS)
          : [],
        inventoryModelIds: Array.isArray(parsed.inventoryModelIds)
          ? Array.from(new Set(parsed.inventoryModelIds)).slice(0, USER_LIMITS.MAX_INVENTORY_MODELS)
          : [],
        wishlistModelIds: Array.isArray(parsed.wishlistModelIds)
          ? Array.from(new Set(parsed.wishlistModelIds)).slice(0, USER_LIMITS.MAX_WISHLIST_MODELS)
          : [],
        customPaints: Array.isArray(parsed.customPaints)
          ? parsed.customPaints.slice(0, USER_LIMITS.MAX_CUSTOM_PAINTS)
          : [],
        customCompatibilityOverrides:
          parsed.customCompatibilityOverrides &&
          typeof parsed.customCompatibilityOverrides === 'object'
            ? parsed.customCompatibilityOverrides
            : {},
        projects: Array.isArray(parsed.projects)
          ? parsed.projects.slice(0, USER_LIMITS.MAX_PROJECTS).map((p) => ({
              ...p,
              colorIds: (
                p.colorIds ?? (p as { colourIds?: string[] }).colourIds ?? []
              ).slice(0, USER_LIMITS.MAX_COLORS_PER_PROJECT),
              recipeIds: (p.recipeIds ?? []).slice(0, USER_LIMITS.MAX_MODELS_PER_PROJECT),
              notes: (p.notes ?? []).slice(0, USER_LIMITS.MAX_NOTES_PER_PROJECT),
            }))
          : [],
        uploadedPhotos: Array.isArray(parsed.uploadedPhotos)
          ? parsed.uploadedPhotos
              .slice(0, USER_LIMITS.MAX_TOTAL_USER_PHOTOS)
              .map((ph) => ({
                ...ph,
                isPrivate: ph.kind === 'reference' ? true : Boolean(ph.isPrivate ?? true),
              }))
          : [],
        preferences: {
          ...def.preferences,
          ...(parsed.preferences ?? {}),
        },
      };
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
    const currentlyOwned = this.inventorySet().has(paintId);
    if (
      !currentlyOwned &&
      this.state().inventoryPaintIds.length >= USER_LIMITS.MAX_INVENTORY_PAINTS
    ) {
      this.showToast(
        `Paint Inventory limit reached (${USER_LIMITS.MAX_INVENTORY_PAINTS} paints max).`
      );
      return;
    }
    this.commit((prev) => {
      const inv = new Set(prev.inventoryPaintIds);
      const wish = new Set(prev.wishlistPaintIds);
      if (inv.has(paintId)) {
        inv.delete(paintId);
      } else {
        inv.add(paintId);
        // Moving to inventory automatically clears from wishlist
        wish.delete(paintId);
      }
      return {
        ...prev,
        inventoryPaintIds: Array.from(inv),
        wishlistPaintIds: Array.from(wish),
      };
    });
  }

  toggleWishlist(paintId: string): void {
    const currentlyWishlisted = this.wishlistSet().has(paintId);
    if (
      !currentlyWishlisted &&
      this.state().wishlistPaintIds.length >= USER_LIMITS.MAX_WISHLIST_PAINTS
    ) {
      this.showToast(
        `Paint Wishlist limit reached (${USER_LIMITS.MAX_WISHLIST_PAINTS} paints max).`
      );
      return;
    }
    this.commit((prev) => {
      const wish = new Set(prev.wishlistPaintIds);
      if (wish.has(paintId)) {
        wish.delete(paintId);
      } else {
        wish.add(paintId);
      }
      return {
        ...prev,
        wishlistPaintIds: Array.from(wish),
      };
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
    const currentlyOwned = this.modelInventorySet().has(modelId);
    if (
      !currentlyOwned &&
      (this.state().inventoryModelIds ?? []).length >= USER_LIMITS.MAX_INVENTORY_MODELS
    ) {
      this.showToast(
        `Model Inventory limit reached (${USER_LIMITS.MAX_INVENTORY_MODELS} models max).`
      );
      return;
    }
    this.commit((prev) => {
      const inv = new Set(prev.inventoryModelIds ?? []);
      const wish = new Set(prev.wishlistModelIds ?? []);
      if (inv.has(modelId)) {
        inv.delete(modelId);
      } else {
        inv.add(modelId);
        // Moving to model inventory automatically clears from model wishlist
        wish.delete(modelId);
      }
      return {
        ...prev,
        inventoryModelIds: Array.from(inv),
        wishlistModelIds: Array.from(wish),
      };
    });
  }

  toggleModelWishlist(modelId: string): void {
    const currentlyWishlisted = this.modelWishlistSet().has(modelId);
    if (
      !currentlyWishlisted &&
      (this.state().wishlistModelIds ?? []).length >= USER_LIMITS.MAX_WISHLIST_MODELS
    ) {
      this.showToast(
        `Model Wishlist limit reached (${USER_LIMITS.MAX_WISHLIST_MODELS} models max).`
      );
      return;
    }
    this.commit((prev) => {
      const wish = new Set(prev.wishlistModelIds ?? []);
      if (wish.has(modelId)) {
        wish.delete(modelId);
      } else {
        wish.add(modelId);
      }
      return {
        ...prev,
        wishlistModelIds: Array.from(wish),
      };
    });
  }

  /* ========================================================================
     PROJECTS & NOTES ACTIONS (WITH QUOTA LIMITS)
     ======================================================================== */

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
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: safeName,
      thumbnailUrl: thumbnailUrl || '',
      localThumbnailPath:
        localThumbnailPath || 'assets/images/games/d8d81a80-7bf7-4fd3-8630-059a722a8bd7.png',
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
    if (!trimmed) return;
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === projectId ? { ...p, name: trimmed, updatedAt: new Date().toISOString() } : p
      ),
    }));
  }

  setProjectThumbnail(projectId: string, localThumbnailPath: string, thumbnailUrl?: string): void {
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              coverPhotoId: undefined,
              localThumbnailPath,
              thumbnailUrl: thumbnailUrl ?? p.thumbnailUrl,
              updatedAt: new Date().toISOString(),
            }
          : p
      ),
    }));
    this.showToast('Updated project thumbnail');
  }

  setProjectCoverPhoto(projectId: string, photoId: string | undefined): void {
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              coverPhotoId: photoId,
              updatedAt: new Date().toISOString(),
            }
          : p
      ),
    }));
    this.showToast(photoId ? 'Set photo as project cover' : 'Cleared custom cover photo');
  }

  duplicateProject(projectId: string): UserProject | null {
    if (this.state().projects.length >= USER_LIMITS.MAX_PROJECTS) {
      this.showToast(`Project limit reached (${USER_LIMITS.MAX_PROJECTS} projects max).`);
      return null;
    }
    const orig = this.state().projects.find((p) => p.id === projectId);
    if (!orig) return null;
    const now = new Date().toISOString();
    const copy: UserProject = {
      ...structuredClone(orig),
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
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
    const projectPhotos = (this.state().uploadedPhotos ?? []).filter(
      (ph) => ph.targetType === 'project' && ph.targetId === projectId
    );
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.filter((p) => p.id !== projectId),
      uploadedPhotos: (prev.uploadedPhotos ?? []).filter(
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
    if (!target) return;
    if (
      !target.recipeIds.includes(recipeId) &&
      target.recipeIds.length >= USER_LIMITS.MAX_MODELS_PER_PROJECT
    ) {
      this.showToast(
        `Project model limit reached (${USER_LIMITS.MAX_MODELS_PER_PROJECT} models per project max).`
      );
      return;
    }
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => {
        if (p.id !== projectId) return p;
        const set = new Set(p.recipeIds);
        set.add(recipeId);
        return {
          ...p,
          recipeIds: Array.from(set),
          localThumbnailPath: p.localThumbnailPath || modelImageLocal || p.localThumbnailPath,
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    this.showToast('Added model guide to project');
  }

  removeRecipeFromProject(projectId: string, recipeId: string): void {
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              recipeIds: p.recipeIds.filter((id) => id !== recipeId),
              updatedAt: new Date().toISOString(),
            }
          : p
      ),
    }));
  }

  addColorToProject(projectId: string, colorId: string): void {
    const target = this.state().projects.find((p) => p.id === projectId);
    if (!target) return;
    if (
      !target.colorIds.includes(colorId) &&
      target.colorIds.length >= USER_LIMITS.MAX_COLORS_PER_PROJECT
    ) {
      this.showToast(
        `Project color limit reached (${USER_LIMITS.MAX_COLORS_PER_PROJECT} colors per project max).`
      );
      return;
    }
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => {
        if (p.id !== projectId) return p;
        const set = new Set(p.colorIds);
        set.add(colorId);
        return {
          ...p,
          colorIds: Array.from(set),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    this.showToast('Added color guide to project');
  }

  removeColorFromProject(projectId: string, colorId: string): void {
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              colorIds: p.colorIds.filter((id) => id !== colorId),
              updatedAt: new Date().toISOString(),
            }
          : p
      ),
    }));
  }

  saveProjectNote(
    projectId: string,
    noteId: string | null,
    title: string,
    components: UserProjectNoteComponent[]
  ): void {
    const target = this.state().projects.find((p) => p.id === projectId);
    if (!target) return;
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

    const now = new Date().toISOString();
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => {
        if (p.id !== projectId) return p;
        let nextNotes: UserProjectNote[];
        if (noteId) {
          nextNotes = p.notes.map((n) =>
            n.id === noteId
              ? { ...n, title: safeTitle, updatedAt: now, components: safeComponents }
              : n
          );
        } else {
          const newNote: UserProjectNote = {
            id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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
      }),
    }));
  }

  toggleNoteCheckbox(projectId: string, noteId: string, componentIndex: number): void {
    const now = new Date().toISOString();
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          updatedAt: now,
          notes: p.notes.map((n) => {
            if (n.id !== noteId) return n;
            const comps = n.components.map((c, idx) =>
              idx === componentIndex ? { ...c, checked: !c.checked } : c
            );
            return { ...n, updatedAt: now, components: comps };
          }),
        };
      }),
    }));
  }

  deleteProjectNote(projectId: string, noteId: string): void {
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              notes: p.notes.filter((n) => n.id !== noteId),
              updatedAt: new Date().toISOString(),
            }
          : p
      ),
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
    if (!photoId) return undefined;
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
    const existingForSection = this.getPhotosForTarget(targetType, targetId, kind).length;
    let remainingSectionSlots = Math.max(0, sectionLimit - existingForSection);
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
        const info = await this.media.validateImageFile(file);
        if (info.wasDownscaled) {
          downscaledCount++;
        }
        const now = new Date().toISOString();
        const photoId = `ph_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const safeFileName = file.name.replace(/[^\w.\- ]/g, '_').slice(0, 100) || 'photo.jpg';

        const meta: UserUploadedPhoto = {
          id: photoId,
          targetType,
          targetId,
          kind,
          isPrivate: true,
          fileName: safeFileName,
          mimeType: info.mimeType,
          sizeBytes: info.blob.size,
          width: info.width,
          height: info.height,
          caption: safeCaption || undefined,
          createdAt: now,
        };

        await this.media.storeLocalBlob(photoId, info.blob);

        if (uid) {
          const storagePath = await this.media.uploadToCloudStorage(meta, info.blob, uid);
          if (storagePath) {
            meta.storagePath = storagePath;
          }
        }

        uploaded.push(meta);
        remainingSectionSlots--;
        remainingAccountSlots--;
      } catch (err: unknown) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (uploaded.length > 0) {
      this.commit((prev) => ({
        ...prev,
        uploadedPhotos: [...uploaded, ...(prev.uploadedPhotos ?? [])].slice(
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

  updatePhotoCaption(photoId: string, caption: string): void {
    const cleaned = caption.trim().slice(0, USER_LIMITS.MAX_PHOTO_CAPTION_LENGTH);
    this.commit((prev) => ({
      ...prev,
      uploadedPhotos: (prev.uploadedPhotos ?? []).map((ph) =>
        ph.id === photoId ? { ...ph, caption: cleaned || undefined } : ph
      ),
    }));
    this.showToast('Saved photo caption');
  }

  async deleteUserPhoto(photoId: string): Promise<void> {
    const target = this.getPhotoById(photoId);
    if (!target) return;

    this.commit((prev) => ({
      ...prev,
      uploadedPhotos: (prev.uploadedPhotos ?? []).filter((ph) => ph.id !== photoId),
      projects: prev.projects.map((p) =>
        p.coverPhotoId === photoId
          ? { ...p, coverPhotoId: undefined, updatedAt: new Date().toISOString() }
          : p
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
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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

  unlinkCustomEquivalent(citadelPaintId: string, equivalentPaintId: string): void {
    this.commit((prev) => {
      const nextOverrides = { ...prev.customCompatibilityOverrides };
      const list = (nextOverrides[citadelPaintId] ?? []).filter((id) => id !== equivalentPaintId);
      if (list.length === 0) {
        delete nextOverrides[citadelPaintId];
      } else {
        nextOverrides[citadelPaintId] = list;
      }
      return {
        ...prev,
        customCompatibilityOverrides: nextOverrides,
      };
    });
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

      const incomingInv = Array.isArray(rawPayload['inventoryPaintIds'])
        ? (rawPayload['inventoryPaintIds'] as string[])
        : [];
      const incomingWish = Array.isArray(rawPayload['wishlistPaintIds'])
        ? (rawPayload['wishlistPaintIds'] as string[])
        : [];
      const incomingModelInv = Array.isArray(rawPayload['inventoryModelIds'])
        ? (rawPayload['inventoryModelIds'] as string[])
        : [];
      const incomingModelWish = Array.isArray(rawPayload['wishlistModelIds'])
        ? (rawPayload['wishlistModelIds'] as string[])
        : [];

      const invSet = new Set([...base.inventoryPaintIds, ...incomingInv]);
      const wishSet = new Set([...base.wishlistPaintIds, ...incomingWish]);
      for (const id of invSet) {
        wishSet.delete(id);
      }

      const modelInvSet = new Set([...(base.inventoryModelIds ?? []), ...incomingModelInv]);
      const modelWishSet = new Set([...(base.wishlistModelIds ?? []), ...incomingModelWish]);
      for (const id of modelInvSet) {
        modelWishSet.delete(id);
      }

      const rawProjects = Array.isArray(rawPayload['projects'])
        ? (rawPayload['projects'] as Record<string, unknown>[])
        : [];

      const normalizedIncomingProjects: UserProject[] = rawProjects.map((rp) => {
        const id = String(
          rp['id'] ?? `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
        );
        const name = String(rp['name'] ?? 'Imported Project').slice(0, USER_LIMITS.MAX_TITLE_LENGTH);
        const createdAt = String(rp['createdAt'] ?? new Date().toISOString());
        const updatedAt = String(rp['updatedAt'] ?? createdAt);

        const recipeIds: string[] = Array.isArray(rp['recipeIds'])
          ? (rp['recipeIds'] as string[])
          : Array.isArray(rp['recipes'])
          ? (rp['recipes'] as Record<string, unknown>[]).map((r) => String(r['id']))
          : [];

        const colorIds: string[] = Array.isArray(rp['colorIds'])
          ? (rp['colorIds'] as string[])
          : Array.isArray(rp['colourIds'])
          ? (rp['colourIds'] as string[])
          : Array.isArray(rp['colors'])
          ? (rp['colors'] as Record<string, unknown>[]).map((c) => String(c['id']))
          : Array.isArray(rp['colours'])
          ? (rp['colours'] as Record<string, unknown>[]).map((c) => String(c['id']))
          : [];

        const rawNotes = Array.isArray(rp['notes'])
          ? (rp['notes'] as Record<string, unknown>[])
          : [];

        const notes: UserProjectNote[] = rawNotes
          .slice(0, USER_LIMITS.MAX_NOTES_PER_PROJECT)
          .map((rn, idx) => {
            const rawComps = Array.isArray(rn['components'])
              ? (rn['components'] as Record<string, unknown>[])
              : [];
            const components: UserProjectNoteComponent[] = rawComps
              .slice(0, USER_LIMITS.MAX_NOTE_BLOCKS_PER_NOTE)
              .map((rc) => ({
                type: rc['type'] === 'checkbox' ? 'checkbox' : 'text',
                value: String(rc['value'] ?? rc['text'] ?? '').slice(
                  0,
                  USER_LIMITS.MAX_NOTE_TEXT_LENGTH
                ),
                checked: Boolean(rc['checked'] ?? false),
              }));
            return {
              id: String(rn['id'] ?? `note_${id}_${idx}`),
              title: String(rn['title'] ?? rn['name'] ?? 'Project Note').slice(
                0,
                USER_LIMITS.MAX_TITLE_LENGTH
              ),
              createdAt: String(rn['createdAt'] ?? createdAt),
              updatedAt: String(rn['updatedAt'] ?? updatedAt),
              components,
            };
          });

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
          recipeIds: Array.from(new Set(recipeIds)).slice(0, USER_LIMITS.MAX_MODELS_PER_PROJECT),
          colorIds: Array.from(new Set(colorIds)).slice(0, USER_LIMITS.MAX_COLORS_PER_PROJECT),
          notes,
        };
      });

      const projectMap = new Map<string, UserProject>();
      for (const p of base.projects) {
        projectMap.set(p.id, p);
      }
      for (const incomingP of normalizedIncomingProjects) {
        if (projectMap.has(incomingP.id) || projectMap.size < USER_LIMITS.MAX_PROJECTS) {
          projectMap.set(incomingP.id, incomingP);
        }
      }

      const incomingCustomPaints = Array.isArray(rawPayload['customPaints'])
        ? (rawPayload['customPaints'] as ThirdPartyPaint[])
        : [];
      const customPaintMap = new Map<string, ThirdPartyPaint>();
      for (const cp of [...base.customPaints, ...incomingCustomPaints]) {
        if (customPaintMap.has(cp.id) || customPaintMap.size < USER_LIMITS.MAX_CUSTOM_PAINTS) {
          customPaintMap.set(cp.id, cp);
        }
      }

      const incomingPhotos = Array.isArray(rawPayload['uploadedPhotos'])
        ? (rawPayload['uploadedPhotos'] as UserUploadedPhoto[])
        : [];
      const photoMap = new Map<string, UserUploadedPhoto>();
      for (const ph of [...(base.uploadedPhotos ?? []), ...incomingPhotos]) {
        if (!ph || !ph.id) continue;
        if (photoMap.has(ph.id) || photoMap.size < USER_LIMITS.MAX_TOTAL_USER_PHOTOS) {
          photoMap.set(ph.id, {
            ...ph,
            isPrivate: true,
          });
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
          // Upload any local-only photos to Firebase Storage and record their storagePaths
          const uploadedMap = await this.media.syncPendingBlobsToCloud(
            this.state().uploadedPhotos ?? [],
            user.uid
          );
          if (uploadedMap.size > 0) {
            this.commit(
              (prev) => ({
                ...prev,
                uploadedPhotos: (prev.uploadedPhotos ?? []).map((ph) =>
                  uploadedMap.has(ph.id) ? { ...ph, storagePath: uploadedMap.get(ph.id) } : ph
                ),
              }),
              false
            );
          }
          await this.pushStateToFirestore(this.state());
          this.unsubscribeFirestore = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
              const remote = docSnap.data() as UserAccountState;
              if (remote.updatedAt && remote.updatedAt > this.state().updatedAt) {
                const normalized: UserAccountState = {
                  ...remote,
                  inventoryPaintIds: remote.inventoryPaintIds ?? [],
                  wishlistPaintIds: remote.wishlistPaintIds ?? [],
                  inventoryModelIds: remote.inventoryModelIds ?? [],
                  wishlistModelIds: remote.wishlistModelIds ?? [],
                  uploadedPhotos: remote.uploadedPhotos ?? [],
                };
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
    if (!fb || !user) return;
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
    if (!fb) return;
    await signOut(fb.auth);
    this.showToast('Signed out of Cloud Sync (local data preserved)');
  }
}
