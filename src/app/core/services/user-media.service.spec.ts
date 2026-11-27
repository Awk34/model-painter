import { TestBed } from '@angular/core/testing';
import { USER_LIMITS } from '../config/user-limits.config';
import { UserUploadedPhoto } from '../models/catalog.models';
import { IdbStoreClient } from '../utils/idb.util';
import { UserMediaService } from './user-media.service';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makePhoto(overrides: Partial<UserUploadedPhoto> = {}): UserUploadedPhoto {
  return {
    id: 'ph_test_1',
    targetType: 'model',
    targetId: 'model_1',
    kind: 'showcase',
    isPrivate: false,
    fileName: 'test.png',
    mimeType: 'image/png',
    sizeBytes: 512,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('UserMediaService', () => {
  let service: UserMediaService;
  let idbMock: jasmine.SpyObj<IdbStoreClient>;
  let currentUid: string | null;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [UserMediaService],
    });
    service = TestBed.inject(UserMediaService);
    currentUid = null;

    idbMock = jasmine.createSpyObj<IdbStoreClient>('IdbStoreClient', [
      'get',
      'put',
      'delete',
      'clearStore',
      'clearAll',
    ]);
    idbMock.get.and.resolveTo(null);
    idbMock.put.and.resolveTo();
    idbMock.delete.and.resolveTo();
    idbMock.clearStore.and.resolveTo();
    idbMock.clearAll.and.resolveTo();

    Object.defineProperty(service, 'idb', { value: idbMock });
    spyOn(service as unknown as { getCurrentUid: () => string | null }, 'getCurrentUid').and.callFake(
      () => currentUid
    );
  });

  afterEach(async () => {
    await service.clearAllLocalMedia();
  });

  it('negative-caches missing local/offline blobs to prevent infinite hydratePhotoUrl loops', async () => {
    const localOnlyPhoto = makePhoto({ id: 'ph_missing_local', storagePath: undefined });
    const signedOutRemotePhoto = makePhoto({
      id: 'ph_signed_out_remote',
      storagePath: 'users/u1/showcase/model/m1/ph_signed_out_remote.jpg',
    });

    for (let i = 0; i < 5; i++) {
      expect(service.resolvePhotoUrl(localOnlyPhoto)).toBe('/icons/ic_image_loading_placeholder.svg');
      expect(service.resolvePhotoUrl(signedOutRemotePhoto)).toBe(
        '/icons/ic_image_loading_placeholder.svg'
      );
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(idbMock.get.calls.allArgs().filter((args) => args[1] === 'ph_missing_local').length).toBe(1);
    expect(
      idbMock.get.calls.allArgs().filter((args) => args[1] === 'ph_signed_out_remote').length
    ).toBe(1);
  });

  it('clears negative cache when user signs in (uid changes) or storeLocalBlob() stores the blob', async () => {
    const photo = makePhoto({
      id: 'ph_retry_auth',
      storagePath: 'users/user-1/showcase/model/m1/ph_retry_auth.jpg',
    });
    const fetchSpy = spyOn(
      service as unknown as { fetchRemoteBlob: (p: string) => Promise<Blob | null> },
      'fetchRemoteBlob'
    ).and.resolveTo(new Blob(['remote'], { type: 'image/jpeg' }));

    // Signed out miss -> negative cached
    service.resolvePhotoUrl(photo);
    await Promise.resolve();
    await Promise.resolve();
    expect(idbMock.get).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Sign in -> uid changes -> retries once and hydrates ObjectURL
    currentUid = 'user-1';
    service.resolvePhotoUrl(photo);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(service.photoUrls()[photo.id]).toMatch(/^blob:/);

    // Negative cache cleared by storeLocalBlob
    const localPhoto = makePhoto({ id: 'ph_stored_later' });
    service.resolvePhotoUrl(localPhoto);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.photoUrls()[localPhoto.id]).toBeUndefined();

    const url = await service.storeLocalBlob(
      localPhoto.id,
      new Blob(['hello'], { type: 'image/png' })
    );
    expect(url).toMatch(/^blob:/);
    expect(service.resolvePhotoUrl(localPhoto)).toBe(url);
  });

  it('prevents deletePhotoAssets and clearAllLocalMedia from resurrecting in-flight remote hydrations', async () => {
    currentUid = 'user-1';
    const photo = makePhoto({
      id: 'ph_race',
      storagePath: 'users/user-1/showcase/model/m1/ph_race.png',
    });

    const deferred = createDeferred<Blob | null>();
    spyOn(
      service as unknown as { fetchRemoteBlob: () => Promise<Blob | null> },
      'fetchRemoteBlob'
    ).and.returnValue(deferred.promise);
    const deleteRemoteSpy = spyOn(
      service as unknown as { deleteRemoteObject: () => Promise<void> },
      'deleteRemoteObject'
    ).and.resolveTo();
    const createObjectUrlSpy = spyOn(URL, 'createObjectURL').and.callThrough();

    service.resolvePhotoUrl(photo);
    await Promise.resolve();

    await service.deletePhotoAssets(photo);
    expect(deleteRemoteSpy).toHaveBeenCalledTimes(1);

    deferred.resolve(new Blob(['late'], { type: 'image/png' }));
    await new Promise((r) => setTimeout(r, 0));

    expect(idbMock.put).not.toHaveBeenCalled();
    expect(service.photoUrls()[photo.id]).toBeUndefined();
    expect(createObjectUrlSpy).not.toHaveBeenCalled();

    // Also test clearAllLocalMedia during concurrent hydration
    const photo2 = makePhoto({
      id: 'ph_race_clear',
      storagePath: 'users/user-1/showcase/model/m1/ph_race_clear.png',
    });
    const deferred2 = createDeferred<Blob | null>();
    (
      service as unknown as { fetchRemoteBlob: jasmine.Spy }
    ).fetchRemoteBlob.and.returnValue(deferred2.promise);

    service.resolvePhotoUrl(photo2);
    await Promise.resolve();
    await service.clearAllLocalMedia();

    deferred2.resolve(new Blob(['late-2'], { type: 'image/png' }));
    await new Promise((r) => setTimeout(r, 0));

    expect(idbMock.put).not.toHaveBeenCalled();
    expect(service.photoUrls()[photo2.id]).toBeUndefined();
    expect(createObjectUrlSpy).not.toHaveBeenCalled();
  });

  it('propagates QuotaExceededError from storeLocalBlob and does not register ObjectURL', async () => {
    idbMock.put.and.rejectWith(new DOMException('Quota exceeded', 'QuotaExceededError'));
    const blob = new Blob(['img'], { type: 'image/png' });

    await expectAsync(service.storeLocalBlob('ph_quota', blob)).toBeRejectedWithError(
      /Quota exceeded/
    );
    expect(service.photoUrls()['ph_quota']).toBeUndefined();
  });

  it('never bypasses MAX_PHOTO_DIMENSION_PX or 32768px in validateImageFile even when downscaled blob is larger than original file', async () => {
    // Real 3000x2000 tiny solid PNG (< 5 MB, > 2560px)
    const canvas = document.createElement('canvas');
    canvas.width = 3000;
    canvas.height = 2000;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#336699';
    ctx.fillRect(0, 0, 3000, 2000);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    const largeDimFile = new File([pngBlob], 'wide.png', { type: 'image/png' });

    const validated = await service.validateImageFile(largeDimFile);
    expect(validated.wasDownscaled).toBeTrue();
    expect(Math.max(validated.width, validated.height)).toBeLessThanOrEqual(
      USER_LIMITS.MAX_PHOTO_DIMENSION_PX
    );
    expect(validated.blob.size).toBeLessThanOrEqual(USER_LIMITS.MAX_PHOTO_FILE_SIZE_BYTES);

    // Also verify > 32768px source dimensions are downscaled and never returned raw
    const tinyPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const extremeFile = new File([tinyPngBytes], 'extreme.png', { type: 'image/png' });
    const fakeImg = document.createElement('canvas');
    fakeImg.width = 100;
    fakeImg.height = 10;

    const closeSpy = jasmine.createSpy('close');
    spyOn(
      service as unknown as {
        decodeImageSource: () => Promise<{
          source: CanvasImageSource;
          width: number;
          height: number;
          close: () => void;
        }>;
      },
      'decodeImageSource'
    ).and.resolveTo({
      source: fakeImg,
      width: 35000,
      height: 100,
      close: closeSpy,
    });

    const extremeValidated = await service.validateImageFile(extremeFile);
    expect(extremeValidated.wasDownscaled).toBeTrue();
    expect(extremeValidated.width).toBeLessThanOrEqual(USER_LIMITS.MAX_PHOTO_DIMENSION_PX);
    expect(extremeValidated.width).toBeLessThanOrEqual(32768);
    expect(closeSpy).toHaveBeenCalledTimes(1);

    // And if downscaleImageToLimit itself returned > 32768px, validateImageFile throws
    spyOn(
      service as unknown as {
        downscaleImageToLimit: () => Promise<{
          blob: Blob;
          mimeType: 'image/webp';
          width: number;
          height: number;
        }>;
      },
      'downscaleImageToLimit'
    ).and.resolveTo({
      blob: new Blob(['ok'], { type: 'image/webp' }),
      mimeType: 'image/webp',
      width: 35000,
      height: 100,
    });

    await expectAsync(service.validateImageFile(extremeFile)).toBeRejectedWithError(
      /Could not downscale/
    );
  });

  it('sanitizes and bounds photo.id and targetId in uploadToCloudStorage paths', async () => {
    const longUnsafeId = `../../${'a'.repeat(130)}`;
    const showcasePhoto = makePhoto({
      id: longUnsafeId,
      targetId: '../../unsafe/target',
      kind: 'showcase',
      mimeType: 'image/webp',
    });
    const refPhoto = makePhoto({
      id: longUnsafeId,
      targetId: 'proj_1',
      kind: 'reference',
      mimeType: 'image/png',
    });

    spyOn(
      service as unknown as { getFbStorage: () => Promise<unknown> },
      'getFbStorage'
    ).and.resolveTo({ storage: {} });
    const uploadSpy = spyOn(
      service as unknown as { uploadStorageBytes: () => Promise<void> },
      'uploadStorageBytes'
    ).and.resolveTo();

    const showcasePath = await service.uploadToCloudStorage(
      showcasePhoto,
      new Blob(['x'], { type: 'image/webp' }),
      'uid_1'
    );
    const refPath = await service.uploadToCloudStorage(
      refPhoto,
      new Blob(['y'], { type: 'image/png' }),
      'uid_1'
    );

    expect(uploadSpy).toHaveBeenCalledTimes(2);
    expect(showcasePath).toBeDefined();
    expect(refPath).toBeDefined();

    const showcaseParts = showcasePath!.split('/');
    expect(showcaseParts.length).toBe(6);
    expect(showcaseParts[2]).toBe('showcase');
    expect(showcaseParts[4]).not.toContain('..');
    expect(showcaseParts[5].length).toBeLessThanOrEqual(120);
    expect(showcaseParts[5].endsWith('.webp')).toBeTrue();

    const refParts = refPath!.split('/');
    expect(refParts.length).toBe(6);
    expect(refParts[2]).toBe('private_references');
    expect(refParts[5].length).toBeLessThanOrEqual(120);
    expect(refParts[5].endsWith('.png')).toBeTrue();
  });

  it('uses Object.hasOwn for photoUrls lookups so prototype-named photo IDs never return Object.prototype methods', async () => {
    const protoKeys = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'];
    for (const id of protoKeys) {
      const photo = makePhoto({ id });
      expect(service.resolvePhotoUrl(photo)).toBe('/icons/ic_image_loading_placeholder.svg');
      await expectAsync(service.deletePhotoAssets(photo)).toBeResolved();
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(service.resolvePhotoUrl(makePhoto({ id: 'toString' }))).toBe(
      '/icons/ic_image_loading_placeholder.svg'
    );
  });

  it('builds bounded storage paths across 200-char targetId, 120-char photo.id, dot-only IDs, and all kind/targetType combos', () => {
    const longTargetId = 't'.repeat(200);
    const longPhotoId = 'p'.repeat(120);

    const combos: Array<{
      kind: 'showcase' | 'reference';
      targetType: 'model' | 'project' | 'project_model';
      expectedFolder: string;
    }> = [
      { kind: 'showcase', targetType: 'model', expectedFolder: 'showcase' },
      { kind: 'showcase', targetType: 'project', expectedFolder: 'showcase' },
      { kind: 'showcase', targetType: 'project_model', expectedFolder: 'showcase' },
      { kind: 'reference', targetType: 'model', expectedFolder: 'private_references' },
      { kind: 'reference', targetType: 'project', expectedFolder: 'private_references' },
      { kind: 'reference', targetType: 'project_model', expectedFolder: 'private_references' },
    ];

    for (const combo of combos) {
      const storagePath = service.buildStoragePath(
        makePhoto({
          id: longPhotoId,
          targetId: longTargetId,
          kind: combo.kind,
          targetType: combo.targetType,
          mimeType: 'image/webp',
        }),
        'u'.repeat(128)
      );
      const parts = storagePath.split('/');
      expect(parts.length).toBe(6);
      expect(parts[2]).toBe(combo.expectedFolder);
      expect(parts[3]).toBe(combo.targetType);
      expect(parts[4].length).toBeLessThanOrEqual(100);
      expect(parts[5].length).toBeLessThanOrEqual(120);
      expect(parts[5].endsWith('.webp')).toBeTrue();
      expect(storagePath.length).toBeLessThanOrEqual(512);
    }

    for (const edge of ['', '.', '..']) {
      const storagePath = service.buildStoragePath(
        makePhoto({
          id: edge,
          targetId: edge,
          kind: 'reference',
          targetType: 'project_model',
          mimeType: 'image/png',
        }),
        'uid_edge'
      );
      const parts = storagePath.split('/');
      expect(['', '.', '..']).not.toContain(parts[4]);
      expect(['', '.', '..']).not.toContain(parts[5]);
      expect(parts[5].endsWith('.png')).toBeTrue();
    }
  });

  it('uploads pending blobs in syncPendingBlobsToCloud with bounded concurrency of 3 and partial failure resilience', async () => {
    // 0 pending items -> fast-return without touching IDB
    const emptyResult = await service.syncPendingBlobsToCloud(
      [makePhoto({ id: 'ph_synced', storagePath: 'users/u1/existing.jpg' })],
      'u1'
    );
    expect(emptyResult.size).toBe(0);
    expect(idbMock.get).not.toHaveBeenCalled();

    const pendingPhotos = Array.from({ length: 7 }, (_, i) =>
      makePhoto({ id: `ph_pending_${i}`, storagePath: undefined })
    );
    idbMock.get.and.callFake((async <T>(_store: string, key: string): Promise<T | null> => {
      if (key === 'ph_pending_5') {
        return null; // missing blob in IDB
      }
      return new Blob([key], { type: 'image/png' }) as unknown as T;
    }) as typeof idbMock.get);

    let activeUploads = 0;
    let maxConcurrentUploads = 0;
    const deferredByPhoto = new Map<string, Deferred<string | undefined>>();
    spyOn(service, 'uploadToCloudStorage').and.callFake((photo) => {
      activeUploads++;
      maxConcurrentUploads = Math.max(maxConcurrentUploads, activeUploads);
      const d = createDeferred<string | undefined>();
      deferredByPhoto.set(photo.id, d);
      return d.promise.finally(() => {
        activeUploads--;
      });
    });

    spyOn(console, 'warn');
    const syncPromise = service.syncPendingBlobsToCloud(pendingPhotos, 'u1');

    // Wait for initial batch of 3 uploads to start
    await new Promise((r) => setTimeout(r, 0));
    expect(maxConcurrentUploads).toBe(3);
    expect(activeUploads).toBe(3);

    // Resolve first 3, including one rejection on ph_pending_1
    deferredByPhoto.get('ph_pending_0')!.resolve('cloud/0.png');
    deferredByPhoto.get('ph_pending_1')!.reject(new Error('network blip'));
    deferredByPhoto.get('ph_pending_2')!.resolve('cloud/2.png');

    await new Promise((r) => setTimeout(r, 0));
    expect(maxConcurrentUploads).toBe(3);

    // Resolve remaining pending uploads (workers advance through ph_pending_3..6)
    for (let round = 0; round < 3; round++) {
      for (const [id, d] of deferredByPhoto.entries()) {
        if (id !== 'ph_pending_0' && id !== 'ph_pending_1' && id !== 'ph_pending_2') {
          d.resolve(`cloud/${id}.png`);
        }
      }
      await new Promise((r) => setTimeout(r, 0));
    }

    const uploaded = await syncPromise;
    expect(maxConcurrentUploads).toBe(3);
    expect(uploaded.get('ph_pending_0')).toBe('cloud/0.png');
    expect(uploaded.has('ph_pending_1')).toBeFalse();
    expect(uploaded.has('ph_pending_5')).toBeFalse();
    expect(uploaded.get('ph_pending_6')).toBe('cloud/ph_pending_6.png');
  });

  it('uses createImageBitmap({ imageOrientation: "from-image" }) and OffscreenCanvas.convertToBlob and closes bitmaps across all paths', async () => {
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = 64;
    smallCanvas.height = 48;
    smallCanvas.getContext('2d')!.fillRect(0, 0, 64, 48);
    const smallPng = await new Promise<Blob>((resolve, reject) => {
      smallCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    const smallFile = new File([smallPng], 'small.png', { type: 'image/png' });

    const realCreateBitmap = window.createImageBitmap.bind(window);
    const closeSmallSpy = jasmine.createSpy('closeSmall');
    const createBitmapSpy = spyOn(window, 'createImageBitmap') as unknown as jasmine.Spy<
      (image: ImageBitmapSource, options?: ImageBitmapOptions) => Promise<ImageBitmap>
    >;
    createBitmapSpy.and.resolveTo({
      width: 64,
      height: 48,
      close: closeSmallSpy,
    } as unknown as ImageBitmap);

    const validatedSmall = await service.validateImageFile(smallFile);
    expect(createBitmapSpy).toHaveBeenCalledWith(smallFile, { imageOrientation: 'from-image' });
    expect(validatedSmall.wasDownscaled).toBeFalse();
    expect(validatedSmall.width).toBe(64);
    expect(validatedSmall.height).toBe(48);
    expect(closeSmallSpy).toHaveBeenCalledTimes(1);

    // Downscaled path with OffscreenCanvas.convertToBlob
    const bigCanvas = document.createElement('canvas');
    bigCanvas.width = 3000;
    bigCanvas.height = 2000;
    bigCanvas.getContext('2d')!.fillRect(0, 0, 3000, 2000);
    const bigPng = await new Promise<Blob>((resolve, reject) => {
      bigCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    const bigFile = new File([bigPng], 'big.png', { type: 'image/png' });

    const realBitmap = await realCreateBitmap(bigFile);
    const closeRealSpy = spyOn(realBitmap, 'close').and.callThrough();
    createBitmapSpy.and.resolveTo(realBitmap);

    const convertSpy =
      typeof OffscreenCanvas !== 'undefined' && typeof OffscreenCanvas.prototype.convertToBlob === 'function'
        ? spyOn(OffscreenCanvas.prototype, 'convertToBlob').and.callThrough()
        : null;

    const validatedBig = await service.validateImageFile(bigFile);
    expect(validatedBig.wasDownscaled).toBeTrue();
    expect(validatedBig.width).toBe(USER_LIMITS.MAX_PHOTO_DIMENSION_PX);
    expect(closeRealSpy).toHaveBeenCalledTimes(1);
    if (convertSpy) {
      expect(convertSpy).toHaveBeenCalled();
    }

    // Invalid 0x0 bitmap closes immediately and rejects
    const closeZeroSpy = jasmine.createSpy('closeZero');
    createBitmapSpy.and.resolveTo({
      width: 0,
      height: 100,
      close: closeZeroSpy,
    } as unknown as ImageBitmap);
    await expectAsync(service.validateImageFile(smallFile)).toBeRejectedWithError(
      'Image has invalid dimensions.'
    );
    expect(closeZeroSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back cleanly to HTMLImageElement + HTMLCanvasElement when ImageBitmap and OffscreenCanvas are unavailable', async () => {
    spyOn(
      service as unknown as { canUseImageBitmap: () => boolean },
      'canUseImageBitmap'
    ).and.returnValue(false);
    spyOn(
      service as unknown as { canUseOffscreenCanvas: () => boolean },
      'canUseOffscreenCanvas'
    ).and.returnValue(false);

    const canvas = document.createElement('canvas');
    canvas.width = 3000;
    canvas.height = 2000;
    canvas.getContext('2d')!.fillRect(0, 0, 3000, 2000);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    const largeFile = new File([pngBlob], 'fallback-wide.png', { type: 'image/png' });

    const createBitmapSpy = spyOn(window, 'createImageBitmap');
    const validated = await service.validateImageFile(largeFile);
    expect(createBitmapSpy).not.toHaveBeenCalled();
    expect(validated.wasDownscaled).toBeTrue();
    expect(validated.width).toBeLessThanOrEqual(USER_LIMITS.MAX_PHOTO_DIMENSION_PX);

    // Invalid 0x0 dimensions in fallback path
    const tinyPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const badFile = new File([tinyPngBytes], 'bad.png', { type: 'image/png' });
    await expectAsync(service.validateImageFile(badFile)).toBeRejected();
  });
});
