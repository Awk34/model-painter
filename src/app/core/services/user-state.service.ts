import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
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
  isSafeRecordKey,
  normalizeAccountState,
  normalizeConfigurations,
  normalizeFeaturedImage,
  normalizeIncomingProject,
  normalizePreferences,
  optionalTrimmedString,
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
  CollectionReference,
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  FirestoreError,
  QuerySnapshot,
  WriteBatch,
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
export class UserStateService implements OnDestroy {
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
  private unsubscribeAuth: (() => void) | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private authGeneration = 0;
  private activeSyncedUid: string | null = null;
  private pendingAccountWrites = 0;
  private pendingBatchWrites = 0;
  private readonly pendingProjectWrites = new Map<string, number>();
  private readonly pendingProjectDeletes = new Map<string, number>();

  constructor() {
    this.initAuthListener();
  }

  ngOnDestroy(): void {
    if (this.unsubscribeAuth) {
      this.unsubscribeAuth();
      this.unsubscribeAuth = null;
    }
    this.clearFirestoreListeners();
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
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
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.toastMessage.set(msg);
    this.toastTimer = setTimeout(() => {
      this.toastTimer = null;
      if (this.toastMessage() === msg) {
        this.toastMessage.set(null);
      }
    }, 3500);
  }

  private commit(
    updater: (prev: UserAccountState) => UserAccountState,
    syncPlan: CloudSyncPlan = { account: true }
  ): void {
    const prev = this.state();
    const prevProjects = prev.projects;
    const next = updater(prev);
    if (next === prev) {
      return;
    }
    const committed: UserAccountState = {
      ...next,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    };
    this.state.set(committed);
    this.persistLocalState(committed);

    if (syncPlan === 'none' || !this.currentUser()) {
      return;
    }

    if (syncPlan === 'all') {
      const nextIds = new Set(committed.projects.map((p) => p.id));
      const removedIds = prevProjects.filter((p) => !nextIds.has(p.id)).map((p) => p.id);
      void this.pushAllToFirestore(committed, removedIds);
      return;
    }

    if (syncPlan.account) {
      void this.pushAccountDocToFirestore(committed);
    }
    for (const projectId of syncPlan.projectIds ?? []) {
      const proj = committed.projects.find((p) => p.id === projectId);
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
      (prev) => {
        const idx = prev.projects.findIndex((p) => p.id === projectId);
        if (idx === -1) {
          return prev;
        }
        const existing = prev.projects[idx];
        const updated = updater(existing, now);
        if (updated === existing) {
          return prev;
        }
        const nextProjects = [...prev.projects];
        nextProjects[idx] = updated;
        return {
          ...prev,
          projects: nextProjects,
        };
      },
      { projectIds: [projectId] }
    );
  }

