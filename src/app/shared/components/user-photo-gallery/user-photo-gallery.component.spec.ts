import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UserMediaService } from '../../../core/services/user-media.service';
import { UserStateService } from '../../../core/services/user-state.service';
import { UserPhotoGalleryComponent } from './user-photo-gallery.component';

function createPasteEvent(files: File[], target?: EventTarget): ClipboardEvent {
  let defaultPrevented = false;
  let propagationStopped = false;
  const event = {
    clipboardData: {
      items: files.map((file) => ({
        kind: 'file',
        type: file.type,
        getAsFile: () => file,
      })),
      files,
    },
    target: target ?? document.body,
    get defaultPrevented() {
      return defaultPrevented;
    },
    preventDefault: () => {
      defaultPrevented = true;
    },
    stopPropagation: () => {
      propagationStopped = true;
    },
    get _propagationStopped() {
      return propagationStopped;
    },
  };
  return event as unknown as ClipboardEvent & { _propagationStopped: boolean };
}

describe('UserPhotoGalleryComponent clipboard paste', () => {
  let uploadPhotosSpy: jasmine.Spy;

  beforeEach(async () => {
    uploadPhotosSpy = jasmine.createSpy('uploadPhotos').and.resolveTo({
      uploaded: [],
      errors: [],
    });

    await TestBed.configureTestingModule({
      imports: [UserPhotoGalleryComponent],
      providers: [
        {
          provide: UserStateService,
          useValue: {
            allUploadedPhotos: signal([]),
            getPhotoQuotaLimit: () => 8,
            getPhotosForTarget: () => [],
            uploadPhotos: uploadPhotosSpy,
            updatePhotoCaption: jasmine.createSpy('updatePhotoCaption'),
            deleteUserPhoto: jasmine.createSpy('deleteUserPhoto'),
          },
        },
        {
          provide: UserMediaService,
          useValue: {
            resolvePhotoUrl: () => '/icons/ic_image_loading_placeholder.svg',
          },
        },
      ],
    }).compileComponents();
  });

  function createComponent(allowGlobalPaste = false) {
    const fixture = TestBed.createComponent(UserPhotoGalleryComponent);
    fixture.componentRef.setInput('targetType', 'model');
    fixture.componentRef.setInput('targetId', 'model-1');
    fixture.componentRef.setInput('kind', 'showcase');
    fixture.componentRef.setInput('allowGlobalPaste', allowGlobalPaste);
    fixture.detectChanges();
    return fixture;
  }

  it('uploads an image pasted directly into the gallery block and stops propagation', async () => {
    const fixture = createComponent(false);
    const png = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    const event = createPasteEvent([png]);

    await fixture.componentInstance.onPaste(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(uploadPhotosSpy).toHaveBeenCalledTimes(1);
    const callArg = uploadPhotosSpy.calls.mostRecent().args[0];
    expect(callArg.files.length).toBe(1);
    expect(callArg.targetType).toBe('model');
    expect(callArg.targetId).toBe('model-1');
    expect(callArg.kind).toBe('showcase');
  });

  it('does not prevent default when pasting plain text inside the gallery', async () => {
    const fixture = createComponent(false);
    const event = createPasteEvent([]);

    await fixture.componentInstance.onPaste(event);

    expect(event.defaultPrevented).toBeFalse();
    expect(uploadPhotosSpy).not.toHaveBeenCalled();
  });

  it('uploads on document paste when allowGlobalPaste is enabled and target is non-editable', async () => {
    const fixture = createComponent(true);
    const png = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });
    const event = createPasteEvent([png], document.body);

    await fixture.componentInstance.onDocumentPaste(event);

    expect(event.defaultPrevented).toBeTrue();
    expect(uploadPhotosSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores document paste when allowGlobalPaste is false or target is an input', async () => {
    const png = new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });

    const disabledFixture = createComponent(false);
    await disabledFixture.componentInstance.onDocumentPaste(createPasteEvent([png], document.body));
    expect(uploadPhotosSpy).not.toHaveBeenCalled();

    const enabledFixture = createComponent(true);
    const inputEl = document.createElement('input');
    await enabledFixture.componentInstance.onDocumentPaste(createPasteEvent([png], inputEl));
    expect(uploadPhotosSpy).not.toHaveBeenCalled();
  });

  it('renders a Paste button that reads from the clipboard API', async () => {
    const fixture = createComponent(false);
    const pasteBtn: HTMLButtonElement | null = fixture.nativeElement.querySelector(
      'button[aria-label="Paste image from clipboard"]'
    );
    expect(pasteBtn).not.toBeNull();

    const fakeBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: jasmine.createSpy('read').and.resolveTo([
          {
            types: ['image/png'],
            getType: () => Promise.resolve(fakeBlob),
          },
        ]),
      },
    });

    try {
      await fixture.componentInstance.onPasteButtonClick();
      expect(uploadPhotosSpy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it('keeps dragActive true on child transition dragleave and clears it when leaving dropzone', () => {
    const fixture = createComponent(false);
    const dropzone: HTMLElement = fixture.nativeElement.querySelector('.upload-dropzone');
    const childHint: HTMLElement = fixture.nativeElement.querySelector('.drop-hint');

    fixture.componentInstance.dragActive.set(true);

    // Leaving dropzone to an internal child keeps dragActive true
    fixture.componentInstance.onDragLeave({
      preventDefault: () => {},
      currentTarget: dropzone,
      relatedTarget: childHint,
    } as unknown as DragEvent);
    expect(fixture.componentInstance.dragActive()).toBeTrue();

    // Leaving dropzone to an outside element clears dragActive
    const outsideEl = document.createElement('div');
    fixture.componentInstance.onDragLeave({
      preventDefault: () => {},
      currentTarget: dropzone,
      relatedTarget: outsideEl,
    } as unknown as DragEvent);
    expect(fixture.componentInstance.dragActive()).toBeFalse();

    // Leaving with null relatedTarget also clears dragActive
    fixture.componentInstance.dragActive.set(true);
    fixture.componentInstance.onDragLeave({
      preventDefault: () => {},
      currentTarget: dropzone,
      relatedTarget: null,
    } as unknown as DragEvent);
    expect(fixture.componentInstance.dragActive()).toBeFalse();
  });
});
