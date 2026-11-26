import { TestBed } from '@angular/core/testing';
import { UserUploadedPhoto } from '../../../core/models/catalog.models';
import { PhotoCardComponent } from './photo-card.component';
import { PhotoLightboxComponent } from './photo-lightbox.component';
import { PhotoUploadDropzoneComponent } from './photo-upload-dropzone.component';

const SAMPLE_PHOTO: UserUploadedPhoto = {
  id: 'ph-1',
  targetType: 'model',
  targetId: 'm-1',
  kind: 'showcase',
  isPrivate: false,
  fileName: 'squad.png',
  mimeType: 'image/png',
  sizeBytes: 2048,
  caption: 'Squad Leader',
  createdAt: '2026-11-26T00:00:00Z',
};

describe('UserPhotoGallery decomposed subcomponents', () => {
  it('PhotoUploadDropzoneComponent syncs reactive caption and preserves drag-leave containment guard', () => {
    TestBed.configureTestingModule({
      imports: [PhotoUploadDropzoneComponent],
    });
    const fixture = TestBed.createComponent(PhotoUploadDropzoneComponent);
    const comp = fixture.componentInstance;
    fixture.componentRef.setInput('inputId', 'up-1');
    fixture.componentRef.setInput('captionInputId', 'cap-1');
    fixture.componentRef.setInput('acceptAttr', 'image/png');
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector('#cap-1') as HTMLInputElement;
    input.value = 'WIP armor';
    input.dispatchEvent(new Event('input'));
    expect(comp.caption()).toBe('WIP armor');

    const dropzone = root.querySelector('.upload-dropzone') as HTMLElement;
    const hint = root.querySelector('.drop-hint') as HTMLElement;
    comp.dragActive.set(true);
    comp.onDragLeave({
      preventDefault: () => {},
      currentTarget: dropzone,
      relatedTarget: hint,
    } as unknown as DragEvent);
    expect(comp.dragActive()).toBeTrue();

    comp.onDragLeave({
      preventDefault: () => {},
      currentTarget: dropzone,
      relatedTarget: null,
    } as unknown as DragEvent);
    expect(comp.dragActive()).toBeFalse();
  });

  it('PhotoCardComponent renders <time [datetime]> and submits reactive caption edit', () => {
    TestBed.configureTestingModule({
      imports: [PhotoCardComponent],
    });
    const fixture = TestBed.createComponent(PhotoCardComponent);
    fixture.componentRef.setInput('photo', SAMPLE_PHOTO);
    fixture.componentRef.setInput('photoUrl', '/icons/ic_models.svg');
    fixture.componentRef.setInput('isEditingCaption', false);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-26T00:00:00Z');

    const saveSpy = jasmine.createSpy('saveCaption');
    fixture.componentInstance.saveCaption.subscribe(saveSpy);
    fixture.componentRef.setInput('isEditingCaption', true);
    fixture.componentRef.setInput('editingCaptionText', 'Updated Caption');
    fixture.detectChanges();

    fixture.componentInstance.onSaveCaption();
    expect(saveSpy).toHaveBeenCalledWith('Updated Caption');
  });

  it('PhotoLightboxComponent emits prev/next on ArrowLeft/ArrowRight inside dialog', () => {
    TestBed.configureTestingModule({
      imports: [PhotoLightboxComponent],
    });
    const fixture = TestBed.createComponent(PhotoLightboxComponent);
    fixture.componentRef.setInput('photo', SAMPLE_PHOTO);
    fixture.componentRef.setInput('photoUrl', '/icons/ic_models.svg');
    fixture.componentRef.setInput('titleId', 'lb-title');
    fixture.componentRef.setInput('index', 0);
    fixture.componentRef.setInput('totalCount', 2);
    fixture.detectChanges();

    const prevSpy = jasmine.createSpy('prev');
    const nextSpy = jasmine.createSpy('next');
    fixture.componentInstance.prev.subscribe(prevSpy);
    fixture.componentInstance.next.subscribe(nextSpy);

    const dialog = (fixture.nativeElement as HTMLElement).querySelector('dialog') as HTMLDialogElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(nextSpy).toHaveBeenCalledTimes(1);
    expect(prevSpy).toHaveBeenCalledTimes(1);
  });
});