  private updateProjectModelById(
    projectId: string,
    entryId: string,
    updater: (entry: ProjectModelEntry, now: string) => ProjectModelEntry
  ): void {
    this.updateProjectById(projectId, (p, now) => {
      const idx = p.models.findIndex((m) => m.id === entryId);
      if (idx === -1) {
        return p;
      }
      const existing = p.models[idx];
      const updated = updater(existing, now);
      if (updated === existing) {
        return p;
      }
      const nextModels = [...p.models];
      nextModels[idx] = updated;
      return {
        ...p,
        updatedAt: now,
        models: nextModels,
      };
    });
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
      if (added === 0) {
        return prev;
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
      if (added === 0) {
        return prev;
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
    if (!modelId || !isSafeRecordKey(modelId)) {
      return [];
    }
    const progress = this.modelProgress();
    return Object.hasOwn(progress, modelId) ? progress[modelId] : [];
  }

  isStepDone(modelId: string, stepId: string): boolean {
    if (!modelId || !stepId || !isSafeRecordKey(modelId)) {
      return false;
    }
    return this.getCompletedStepIds(modelId).includes(stepId);
  }

  toggleStepDone(modelId: string, stepId: string): void {
    if (!modelId || !stepId || !isSafeRecordKey(modelId)) {
      return;
    }
    this.commit((prev) => {
      const currentMap = prev.modelProgress ?? {};
      const existing = Object.hasOwn(currentMap, modelId) ? currentMap[modelId] : [];
      const nextSet = new Set(existing);
      if (nextSet.has(stepId)) {
        nextSet.delete(stepId);
      } else {
        if (
          existing.length === 0 &&
          Object.keys(currentMap).length >= USER_LIMITS.MAX_MODEL_PROGRESS_KEYS
        ) {
          this.showToast(
            `Model progress limit reached (${USER_LIMITS.MAX_MODEL_PROGRESS_KEYS} models max).`
          );
          return prev;
        }
        nextSet.add(stepId);
      }
      const nextList = Array.from(nextSet).slice(0, USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS);
      if (
        nextList.length === existing.length &&
        nextList.every((id, idx) => id === existing[idx])
      ) {
        return prev;
      }
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

  setStepsDone(modelId: string, stepIds: string[], done: boolean): void {
    const validIds = stepIds.filter(Boolean);
    if (!modelId || !isSafeRecordKey(modelId) || validIds.length === 0) {
      return;
    }
    this.commit((prev) => {
      const currentMap = prev.modelProgress ?? {};
      const existing = Object.hasOwn(currentMap, modelId) ? currentMap[modelId] : [];
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
      if (
        nextList.length === existing.length &&
        nextList.every((id, idx) => id === existing[idx])
      ) {
        return prev;
      }
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
    if (!modelId || !isSafeRecordKey(modelId)) {
      return;
    }
    let cleared = false;
    this.commit((prev) => {
      const currentMap = prev.modelProgress ?? {};
      if (!Object.hasOwn(currentMap, modelId)) {
        return prev;
      }
      cleared = true;
      const nextMap = { ...currentMap };
      delete nextMap[modelId];
      return {
        ...prev,
        modelProgress: nextMap,
      };
    });
    if (cleared) {
      this.showToast('Cleared painting progress for this model');
    }
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
    this.updateProjectModelById(projectId, entryId, (entry, now) => {
      const nextSet = new Set(entry.completedStepIds);
      if (nextSet.has(stepId)) {
        nextSet.delete(stepId);
      } else {
        nextSet.add(stepId);
      }
      const nextList = Array.from(nextSet).slice(0, USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS);
      if (
        nextList.length === entry.completedStepIds.length &&
        nextList.every((id, idx) => id === entry.completedStepIds[idx])
      ) {
        return entry;
      }
      return {
        ...entry,
        completedStepIds: nextList,
        updatedAt: now,
      };
    });
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
      const nextList = Array.from(nextSet).slice(0, USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS);
      if (
        nextList.length === entry.completedStepIds.length &&
        nextList.every((id, idx) => id === entry.completedStepIds[idx])
      ) {
        return entry;
      }
      return {
        ...entry,
        completedStepIds: nextList,
        updatedAt: now,
      };
    });
  }

  clearProjectModelProgress(projectId: string, entryId: string): void {
    if (!projectId || !entryId) {
      return;
    }
    let cleared = false;
    this.updateProjectModelById(projectId, entryId, (entry, now) => {
      if (entry.completedStepIds.length === 0) {
        return entry;
      }
      cleared = true;
      return {
        ...entry,
        completedStepIds: [],
        updatedAt: now,
      };
    });
    if (cleared) {
      this.showToast('Cleared painting progress for this project model');
    }
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
        next.featuredImage = normalizeFeaturedImage(patch.featuredImage);
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
        id: optionalTrimmedString(c.id, 120) ?? createEntityId('blk'),
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

  private commitUploadedPhotos(params: {
    targetType: UserPhotoTargetType;
    targetId: string;
    kind: UserPhotoKind;
    resolvedProjectId: string | undefined;
    uploaded: UserUploadedPhoto[];
    startAuthGen: number;
    startUid: string | null;
  }): { accepted: UserUploadedPhoto[]; rejected: UserUploadedPhoto[]; abortReason?: string } {
    const {
      targetType,
      targetId,
      kind,
      resolvedProjectId,
      uploaded,
      startAuthGen,
      startUid,
    } = params;
    const currentUid = this.currentUser()?.uid ?? null;
    if (startAuthGen !== this.authGeneration || currentUid !== startUid) {
      return {
        accepted: [],
        rejected: uploaded,
        abortReason: 'Account session changed during upload; discarded pending photos.',
      };
    }

    const sectionLimit = this.getPhotoQuotaLimit(targetType, kind);
    let accepted: UserUploadedPhoto[] = [];
    let rejected: UserUploadedPhoto[] = uploaded;
    let targetMissing = false;

    const commitTarget = (prev: UserAccountState): UserAccountState => {
      const totalAccountCount =
        prev.uploadedPhotos.length +
        prev.projects.reduce((sum, p) => sum + collectProjectPhotos(p).length, 0);
      const remainingAccount = Math.max(0, USER_LIMITS.MAX_TOTAL_USER_PHOTOS - totalAccountCount);

      let remainingSection = 0;
      if (targetType === 'project' && resolvedProjectId) {
        const proj = prev.projects.find((p) => p.id === resolvedProjectId);
        if (!proj) {
          targetMissing = true;
          return prev;
        }
        const kindCount = proj.photos.filter((ph) => ph.kind === kind).length;
        const remainingKind = Math.max(0, sectionLimit - kindCount);
        const remainingContainer = Math.max(
          0,
          USER_LIMITS.MAX_PROJECT_PHOTOS_PER_PROJECT - proj.photos.length
        );
        remainingSection = Math.min(remainingKind, remainingContainer);
      } else if (targetType === 'project_model' && resolvedProjectId) {
        const proj = prev.projects.find((p) => p.id === resolvedProjectId);
        const entry = proj?.models.find((m) => m.id === targetId);
        if (!proj || !entry) {
          targetMissing = true;
          return prev;
        }
        const kindCount = entry.photos.filter((ph) => ph.kind === kind).length;
        const remainingKind = Math.max(0, sectionLimit - kindCount);
        const remainingContainer = Math.max(
          0,
          USER_LIMITS.MAX_PHOTOS_PER_PROJECT_MODEL - entry.photos.length
        );
        remainingSection = Math.min(remainingKind, remainingContainer);
      } else {
        const kindCount = prev.uploadedPhotos.filter(
          (ph) => ph.targetType === targetType && ph.targetId === targetId && ph.kind === kind
        ).length;
        remainingSection = Math.max(0, sectionLimit - kindCount);
      }

      const allowedCount = Math.min(uploaded.length, remainingSection, remainingAccount);
      accepted = uploaded.slice(0, allowedCount);
      rejected = uploaded.slice(allowedCount);
      if (accepted.length === 0) {
        return prev;
      }

      const now = new Date().toISOString();
      if (targetType === 'project' && resolvedProjectId) {
        return {
          ...prev,
          projects: prev.projects.map((p) =>
            p.id === resolvedProjectId
              ? { ...p, photos: [...accepted, ...p.photos], updatedAt: now }
              : p
          ),
        };
      }
      if (targetType === 'project_model' && resolvedProjectId) {
        return {
          ...prev,
          projects: prev.projects.map((p) =>
            p.id === resolvedProjectId
              ? {
                  ...p,
                  updatedAt: now,
                  models: p.models.map((entry) =>
                    entry.id === targetId
                      ? { ...entry, photos: [...accepted, ...entry.photos], updatedAt: now }
                      : entry
                  ),
                }
              : p
          ),
        };
      }
      return {
        ...prev,
        uploadedPhotos: [...accepted, ...prev.uploadedPhotos],
      };
    };

    const syncPlan: CloudSyncPlan =
      (targetType === 'project' || targetType === 'project_model') && resolvedProjectId
        ? { projectIds: [resolvedProjectId] }
        : { account: true };

    this.commit(commitTarget, syncPlan);

    return {
      accepted,
      rejected,
      abortReason: targetMissing
        ? 'Target project or model was deleted before upload completed.'
        : undefined,
    };
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
    const startAuthGen = this.authGeneration;
    const startUid = this.currentUser()?.uid ?? null;
    const downscaledPhotoIds = new Set<string>();

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
          uid: startUid ?? undefined,
        });
        if (result.wasDownscaled) {
          downscaledPhotoIds.add(result.photo.id);
        }
        uploaded.push(result.photo);
        remainingSectionSlots--;
        remainingAccountSlots--;
      } catch (err: unknown) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    if (uploaded.length === 0) {
      return { uploaded, errors };
    }

    const { accepted, rejected, abortReason } = this.commitUploadedPhotos({
      targetType,
      targetId,
      kind,
      resolvedProjectId,
      uploaded,
      startAuthGen,
      startUid,
    });

    for (const orphan of rejected) {
      void this.media.deletePhotoAssets(orphan);
    }

    if (abortReason) {
      errors.push(abortReason);
    } else if (rejected.length > 0) {
      errors.push(
        `Skipped ${rejected.length} photo${rejected.length > 1 ? 's' : ''}: quota reached while uploading.`
      );
    }

    if (accepted.length > 0) {
      const acceptedDownscaled = accepted.filter((ph) => downscaledPhotoIds.has(ph.id)).length;
      const resizeNote =
        acceptedDownscaled > 0
          ? ` (${acceptedDownscaled} auto-downscaled to ≤ ${USER_LIMITS.MAX_PHOTO_FILE_SIZE_MB} MB)`
          : '';
      this.showToast(
        `Uploaded ${accepted.length} ${kind === 'reference' ? 'private reference ' : ''}photo${
          accepted.length > 1 ? 's' : ''
        }${resizeNote}`
      );
    }

    return { uploaded: accepted, errors };
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
      isPrivate: params.kind === 'reference',
      fileName: safeFileName,
      mimeType: info.mimeType,
      sizeBytes: Math.max(1, Math.trunc(info.blob.size)),
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
    const safeName = (paint.name ?? '').trim().slice(0, USER_LIMITS.MAX_TITLE_LENGTH);
    if (!safeName) {
      this.showToast('Custom paint name is required.');
      return null;
    }
    const created: ThirdPartyPaint = {
      ...paint,
      name: safeName,
      brand:
        (paint.brand ?? '').trim().slice(0, USER_LIMITS.MAX_TITLE_LENGTH) || 'Custom Brand',
      range:
        (paint.range ?? '').trim().slice(0, USER_LIMITS.MAX_TITLE_LENGTH) || 'Custom Range',
      code: optionalTrimmedString(paint.code, 64),
      category: (paint.category ?? '').trim().slice(0, 64) || 'Layer',
      potStyle: optionalTrimmedString(paint.potStyle, 64),
      hex: (paint.hex ?? '').trim().slice(0, 16) || '#888888',
      citadelMatches: (paint.citadelMatches ?? []).slice(
        0,
        USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT
      ),
      id: createEntityId('custom'),
      isCustom: true,
    };
    this.commit((prev) => {
      const nextOverrides = { ...prev.customCompatibilityOverrides };
      for (const m of created.citadelMatches) {
        if (!isSafeRecordKey(m.citadelPaintId)) {
          continue;
        }
        const hasKey = Object.hasOwn(nextOverrides, m.citadelPaintId);
        if (
          !hasKey &&
          Object.keys(nextOverrides).length >= USER_LIMITS.MAX_COMPATIBILITY_OVERRIDE_KEYS
        ) {
          continue;
        }
        const list = new Set(hasKey ? nextOverrides[m.citadelPaintId] : []);
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
    if (!citadelPaintId || !equivalentPaintId || !isSafeRecordKey(citadelPaintId)) {
      return;
    }
    const currentOverrides = this.state().customCompatibilityOverrides;
    const hasKey = Object.hasOwn(currentOverrides, citadelPaintId);
    const existingList = hasKey ? currentOverrides[citadelPaintId] : [];
    if (
      !hasKey &&
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
      const existing = Object.hasOwn(nextOverrides, citadelPaintId)
        ? nextOverrides[citadelPaintId]
        : [];
      const list = new Set(existing);
      if (list.has(equivalentPaintId)) {
        return prev;
      }
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
              projectMap.set(incomingP.id, {
                ...incomingP,
                createdAt: existing.createdAt,
              });
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
            photoMap.set(ph.id, {
              ...ph,
              isPrivate: ph.kind === 'reference' ? true : Boolean(ph.isPrivate),
            });
          }
        }

        const mergedProgress: Record<string, string[]> = {};
        for (const [modelId, existingSteps] of Object.entries(base.modelProgress ?? {})) {
          if (isSafeRecordKey(modelId)) {
            mergedProgress[modelId] = existingSteps;
          }
        }
        for (const [modelId, incomingSteps] of Object.entries(incoming.modelProgress ?? {})) {
          if (!isSafeRecordKey(modelId)) {
            continue;
          }
          const hasModel = Object.hasOwn(mergedProgress, modelId);
          if (
            !hasModel &&
            Object.keys(mergedProgress).length >= USER_LIMITS.MAX_MODEL_PROGRESS_KEYS
          ) {
            break;
          }
          const combined = Array.from(
            new Set([...(hasModel ? mergedProgress[modelId] : []), ...incomingSteps])
          ).slice(0, USER_LIMITS.MAX_STEPS_PER_MODEL_PROGRESS);
          if (combined.length > 0) {
            mergedProgress[modelId] = combined;
          }
        }

        const mergedOverrides: Record<string, string[]> = {};
        for (const [paintId, existingIds] of Object.entries(
          base.customCompatibilityOverrides ?? {}
        )) {
          if (isSafeRecordKey(paintId)) {
            mergedOverrides[paintId] = existingIds;
          }
        }
        for (const [paintId, incomingIds] of Object.entries(
          incoming.customCompatibilityOverrides ?? {}
        )) {
          if (!isSafeRecordKey(paintId)) {
            continue;
          }
          const hasPaint = Object.hasOwn(mergedOverrides, paintId);
          if (
            !hasPaint &&
            Object.keys(mergedOverrides).length >= USER_LIMITS.MAX_COMPATIBILITY_OVERRIDE_KEYS
          ) {
            break;
          }
          const combined = Array.from(
            new Set([...(hasPaint ? mergedOverrides[paintId] : []), ...incomingIds])
          ).slice(0, USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT);
          if (combined.length > 0) {
            mergedOverrides[paintId] = combined;
          }
        }

        const hasRawPreferences =
          Object.hasOwn(rawPayload, 'preferences') &&
          Boolean(rawPayload['preferences']) &&
          typeof rawPayload['preferences'] === 'object' &&
          !Array.isArray(rawPayload['preferences']);
        const mergedPreferences = hasRawPreferences
          ? normalizePreferences(rawPayload['preferences'], base.preferences)
          : {
              ...base.preferences,
              preferredThirdPartyBrands: [...base.preferences.preferredThirdPartyBrands],
            };

        return {
          ...base,
          inventoryPaintIds: Array.from(invSet).slice(0, USER_LIMITS.MAX_INVENTORY_PAINTS),
          wishlistPaintIds: Array.from(wishSet).slice(0, USER_LIMITS.MAX_WISHLIST_PAINTS),
          inventoryModelIds: Array.from(modelInvSet).slice(0, USER_LIMITS.MAX_INVENTORY_MODELS),
          wishlistModelIds: Array.from(modelWishSet).slice(0, USER_LIMITS.MAX_WISHLIST_MODELS),
          customPaints: Array.from(customPaintMap.values()),
          customCompatibilityOverrides: mergedOverrides,
          modelProgress: mergedProgress,
          projects: Array.from(projectMap.values()),
          uploadedPhotos: Array.from(photoMap.values()),
          preferences: mergedPreferences,
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
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  protected getFbHandles(): FirebaseHandles | null {
    return getFirebaseHandles();
  }

  protected getUserDocRef(db: FirebaseHandles['db'], uid: string): DocumentReference {
    return doc(db, 'users', uid);
  }

  protected getProjectsColRef(db: FirebaseHandles['db'], uid: string): CollectionReference {
    return collection(db, 'users', uid, 'projects');
  }

  protected getProjectDocRef(
    db: FirebaseHandles['db'],
    uid: string,
    projectId: string
  ): DocumentReference {
    return doc(db, 'users', uid, 'projects', projectId);
  }

  protected subscribeAuthState(
    auth: FirebaseHandles['auth'],
    callback: (user: User | null) => void
  ): () => void {
    return onAuthStateChanged(auth, callback);
  }

  protected fetchDocSnap(ref: DocumentReference): Promise<DocumentSnapshot> {
    return getDoc(ref);
  }

  protected fetchQuerySnap(ref: CollectionReference): Promise<QuerySnapshot> {
    return getDocs(ref);
  }

  protected subscribeDocSnapshot(
    ref: DocumentReference,
    onNext: (snap: DocumentSnapshot) => void,
    onError: (err: FirestoreError) => void
  ): () => void {
    return onSnapshot(ref, onNext, onError);
  }

  protected subscribeQuerySnapshot(
    ref: CollectionReference,
    onNext: (snap: QuerySnapshot) => void,
    onError: (err: FirestoreError) => void
  ): () => void {
    return onSnapshot(ref, onNext, onError);
  }

  protected writeDoc(
    ref: DocumentReference,
    data: DocumentData,
    options?: { merge?: boolean }
  ): Promise<void> {
    return options ? setDoc(ref, data, options) : setDoc(ref, data);
  }

  protected removeDoc(ref: DocumentReference): Promise<void> {
    return deleteDoc(ref);
  }

  protected createWriteBatch(db: FirebaseHandles['db']): WriteBatch {
    return writeBatch(db);
  }

  protected sdkSignOut(auth: FirebaseHandles['auth']): Promise<void> {
    return signOut(auth);
  }

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
    if (this.unsubscribeAuth) {
      this.unsubscribeAuth();
      this.unsubscribeAuth = null;
    }
    this.clearFirestoreListeners();
    const fb = this.getFbHandles();
    if (!fb) {
      this.cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
      return;
    }
    this.unsubscribeAuth = this.subscribeAuthState(fb.auth, (user) => {
      const authGen = ++this.authGeneration;
      this.currentUser.set(user);
      this.clearFirestoreListeners();
      if (!user) {
        this.cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
        return;
      }
      void this.syncSignedInUser(fb, user, authGen);
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

  private async syncSignedInUser(
    fb: FirebaseHandles,
    user: User,
    authGen: number
  ): Promise<void> {
    this.cloudSyncStatus.set(CloudSyncStatus.Syncing);
    const userDocRef = this.getUserDocRef(fb.db, user.uid);
    const projectsColRef = this.getProjectsColRef(fb.db, user.uid);

    try {
      if (this.activeSyncedUid && this.activeSyncedUid !== user.uid) {
        const fresh = createDefaultState();
        this.state.set(fresh);
        this.persistLocalState(fresh);
        await this.media.clearAllLocalMedia();
        if (authGen !== this.authGeneration) {
          return;
        }
      }

      const [userSnap, projectsSnap] = await Promise.all([
        this.fetchDocSnap(userDocRef),
        this.fetchQuerySnap(projectsColRef),
      ]);
      if (authGen !== this.authGeneration) {
        return;
      }
      this.activeSyncedUid = user.uid;

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
      if (authGen !== this.authGeneration) {
        return;
      }
      this.applyUploadedPhotoPaths(uploadedMap);

      await this.pushAllToFirestore(this.state());
      if (authGen !== this.authGeneration) {
        return;
      }

      this.unsubscribeUserFirestore = this.subscribeDocSnapshot(
        userDocRef,
        (docSnap) => {
          if (
            authGen !== this.authGeneration ||
            !docSnap.exists() ||
            docSnap.metadata.hasPendingWrites ||
            this.pendingAccountWrites > 0 ||
            this.pendingBatchWrites > 0
          ) {
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
        },
        (err) => {
          if (authGen !== this.authGeneration) {
            return;
          }
          console.warn('Firestore user listener error:', err);
          this.cloudSyncStatus.set(CloudSyncStatus.Error);
        }
      );

      this.unsubscribeProjectsFirestore = this.subscribeQuerySnapshot(
        projectsColRef,
        (querySnap) => {
          if (
            authGen !== this.authGeneration ||
            querySnap.metadata.hasPendingWrites ||
            this.pendingBatchWrites > 0
          ) {
            return;
          }
          const remoteMap = new Map<string, UserProject>();
          querySnap.forEach((docSnap) => {
            if ((this.pendingProjectDeletes.get(docSnap.id) ?? 0) > 0) {
              return;
            }
            const raw = docSnap.data() as Record<string, unknown>;
            remoteMap.set(docSnap.id, normalizeIncomingProject({ ...raw, id: docSnap.id }));
          });
          for (const localProj of this.state().projects) {
            if ((this.pendingProjectWrites.get(localProj.id) ?? 0) > 0) {
              remoteMap.set(localProj.id, localProj);
            }
          }
          const remoteProjects = Array.from(remoteMap.values());
          remoteProjects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          const next: UserAccountState = {
            ...this.state(),
            projects: remoteProjects.slice(0, USER_LIMITS.MAX_PROJECTS),
          };
          this.state.set(next);
          this.persistLocalState(next);
        },
        (err) => {
          if (authGen !== this.authGeneration) {
            return;
          }
          console.warn('Firestore projects listener error:', err);
          this.cloudSyncStatus.set(CloudSyncStatus.Error);
        }
      );

      this.cloudSyncStatus.set(CloudSyncStatus.Synced);
    } catch (err) {
      if (authGen !== this.authGeneration) {
        return;
      }
      console.warn('Firestore user sync failed:', err);
      this.cloudSyncStatus.set(CloudSyncStatus.Error);
    }
  }

  private async runFirestoreSync(
    errorLabel: string,
    op: (fb: FirebaseHandles, uid: string) => Promise<void>
  ): Promise<void> {
    const fb = this.getFbHandles();
    const user = this.currentUser();
    if (!fb || !user) {
      return;
    }
    const startGen = this.authGeneration;
    try {
      this.cloudSyncStatus.set(CloudSyncStatus.Syncing);
      await op(fb, user.uid);
      if (startGen === this.authGeneration) {
        this.cloudSyncStatus.set(CloudSyncStatus.Synced);
      }
    } catch (err) {
      console.warn(errorLabel, err);
      if (startGen === this.authGeneration) {
        this.cloudSyncStatus.set(CloudSyncStatus.Error);
      }
    }
  }

  private async pushAccountDocToFirestore(stateToSave: UserAccountState): Promise<void> {
    this.pendingAccountWrites++;
    try {
      await this.runFirestoreSync('Failed to sync account document to Firestore:', (fb, uid) =>
        this.writeDoc(
          this.getUserDocRef(fb.db, uid),
          stripUndefinedDeep(extractAccountDocPayload(stateToSave)),
          { merge: true }
        )
      );
    } finally {
      this.pendingAccountWrites = Math.max(0, this.pendingAccountWrites - 1);
    }
  }

  private async pushProjectToFirestore(project: UserProject): Promise<void> {
    this.pendingProjectWrites.set(
      project.id,
      (this.pendingProjectWrites.get(project.id) ?? 0) + 1
    );
    try {
      await this.runFirestoreSync(
        `Failed to sync project ${project.id} to Firestore:`,
        (fb, uid) =>
          this.writeDoc(
            this.getProjectDocRef(fb.db, uid, project.id),
            stripUndefinedDeep(project)
          )
      );
    } finally {
      const remaining = (this.pendingProjectWrites.get(project.id) ?? 1) - 1;
      if (remaining > 0) {
        this.pendingProjectWrites.set(project.id, remaining);
      } else {
        this.pendingProjectWrites.delete(project.id);
      }
    }
  }

  private async deleteProjectFromFirestore(projectId: string): Promise<void> {
    this.pendingProjectDeletes.set(
      projectId,
      (this.pendingProjectDeletes.get(projectId) ?? 0) + 1
    );
    try {
      await this.runFirestoreSync(
        `Failed to delete project ${projectId} from Firestore:`,
        (fb, uid) => this.removeDoc(this.getProjectDocRef(fb.db, uid, projectId))
      );
    } finally {
      const remaining = (this.pendingProjectDeletes.get(projectId) ?? 1) - 1;
      if (remaining > 0) {
        this.pendingProjectDeletes.set(projectId, remaining);
      } else {
        this.pendingProjectDeletes.delete(projectId);
      }
    }
  }

  private async pushAllToFirestore(
    stateToSave: UserAccountState,
    deletedProjectIds: string[] = []
  ): Promise<void> {
    this.pendingBatchWrites++;
    try {
      await this.runFirestoreSync(
        'Failed to batch-sync account & projects to Firestore:',
        (fb, uid) => {
          const batch = this.createWriteBatch(fb.db);
          batch.set(
            this.getUserDocRef(fb.db, uid),
            stripUndefinedDeep(extractAccountDocPayload(stateToSave)),
            { merge: true }
          );
          for (const proj of stateToSave.projects.slice(0, USER_LIMITS.MAX_PROJECTS)) {
            batch.set(
              this.getProjectDocRef(fb.db, uid, proj.id),
              stripUndefinedDeep(proj)
            );
          }
          for (const delId of deletedProjectIds) {
            batch.delete(this.getProjectDocRef(fb.db, uid, delId));
          }
          return batch.commit();
        }
      );
    } finally {
      this.pendingBatchWrites = Math.max(0, this.pendingBatchWrites - 1);
    }
  }

  async signInWithGoogle(): Promise<void> {
    const fb = this.getFbHandles();
    if (!fb) {
      throw new Error('Configure your Firebase Project credentials first to enable Cloud Auth.');
    }
    const provider = new GoogleAuthProvider();
    await signInWithPopup(fb.auth, provider);
    this.showToast('Signed in with Google & synced hobby desk');
  }

  async signInWithEmail(email: string, pass: string, isSignUp = false): Promise<void> {
    const fb = this.getFbHandles();
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
    const fb = this.getFbHandles();
    if (!fb) {
      return;
    }
    const signOutGen = ++this.authGeneration;
    this.clearFirestoreListeners();
    await this.sdkSignOut(fb.auth);
    if (this.authGeneration !== signOutGen && this.currentUser() !== null) {
      return;
    }
    this.activeSyncedUid = null;
    this.currentUser.set(null);
    this.cloudSyncStatus.set(CloudSyncStatus.LocalOnly);
    const fresh = createDefaultState();
    this.state.set(fresh);
    this.persistLocalState(fresh);
    await this.media.clearAllLocalMedia();
    if (this.authGeneration !== signOutGen && this.currentUser() !== null) {
      return;
    }
    this.showToast('Signed out of Cloud Sync');
  }
}
