import { InventoryReadinessResult, ModelSummary } from '../models/catalog.models';

export type ReadinessFilterMode = 'all' | 'ready100' | 'missing1' | 'missing2' | 'sortReady';

/**
 * Checks whether a miniature summary matches a lowercased search query
 * across model name, faction names, and game system names.
 */
export function matchesModelSearch(
  model: Pick<ModelSummary, 'name' | 'factionNames' | 'gameNames'>,
  queryLower: string
): boolean {
  if (!queryLower) {
    return true;
  }
  if (model.name.toLowerCase().includes(queryLower)) {
    return true;
  }
  if (model.factionNames.some((fn) => fn.toLowerCase().includes(queryLower))) {
    return true;
  }
  return model.gameNames.some((gn) => gn.toLowerCase().includes(queryLower));
}

/**
 * Filters or sorts items decorated with an InventoryReadinessResult by readiness mode.
 */
export function applyReadinessFilter<T extends { readiness: InventoryReadinessResult }>(
  items: T[],
  filter: ReadinessFilterMode
): T[] {
  if (filter === 'ready100') {
    return items.filter((x) => x.readiness.totalRequired > 0 && x.readiness.matchPercent === 100);
  }
  if (filter === 'missing1') {
    return items.filter((x) => x.readiness.totalRequired > 0 && x.readiness.missingCount <= 1);
  }
  if (filter === 'missing2') {
    return items.filter((x) => x.readiness.totalRequired > 0 && x.readiness.missingCount <= 2);
  }
  if (filter === 'sortReady') {
    return [...items].sort((a, b) => b.readiness.matchPercent - a.readiness.matchPercent);
  }
  return items;
}

/**
 * Formats a Citadel paint range identifier into its user-facing display label.
 */
export function getCitadelBrandLabel(range?: string, classicLabel = 'Citadel Classic'): string {
  if (range === 'warhammer_pro') {
    return 'Citadel Tone Pro';
  }
  return classicLabel;
}

/**
 * Generates a collision-resistant local entity ID using Web Crypto.
 */
export function createEntityId(prefix: string): string {
  const randomSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  return `${prefix}_${Date.now()}_${randomSuffix}`;
}
