import { TestBed } from '@angular/core/testing';
import { PaintModalService } from './paint-modal.service';

describe('PaintModalService', () => {
  let service: PaintModalService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PaintModalService],
    });
    service = TestBed.inject(PaintModalService);
  });

  it('starts closed with activePaintId === null', () => {
    expect(service.activePaintId()).toBeNull();
  });

  it('opens a paint ID, ignores empty string, switches paints, and closes cleanly', () => {
    service.openPaint('');
    expect(service.activePaintId()).toBeNull();

    service.openPaint('paint-macragge');
    expect(service.activePaintId()).toBe('paint-macragge');

    service.openPaint('');
    expect(service.activePaintId()).toBe('paint-macragge');

    service.openPaint('paint-retributor');
    expect(service.activePaintId()).toBe('paint-retributor');

    service.close();
    expect(service.activePaintId()).toBeNull();
  });
});
