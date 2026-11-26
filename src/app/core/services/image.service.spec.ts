import { TestBed } from '@angular/core/testing';
import {
  invalidateLocalFirebaseConfigCache,
  resetRuntimeFirebaseConfigForTests,
} from './firebase.config';
import { ImageService } from './image.service';

const FIREBASE_CONFIG_STORAGE_KEY = 'whc_firebase_config_v1';

describe('ImageService', () => {
  let service: ImageService;

  beforeEach(() => {
    localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
    resetRuntimeFirebaseConfigForTests();
    TestBed.configureTestingModule({
      providers: [ImageService],
    });
    service = TestBed.inject(ImageService);
  });

  afterEach(() => {
    localStorage.removeItem(FIREBASE_CONFIG_STORAGE_KEY);
    resetRuntimeFirebaseConfigForTests();
  });

  it('resolves localPath via Firebase Storage when storageBucket and useCloudStorage are enabled', () => {
    localStorage.setItem(
      FIREBASE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        apiKey: 'test_Key_Value_1234567890',
        authDomain: 'model-painter-a8724.firebaseapp.com',
        projectId: 'model-painter-a8724',
        storageBucket: 'model-painter-a8724.appspot.com',
        useCloudStorage: true,
      })
    );
    invalidateLocalFirebaseConfigCache();

    expect(service.resolve('/assets/images/paints/blue.png', 'https://cdn.example/blue.png')).toBe(
      'https://firebasestorage.googleapis.com/v0/b/model-painter-a8724.appspot.com/o/assets%2Fimages%2Fpaints%2Fblue.png?alt=media'
    );
    expect(service.resolve('assets/images/models/dante.jpg')).toBe(
      'https://firebasestorage.googleapis.com/v0/b/model-painter-a8724.appspot.com/o/assets%2Fimages%2Fmodels%2Fdante.jpg?alt=media'
    );
  });

  it('skips Firebase Storage when useCloudStorage is false or storageBucket is missing', () => {
    localStorage.setItem(
      FIREBASE_CONFIG_STORAGE_KEY,
      JSON.stringify({
        apiKey: 'test_Key_Value_1234567890',
        authDomain: 'model-painter-a8724.firebaseapp.com',
        projectId: 'model-painter-a8724',
        storageBucket: 'model-painter-a8724.appspot.com',
        useCloudStorage: false,
      })
    );
    invalidateLocalFirebaseConfigCache();

    expect(service.resolve('assets/images/paints/blue.png', 'https://cdn.example/blue.png')).toBe(
      'https://cdn.example/blue.png'
    );
    expect(service.resolve('assets/images/paints/blue.png', null)).toBe(
      '/assets/images/paints/blue.png'
    );
  });

  it('falls back to remoteUrl, normalized localPath, or default /icons/ic_models.svg', () => {
    expect(service.resolve('   ', 'https://cdn.example/fallback.png')).toBe(
      'https://cdn.example/fallback.png'
    );
    expect(service.resolve('assets/images/models/m1.png', '   ')).toBe(
      '/assets/images/models/m1.png'
    );
    expect(service.resolve('/assets/images/models/m1.png', null)).toBe(
      '/assets/images/models/m1.png'
    );
    expect(service.resolve(null, undefined)).toBe('/icons/ic_models.svg');
    expect(service.resolve('', '   ')).toBe('/icons/ic_models.svg');
  });
});
