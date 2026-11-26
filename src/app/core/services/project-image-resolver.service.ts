import { Injectable, inject } from '@angular/core';
import {
  ModelRecipe,
  ModelSummary,
  ProjectModelEntry,
  UserProject,
} from '../models/catalog.models';
import { CatalogService } from './catalog.service';
import { ImageService } from './image.service';
import { UserMediaService } from './user-media.service';

@Injectable({
  providedIn: 'root',
})
export class ProjectImageResolverService {
  private readonly catalog = inject(CatalogService);
  private readonly img = inject(ImageService);
  private readonly media = inject(UserMediaService);

  resolveFeaturedImageUrl(
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
}
