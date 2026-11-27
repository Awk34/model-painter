import { Injectable, signal } from '@angular/core';
import {
  AllowedImageMimeType,
  USER_LIMITS,
  formatBytes,
} from '../config/user-limits.config';
import { UserUploadedPhoto } from '../models/catalog.models';
import { getFirebaseHandles } from './firebase.config';
import { createIdbStoreClient } from '../utils/idb.util';
import { deleteObject, getBlob, ref, uploadBytes } from 'firebase/storage';

const MEDIA_DB_NAME = 'whc_user_media_v1';
const MEDIA_DB_VERSION = 1;
const STORE_PHOTO_BLOBS = 'photo_blobs';
const MAX_STORAGE_DIMENSION_PX = 32768;

export interface ValidatedImageInfo {
  blob: Blob;
  mimeType: AllowedImageMimeType;
  width: number;
  height: number;
  wasDownscaled: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class UserMediaService {
  /** Reactive map of photoId -> active browser ObjectURL */
  readonly photoUrls = signal<Record<string, string>>({});

  private readonly idb = createIdbStoreClient(MEDIA_DB_NAME, MEDIA_DB_VERSION, [STORE_PHOTO_BLOBS]);
  private readonly loadingIds = new Set<string>();
  private readonly failedAttemptKeys = new Map<string, string>();
  private readonly deletedIds = new Set<string>();
  private readonly photoGenerations = new Map<string, number>();
  private mediaEpoch = 0;

  protected getFbHandles() {
    return getFirebaseHandles();
  }

  protected getCurrentUid(): string | null {
    return this.getFbHandles()?.auth.currentUser?.uid ?? null;
  }

  protected async fetchRemoteBlob(storagePath: string): Promise<Blob | null> {
    const fb = this.getFbHandles();
    if (!fb || !fb.auth.currentUser) {
      return null;
    }
    return getBlob(ref(fb.storage, storagePath));
  }

  protected async deleteRemoteObject(storagePath: string): Promise<void> {
    const fb = this.getFbHandles();
    if (!fb || !fb.auth.currentUser) {
      return;
    }
    await deleteObject(ref(fb.storage, storagePath));
  }

  protected async uploadStorageBytes(
    storagePath: string,
    blob: Blob,
    photo: UserUploadedPhoto
  ): Promise<void> {
    const fb = this.getFbHandles();
    if (!fb) {
      throw new Error('Firebase handles unavailable.');
    }
    const storageRef = ref(fb.storage, storagePath);
    await uploadBytes(storageRef, blob, {
      contentType: photo.mimeType,
      customMetadata: {
        kind: photo.kind,
        targetType: photo.targetType,
        targetId: photo.targetId,
      },
    });
  }

  private nextPhotoGeneration(photoId: string): number {
    const next = (this.photoGenerations.get(photoId) ?? 0) + 1;
    this.photoGenerations.set(photoId, next);
    return next;
  }

  private isHydrationCurrent(photoId: string, startEpoch: number, startGen: number): boolean {
    return (
      !this.deletedIds.has(photoId) &&
      this.mediaEpoch === startEpoch &&
      (this.photoGenerations.get(photoId) ?? 0) === startGen
    );
  }

  /**
   * Validates MIME type, magic-byte file signature, and image dimensions.
   * If the image exceeds the 5 MB storage limit or max dimension threshold,
   * automatically downscales/compresses it client-side to fit within limits.
   */
  async validateImageFile(file: File): Promise<ValidatedImageInfo> {
    if (!file || file.size <= 0) {
      throw new Error(`File "${file?.name || 'unknown'}" is empty.`);
    }
    if (file.size > USER_LIMITS.MAX_RAW_INPUT_FILE_SIZE_BYTES) {
      throw new Error(
        `"${file.name}" (${formatBytes(file.size)}) exceeds the ${USER_LIMITS.MAX_RAW_INPUT_FILE_SIZE_MB} MB maximum upload file size.`
      );
    }

    const allowedTypes: readonly string[] = USER_LIMITS.ALLOWED_IMAGE_MIME_TYPES;
    if (!allowedTypes.includes(file.type)) {
      throw new Error(
        `"${file.name}" has an unsupported format (${file.type || 'unknown'}). Allowed formats: ${USER_LIMITS.ALLOWED_IMAGE_EXTENSIONS_LABEL}.`
      );
    }

    const headerBuf = await file.slice(0, 12).arrayBuffer();
    const bytes = new Uint8Array(headerBuf);
    const detectedMime = this.detectMagicMime(bytes);
    if (!detectedMime || detectedMime !== file.type) {
      throw new Error(
        `"${file.name}" does not match a valid ${USER_LIMITS.ALLOWED_IMAGE_EXTENSIONS_LABEL} image header.`
      );
    }

    const loaded = await this.loadImageElement(file);
    const { width, height, img } = loaded;

    const overByteLimit = file.size > USER_LIMITS.MAX_PHOTO_FILE_SIZE_BYTES;
    const overDimLimit = Math.max(width, height) > USER_LIMITS.MAX_PHOTO_DIMENSION_PX;

    if (!overByteLimit && !overDimLimit) {
      if (Math.max(width, height) > MAX_STORAGE_DIMENSION_PX) {
        throw new Error(
          `"${file.name}" exceeds the ${MAX_STORAGE_DIMENSION_PX}px maximum image dimension.`
        );
      }
      return {
        blob: file,
        mimeType: detectedMime,
        width,
        height,
        wasDownscaled: false,
      };
    }

    const downscaled = await this.downscaleImageToLimit(img, width, height, detectedMime);
    if (
      Math.max(downscaled.width, downscaled.height) > USER_LIMITS.MAX_PHOTO_DIMENSION_PX ||
      Math.max(downscaled.width, downscaled.height) > MAX_STORAGE_DIMENSION_PX ||
      downscaled.blob.size > USER_LIMITS.MAX_PHOTO_FILE_SIZE_BYTES
    ) {
      throw new Error(
        `Could not downscale "${file.name}" within ${USER_LIMITS.MAX_PHOTO_DIMENSION_PX}px and ${USER_LIMITS.MAX_PHOTO_FILE_SIZE_MB} MB limits.`
      );
    }

    return {
      blob: downscaled.blob,
      mimeType: downscaled.mimeType,
      width: downscaled.width,
      height: downscaled.height,
      wasDownscaled: true,
    };
  }

  private detectMagicMime(b: Uint8Array): AllowedImageMimeType | null {
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
      return 'image/jpeg';
    }
    if (
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a
    ) {
      return 'image/png';
    }
    if (
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50
    ) {
      return 'image/webp';
    }
    return null;
  }

