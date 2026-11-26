import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createVisibleLimit } from './pagination.util';

describe('createVisibleLimit', () => {
  it('increments on loadMore, resets on reset(), and auto-resets when trigger changes', () => {
    TestBed.runInInjectionContext(() => {
      const trigger = signal('inventory');
      const pager = createVisibleLimit(60, () => trigger());

      expect(pager.limit()).toBe(60);

      pager.loadMore();
      expect(pager.limit()).toBe(120);

      trigger.set('wishlist');
      expect(pager.limit()).toBe(60);

      pager.loadMore();
      expect(pager.limit()).toBe(120);

      pager.reset();
      expect(pager.limit()).toBe(60);
    });
  });

  it('supports custom page sizes', () => {
    TestBed.runInInjectionContext(() => {
      const pager = createVisibleLimit(25);
      expect(pager.limit()).toBe(25);
      pager.loadMore();
      expect(pager.limit()).toBe(50);
    });
  });
});
