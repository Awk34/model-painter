import { TestBed } from '@angular/core/testing';
import { ImageService } from '../../../core/services/image.service';
import { UserMediaService } from '../../../core/services/user-media.service';
import { ModelThumbnailStripComponent } from './model-thumbnail-strip.component';

describe('ModelThumbnailStripComponent', () => {
  it('renders featured, official, and user photo thumbnails and emits selection events', () => {
    TestBed.configureTestingModule({
      imports: [ModelThumbnailStripComponent],
      providers: [
        {
          provide: ImageService,
          useValue: {
            resolve: (localPath?: string | null, remoteUrl?: string | null) =>
              localPath || remoteUrl || '/icons/ic_models.svg',
          },
        },
        {
          provide: UserMediaService,
          useValue: {
            resolvePhotoUrl: () => '/icons/ic_paint.svg',
          },
        },
      ],
    });

    const fixture = TestBed.createComponent(ModelThumbnailStripComponent);
    fixture.componentRef.setInput('officialImages', ['/a.png', '/b.png']);
    fixture.componentRef.setInput('localImagePaths', ['/la.png', '/lb.png']);
    fixture.componentRef.setInput('hasCustomOverlayFeatured', true);
    fixture.componentRef.setInput('customFeaturedUrl', '/feat.png');
    fixture.componentRef.setInput('userPhotos', [
      {
        id: 'up-1',
        targetType: 'model',
        targetId: 'm1',
        kind: 'reference',
        isPrivate: true,
        fileName: 'ref.png',
        mimeType: 'image/png',
        sizeBytes: 100,
        createdAt: '2026-11-26T00:00:00Z',
      },
    ]);
    fixture.detectChanges();

    const featSpy = jasmine.createSpy('selectCustomFeatured');
    const angleSpy = jasmine.createSpy('selectOfficialAngle');
    const photoSpy = jasmine.createSpy('selectUserPhoto');
    fixture.componentInstance.selectCustomFeatured.subscribe(featSpy);
    fixture.componentInstance.selectOfficialAngle.subscribe(angleSpy);
    fixture.componentInstance.selectUserPhoto.subscribe(photoSpy);

    const buttons = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.angle-thumb')
    ) as HTMLButtonElement[];
    expect(buttons.length).toBe(4);
    expect(buttons[3].querySelector('.thumb-lock')).not.toBeNull();
    const featImg = buttons[0].querySelector('img') as HTMLImageElement;
    const officialImg = buttons[1].querySelector('img') as HTMLImageElement;
    const userImg = buttons[3].querySelector('img') as HTMLImageElement;
    for (const imgEl of [featImg, officialImg, userImg]) {
      expect(imgEl.getAttribute('loading')).toBe('lazy');
      expect(imgEl.getAttribute('decoding')).toBe('async');
    }
    expect(featImg.getAttribute('width')).toBe('68');
    expect(featImg.getAttribute('height')).toBe('68');
    expect(userImg.getAttribute('width')).toBe('76');
    expect(userImg.getAttribute('height')).toBe('76');

    buttons[0].click();
    buttons[2].click();
    buttons[3].click();

    expect(featSpy).toHaveBeenCalledTimes(1);
    expect(angleSpy).toHaveBeenCalledWith(1);
    expect(photoSpy).toHaveBeenCalledWith('up-1');
  });
});
