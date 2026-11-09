import { Injectable, computed, signal } from '@angular/core';
import {
  ThirdPartyPaint,
  UserAccountState,
  UserPreferences,
  UserProject,
  UserProjectNote,
  UserProjectNoteComponent,
} from '../models/warhammer.models';
import { getFirebaseHandles } from './firebase.config';
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
    customPaints: [],
    customCompatibilityOverrides: {},
    projects: [],
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

@Injectable({
  providedIn: 'root',
})
export class UserStateService {
  readonly state = signal<UserAccountState>(this.loadInitialState());
  readonly currentUser = signal<User | null>(null);
  readonly cloudSyncStatus = signal<'local-only' | 'synced' | 'syncing' | 'error'>('local-only');
  readonly toastMessage = signal<string | null>(null);

  /** Fast reactive sets for O(1) lookup */
  readonly inventorySet = computed(() => new Set(this.state().inventoryPaintIds));
  readonly wishlistSet = computed(() => new Set(this.state().wishlistPaintIds));
  readonly projects = computed(() => this.state().projects);
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
          ? Array.from(new Set(parsed.inventoryPaintIds))
          : [],
        wishlistPaintIds: Array.isArray(parsed.wishlistPaintIds)
          ? Array.from(new Set(parsed.wishlistPaintIds))
          : [],
        customPaints: Array.isArray(parsed.customPaints) ? parsed.customPaints : [],
        customCompatibilityOverrides:
          parsed.customCompatibilityOverrides &&
          typeof parsed.customCompatibilityOverrides === 'object'
            ? parsed.customCompatibilityOverrides
            : {},
        projects: Array.isArray(parsed.projects) ? parsed.projects : [],
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
      this.pushStateToFirestore(next);
    }
  }

  /* ========================================================================
     INVENTORY & WISHLIST ACTIONS
     ======================================================================== */

  isOwned(paintId: string): boolean {
    return this.inventorySet().has(paintId);
  }

  isWishlisted(paintId: string): boolean {
    return this.wishlistSet().has(paintId);
  }

  toggleInventory(paintId: string): void {
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
    this.commit((prev) => {
      const inv = new Set(prev.inventoryPaintIds);
      const wish = new Set(prev.wishlistPaintIds);
      for (const pid of paintIds) {
        if (!inv.has(pid) && !wish.has(pid)) {
          wish.add(pid);
          added++;
        }
      }
      return {
        ...prev,
        wishlistPaintIds: Array.from(wish),
      };
    });
    if (added > 0) {
      this.showToast(`Added ${added} missing paint${added > 1 ? 's' : ''} to your Wishlist`);
    } else {
      this.showToast('All missing paints are already on your Wishlist');
    }
    return added;
  }

  addManyToInventory(paintIds: string[]): number {
    let added = 0;
    this.commit((prev) => {
      const inv = new Set(prev.inventoryPaintIds);
      const wish = new Set(prev.wishlistPaintIds);
      for (const pid of paintIds) {
        if (!inv.has(pid)) {
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
    if (added > 0) {
      this.showToast(`Added ${added} paint${added > 1 ? 's' : ''} to your Inventory`);
    }
    return added;
  }

  /* ========================================================================
     PROJECTS & NOTES ACTIONS
     ======================================================================== */

  createProject(name: string, thumbnailUrl?: string, localThumbnailPath?: string): UserProject {
    const now = new Date().toISOString();
    const project: UserProject = {
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || 'Untitled Project',
      thumbnailUrl: thumbnailUrl || '',
      localThumbnailPath: localThumbnailPath || 'assets/images/games/d8d81a80-7bf7-4fd3-8630-059a722a8bd7.png',
      createdAt: now,
      updatedAt: now,
      recipeIds: [],
      colourIds: [],
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
    const trimmed = newName.trim();
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
              localThumbnailPath,
              thumbnailUrl: thumbnailUrl ?? p.thumbnailUrl,
              updatedAt: new Date().toISOString(),
            }
          : p
      ),
    }));
    this.showToast('Updated project thumbnail');
  }

  duplicateProject(projectId: string): UserProject | null {
    const orig = this.state().projects.find((p) => p.id === projectId);
    if (!orig) return null;
    const now = new Date().toISOString();
    const copy: UserProject = {
      ...structuredClone(orig),
      id: `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: `${orig.name} (Copy)`,
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
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.filter((p) => p.id !== projectId),
    }));
    this.showToast('Deleted project');
  }

  addRecipeToProject(projectId: string, recipeId: string, modelImageLocal?: string): void {
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

  addColourToProject(projectId: string, colourId: string): void {
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => {
        if (p.id !== projectId) return p;
        const set = new Set(p.colourIds);
        set.add(colourId);
        return {
          ...p,
          colourIds: Array.from(set),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    this.showToast('Added colour guide to project');
  }

  removeColourFromProject(projectId: string, colourId: string): void {
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              colourIds: p.colourIds.filter((id) => id !== colourId),
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
    const now = new Date().toISOString();
    this.commit((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => {
        if (p.id !== projectId) return p;
        let nextNotes: UserProjectNote[];
        if (noteId) {
          nextNotes = p.notes.map((n) =>
            n.id === noteId
              ? { ...n, title: title.trim() || 'Untitled Note', updatedAt: now, components }
              : n
          );
        } else {
          const newNote: UserProjectNote = {
            id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: title.trim() || 'Hobby Note',
            createdAt: now,
            updatedAt: now,
            components,
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
     CUSTOM 3RD-PARTY PAINTS & OVERRIDES
     ======================================================================== */

  addCustomPaint(paint: Omit<ThirdPartyPaint, 'id' | 'isCustom'>): ThirdPartyPaint {
    const created: ThirdPartyPaint = {
      ...paint,
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      isCustom: true,
    };
    this.commit((prev) => {
      const nextOverrides = { ...prev.customCompatibilityOverrides };
      for (const m of created.citadelMatches) {
        const list = new Set(nextOverrides[m.citadelPaintId] ?? []);
        list.add(created.id);
        nextOverrides[m.citadelPaintId] = Array.from(list);
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
      nextOverrides[citadelPaintId] = list;
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

  /**
   * Merges or replaces user state from either:
   * - Extracted My Warhammer `user_account.json` (or Cloud Function `importMyWarhammerAccount` payload)
   * - Full Web App Backup JSON
   */
  importAccountPayload(rawPayload: Record<string, unknown>, mode: 'merge' | 'replace' = 'merge'): void {
    this.commit((prev) => {
      const base = mode === 'replace' ? createDefaultState() : prev;

      const incomingInv = Array.isArray(rawPayload['inventoryPaintIds'])
        ? (rawPayload['inventoryPaintIds'] as string[])
        : [];
      const incomingWish = Array.isArray(rawPayload['wishlistPaintIds'])
        ? (rawPayload['wishlistPaintIds'] as string[])
        : [];

      const invSet = new Set([...base.inventoryPaintIds, ...incomingInv]);
      const wishSet = new Set([...base.wishlistPaintIds, ...incomingWish]);
      // Ensure owned items are not simultaneously wishlisted
      for (const id of invSet) {
        wishSet.delete(id);
      }

      // Normalize projects from either web app backup or extracted APK user_account.json
      const rawProjects = Array.isArray(rawPayload['projects'])
        ? (rawPayload['projects'] as Record<string, unknown>[])
        : [];

      const normalizedIncomingProjects: UserProject[] = rawProjects.map((rp) => {
        const id = String(rp['id'] ?? `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
        const name = String(rp['name'] ?? 'Imported Project');
        const createdAt = String(rp['createdAt'] ?? new Date().toISOString());
        const updatedAt = String(rp['updatedAt'] ?? createdAt);

        const recipeIds: string[] = Array.isArray(rp['recipeIds'])
          ? (rp['recipeIds'] as string[])
          : Array.isArray(rp['recipes'])
          ? (rp['recipes'] as Record<string, unknown>[]).map((r) => String(r['id']))
          : [];

        const colourIds: string[] = Array.isArray(rp['colourIds'])
          ? (rp['colourIds'] as string[])
          : Array.isArray(rp['colours'])
          ? (rp['colours'] as Record<string, unknown>[]).map((c) => String(c['id']))
          : [];

        const rawNotes = Array.isArray(rp['notes'])
          ? (rp['notes'] as Record<string, unknown>[])
          : [];

        const notes: UserProjectNote[] = rawNotes.map((rn, idx) => {
          const rawComps = Array.isArray(rn['components'])
            ? (rn['components'] as Record<string, unknown>[])
            : [];
          const components: UserProjectNoteComponent[] = rawComps.map((rc) => ({
            type: rc['type'] === 'checkbox' ? 'checkbox' : 'text',
            value: String(rc['value'] ?? rc['text'] ?? ''),
            checked: Boolean(rc['checked'] ?? false),
          }));
          return {
            id: String(rn['id'] ?? `note_${id}_${idx}`),
            title: String(rn['title'] ?? rn['name'] ?? 'Project Note'),
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

        return {
          id,
          name,
          thumbnailUrl: thumbUrl ? String(thumbUrl) : undefined,
          localThumbnailPath: localThumb ? String(localThumb) : undefined,
          createdAt,
          updatedAt,
          recipeIds: Array.from(new Set(recipeIds)),
          colourIds: Array.from(new Set(colourIds)),
          notes,
        };
      });

      const projectMap = new Map<string, UserProject>();
      for (const p of base.projects) {
        projectMap.set(p.id, p);
      }
      for (const incomingP of normalizedIncomingProjects) {
        projectMap.set(incomingP.id, incomingP);
      }

      const incomingCustomPaints = Array.isArray(rawPayload['customPaints'])
        ? (rawPayload['customPaints'] as ThirdPartyPaint[])
        : [];
      const customPaintMap = new Map<string, ThirdPartyPaint>();
      for (const cp of [...base.customPaints, ...incomingCustomPaints]) {
        customPaintMap.set(cp.id, cp);
      }

      return {
        ...base,
        inventoryPaintIds: Array.from(invSet),
        wishlistPaintIds: Array.from(wishSet),
        customPaints: Array.from(customPaintMap.values()),
        projects: Array.from(projectMap.values()),
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
    a.download = `warhammer_colour_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('Exported JSON backup');
  }

  resetLocalData(): void {
    const fresh = createDefaultState();
    this.state.set(fresh);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    this.showToast('Reset local browser data to a blank slate');
  }

  /* ========================================================================
     OPTIONAL FIREBASE AUTH & CLOUD FIRESTORE SYNC (`users/{uid}`)
     ======================================================================== */

  initAuthListener(): void {
    const fb = getFirebaseHandles();
    if (!fb) {
      this.cloudSyncStatus.set('local-only');
      return;
    }
    onAuthStateChanged(fb.auth, async (user) => {
      this.currentUser.set(user);
      if (this.unsubscribeFirestore) {
        this.unsubscribeFirestore();
        this.unsubscribeFirestore = null;
      }
      if (user) {
        this.cloudSyncStatus.set('syncing');
        const userDocRef = doc(fb.db, 'users', user.uid);
        try {
          const snap = await getDoc(userDocRef);
          if (snap.exists()) {
            this.importAccountPayload(snap.data() as Record<string, unknown>, 'merge');
          }
          await this.pushStateToFirestore(this.state());
          this.unsubscribeFirestore = onSnapshot(userDocRef, (docSnap) => {
            if (docSnap.exists()) {
              const remote = docSnap.data() as UserAccountState;
              if (remote.updatedAt && remote.updatedAt > this.state().updatedAt) {
                this.state.set(remote);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(remote));
              }
            }
          });
          this.cloudSyncStatus.set('synced');
        } catch (err) {
          console.warn('Firestore user sync failed:', err);
          this.cloudSyncStatus.set('error');
        }
      } else {
        this.cloudSyncStatus.set('local-only');
      }
    });
  }

  private async pushStateToFirestore(stateToSave: UserAccountState): Promise<void> {
    const fb = getFirebaseHandles();
    const user = this.currentUser();
    if (!fb || !user) return;
    try {
      this.cloudSyncStatus.set('syncing');
      await setDoc(doc(fb.db, 'users', user.uid), stateToSave, { merge: true });
      this.cloudSyncStatus.set('synced');
    } catch {
      this.cloudSyncStatus.set('error');
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
