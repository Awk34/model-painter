import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { USER_LIMITS } from '../config/user-limits.config';
import {
  ProjectModelEntry,
  ProjectModelFeaturedImage,
  ThirdPartyCitadelMatch,
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
import { createEntityId } from '../utils/catalog-filter.util';
import { mergeUserAccountState } from '../utils/user-state-merger.util';
import {
  CURRENT_SCHEMA_VERSION,
  clampModelQuantity,
  cloneCatalogFeaturedImage,
  collectProjectPhotos,
  createDefaultState,
  isSafeRecordKey,
  normalizeAccountState,
  normalizeConfigurations,
  normalizeFeaturedImage,
  normalizeIncomingProject,
  normalizePreferences,
  optionalTrimmedString,
} from '../utils/user-state-normalizer.util';
import { clearWarhammerTokenCache } from '../utils/warhammer-pkce-storage.util';
import { invalidateLocalFirebaseConfigCache } from './firebase.config';
import { ToastService } from './toast.service';
import { CloudSyncPlan, UserCloudSyncHost, UserCloudSyncService } from './user-cloud-sync.service';
import { UserMediaService } from './user-media.service';

const STORAGE_KEY = 'whc_user_state_v1';
const DEFAULT_PROJECT_THUMBNAIL = 'assets/images/games/d8d81a80-7bf7-4fd3-8630-059a722a8bd7.png';
export const LOCAL_PERSIST_DEBOUNCE_MS = 300;

type PhotoOwnerLocation =
  | { scope: 'account' }
  | { scope: 'project'; projectId: string }
  | { scope: 'project_model'; projectId: string; entryId: string };

@Injectable({
  providedIn: 'root',
})
export class UserStateService implements OnDestroy {
  readonly media = inject(UserMediaService);
  private readonly toast = inject(ToastService);
  private readonly cloudSync = inject(UserCloudSyncService);
  readonly limits = USER_LIMITS;

  private readonly _state = signal<UserAccountState>(this.loadInitialState());
  readonly state = this._state.asReadonly();
  readonly currentUser = this.cloudSync.currentUser;
  readonly cloudSyncStatus = this.cloudSync.cloudSyncStatus;
  readonly toastMessage = this.toast.message;

  /** Fine-grained slice signals (preserve object identity across unrelated mutations) */
  readonly inventoryPaintIds = computed(() => this._state().inventoryPaintIds);
  readonly wishlistPaintIds = computed(() => this._state().wishlistPaintIds);
  readonly inventoryModelIds = computed(() => this._state().inventoryModelIds);
  readonly wishlistModelIds = computed(() => this._state().wishlistModelIds);
  readonly projects = computed(() => this._state().projects);
  /** Standalone catalog-model photos stored on `/users/{uid}` */
  readonly uploadedPhotos = computed(() => this._state().uploadedPhotos);
  readonly preferences = computed(() => this._state().preferences);
  readonly customPaints = computed(() => this._state().customPaints);
  readonly customCompatibilityOverrides = computed(
    () => this._state().customCompatibilityOverrides
  );
  readonly modelProgress = computed(() => this._state().modelProgress ?? {});

  /** Fast O(1) lookup sets and maps derived from slice signals */
  readonly inventorySet = computed(() => new Set(this.inventoryPaintIds()));
  readonly wishlistSet = computed(() => new Set(this.wishlistPaintIds()));
  readonly modelInventorySet = computed(() => new Set(this.inventoryModelIds()));
  readonly modelWishlistSet = computed(() => new Set(this.wishlistModelIds()));
  readonly customPaintById = computed(
    () => new Map(this.customPaints().map((paint) => [paint.id, paint]))
  );
  readonly projectByIdMap = computed(
    () => new Map(this.projects().map((project) => [project.id, project]))
  );
  /** All uploaded photos across standalone catalog models, projects, and project model entries */
  readonly allUploadedPhotos = computed<UserUploadedPhoto[]>(() => {
    const out: UserUploadedPhoto[] = [...this.uploadedPhotos()];
    for (const proj of this.projects()) {
      out.push(...collectProjectPhotos(proj));
    }
    return out;
  });
  readonly photoByIdMap = computed(
    () => new Map(this.allUploadedPhotos().map((photo) => [photo.id, photo]))
  );
  readonly projectModelByIdMap = computed(() => {
    const map = new Map<string, { project: UserProject; entry: ProjectModelEntry }>();
    for (const project of this.projects()) {
      for (const entry of project.models) {
        map.set(entry.id, { project, entry });
      }
    }
    return map;
  });
  readonly photoOwnerByIdMap = computed(() => {
    const map = new Map<string, PhotoOwnerLocation>();
    for (const ph of this.uploadedPhotos()) {
      map.set(ph.id, { scope: 'account' });
    }
    for (const proj of this.projects()) {
      for (const ph of proj.photos) {
        map.set(ph.id, { scope: 'project', projectId: proj.id });
      }
      for (const entry of proj.models) {
        for (const ph of entry.photos) {
          map.set(ph.id, { scope: 'project_model', projectId: proj.id, entryId: entry.id });
        }
      }
    }
    return map;
  });

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPersistState: UserAccountState | null = null;
  private readonly onPageHide = (): void => {
    this.flushLocalPersistence();
  };
  private readonly onVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.flushLocalPersistence();
    }
  };

  private readonly cloudHost: UserCloudSyncHost = {
    getState: () => this._state(),
    getAllUploadedPhotos: () => this.allUploadedPhotos(),
    resetLocalForAccountChange: async () => {
      const fresh = createDefaultState();
      this._state.set(fresh);
      this.persistLocalStateImmediate(fresh);
      clearWarhammerTokenCache();
      await this.media.clearAllLocalMedia();
    },
    mergeRemoteAccountData: (remoteUserData, subcollectionProjects) => {
      if (remoteUserData) {
        this.importAccountPayload(remoteUserData, 'merge', false);
      }
      if (subcollectionProjects.length > 0) {
        this.importAccountPayload({ projects: subcollectionProjects }, 'merge', false);
      }
    },
    attachUploadedPhotoPaths: (uploadedMap) => {
      this.applyUploadedPhotoPaths(uploadedMap);
    },
    applyRemoteAccountDoc: (normalized) => {
      this._state.set(normalized);
      this.scheduleLocalPersist(normalized);
    },
    applyRemoteProjects: (next) => {
      this._state.set(next);
      this.scheduleLocalPersist(next);
    },
  };

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.initAuthListener();
  }

  ngOnDestroy(): void {
    this.flushLocalPersistence();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
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

  private writeLocalStateNow(next: UserAccountState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('Failed to persist user state to localStorage:', e);
    }
  }

  private scheduleLocalPersist(next: UserAccountState): void {
    this.pendingPersistState = next;
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.flushLocalPersistence();
    }, LOCAL_PERSIST_DEBOUNCE_MS);
  }

  flushLocalPersistence(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.pendingPersistState !== null) {
      const stateToPersist = this.pendingPersistState;
      this.pendingPersistState = null;
      this.writeLocalStateNow(stateToPersist);
    }
  }

  private persistLocalStateImmediate(next: UserAccountState): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.pendingPersistState = null;
    this.writeLocalStateNow(next);
  }

  showToast(msg: string): void {
    this.toast.show(msg);
  }

  private commit(
    updater: (prev: UserAccountState) => UserAccountState,
    syncPlan: CloudSyncPlan = { account: true }
  ): void {
    const prev = this._state();
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
    this._state.set(committed);
    this.scheduleLocalPersist(committed);

    const nextIds = syncPlan === 'all' ? new Set(committed.projects.map((p) => p.id)) : null;
    const removedIds = nextIds
      ? prevProjects.filter((p) => !nextIds.has(p.id)).map((p) => p.id)
      : [];
    this.cloudSync.syncPlan(syncPlan, committed, removedIds);
  }

  private toggleBoundedSetItem(params: {
    id: string;
    primaryKey: 'inventoryPaintIds' | 'wishlistPaintIds' | 'inventoryModelIds' | 'wishlistModelIds';
    clearFromKey?: 'wishlistPaintIds' | 'wishlistModelIds';
    maxLimit: number;
    limitLabel: string;
  }): void {
    const currentList = this._state()[params.primaryKey];
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

  private addManyPaintsToCollection(
    paintIds: string[],
    target: 'inventory' | 'wishlist'
  ): number {
    const isInventory = target === 'inventory';
    const maxLimit = isInventory
      ? USER_LIMITS.MAX_INVENTORY_PAINTS
      : USER_LIMITS.MAX_WISHLIST_PAINTS;
    let added = 0;
    let hitLimit = false;

    this.commit((prev) => {
      const inv = new Set(prev.inventoryPaintIds);
      const wish = new Set(prev.wishlistPaintIds);
      const primary = isInventory ? inv : wish;

      for (const pid of paintIds) {
        const alreadyCovered = isInventory ? inv.has(pid) : inv.has(pid) || wish.has(pid);
        if (alreadyCovered) {
          continue;
        }
        if (primary.size >= maxLimit) {
          hitLimit = true;
          break;
        }
        primary.add(pid);
        if (isInventory) {
          wish.delete(pid);
        }
        added++;
      }

      if (added === 0) {
        return prev;
      }
      return isInventory
        ? { ...prev, inventoryPaintIds: Array.from(inv), wishlistPaintIds: Array.from(wish) }
        : { ...prev, wishlistPaintIds: Array.from(wish) };
    });

    if (hitLimit) {
      const label = isInventory ? 'Inventory' : 'Wishlist';
      this.showToast(`Added ${added} paint${added === 1 ? '' : 's'} (${label} limit of ${maxLimit} reached)`);
    } else if (added > 0) {
      this.showToast(
        isInventory
          ? `Added ${added} paint${added > 1 ? 's' : ''} to your Inventory`
          : `Added ${added} missing paint${added > 1 ? 's' : ''} to your Wishlist`
      );
    } else if (!isInventory) {
      this.showToast('All missing paints are already on your Wishlist');
    }

    return added;
  }

  addManyToWishlist(paintIds: string[]): number {
    return this.addManyPaintsToCollection(paintIds, 'wishlist');
  }

  addManyToInventory(paintIds: string[]): number {
    return this.addManyPaintsToCollection(paintIds, 'inventory');
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
    return this.projectByIdMap().get(projectId);
  }

  getProjectModelEntry(projectId: string, entryId: string): ProjectModelEntry | undefined {
    const found = this.projectModelByIdMap().get(entryId);
    return found?.project.id === projectId ? found.entry : undefined;
  }

  getProjectTotalMiniatures(project: Pick<UserProject, 'models'>): number {
    return project.models.reduce((sum, entry) => sum + Math.max(1, entry.quantity || 1), 0);
  }

  getProjectTotalPhotoCount(project: Pick<UserProject, 'photos' | 'models'>): number {
    return collectProjectPhotos(project).length;
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
     STANDALONE MODEL & PROJECT MODEL PAINTING PROGRESS
     ======================================================================== */

  private computeNextStepIds(
    existing: string[],
    stepIds: readonly string[],
    mode: 'toggle' | 'set' | 'unset'
  ): string[] | null {
    const nextSet = new Set(existing);
    for (const id of stepIds) {
      if (mode === 'toggle') {
        if (nextSet.has(id)) {
          nextSet.delete(id);
        } else {
          nextSet.add(id);
        }
      } else if (mode === 'set') {
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
      return null;
    }
    return nextList;
  }

  private updateStandaloneModelSteps(
    modelId: string,
    stepIds: readonly string[],
    mode: 'toggle' | 'set' | 'unset'
  ): void {
    const validIds = stepIds.filter(Boolean);
    if (!modelId || !isSafeRecordKey(modelId) || validIds.length === 0) {
      return;
    }
    this.commit((prev) => {
      const currentMap = prev.modelProgress ?? {};
      const existing = Object.hasOwn(currentMap, modelId) ? currentMap[modelId] : [];
      const mightAddNewKey =
        existing.length === 0 &&
        (mode === 'set' || (mode === 'toggle' && !existing.includes(validIds[0])));
      if (
        mightAddNewKey &&
        Object.keys(currentMap).length >= USER_LIMITS.MAX_MODEL_PROGRESS_KEYS
      ) {
        this.showToast(
          `Model progress limit reached (${USER_LIMITS.MAX_MODEL_PROGRESS_KEYS} models max).`
        );
        return prev;
      }

      const nextList = this.computeNextStepIds(existing, validIds, mode);
      if (!nextList) {
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

  private updateProjectModelSteps(
    projectId: string,
    entryId: string,
    stepIds: readonly string[],
    mode: 'toggle' | 'set' | 'unset'
  ): void {
    const validIds = stepIds.filter(Boolean);
    if (!projectId || !entryId || validIds.length === 0) {
      return;
    }
    this.updateProjectModelById(projectId, entryId, (entry, now) => {
      const nextList = this.computeNextStepIds(entry.completedStepIds, validIds, mode);
      if (!nextList) {
        return entry;
      }
      return {
        ...entry,
        completedStepIds: nextList,
        updatedAt: now,
      };
    });
  }

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
    this.updateStandaloneModelSteps(modelId, [stepId], 'toggle');
  }

  setStepsDone(modelId: string, stepIds: string[], done: boolean): void {
    this.updateStandaloneModelSteps(modelId, stepIds, done ? 'set' : 'unset');
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

  getProjectModelCompletedStepIds(projectId: string, entryId: string): string[] {
    return this.getProjectModelEntry(projectId, entryId)?.completedStepIds ?? [];
  }

  toggleProjectModelStepDone(projectId: string, entryId: string, stepId: string): void {
    this.updateProjectModelSteps(projectId, entryId, [stepId], 'toggle');
  }

  setProjectModelStepsDone(
    projectId: string,
    entryId: string,
    stepIds: string[],
    done: boolean
  ): void {
    this.updateProjectModelSteps(projectId, entryId, stepIds, done ? 'set' : 'unset');
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
    if (this.projects().length >= USER_LIMITS.MAX_PROJECTS) {
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
    if (this.projects().length >= USER_LIMITS.MAX_PROJECTS) {
      this.showToast(`Project limit reached (${USER_LIMITS.MAX_PROJECTS} projects max).`);
      return null;
    }
    const orig = this.getProjectById(projectId);
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
    const targetProject = this.getProjectById(projectId);
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
    const target = this.getProjectById(projectId);
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
    const target = this.getProjectById(projectId);
    if (!target) {
      return null;
    }
    if (target.models.length >= USER_LIMITS.MAX_MODELS_PER_PROJECT) {
      this.showToast(
        `Project model limit reached (${USER_LIMITS.MAX_MODELS_PER_PROJECT} models per project max).`
      );
      return null;
    }
    const orig = this.getProjectModelEntry(projectId, entryId);
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
    const target = this.getProjectById(projectId);
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
    const target = this.getProjectById(projectId);
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
    return photoId ? this.photoByIdMap().get(photoId) : undefined;
  }

  private findProjectModelEntryById(
    entryId: string
  ): { project: UserProject; entry: ProjectModelEntry } | null {
    return this.projectModelByIdMap().get(entryId) ?? null;
  }

  private locatePhotoOwner(photoId: string): PhotoOwnerLocation | null {
    return this.photoOwnerByIdMap().get(photoId) ?? null;
  }

  private updatePhotosByOwner(
    owner: PhotoOwnerLocation,
    transform: (photos: UserUploadedPhoto[]) => UserUploadedPhoto[],
    hooks?: {
      onProject?: (p: UserProject, nextPhotos: UserUploadedPhoto[], now: string) => UserProject;
      onProjectModel?: (
        e: ProjectModelEntry,
        nextPhotos: UserUploadedPhoto[],
        now: string
      ) => ProjectModelEntry;
    }
  ): void {
    if (owner.scope === 'account') {
      this.commit(
        (prev) => ({ ...prev, uploadedPhotos: transform(prev.uploadedPhotos) }),
        { account: true }
      );
      return;
    }
    if (owner.scope === 'project') {
      this.updateProjectById(owner.projectId, (p, now) => {
        const nextPhotos = transform(p.photos);
        return hooks?.onProject
          ? hooks.onProject(p, nextPhotos, now)
          : { ...p, photos: nextPhotos, updatedAt: now };
      });
      return;
    }
    this.updateProjectModelById(owner.projectId, owner.entryId, (entry, now) => {
      const nextPhotos = transform(entry.photos);
      return hooks?.onProjectModel
        ? hooks.onProjectModel(entry, nextPhotos, now)
        : { ...entry, photos: nextPhotos, updatedAt: now };
    });
  }

  private getRemainingSectionPhotoSlots(
    prev: UserAccountState,
    targetType: UserPhotoTargetType,
    targetId: string,
    kind: UserPhotoKind,
    resolvedProjectId: string | undefined,
    sectionLimit: number
  ): { remaining: number; targetMissing: boolean } {
    if (targetType === 'project' && resolvedProjectId) {
      const proj = prev.projects.find((p) => p.id === resolvedProjectId);
      if (!proj) {
        return { remaining: 0, targetMissing: true };
      }
      const kindCount = proj.photos.filter((ph) => ph.kind === kind).length;
      return {
        remaining: Math.min(
          Math.max(0, sectionLimit - kindCount),
          Math.max(0, USER_LIMITS.MAX_PROJECT_PHOTOS_PER_PROJECT - proj.photos.length)
        ),
        targetMissing: false,
      };
    }
    if (targetType === 'project_model' && resolvedProjectId) {
      const proj = prev.projects.find((p) => p.id === resolvedProjectId);
      const entry = proj?.models.find((m) => m.id === targetId);
      if (!proj || !entry) {
        return { remaining: 0, targetMissing: true };
      }
      const kindCount = entry.photos.filter((ph) => ph.kind === kind).length;
      return {
        remaining: Math.min(
          Math.max(0, sectionLimit - kindCount),
          Math.max(0, USER_LIMITS.MAX_PHOTOS_PER_PROJECT_MODEL - entry.photos.length)
        ),
        targetMissing: false,
      };
    }
    const kindCount = prev.uploadedPhotos.filter(
      (ph) => ph.targetType === targetType && ph.targetId === targetId && ph.kind === kind
    ).length;
    return {
      remaining: Math.max(0, sectionLimit - kindCount),
      targetMissing: false,
    };
  }

  private prependPhotosToTarget(
    prev: UserAccountState,
    targetType: UserPhotoTargetType,
    targetId: string,
    resolvedProjectId: string | undefined,
    accepted: UserUploadedPhoto[],
    now: string
  ): UserAccountState {
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
    if (startAuthGen !== this.cloudSync.getAuthGeneration() || currentUid !== startUid) {
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

      const sectionSlots = this.getRemainingSectionPhotoSlots(
        prev,
        targetType,
        targetId,
        kind,
        resolvedProjectId,
        sectionLimit
      );
      if (sectionSlots.targetMissing) {
        targetMissing = true;
        return prev;
      }

      const allowedCount = Math.min(uploaded.length, sectionSlots.remaining, remainingAccount);
      accepted = uploaded.slice(0, allowedCount);
      rejected = uploaded.slice(allowedCount);
      if (accepted.length === 0) {
        return prev;
      }

      const now = new Date().toISOString();
      return this.prependPhotosToTarget(
        prev,
        targetType,
        targetId,
        resolvedProjectId,
        accepted,
        now
      );
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
    const startAuthGen = this.cloudSync.getAuthGeneration();
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
    this.updatePhotosByOwner(owner, (photos) =>
      photos.map((ph) => (ph.id === photoId ? { ...ph, caption: nextCaption } : ph))
    );
    this.showToast('Saved photo caption');
  }

  async deleteUserPhoto(photoId: string): Promise<void> {
    const target = this.getPhotoById(photoId);
    const owner = this.locatePhotoOwner(photoId);
    if (!target || !owner) {
      return;
    }

    this.updatePhotosByOwner(
      owner,
      (photos) => photos.filter((ph) => ph.id !== photoId),
      {
        onProject: (p, nextPhotos, now) => ({
          ...p,
          photos: nextPhotos,
          coverPhotoId: p.coverPhotoId === photoId ? undefined : p.coverPhotoId,
          updatedAt: now,
        }),
        onProjectModel: (entry, nextPhotos, now) => ({
          ...entry,
          photos: nextPhotos,
          featuredImage:
            entry.featuredImage?.source === 'uploaded_photo' &&
            entry.featuredImage.photoId === photoId
              ? undefined
              : entry.featuredImage,
          updatedAt: now,
        }),
      }
    );

    await this.media.deletePhotoAssets(target);
    this.showToast('Deleted photo');
  }

  /* ========================================================================
     CUSTOM 3RD-PARTY PAINTS & OVERRIDES (WITH QUOTA LIMITS)
     ======================================================================== */

  addCustomPaint(paint: Omit<ThirdPartyPaint, 'id' | 'isCustom'>): ThirdPartyPaint | null {
    if (this.customPaints().length >= USER_LIMITS.MAX_CUSTOM_PAINTS) {
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
    const sanitizedMatches: ThirdPartyCitadelMatch[] = [];
    for (const m of paint.citadelMatches ?? []) {
      if (sanitizedMatches.length >= USER_LIMITS.MAX_COMPATIBILITY_OVERRIDES_PER_PAINT) {
        break;
      }
      if (!m || typeof m !== 'object') {
        continue;
      }
      const citadelPaintId = optionalTrimmedString(m.citadelPaintId, 200);
      if (!citadelPaintId) {
        continue;
      }
      const matchQuality =
        m.matchQuality === 'exact' || m.matchQuality === 'close' || m.matchQuality === 'similar'
          ? m.matchQuality
          : 'close';
      const deltaE = typeof m.deltaE === 'number' && Number.isFinite(m.deltaE) ? m.deltaE : 0;
      sanitizedMatches.push({
        citadelPaintId,
        citadelPaintName:
          optionalTrimmedString(m.citadelPaintName, USER_LIMITS.MAX_TITLE_LENGTH) ?? '',
        citadelRange:
          optionalTrimmedString(m.citadelRange, USER_LIMITS.MAX_TITLE_LENGTH) ?? '',
        citadelCategory: optionalTrimmedString(m.citadelCategory, 64) ?? '',
        citadelHex: optionalTrimmedString(m.citadelHex, 16) ?? '#888888',
        deltaE,
        matchQuality,
      });
    }
    const created: ThirdPartyPaint = {
      id: createEntityId('custom'),
      brand:
        (paint.brand ?? '').trim().slice(0, USER_LIMITS.MAX_TITLE_LENGTH) || 'Custom Brand',
      range:
        (paint.range ?? '').trim().slice(0, USER_LIMITS.MAX_TITLE_LENGTH) || 'Custom Range',
      code: optionalTrimmedString(paint.code, 64),
      name: safeName,
      category: (paint.category ?? '').trim().slice(0, 64) || 'Layer',
      potStyle: optionalTrimmedString(paint.potStyle, 64),
      hex: (paint.hex ?? '').trim().slice(0, 16) || '#888888',
      citadelMatches: sanitizedMatches,
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
    const currentOverrides = this.customCompatibilityOverrides();
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
      preferences: normalizePreferences(
        {
          ...prev.preferences,
          ...patch,
        },
        prev.preferences
      ),
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
      (prev) => mergeUserAccountState(prev, rawPayload, mode),
      syncCloud ? 'all' : 'none'
    );

    if (syncCloud) {
      this.showToast(
        `Imported account data (${this.inventoryPaintIds().length} owned, ${this.wishlistPaintIds().length} wishlist, ${this.projects().length} projects)`
      );
    }
  }

  async loadExtractedAccountSnapshot(mode: 'merge' | 'replace' = 'merge'): Promise<void> {
    const resp = await fetch('/data/user_account_snapshot.json', {
      cache: 'no-cache',
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = (resp.headers.get('content-type') ?? '').toLowerCase();
    if (!resp.ok || !contentType.includes('application/json')) {
      throw new Error(
        'Bundled account snapshot is not available in this environment. Use My Warhammer PKCE login or upload a JSON/CSV file instead.'
      );
    }
    const data: unknown = await resp.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Bundled account snapshot is invalid.');
    }
    this.importAccountPayload(data as Record<string, unknown>, mode);
  }

  exportBackupJson(): void {
    this.flushLocalPersistence();
    const dataStr = JSON.stringify(this._state(), null, 2);
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
    this._state.set(fresh);
    this.persistLocalStateImmediate(fresh);
    invalidateLocalFirebaseConfigCache();
    clearWarhammerTokenCache();
    void this.media.clearAllLocalMedia();
    this.showToast('Reset local browser data to a blank slate');
  }

  /* ========================================================================
     CLOUD AUTH & SYNC DELEGATION
     ======================================================================== */

  initAuthListener(): void {
    this.cloudSync.initAuthListener(this.cloudHost);
  }

  private applyUploadedPhotoPaths(uploadedMap: Map<string, string>): void {
    if (uploadedMap.size === 0) {
      return;
    }
    const attachStoragePaths = (photos: UserUploadedPhoto[]): UserUploadedPhoto[] =>
      photos.map((ph) =>
        uploadedMap.has(ph.id) ? { ...ph, storagePath: uploadedMap.get(ph.id) } : ph
      );

    this.commit(
      (prev) => ({
        ...prev,
        uploadedPhotos: attachStoragePaths(prev.uploadedPhotos),
        projects: prev.projects.map((p) => ({
          ...p,
          photos: attachStoragePaths(p.photos),
          models: p.models.map((m) => ({
            ...m,
            photos: attachStoragePaths(m.photos),
          })),
        })),
      }),
      'none'
    );
  }

  async signInWithGoogle(): Promise<void> {
    await this.cloudSync.signInWithGoogle();
    this.showToast('Signed in with Google & synced hobby desk');
  }

  async signInWithEmail(email: string, pass: string, isSignUp = false): Promise<void> {
    await this.cloudSync.signInWithEmail(email, pass, isSignUp);
    this.showToast(isSignUp ? 'Created account & synced hobby desk' : 'Signed in & synced hobby desk');
  }

  async signOutCloud(): Promise<void> {
    const signedOut = await this.cloudSync.signOutCloud();
    if (signedOut) {
      this.showToast('Signed out of Cloud Sync');
    }
  }
}
