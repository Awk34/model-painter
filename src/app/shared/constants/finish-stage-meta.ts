import { FinishStageKey } from '../../core/models/catalog.models';

export interface FinishStageMeta {
  key: FinishStageKey;
  shortLabel: string;
  title: string;
  tierHint: string;
  fullLabel: string;
  dropdownLabel: string;
  primaryWishlistButton: boolean;
}

export const FINISH_STAGE_META: readonly FinishStageMeta[] = [
  {
    key: 'base',
    shortLabel: '1. Base',
    title: '1. Base Finish',
    tierHint: 'Battle Ready',
    fullLabel: 'Base Finish (Battle Ready)',
    dropdownLabel: 'Target: 1. Base Finish (Battle Ready)',
    primaryWishlistButton: true,
  },
  {
    key: 'detail',
    shortLabel: '2. Detail',
    title: '2. Detail Finish',
    tierHint: 'Shade & Layer',
    fullLabel: 'Detail Finish (Parade Ready)',
    dropdownLabel: 'Target: 2. Detail Finish (Parade Ready)',
    primaryWishlistButton: false,
  },
  {
    key: 'artificer',
    shortLabel: '3. Artificer',
    title: '3. Artificer Finish',
    tierHint: 'Edge Highlights',
    fullLabel: 'Artificer Finish (Masterclass)',
    dropdownLabel: 'Target: 3. Artificer Finish',
    primaryWishlistButton: false,
  },
] as const;

export const FINISH_STAGE_META_BY_KEY: Record<FinishStageKey, FinishStageMeta> = {
  base: FINISH_STAGE_META[0],
  detail: FINISH_STAGE_META[1],
  artificer: FINISH_STAGE_META[2],
};
