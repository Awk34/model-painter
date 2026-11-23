import { USER_LIMITS } from '../config/user-limits.config';

const GENERIC_CLIPBOARD_NAMES = new Set([
  '',
  'image.png',
  'image.jpg',
  'image.jpeg',
  'image.webp',
  'blob',
]);

function extensionForMime(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    default: {
      const sub = mimeType.split('/')[1]?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      return sub || 'png';
    }
  }
}

export function createPastedFileName(mimeType: string, index = 0, now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = index > 0 ? `-${index + 1}` : '';
  return `pasted-image-${stamp}${suffix}.${extensionForMime(mimeType)}`;
}

function normalizeClipboardFile(file: File, index: number): File {
  const trimmedName = (file.name ?? '').trim().toLowerCase();
  if (!GENERIC_CLIPBOARD_NAMES.has(trimmedName)) {
    return file;
  }
  const mime = file.type || 'image/png';
  return new File([file], createPastedFileName(mime, index), {
    type: mime,
    lastModified: file.lastModified || Date.now(),
  });
}

/**
 * Extracts image File objects from a DOM ClipboardEvent (`paste`).
 * Returns an empty array when the clipboard contains only text/non-image content.
 */
export function extractClipboardImageFiles(event: ClipboardEvent): File[] {
  const data = event.clipboardData;
  if (!data) {
    return [];
  }

  const extracted: File[] = [];

  if (data.items && data.items.length > 0) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          extracted.push(normalizeClipboardFile(file, extracted.length));
        }
      }
    }
  }

  if (extracted.length === 0 && data.files && data.files.length > 0) {
    for (let i = 0; i < data.files.length; i++) {
      const file = data.files[i];
      if (file.type.startsWith('image/')) {
        extracted.push(normalizeClipboardFile(file, extracted.length));
      }
    }
  }

  return extracted;
}

export interface ClipboardReadResult {
  files: File[];
  error?: string;
}

/**
 * Reads image files on demand using the Async Clipboard API (`navigator.clipboard.read`).
 */
export async function readClipboardImageFiles(): Promise<ClipboardReadResult> {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.read !== 'function') {
    return {
      files: [],
      error:
        'Direct clipboard read is not available in this browser. Click the upload area and press Ctrl+V (or Cmd+V) instead.',
    };
  }

  try {
    const items = await navigator.clipboard.read();
    const files: File[] = [];

    for (const item of items) {
      const preferredMime =
        USER_LIMITS.ALLOWED_IMAGE_MIME_TYPES.find((t) => item.types.includes(t)) ??
        item.types.find((t) => t.startsWith('image/'));

      if (!preferredMime) {
        continue;
      }

      const blob = await item.getType(preferredMime);
      const mime = blob.type || preferredMime;
      files.push(
        new File([blob], createPastedFileName(mime, files.length), {
          type: mime,
          lastModified: Date.now(),
        })
      );
    }

    if (files.length === 0) {
      return {
        files: [],
        error: 'No image found in your clipboard. Copy an image or screenshot first.',
      };
    }

    return { files };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return {
        files: [],
        error:
          'Clipboard access was denied. Allow clipboard permission or click the upload area and press Ctrl+V (or Cmd+V).',
      };
    }
    return {
      files: [],
      error:
        'Could not read image from clipboard. Try clicking the upload area and pressing Ctrl+V (or Cmd+V).',
    };
  }
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return Boolean(target.closest('[contenteditable="true"]'));
}

export function hasOpenModalDialog(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
}
