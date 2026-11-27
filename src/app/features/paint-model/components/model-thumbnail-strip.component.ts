import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { UserUploadedPhoto } from '../../../core/models/catalog.models';
import { ImageService } from '../../../core/services/image.service';
import { UserMediaService } from '../../../core/services/user-media.service';

@Component({
  selector: 'app-model-thumbnail-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './model-thumbnail-strip.component.ng.html',
  styleUrl: './model-thumbnail-strip.component.css',
})
export class ModelThumbnailStripComponent {
  readonly img = inject(ImageService);
  readonly media = inject(UserMediaService);

  readonly officialImages = input<string[]>([]);
  readonly localImagePaths = input<string[]>([]);
  readonly userPhotos = input<UserUploadedPhoto[]>([]);
  readonly customFeaturedUrl = input<string | null>(null);
  readonly hasCustomOverlayFeatured = input<boolean>(false);
  readonly viewingCustomFeatured = input<boolean>(false);
  readonly selectedImageIndex = input<number>(0);
  readonly selectedUserPhotoId = input<string | null>(null);
  readonly officialAriaPrefix = input<string>('View official angle ');
  readonly showCustomFeaturedTitle = input<boolean>(true);

  readonly selectCustomFeatured = output<void>();
  readonly selectOfficialAngle = output<number>();
  readonly selectUserPhoto = output<string>();
}
