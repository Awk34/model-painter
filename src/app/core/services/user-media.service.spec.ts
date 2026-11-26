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

    spyOn(
      service as unknown as {
        loadImageElement: () => Promise<{ img: HTMLImageElement; width: number; height: number }>;
      },
      'loadImageElement'
    ).and.resolveTo({
      img: fakeImg as unknown as HTMLImageElement,
      width: 35000,
      height: 100,
    });

    const extremeValidated = await service.validateImageFile(extremeFile);
    expect(extremeValidated.wasDownscaled).toBeTrue();
    expect(extremeValidated.width).toBeLessThanOrEqual(USER_LIMITS.MAX_PHOTO_DIMENSION_PX);
    expect(extremeValidated.width).toBeLessThanOrEqual(32768);

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
      service as unknown as { getFbHandles: () => unknown },
      'getFbHandles'
    ).and.returnValue({ auth: { currentUser: { uid: 'uid_1' } }, storage: {} });
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
});