  private loadImageElement(
    blob: Blob
  ): Promise<{ img: HTMLImageElement; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const tempUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth;
        const height = img.naturalHeight;
        URL.revokeObjectURL(tempUrl);
        if (width <= 0 || height <= 0) {
          reject(new Error('Image has invalid dimensions.'));
          return;
        }
        resolve({ img, width, height });
      };
      img.onerror = () => {
        URL.revokeObjectURL(tempUrl);
        reject(new Error('Could not decode image file.'));
      };
      img.src = tempUrl;
    });
  }

  private async downscaleImageToLimit(
    img: HTMLImageElement,
    origWidth: number,
    origHeight: number,
    sourceMime: AllowedImageMimeType
  ): Promise<{ blob: Blob; mimeType: AllowedImageMimeType; width: number; height: number }> {
    const maxDimCandidates = [USER_LIMITS.MAX_PHOTO_DIMENSION_PX, 2048, 1600, 1280, 960];
    const qualityCandidates = [0.86, 0.78, 0.68];
    const targetMime: AllowedImageMimeType =
      sourceMime === 'image/png' ? 'image/webp' : sourceMime;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser canvas 2D context is unavailable for downscaling.');
    }

    let lastResult: {
      blob: Blob;
      mimeType: AllowedImageMimeType;
      width: number;
      height: number;
    } | null = null;

    for (const maxEdge of maxDimCandidates) {
      const longest = Math.max(origWidth, origHeight);
      const scale = longest > maxEdge ? maxEdge / longest : 1;
      const targetW = Math.max(1, Math.round(origWidth * scale));
      const targetH = Math.max(1, Math.round(origHeight * scale));

      canvas.width = targetW;
      canvas.height = targetH;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(img, 0, 0, targetW, targetH);

      for (const quality of qualityCandidates) {
        const encoded = await this.canvasToBlob(canvas, targetMime, quality);
        const actualMime: AllowedImageMimeType =
          encoded.type === 'image/webp' ||
          encoded.type === 'image/png' ||
          encoded.type === 'image/jpeg'
            ? encoded.type
            : 'image/jpeg';

        lastResult = {
          blob: encoded,
          mimeType: actualMime,
          width: targetW,
          height: targetH,
        };

        if (encoded.size <= USER_LIMITS.MAX_PHOTO_FILE_SIZE_BYTES) {
          return lastResult;
        }
      }
    }

    if (lastResult && lastResult.blob.size <= USER_LIMITS.MAX_PHOTO_FILE_SIZE_BYTES) {
      return lastResult;
    }
    throw new Error(
      `Could not downscale image below the ${USER_LIMITS.MAX_PHOTO_FILE_SIZE_MB} MB limit.`
    );
  }

  private canvasToBlob(
    canvas: HTMLCanvasElement,
    mimeType: AllowedImageMimeType,
    quality: number
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to encode downscaled image.'));
          }
        },
        mimeType,
        quality
      );
    });
  }

  private registerObjectUrl(photoId: string, blob: Blob): string {
    if (this.deletedIds.has(photoId)) {
      return '';
    }
    const urls = this.photoUrls();
    const existing = Object.hasOwn(urls, photoId) ? urls[photoId] : undefined;
    if (existing) {
      return existing;
    }
    const objUrl = URL.createObjectURL(blob);
    this.photoUrls.update((prev) => {
      const next = { ...prev };
      Object.defineProperty(next, photoId, {
        value: objUrl,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      return next;
    });
    return objUrl;
  }

  async storeLocalBlob(photoId: string, blob: Blob): Promise<string> {
    this.deletedIds.delete(photoId);
    this.failedAttemptKeys.delete(photoId);
    const startEpoch = this.mediaEpoch;
    const startGen = this.nextPhotoGeneration(photoId);

    await this.idb.put(STORE_PHOTO_BLOBS, photoId, blob);
    if (!this.isHydrationCurrent(photoId, startEpoch, startGen)) {
      void this.idb.delete(STORE_PHOTO_BLOBS, photoId);
      return '';
    }
    return this.registerObjectUrl(photoId, blob);
  }

  buildStoragePath(
    photo: Pick<UserUploadedPhoto, 'id' | 'targetType' | 'targetId' | 'kind' | 'mimeType'>,
    uid: string
  ): string {
    const folder = photo.kind === 'reference' ? 'private_references' : 'showcase';
    const ext =
      photo.mimeType === 'image/png'
        ? 'png'
        : photo.mimeType === 'image/webp'
          ? 'webp'
          : 'jpg';
    const safeTargetId = photo.targetId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'item';
    const safePhotoId = photo.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 110) || 'photo';
    return `users/${uid}/${folder}/${photo.targetType}/${safeTargetId}/${safePhotoId}.${ext}`;
  }

  async uploadToCloudStorage(
    photo: UserUploadedPhoto,
    blob: Blob,
    uid: string
  ): Promise<string | undefined> {
    const fb = this.getFbHandles();
    if (!fb) {
      return undefined;
    }
    const storagePath = this.buildStoragePath(photo, uid);
    try {
      await this.uploadStorageBytes(storagePath, blob, photo);
      return storagePath;
    } catch (err) {
      console.warn('Cloud Storage photo upload skipped/failed (kept locally in IndexedDB):', err);
      return undefined;
    }
  }

  /**
   * Returns a reactive ObjectURL for `photo` if loaded, or triggers async hydration
   * from IndexedDB / Firebase Cloud Storage and returns a placeholder until ready.
   */
  resolvePhotoUrl(photo: UserUploadedPhoto | null | undefined): string {
    if (!photo) {
      return '/icons/ic_image_loading_placeholder.svg';
    }
    const urls = this.photoUrls();
    const cachedUrl = Object.hasOwn(urls, photo.id) ? urls[photo.id] : undefined;
    if (cachedUrl) {
      return cachedUrl;
    }
    this.hydratePhotoUrl(photo);
    return '/icons/ic_image_loading_placeholder.svg';
  }

  hydratePhotoUrl(photo: UserUploadedPhoto): void {
    const uid = this.getCurrentUid() ?? '';
    const attemptKey = `${photo.storagePath ?? ''}|${uid}`;
    const urls = this.photoUrls();
    if (
      (Object.hasOwn(urls, photo.id) && urls[photo.id]) ||
      this.loadingIds.has(photo.id) ||
      this.deletedIds.has(photo.id) ||
      this.failedAttemptKeys.get(photo.id) === attemptKey
    ) {
      return;
    }

    const startEpoch = this.mediaEpoch;
    const startGen = this.photoGenerations.get(photo.id) ?? 0;
    this.loadingIds.add(photo.id);
    void (async () => {
      try {
        const localBlob = await this.idb.get<Blob>(STORE_PHOTO_BLOBS, photo.id);
        if (!this.isHydrationCurrent(photo.id, startEpoch, startGen)) {
          return;
        }
        if (localBlob) {
          this.failedAttemptKeys.delete(photo.id);
          this.registerObjectUrl(photo.id, localBlob);
          return;
        }
        if (photo.storagePath && uid) {
          const remoteBlob = await this.fetchRemoteBlob(photo.storagePath);
          if (!this.isHydrationCurrent(photo.id, startEpoch, startGen)) {
            return;
          }
          if (remoteBlob) {
            try {
              await this.idb.put(STORE_PHOTO_BLOBS, photo.id, remoteBlob);
            } catch (putErr) {
              console.warn(`Could not cache photo ${photo.id} in IndexedDB:`, putErr);
            }
            if (!this.isHydrationCurrent(photo.id, startEpoch, startGen)) {
              void this.idb.delete(STORE_PHOTO_BLOBS, photo.id);
              return;
            }
            this.failedAttemptKeys.delete(photo.id);
            this.registerObjectUrl(photo.id, remoteBlob);
            return;
          }
        }
        if (this.isHydrationCurrent(photo.id, startEpoch, startGen)) {
          this.failedAttemptKeys.set(photo.id, attemptKey);
        }
      } catch (err) {
        if (this.isHydrationCurrent(photo.id, startEpoch, startGen)) {
          this.failedAttemptKeys.set(photo.id, attemptKey);
        }
        console.warn(`Could not hydrate photo ${photo.id}:`, err);
      } finally {
        this.loadingIds.delete(photo.id);
      }
    })();
  }

  /**
   * Syncs any local-only blobs to Firebase Storage when a user signs in.
   */
  async syncPendingBlobsToCloud(
    photos: UserUploadedPhoto[],
    uid: string
  ): Promise<Map<string, string>> {
    const uploadedPaths = new Map<string, string>();
    for (const photo of photos) {
      if (photo.storagePath) {
        continue;
      }
      const blob = await this.idb.get<Blob>(STORE_PHOTO_BLOBS, photo.id);
      if (!blob) {
        continue;
      }
      const path = await this.uploadToCloudStorage(photo, blob, uid);
      if (path) {
        uploadedPaths.set(photo.id, path);
      }
    }
    return uploadedPaths;
  }

  async deletePhotoAssets(photo: UserUploadedPhoto): Promise<void> {
    this.deletedIds.add(photo.id);
    this.nextPhotoGeneration(photo.id);
    this.failedAttemptKeys.delete(photo.id);

    const urls = this.photoUrls();
    const existingUrl = Object.hasOwn(urls, photo.id) ? urls[photo.id] : undefined;
    if (existingUrl) {
      URL.revokeObjectURL(existingUrl);
      this.photoUrls.update((prev) => {
        const next = { ...prev };
        delete next[photo.id];
        return next;
      });
    }
    await this.idb.delete(STORE_PHOTO_BLOBS, photo.id);
    if (photo.storagePath) {
      try {
        await this.deleteRemoteObject(photo.storagePath);
      } catch (err) {
        console.warn(`Could not delete remote photo ${photo.storagePath}:`, err);
      }
    }
  }

  async clearAllLocalMedia(): Promise<void> {
    this.mediaEpoch++;
    this.failedAttemptKeys.clear();
    this.deletedIds.clear();
    this.photoGenerations.clear();
    const urls = Object.values(this.photoUrls());
    for (const u of urls) {
      URL.revokeObjectURL(u);
    }
    this.photoUrls.set({});
    await this.idb.clearAll();
  }
}
