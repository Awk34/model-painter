import {
  createPastedFileName,
  extractClipboardImageFiles,
  hasOpenModalDialog,
  isEditableElement,
  readClipboardImageFiles,
} from './clipboard-image.util';

function makeClipboardEvent(init: {
  items?: Array<{ kind: string; type: string; file: File | null }>;
  files?: File[];
}): ClipboardEvent {
  const clipboardData = {
    items: (init.items ?? []).map((item) => ({
      kind: item.kind,
      type: item.type,
      getAsFile: () => item.file,
    })),
    files: init.files ?? [],
  };

  return {
    clipboardData,
  } as unknown as ClipboardEvent;
}

describe('clipboard-image.util', () => {
  it('formats pasted filenames with timestamp and mime extension', () => {
    const fixedDate = new Date(2026, 10, 22, 9, 5, 3);
    expect(createPastedFileName('image/png', 0, fixedDate)).toBe('pasted-image-20261122-090503.png');
    expect(createPastedFileName('image/jpeg', 1, fixedDate)).toBe(
      'pasted-image-20261122-090503-2.jpg'
    );
    expect(createPastedFileName('image/webp', 0, fixedDate)).toBe(
      'pasted-image-20261122-090503.webp'
    );
  });

  it('extracts image files from clipboardData.items and normalizes generic names', () => {
    const pngFile = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    const event = makeClipboardEvent({
      items: [
        { kind: 'string', type: 'text/plain', file: null },
        { kind: 'file', type: 'image/png', file: pngFile },
      ],
    });

    const files = extractClipboardImageFiles(event);
    expect(files.length).toBe(1);
    expect(files[0].type).toBe('image/png');
    expect(files[0].name).toMatch(/^pasted-image-\d{8}-\d{6}\.png$/);
  });

  it('preserves non-generic filenames when pasting copied image files', () => {
    const customFile = new File([new Uint8Array([1, 2, 3])], 'captain-armor.webp', {
      type: 'image/webp',
    });
    const event = makeClipboardEvent({
      items: [{ kind: 'file', type: 'image/webp', file: customFile }],
    });

    const files = extractClipboardImageFiles(event);
    expect(files.length).toBe(1);
    expect(files[0].name).toBe('captain-armor.webp');
  });

  it('falls back to clipboardData.files when items is empty', () => {
    const jpgFile = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
    const txtFile = new File(['hello'], 'note.txt', { type: 'text/plain' });
    const event = makeClipboardEvent({
      files: [txtFile, jpgFile],
    });

    const files = extractClipboardImageFiles(event);
    expect(files.length).toBe(1);
    expect(files[0].name).toBe('photo.jpg');
  });

  it('returns an empty list for text-only paste events', () => {
    const event = makeClipboardEvent({
      items: [{ kind: 'string', type: 'text/plain', file: null }],
    });
    expect(extractClipboardImageFiles(event)).toEqual([]);
  });

  it('detects editable targets correctly', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const div = document.createElement('div');
    const editableDiv = document.createElement('div');
    editableDiv.contentEditable = 'true';

    expect(isEditableElement(input)).toBeTrue();
    expect(isEditableElement(textarea)).toBeTrue();
    expect(isEditableElement(div)).toBeFalse();
    expect(isEditableElement(editableDiv)).toBeTrue();
    expect(isEditableElement(null)).toBeFalse();
  });

  it('reads images via navigator.clipboard.read when available', async () => {
    const fakeBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    const fakeItem = {
      types: ['text/html', 'image/png'],
      getType: jasmine.createSpy('getType').and.resolveTo(fakeBlob),
    };
    const readSpy = jasmine.createSpy('read').and.resolveTo([fakeItem]);
    const originalClipboard = navigator.clipboard;

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: readSpy },
    });

    try {
      const result = await readClipboardImageFiles();
      expect(result.error).toBeUndefined();
      expect(result.files.length).toBe(1);
      expect(result.files[0].type).toBe('image/png');
      expect(result.files[0].name).toMatch(/^pasted-image-\d{8}-\d{6}\.png$/);
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it('returns a helpful error when clipboard permission is denied', async () => {
    const denied = new DOMException('Denied', 'NotAllowedError');
    const readSpy = jasmine.createSpy('read').and.rejectWith(denied);
    const originalClipboard = navigator.clipboard;

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: readSpy },
    });

    try {
      const result = await readClipboardImageFiles();
      expect(result.files).toEqual([]);
      expect(result.error).toContain('Clipboard access was denied');
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it('detects open native <dialog> and ARIA dialogs in hasOpenModalDialog()', () => {
    expect(hasOpenModalDialog()).toBeFalse();

    const nativeDialog = document.createElement('dialog');
    document.body.appendChild(nativeDialog);
    try {
      expect(hasOpenModalDialog()).toBeFalse();
      nativeDialog.showModal();
      expect(hasOpenModalDialog()).toBeTrue();
      nativeDialog.close();
      expect(hasOpenModalDialog()).toBeFalse();

      nativeDialog.setAttribute('open', '');
      expect(hasOpenModalDialog()).toBeTrue();
    } finally {
      nativeDialog.remove();
    }

    const ariaDialog = document.createElement('div');
    ariaDialog.setAttribute('role', 'dialog');
    ariaDialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(ariaDialog);
    try {
      expect(hasOpenModalDialog()).toBeTrue();
    } finally {
      ariaDialog.remove();
    }
    expect(hasOpenModalDialog()).toBeFalse();
  });
});
