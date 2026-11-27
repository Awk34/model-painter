export interface PaintSubstituteMatch {
  requiredPaintId: string;
  substitutePaintId: string;
  substituteName: string;
  substituteBrand: string;
  substituteHex: string;
  matchType: 'tone_pro' | 'classic_citadel' | 'third_party' | 'custom_override';
  deltaE?: number;
}

export type FinishStageKey = 'base' | 'detail' | 'artificer';

export interface InventoryReadinessResult {
  totalRequired: number;
  ownedDirectCount: number;
  substitutedCount: number;
  missingCount: number;
  matchPercent: number;
  ownedDirectIds: string[];
  substitutedByPaintId: Record<string, PaintSubstituteMatch>;
  missingPaintIds: string[];
}

export interface StagedReadinessResult {
  base: InventoryReadinessResult;
  detail: InventoryReadinessResult;
  artificer: InventoryReadinessResult;
  overall: InventoryReadinessResult;
}
