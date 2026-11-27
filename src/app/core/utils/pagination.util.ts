import { WritableSignal, linkedSignal } from '@angular/core';

export interface VisibleLimitPagination {
  readonly limit: WritableSignal<number>;
  loadMore: () => void;
  reset: () => void;
}

/**
 * Creates a `linkedSignal`-backed pagination limit that automatically resets to
 * `pageSize` whenever `resetTrigger()` changes.
 */
export function createVisibleLimit(
  pageSize = 60,
  resetTrigger?: () => unknown
): VisibleLimitPagination {
  const limit = linkedSignal<unknown, number>({
    source: resetTrigger ?? (() => null),
    computation: () => pageSize,
  });

  return {
    limit,
    loadMore: () => limit.update((value) => value + pageSize),
    reset: () => limit.set(pageSize),
  };
}
