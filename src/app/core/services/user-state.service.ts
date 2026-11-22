import { Injectable, computed, inject, signal } from '@angular/core';
import {
  CloudSyncStatus,
  ModelRecipe,
  ModelSummary,
  ProjectModelEntry,
  ProjectModelFeaturedImage,
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
import {
  CURRENT_SCHEMA_VERSION,
  clampModelQuantity,
  cloneCatalogFeaturedImage,
  collectProjectPhotos,
  createDefaultState,
  extractAccountDocPayload,
  normalizeAccountState,
  normalizeConfigurations,
  normalizeIncomingProject,
  stripUndefinedDeep,
} from '../utils/user-state-normalizer.util';
import { CatalogService } from './catalog.service';
import { FirebaseHandles, getFirebaseHandles } from './firebase.config';
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
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

const STORAGE_KEY = 'whc_user_state_v1';
const DEFAULT_PROJECT_THUMBNAIL = 'assets/images/games/d8d81a80-7bf7-4fd3-8630-059a722a8bd7.png';

type CloudSyncPlan =
  | 'none'
  | 'all'
  | {
      account?: boolean;
      projectIds?: string[];
      deletedProjectIds?: string[];
    };

type PhotoOwnerLocation =
  | { scope: 'account' }
  | { scope: 'project'; projectId: string }
  | { scope: 'project_model'; projectId: string; entryId: string };

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
  /** Standalone catalog-model photos stored on `/users/{uid}` */
  readonly uploadedPhotos = computed(() => this.state().uploadedPhotos);
  /** All uploaded photos across standalone catalog models, projects, and project model entries */
  readonly allUploadedPhotos = computed<UserUploadedPhoto[]>(() => {
    const out: UserUploadedPhoto[] = [...this.state().uploadedPhotos];
    for (const proj of this.state().projects) {
      out.push(...collectProjectPhotos(proj));
    }
    return out;
  });
  readonly preferences = computed(() => this.state().preferences);
  readonly customPaints = computed(() => this.state().customPaints);
  readonly customPaintById = computed(
    () => new Map(this.customPaints().map((paint) => [paint.id, paint]))
  );
  readonly customCompatibilityOverrides = computed(
    () => this.state().customCompatibilityOverrides
  );
  readonly modelProgress = computed(() => this.state().modelProgress ?? {});

  private unsubscribeUserFirestore: (() => void) | null = null;
  private unsubscribeProjectsFirestore: (() => void) | null = null;

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

  private persistLocalState(next: UserAccountState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('Failed to persist user state to localStorage:', e);
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

  private commit(
    updater: (prev: UserAccountState) => UserAccountState,
    syncPlan: CloudSyncPlan = { account: true }
  ): void {
    const prevProjects = this.state().projects;
    const next = updater(this.state());
    next.schemaVersion = CURRENT_SCHEMA_VERSION;
    next.updatedAt = new Date().toISOString();
    this.state.set(next);
    this.persistLocalState(next);

    if (syncPlan === 'none' || !this.currentUser()) {
      return;
    }

    if (syncPlan === 'all') {
      const nextIds = new Set(next.projects.map((p) => p.id));
      const removedIds = prevProjects.filter((p) => !nextIds.has(p.id)).map((p) => p.id);
      void this.pushAllToFirestore(next, removedIds);
      return;
    }

    if (syncPlan.account) {
      void this.pushAccountDocToFirestore(next);
    }
    for (const projectId of syncPlan.projectIds ?? []) {
      const proj = next.projects.find((p) => p.id === projectId);
      if (proj) {
        void this.pushProjectToFirestore(proj);
      }
    }
    for (const deletedId of syncPlan.deletedProjectIds ?? []) {
      void this.deleteProjectFromFirestore(deletedId);
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
    this.commit(
      (prev) => ({
        ...prev,
        projects: prev.projects.map((p) => (p.id === projectId ? updater(p, now) : p)),
      }),
      { projectIds: [projectId] }
    );
  }

  private updateProjectModelById(
    projectId: string,
    entryId: string,
    updater: (entry: ProjectModelEntry, now: string) => ProjectModelEntry
  ): void {
    this.updateProjectById(projectId, (p, now) => ({
      ...p,
      updatedAt: now,
      models: p.models.map((m) => (m.id === entryId ? updater(m, now) : m)),
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
     PROJECTS, PROJECT MODEL ENTRIES & NOTES ACTIONS (WITH QUOTA LIMITS)
     ======================================================================== */

  getProjectById(projectId: string): UserProject | undefined {
    return this.projects().find((p) => p.id === projectId);
  }

  getProjectModelEntry(projectId: string, entryId: string): ProjectModelEntry | undefined {
    const project = this.getProjectById(projectId);
    return project?.models.find((m) => m.id === entryId);
  }

  getProjectTotalMiniatures(project: Pick<UserProject, 'models'>): number {
    return project.models.reduce((sum, entry) => sum + Math.max(1, entry.quantity || 1), 0);
  }

  getProjectTotalPhotoCount(project: Pick<UserProject, 'photos' | 'models'>): number {
    return collectProjectPhotos(project).length;
  }

  private resolveFeaturedImageUrl(
    entry: ProjectModelEntry,
    recipe?: Pick<ModelRecipe, 'localImagePaths' | 'images'> | null
  ): string | null {
    const fi = entry.featuredImage;
    if (!fi) {
      return null;
    }
    if (fi.source === 'uploaded_photo') {
      const photo = entry.photos.find((ph) => ph.id === fi.photoId);
      return photo ? this.media.resolvePhotoUrl(photo) : null;
    }
    if (fi.source === 'catalog_angle') {
      const local = recipe?.localImagePaths?.[fi.imageIndex] ?? fi.localImagePath;
      const remote = recipe?.images?.[fi.imageIndex] ?? fi.imageUrl;
      return local || remote ? this.img.resolve(local, remote) : null;
    }
    if (fi.localImagePath || fi.imageUrl) {
      return this.img.resolve(fi.localImagePath, fi.imageUrl);
    }
    const other = this.catalog.modelById().get(fi.modelId);
    return other ? this.img.resolve(other.localPrimaryImage, other.primaryImage) : null;
  }

  resolveProjectModelImageUrl(
    entry: ProjectModelEntry,
    catalogModel?: Pick<ModelSummary, 'localPrimaryImage' | 'primaryImage'> | null,
    recipe?: Pick<ModelRecipe, 'localImagePaths' | 'images'> | null
  ): string {
    const customUrl = this.resolveFeaturedImageUrl(entry, recipe);
    if (customUrl) {
      return customUrl;
    }
    if (recipe && (recipe.localImagePaths?.[0] || recipe.images?.[0])) {
      return this.img.resolve(recipe.localImagePaths[0], recipe.images[0]);
    }
    const summary = catalogModel ?? this.catalog.modelById().get(entry.recipeId);
    if (summary) {
      return this.img.resolve(summary.localPrimaryImage, summary.primaryImage);
    }
    return '/icons/ic_models.svg';
  }

  resolveProjectCoverUrl(
    proj: Pick<
      UserProject,
      'id' | 'coverPhotoId' | 'localThumbnailPath' | 'thumbnailUrl' | 'models' | 'photos'
    >
  ): string {
    const preferredShowcase =
      (proj.coverPhotoId
        ? proj.photos.find((ph) => ph.id === proj.coverPhotoId && ph.kind === 'showcase')
        : undefined) ?? proj.photos.find((ph) => ph.kind === 'showcase');

    if (preferredShowcase) {
      const resolved = this.media.resolvePhotoUrl(preferredShowcase);
      if (resolved) {
        return resolved;
      }
    }

    if (proj.localThumbnailPath || proj.thumbnailUrl) {
      return this.img.resolve(proj.localThumbnailPath, proj.thumbnailUrl);
    }

    const firstModelEntry = proj.models[0];
    if (firstModelEntry) {
      return this.resolveProjectModelImageUrl(firstModelEntry);
    }

    return '/icons/ic_project.svg';
  }

  getTargetPhotoCount(
    targetType: UserPhotoTargetType,
    targetId: string,
    projectId?: string
  ): number {
    return (
      this.getPhotosForTarget(targetType, targetId, 'showcase', projectId).length +
      this.getPhotosForTarget(targetType, targetId, 'reference', projectId).length
    );
  }

  /* ========================================================================
     STANDALONE MODEL PAINTING PROGRESS (CATALOG /models/:id)
     ======================================================================== */

  getCompletedStepIds(modelId: string): string[] {
    if (!modelId) {
      return [];
    }
    return this.modelProgress()[modelId] ?? [];
  }

  isStepDone(modelId: string, stepId: string): boolean {
    if (!modelId || !stepId) {
      return false;
    }
    return this.getCompletedStepIds(modelId).includes(stepId);
  }

  toggleStepDone(modelId: string, stepId: string): void {
    if (!modelId || !stepId) {
      return;
    }
    const currentlyDone = this.isStepDone(modelId, stepId);
    this.setStepsDone(modelId, [stepId], !currentlyDone);
  }

  setStepsDone(modelId: string, stepIds: string[], done: boolean): void {
    const validIds = stepIds.filter(Boolean);
    if (!modelId || validIds.length === 0) {
      return;
    }
    this.commit((prev) => {
      const currentMap = prev.modelProgress ?? {};
      const existing = currentMap[modelId] ?? [];
      if (
        done &&
        existing.length === 0 &&
        Object.keys(currentMap).length >= USER_LIMITS.MAX_MODEL_PROGRESS_KEYS
      ) {
        this.showToast(
          `Model progress limit reached (${USER_LIMITS.MAX_MODEL_PROGRESS_KEYS} models max).`
        );
        return prev;
      }

      const nextSet = new Set(existing);
      for (const id of validIds) {
        if (done) {
          nextSet.add(id);
        } else {
          nextSet.delete(id);
        }
      }

      const nextList = Array.from(nextSet).slice(0, USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS);
      const nextMap = { ...currentMap };
      if (nextList.length > 0) {
        nextMap[modelId] = nextList;
      } else {
        delete nextMap[modelId];
      }

      return {
        ...prev,
        modelProgress: nextMap,
      };
    });
  }

  clearModelProgress(modelId: string): void {
    if (!modelId) {
      return;
    }
    this.commit((prev) => {
      const currentMap = prev.modelProgress ?? {};
      if (!(modelId in currentMap)) {
        return prev;
      }
      const nextMap = { ...currentMap };
      delete nextMap[modelId];
      return {
        ...prev,
        modelProgress: nextMap,
      };
    });
    this.showToast('Cleared painting progress for this model');
  }

  /* ========================================================================
     PER-INSTANCE PROJECT MODEL PAINTING PROGRESS
     ======================================================================== */

  getProjectModelCompletedStepIds(projectId: string, entryId: string): string[] {
    return this.getProjectModelEntry(projectId, entryId)?.completedStepIds ?? [];
  }

  toggleProjectModelStepDone(projectId: string, entryId: string, stepId: string): void {
    if (!projectId || !entryId || !stepId) {
      return;
    }
    const done = this.getProjectModelCompletedStepIds(projectId, entryId).includes(stepId);
    this.setProjectModelStepsDone(projectId, entryId, [stepId], !done);
  }

  setProjectModelStepsDone(
    projectId: string,
    entryId: string,
    stepIds: string[],
    done: boolean
  ): void {
    const validIds = stepIds.filter(Boolean);
    if (!projectId || !entryId || validIds.length === 0) {
      return;
    }
    this.updateProjectModelById(projectId, entryId, (entry, now) => {
      const nextSet = new Set(entry.completedStepIds);
      for (const id of validIds) {
        if (done) {
          nextSet.add(id);
        } else {
          nextSet.delete(id);
        }
      }
      return {
        ...entry,
        completedStepIds: Array.from(nextSet).slice(0, USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS),
        updatedAt: now,
      };
    });
  }

  clearProjectModelProgress(projectId: string, entryId: string): void {
    if (!projectId || !entryId) {
      return;
    }
    this.updateProjectModelById(projectId, entryId, (entry, now) => ({
      ...entry,
      completedStepIds: [],
      updatedAt: now,
    }));
    this.showToast('Cleared painting progress for this project model');
  }

  /* ========================================================================
     PROJECT CRUD & PROJECT MODEL ENTRY CRUD
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
      id: createEntityId('proj'),
      name: safeName,
      thumbnailUrl: thumbnailUrl || '',
      localThumbnailPath: localThumbnailPath || DEFAULT_PROJECT_THUMBNAIL,
      createdAt: now,
      updatedAt: now,
      models: [],
      colorIds: [],
      notes: [],
      photos: [],
    };
    this.commit(
      (prev) => ({
        ...prev,
        projects: [project, ...prev.projects],
      }),
      { projectIds: [project.id] }
    );
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
    const clonedModels: ProjectModelEntry[] = orig.models.map((entry) => ({
      ...structuredClone(entry),
      id: createEntityId('pmod'),
      featuredImage: cloneCatalogFeaturedImage(entry.featuredImage),
      photos: [],
      createdAt: now,
      updatedAt: now,
    }));
    const copy: UserProject = {
      ...structuredClone(orig),
      id: createEntityId('proj'),
      name: `${orig.name} (Copy)`.slice(0, USER_LIMITS.MAX_TITLE_LENGTH),
      coverPhotoId: undefined,
      photos: [],
      models: clonedModels,
      createdAt: now,
      updatedAt: now,
    };
    this.commit(
      (prev) => ({
        ...prev,
        projects: [copy, ...prev.projects],
      }),
      { projectIds: [copy.id] }
    );
    this.showToast(`Duplicated "${orig.name}"`);
    return copy;
  }

  deleteProject(projectId: string): void {
    const targetProject = this.state().projects.find((p) => p.id === projectId);
    const projectPhotos = targetProject ? collectProjectPhotos(targetProject) : [];
    this.commit(
      (prev) => ({
        ...prev,
        projects: prev.projects.filter((p) => p.id !== projectId),
      }),
      { deletedProjectIds: [projectId] }
    );
    for (const ph of projectPhotos) {
      void this.media.deletePhotoAssets(ph);
    }
    this.showToast('Deleted project');
  }

  addModelToProject(
    projectId: string,
    recipeId: string,
    options?: { customName?: string; quantity?: number; modelImageLocal?: string }
  ): ProjectModelEntry | null {
    const target = this.state().projects.find((p) => p.id === projectId);
    if (!target || !recipeId) {
      return null;
    }
    if (target.models.length >= USER_LIMITS.MAX_MODELS_PER_PROJECT) {
      this.showToast(
        `Project model limit reached (${USER_LIMITS.MAX_MODELS_PER_PROJECT} models per project max).`
      );
      return null;
    }
    const now = new Date().toISOString();
    const customName = options?.customName?.trim().slice(0, USER_LIMITS.MAX_TITLE_LENGTH) || undefined;
    const entry: ProjectModelEntry = {
      id: createEntityId('pmod'),
      recipeId,
      customName,
      quantity: clampModelQuantity(options?.quantity ?? 1),
      notes: '',
      completedStepIds: [],
      photos: [],
      createdAt: now,
      updatedAt: now,
    };
    this.updateProjectById(projectId, (p, ts) => ({
      ...p,
      models: [...p.models, entry],
      localThumbnailPath: p.localThumbnailPath || options?.modelImageLocal,
      updatedAt: ts,
    }));
    const existingCount = target.models.filter((m) => m.recipeId === recipeId).length;
    this.showToast(
      existingCount > 0 ? 'Added another instance of this model to project' : 'Added model to project'
    );
    return entry;
  }

  duplicateProjectModel(projectId: string, entryId: string): ProjectModelEntry | null {
    const target = this.state().projects.find((p) => p.id === projectId);
    if (!target) {
      return null;
    }
    if (target.models.length >= USER_LIMITS.MAX_MODELS_PER_PROJECT) {
      this.showToast(
        `Project model limit reached (${USER_LIMITS.MAX_MODELS_PER_PROJECT} models per project max).`
      );
      return null;
    }
    const orig = target.models.find((m) => m.id === entryId);
    if (!orig) {
      return null;
    }
    const now = new Date().toISOString();
    const copy: ProjectModelEntry = {
      id: createEntityId('pmod'),
      recipeId: orig.recipeId,
      customName: orig.customName
        ? `${orig.customName} (Copy)`.slice(0, USER_LIMITS.MAX_TITLE_LENGTH)
        : undefined,
      quantity: 1,
      notes: orig.notes,
      completedStepIds: [],
      featuredImage: cloneCatalogFeaturedImage(orig.featuredImage),
      photos: [],
      configurations: orig.configurations ? structuredClone(orig.configurations) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.updateProjectById(projectId, (p, ts) => {
      const idx = p.models.findIndex((m) => m.id === entryId);
      const nextModels = [...p.models];
      nextModels.splice(idx >= 0 ? idx + 1 : nextModels.length, 0, copy);
      return {
        ...p,
        models: nextModels,
        updatedAt: ts,
      };
    });
    this.showToast('Duplicated model entry in project');
    return copy;
  }

  removeModelFromProject(projectId: string, entryId: string): void {
    const entry = this.getProjectModelEntry(projectId, entryId);
    const entryPhotos = entry?.photos ?? [];
    this.updateProjectById(projectId, (p, now) => ({
      ...p,
      models: p.models.filter((m) => m.id !== entryId),
      updatedAt: now,
    }));
    for (const ph of entryPhotos) {
      void this.media.deletePhotoAssets(ph);
    }
    this.showToast('Removed model from project');
  }

  updateProjectModel(
    projectId: string,
    entryId: string,
    patch: Partial<
      Pick<
        ProjectModelEntry,
        'customName' | 'quantity' | 'notes' | 'featuredImage' | 'configurations'
      >
    >
  ): void {
    this.updateProjectModelById(projectId, entryId, (entry, now) => {
      const next: ProjectModelEntry = {
        ...entry,
        updatedAt: now,
      };
      if ('customName' in patch) {
        const cleaned = (patch.customName ?? '').trim().slice(0, USER_LIMITS.MAX_TITLE_LENGTH);
        next.customName = cleaned || undefined;
      }
      if ('quantity' in patch && patch.quantity !== undefined) {
        next.quantity = clampModelQuantity(patch.quantity);
      }
      if ('notes' in patch && patch.notes !== undefined) {
        next.notes = patch.notes.slice(0, USER_LIMITS.MAX_MODEL_NOTE_LENGTH);
      }
      if ('featuredImage' in patch) {
        next.featuredImage = patch.featuredImage;
      }
      if ('configurations' in patch) {
        next.configurations = normalizeConfigurations(patch.configurations);
      }
      return next;
    });
  }

  setProjectModelQuantity(projectId: string, entryId: string, quantity: number): void {
    this.updateProjectModel(projectId, entryId, { quantity });
  }

  adjustProjectModelQuantity(projectId: string, entryId: string, delta: number): void {
    this.updateProjectModelById(projectId, entryId, (entry, now) => ({
      ...entry,
      quantity: clampModelQuantity(entry.quantity + delta),
      updatedAt: now,
    }));
  }

  setProjectModelFeaturedImage(
    projectId: string,
    entryId: string,
    featuredImage: ProjectModelFeaturedImage | undefined
  ): void {
    this.updateProjectModel(projectId, entryId, { featuredImage });
    this.showToast(
      featuredImage ? 'Updated model featured image' : 'Reset model featured image to default'
    );
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
    if (targetType === 'project_model') {
      return kind === 'reference'
        ? USER_LIMITS.MAX_PROJECT_MODEL_REFERENCE_PHOTOS
        : USER_LIMITS.MAX_PROJECT_MODEL_SHOWCASE_PHOTOS;
    }
    return kind === 'reference'
      ? USER_LIMITS.MAX_PROJECT_REFERENCE_PHOTOS
      : USER_LIMITS.MAX_PROJECT_SHOWCASE_PHOTOS;
  }

  getPhotosForTarget(
    targetType: UserPhotoTargetType,
    targetId: string,
    kind: UserPhotoKind,
    projectId?: string
  ): UserUploadedPhoto[] {
    if (targetType === 'project') {
      const proj = this.getProjectById(targetId);
      return (proj?.photos ?? []).filter((ph) => ph.kind === kind);
    }
    if (targetType === 'project_model') {
      const entry = projectId
        ? this.getProjectModelEntry(projectId, targetId)
        : this.findProjectModelEntryById(targetId)?.entry;
      return (entry?.photos ?? []).filter((ph) => ph.kind === kind);
    }
    return this.uploadedPhotos().filter(
      (ph) => ph.targetType === targetType && ph.targetId === targetId && ph.kind === kind
    );
  }

  getPhotoById(photoId?: string): UserUploadedPhoto | undefined {
    if (!photoId) {
      return undefined;
    }
    return this.allUploadedPhotos().find((ph) => ph.id === photoId);
  }

  private findProjectModelEntryById(
    entryId: string
  ): { project: UserProject; entry: ProjectModelEntry } | null {
    for (const project of this.state().projects) {
      const entry = project.models.find((m) => m.id === entryId);
      if (entry) {
        return { project, entry };
      }
    }
    return null;
  }

  private locatePhotoOwner(photoId: string): PhotoOwnerLocation | null {
    if (this.state().uploadedPhotos.some((ph) => ph.id === photoId)) {
      return { scope: 'account' };
    }
    for (const proj of this.state().projects) {
      if (proj.photos.some((ph) => ph.id === photoId)) {
        return { scope: 'project', projectId: proj.id };
      }
      const owningEntry = proj.models.find((m) => m.photos.some((ph) => ph.id === photoId));
      if (owningEntry) {
        return { scope: 'project_model', projectId: proj.id, entryId: owningEntry.id };
      }
    }
    return null;
  }

  private commitUploadedPhotos(
    targetType: UserPhotoTargetType,
    targetId: string,
    resolvedProjectId: string | undefined,
    uploaded: UserUploadedPhoto[]
  ): void {
    if (targetType === 'project' && resolvedProjectId) {
      this.updateProjectById(resolvedProjectId, (p, now) => ({
        ...p,
        photos: [...uploaded, ...p.photos].slice(0, USER_LIMITS.MAX_PROJECT_PHOTOS_PER_PROJECT),
        updatedAt: now,
      }));
      return;
    }
    if (targetType === 'project_model' && resolvedProjectId) {
      this.updateProjectModelById(resolvedProjectId, targetId, (entry, now) => ({
        ...entry,
        photos: [...uploaded, ...entry.photos].slice(0, USER_LIMITS.MAX_PHOTOS_PER_PROJECT_MODEL),
        updatedAt: now,
      }));
      return;
    }
    this.commit(
      (prev) => ({
        ...prev,
        uploadedPhotos: [...uploaded, ...prev.uploadedPhotos].slice(
          0,
          USER_LIMITS.MAX_TOTAL_USER_PHOTOS
        ),
      }),
      { account: true }
    );
  }

  async uploadPhotos(params: {
    files: File[];
    targetType: UserPhotoTargetType;
    targetId: string;
    kind: UserPhotoKind;
    caption?: string;
    projectId?: string;
  }): Promise<{ uploaded: UserUploadedPhoto[]; errors: string[] }> {
    const { files, targetType, targetId, kind } = params;
    const uploaded: UserUploadedPhoto[] = [];
    const errors: string[] = [];
    if (!files.length || !targetId) {
      return { uploaded, errors };
    }

    const resolvedProjectId =
      targetType === 'project'
        ? targetId
        : targetType === 'project_model'
        ? params.projectId ?? this.findProjectModelEntryById(targetId)?.project.id
        : undefined;

    if ((targetType === 'project' || targetType === 'project_model') && !resolvedProjectId) {
      errors.push('Could not locate the owning project for this photo.');
      return { uploaded, errors };
    }

    const sectionLimit = this.getPhotoQuotaLimit(targetType, kind);
    let remainingSectionSlots = Math.max(
      0,
      sectionLimit - this.getPhotosForTarget(targetType, targetId, kind, resolvedProjectId).length
    );
    let remainingAccountSlots = Math.max(
      0,
      USER_LIMITS.MAX_TOTAL_USER_PHOTOS - this.allUploadedPhotos().length
    );

    if (remainingSectionSlots === 0) {
      const label = kind === 'reference' ? 'private reference' : 'painted';
      const targetLabel = targetType === 'project_model' ? 'project model' : targetType;
      errors.push(`Maximum of ${sectionLimit} ${label} photos reached for this ${targetLabel}.`);
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
      this.commitUploadedPhotos(targetType, targetId, resolvedProjectId, uploaded);
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
    const owner = this.locatePhotoOwner(photoId);
    if (!owner) {
      return;
    }
    const nextCaption = caption.trim().slice(0, USER_LIMITS.MAX_PHOTO_CAPTION_LENGTH) || undefined;
    const applyCaption = (photos: UserUploadedPhoto[]): UserUploadedPhoto[] =>
      photos.map((ph) => (ph.id === photoId ? { ...ph, caption: nextCaption } : ph));

    if (owner.scope === 'account') {
      this.commit(
        (prev) => ({ ...prev, uploadedPhotos: applyCaption(prev.uploadedPhotos) }),
        { account: true }
      );
    } else if (owner.scope === 'project') {
      this.updateProjectById(owner.projectId, (p, now) => ({
        ...p,
        photos: applyCaption(p.photos),
        updatedAt: now,
      }));
    } else {
      this.updateProjectModelById(owner.projectId, owner.entryId, (entry, now) => ({
        ...entry,
        photos: applyCaption(entry.photos),
        updatedAt: now,
      }));
    }
    this.showToast('Saved photo caption');
  }

  async deleteUserPhoto(photoId: string): Promise<void> {
    const target = this.getPhotoById(photoId);
    const owner = this.locatePhotoOwner(photoId);
    if (!target || !owner) {
      return;
    }

    if (owner.scope === 'account') {
      this.commit(
        (prev) => ({
          ...prev,
          uploadedPhotos: prev.uploadedPhotos.filter((ph) => ph.id !== photoId),
        }),
        { account: true }
      );
    } else if (owner.scope === 'project') {
      this.updateProjectById(owner.projectId, (p, now) => ({
        ...p,
        photos: p.photos.filter((ph) => ph.id !== photoId),
        coverPhotoId: p.coverPhotoId === photoId ? undefined : p.coverPhotoId,
        updatedAt: now,
      }));
    } else {
      this.updateProjectModelById(owner.projectId, owner.entryId, (entry, now) => ({
        ...entry,
        photos: entry.photos.filter((ph) => ph.id !== photoId),
        featuredImage:
          entry.featuredImage?.source === 'uploaded_photo' &&
          entry.featuredImage.photoId === photoId
            ? undefined
            : entry.featuredImage,
        updatedAt: now,
      }));
    }

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
    mode: 'merge' | 'replace' = 'merge',
    syncCloud = true
  ): void {
    this.commit(
      (prev) => {
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

        const projectMap = new Map<string, UserProject>(base.projects.map((p) => [p.id, p]));
        for (const incomingP of incoming.projects) {
          const existing = projectMap.get(incomingP.id);
          if (existing) {
            if (incomingP.updatedAt >= existing.updatedAt) {
              projectMap.set(incomingP.id, incomingP);
            }
          } else if (projectMap.size < USER_LIMITS.MAX_PROJECTS) {
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
          if (
            ph.targetType === 'model' &&
            (photoMap.has(ph.id) || photoMap.size < USER_LIMITS.MAX_TOTAL_USER_PHOTOS)
          ) {
            photoMap.set(ph.id, { ...ph, isPrivate: true });
          }
        }

        const mergedProgress: Record<string, string[]> = { ...(base.modelProgress ?? {}) };
        for (const [modelId, incomingSteps] of Object.entries(incoming.modelProgress ?? {})) {
          if (
            !(modelId in mergedProgress) &&
            Object.keys(mergedProgress).length >= USER_LIMITS.MAX_MODEL_PROGRESS_KEYS
          ) {
            break;
          }
          const combined = Array.from(
            new Set([...(mergedProgress[modelId] ?? []), ...incomingSteps])
          ).slice(0, USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS);
          if (combined.length > 0) {
            mergedProgress[modelId] = combined;
          }
        }

        return {
          ...base,
          inventoryPaintIds: Array.from(invSet).slice(0, USER_LIMITS.MAX_INVENTORY_PAINTS),
          wishlistPaintIds: Array.from(wishSet).slice(0, USER_LIMITS.MAX_WISHLIST_PAINTS),
          inventoryModelIds: Array.from(modelInvSet).slice(0, USER_LIMITS.MAX_INVENTORY_MODELS),
          wishlistModelIds: Array.from(modelWishSet).slice(0, USER_LIMITS.MAX_WISHLIST_MODELS),
          customPaints: Array.from(customPaintMap.values()),
          modelProgress: mergedProgress,
          projects: Array.from(projectMap.values()),
          uploadedPhotos: Array.from(photoMap.values()),
        };
      },
      syncCloud ? 'all' : 'none'
    );

    if (syncCloud) {
      this.showToast(
        `Imported account data (${this.state().inventoryPaintIds.length} owned, ${this.state().wishlistPaintIds.length} wishlist, ${this.state().projects.length} projects)`
      );
    }
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
    this.persistLocalState(fresh);
    void this.media.clearAllLocalMedia();
    this.showToast('Reset local browser data to a blank slate');
  }

  /* ========================================================================
     OPTIONAL FIREBASE AUTH & CLOUD FIRESTORE SYNC
     Account doc: `/users/{uid}`
     Project docs: `/users/{uid}/projects/{projectId}`
     ======================================================================== */

  private clearFirestoreListeners(): void {
    if (this.unsubscribeUserFirestore) {
      this.unsubscribeUserFirestore();
      this.unsubscribeUserFirestore = null;
    }
    if (this.unsubscribeProjectsFirestore) {
      this.unsubscribeProjectsFirestore();
      this.unsubscribeProjectsFirestore = null;
    }
  }

  initAuthListener(): void {
    const fb = getFirebaseHandles();
    if (!fb) {
      this.cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
      return;
    }
    onAuthStateChanged(fb.auth, async (user) => {
      this.currentUser.set(user);
      this.clearFirestoreListeners();
      if (!user) {
        this.cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
        return;
      }
      await this.syncSignedInUser(fb, user);
    });
  }

  private applyUploadedPhotoPaths(uploadedMap: Map<string, string>): void {
    if (uploadedMap.size === 0) {
      return;
    }
    const attachPaths = (photos: UserUploadedPhoto[]): UserUploadedPhoto[] =>
      photos.map((ph) =>
        uploadedMap.has(ph.id) ? { ...ph, storagePath: uploadedMap.get(ph.id) } : ph
      );

    this.commit(
      (prev) => ({
        ...prev,
        uploadedPhotos: attachPaths(prev.uploadedPhotos),
        projects: prev.projects.map((p) => ({
          ...p,
          photos: attachPaths(p.photos),
          models: p.models.map((m) => ({
            ...m,
            photos: attachPaths(m.photos),
          })),
        })),
      }),
      'none'
    );
  }

  private async syncSignedInUser(fb: FirebaseHandles, user: User): Promise<void> {
    this.cloudSyncStatus.set(CloudSyncStatus.Syncing);
    const userDocRef = doc(fb.db, 'users', user.uid);
    const projectsColRef = collection(fb.db, 'users', user.uid, 'projects');

    try {
      const [userSnap, projectsSnap] = await Promise.all([
        getDoc(userDocRef),
        getDocs(projectsColRef),
      ]);

      const remoteUserData = userSnap.exists()
        ? (userSnap.data() as Record<string, unknown>)
        : null;

      const subcollectionProjects: UserProject[] = [];
      projectsSnap.forEach((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        subcollectionProjects.push(normalizeIncomingProject({ ...raw, id: docSnap.id }));
      });

      if (remoteUserData) {
        this.importAccountPayload(remoteUserData, 'merge', false);
      }
      if (subcollectionProjects.length > 0) {
        this.importAccountPayload({ projects: subcollectionProjects }, 'merge', false);
      }

      const uploadedMap = await this.media.syncPendingBlobsToCloud(
        this.allUploadedPhotos(),
        user.uid
      );
      this.applyUploadedPhotoPaths(uploadedMap);

      await this.pushAllToFirestore(this.state());

      this.unsubscribeUserFirestore = onSnapshot(userDocRef, (docSnap) => {
        if (!docSnap.exists() || docSnap.metadata.hasPendingWrites) {
          return;
        }
        const remote = docSnap.data() as Partial<UserAccountState>;
        if (remote.updatedAt && remote.updatedAt > this.state().updatedAt) {
          const normalized = normalizeAccountState({
            ...remote,
            projects: this.state().projects,
          });
          this.state.set(normalized);
          this.persistLocalState(normalized);
        }
      });

      this.unsubscribeProjectsFirestore = onSnapshot(projectsColRef, (querySnap) => {
        if (querySnap.metadata.hasPendingWrites) {
          return;
        }
        const remoteProjects: UserProject[] = [];
        querySnap.forEach((docSnap) => {
          const raw = docSnap.data() as Record<string, unknown>;
          remoteProjects.push(normalizeIncomingProject({ ...raw, id: docSnap.id }));
        });
        remoteProjects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const next: UserAccountState = {
          ...this.state(),
          projects: remoteProjects.slice(0, USER_LIMITS.MAX_PROJECTS),
        };
        this.state.set(next);
        this.persistLocalState(next);
      });

      this.cloudSyncStatus.set(CloudSyncStatus.Synced);
    } catch (err) {
      console.warn('Firestore user sync failed:', err);
      this.cloudSyncStatus.set(CloudSyncStatus.Error);
    }
  }

  private async runFirestoreSync(
    errorLabel: string,
    op: (fb: FirebaseHandles, uid: string) => Promise<void>
  ): Promise<void> {
    const fb = getFirebaseHandles();
    const user = this.currentUser();
    if (!fb || !user) {
      return;
    }
    try {
      this.cloudSyncStatus.set(CloudSyncStatus.Syncing);
      await op(fb, user.uid);
      this.cloudSyncStatus.set(CloudSyncStatus.Synced);
    } catch (err) {
      console.warn(errorLabel, err);
      this.cloudSyncStatus.set(CloudSyncStatus.Error);
    }
  }

  private pushAccountDocToFirestore(stateToSave: UserAccountState): Promise<void> {
    return this.runFirestoreSync('Failed to sync account document to Firestore:', (fb, uid) =>
      setDoc(doc(fb.db, 'users', uid), stripUndefinedDeep(extractAccountDocPayload(stateToSave)), {
        merge: true,
      })
    );
  }

  private pushProjectToFirestore(project: UserProject): Promise<void> {
    return this.runFirestoreSync(
      `Failed to sync project ${project.id} to Firestore:`,
      (fb, uid) => setDoc(doc(fb.db, 'users', uid, 'projects', project.id), stripUndefinedDeep(project))
    );
  }

  private deleteProjectFromFirestore(projectId: string): Promise<void> {
    return this.runFirestoreSync(
      `Failed to delete project ${projectId} from Firestore:`,
      (fb, uid) => deleteDoc(doc(fb.db, 'users', uid, 'projects', projectId))
    );
  }

  private pushAllToFirestore(
    stateToSave: UserAccountState,
    deletedProjectIds: string[] = []
  ): Promise<void> {
    return this.runFirestoreSync('Failed to batch-sync account & projects to Firestore:', (fb, uid) => {
      const batch = writeBatch(fb.db);
      batch.set(
        doc(fb.db, 'users', uid),
        stripUndefinedDeep(extractAccountDocPayload(stateToSave)),
        { merge: true }
      );
      for (const proj of stateToSave.projects.slice(0, USER_LIMITS.MAX_PROJECTS)) {
        batch.set(doc(fb.db, 'users', uid, 'projects', proj.id), stripUndefinedDeep(proj));
      }
      for (const delId of deletedProjectIds) {
        batch.delete(doc(fb.db, 'users', uid, 'projects', delId));
      }
      return batch.commit();
    });
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
