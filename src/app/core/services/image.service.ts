import { Injectable } from '@angular/core';
import { getStoredFirebaseConfig } from './firebase.config';

@Injectable({
  providedIn: 'root',
})
export class ImageService {
  /**
   * Resolves a local relative asset path (`assets/images/...`), Firebase Cloud Storage URL,
   * or remote CDN URL (`remoteUrl`) with automatic fallback.
   */
  resolve(localPath?: string | null, remoteUrl?: string | null): string {
    const fbCfg = getStoredFirebaseConfig();
    if (localPath && localPath.trim().length > 0) {
      if (fbCfg?.storageBucket) {
        const encoded = encodeURIComponent(localPath.replace(/^\//, ''));
        return `https://firebasestorage.googleapis.com/v0/b/${fbCfg.storageBucket}/o/${encoded}?alt=media`;
      }
      if (
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
      ) {
        return localPath.startsWith('/') ? localPath : `/${localPath}`;
      }
    }
    if (remoteUrl && remoteUrl.trim().length > 0) {
      return remoteUrl;
    }
    if (localPath && localPath.trim().length > 0) {
      return localPath.startsWith('/') ? localPath : `/${localPath}`;
    }
    return '/icons/ic_models.svg';
  }
}
