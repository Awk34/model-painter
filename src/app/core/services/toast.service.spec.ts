import { TestBed } from '@angular/core/testing';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ToastService] });
    service = TestBed.inject(ToastService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows a toast and auto-dismisses after default 3500ms duration', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(1_000_000));
      service.show('Saved');

      expect(service.current()?.message).toBe('Saved');
      expect(service.message()).toBe('Saved');
      expect(service.isPaused()).toBeFalse();

      jasmine.clock().tick(3499);
      expect(service.message()).toBe('Saved');

      jasmine.clock().tick(1);
      expect(service.message()).toBeNull();
      expect(service.current()).toBeNull();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('replaces active toast on rapid re-toast, clears prior timer, and increments monotonic id', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(1_000_000));
      service.show('First');
      const firstId = service.current()!.id;

      jasmine.clock().tick(2000);
      service.show('Second');
      const secondId = service.current()!.id;
      expect(secondId).toBeGreaterThan(firstId);
      expect(service.message()).toBe('Second');

      jasmine.clock().tick(2000);
      expect(service.message()).toBe('Second');

      jasmine.clock().tick(1500);
      expect(service.message()).toBeNull();

      // Re-showing identical string still emits new monotonic id and full timer
      service.show('Same');
      const idA = service.current()!.id;
      jasmine.clock().tick(2500);
      service.show('Same');
      const idB = service.current()!.id;
      expect(idB).toBeGreaterThan(idA);

      jasmine.clock().tick(2000);
      expect(service.message()).toBe('Same');
      jasmine.clock().tick(1500);
      expect(service.message()).toBeNull();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('dismisses immediately on manual dismiss() and ignores stale expectedId', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(1_000_000));
      service.show('First');
      const staleId = service.current()!.id;
      service.show('Second');

      service.dismiss(staleId);
      expect(service.message()).toBe('Second');

      jasmine.clock().tick(1000);
      service.dismiss();
      expect(service.message()).toBeNull();
      expect(service.current()).toBeNull();

      jasmine.clock().tick(5000);
      expect(service.message()).toBeNull();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('pauses remaining auto-dismiss time on pause() and resumes accurately on resume()', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(1_000_000));
      service.show('Hold');

      jasmine.clock().tick(2000);
      service.pause();
      expect(service.isPaused()).toBeTrue();

      jasmine.clock().tick(10000);
      expect(service.message()).toBe('Hold');

      service.resume();
      expect(service.isPaused()).toBeFalse();

      jasmine.clock().tick(1499);
      expect(service.message()).toBe('Hold');

      jasmine.clock().tick(1);
      expect(service.message()).toBeNull();
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('handles idempotent pause/resume, whitespace messages, and ngOnDestroy timer cleanup', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(1_000_000));

      // Whitespace message dismisses/ignores cleanly
      service.show('Visible');
      expect(service.message()).toBe('Visible');
      service.show('   ');
      expect(service.message()).toBeNull();

      // Resume when not paused is a no-op
      service.show('Active');
      service.resume();
      expect(service.isPaused()).toBeFalse();

      // Double pause is idempotent
      jasmine.clock().tick(1000);
      service.pause();
      service.pause();
      expect(service.isPaused()).toBeTrue();
      service.resume();
      jasmine.clock().tick(2500);
      expect(service.message()).toBeNull();

      // ngOnDestroy clears pending timer cleanly
      service.show('Before destroy');
      service.ngOnDestroy();
      jasmine.clock().tick(5000);
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('guards non-finite durationMs to 3500ms default and clamps duration to [0, 2147483647]', () => {
    jasmine.clock().install();
    try {
      jasmine.clock().mockDate(new Date(1_000_000));

      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        service.show('Fallback', bad);
        expect(service.current()?.durationMs).toBe(3500);
        jasmine.clock().tick(3499);
        expect(service.message()).toBe('Fallback');
        jasmine.clock().tick(1);
        expect(service.message()).toBeNull();
      }

      service.show('Sticky', -500);
      expect(service.current()?.durationMs).toBe(0);
      jasmine.clock().tick(10_000);
      expect(service.message()).toBe('Sticky');

      service.show('Capped', 3_000_000_000);
      expect(service.current()?.durationMs).toBe(2_147_483_647);
      service.dismiss();
    } finally {
      jasmine.clock().uninstall();
    }
  });
});
