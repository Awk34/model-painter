import { Injectable, inject } from '@angular/core';
import {
  InventoryReadinessResult,
  PaintSubstituteMatch,
  StagedReadinessResult,
  UserProject,
} from '../models/catalog.models';
import { getCitadelBrandLabel } from '../utils/catalog-filter.util';
import { CatalogService } from './catalog.service';
import { UserStateService } from './user-state.service';

@Injectable({
  providedIn: 'root',
})
export class InventoryMatchService {
  private readonly catalog = inject(CatalogService);
  private readonly userState = inject(UserStateService);

  /**
   * Computes "Can I Paint This?" inventory readiness for any list of required Paint IDs.
   * Respects:
   * - Direct ownership in `inventoryPaintIds`
   * - User custom equivalence overrides
   * - Official Citadel Classic <-> Tone Pro compatibility (when `allowCompatibleSubstitutions` is enabled)
   * - Pre-seeded 3rd-party paint equivalents (when `allowThirdPartySubstitutions` is enabled)
   */
  evaluateReadiness(requiredPaintIds?: string[] | null): InventoryReadinessResult {
    const deduped = Array.from(new Set((requiredPaintIds ?? []).filter(Boolean)));
    if (deduped.length === 0) {
      return {
        totalRequired: 0,
        ownedDirectCount: 0,
        substitutedCount: 0,
        missingCount: 0,
        matchPercent: 100,
        ownedDirectIds: [],
        substitutedByPaintId: {},
        missingPaintIds: [],
      };
    }

    const invSet = this.userState.inventorySet();
    const prefs = this.userState.preferences();
    const ownedDirectIds: string[] = [];
    const substitutedByPaintId: Record<string, PaintSubstituteMatch> = {};
    const missingPaintIds: string[] = [];

    for (const pid of deduped) {
      if (invSet.has(pid)) {
        ownedDirectIds.push(pid);
        continue;
      }

      const foundSub =
        this.findCustomOverrideMatch(pid, invSet) ??
        (prefs.allowCompatibleSubstitutions
          ? this.findOfficialCompatibilityMatch(pid, invSet)
          : null) ??
        (prefs.allowThirdPartySubstitutions ? this.findThirdPartyMatch(pid, invSet) : null);

      if (foundSub) {
        substitutedByPaintId[pid] = foundSub;
      } else {
        missingPaintIds.push(pid);
      }
    }

    const totalRequired = deduped.length;
    const ownedDirectCount = ownedDirectIds.length;
    const substitutedCount = Object.keys(substitutedByPaintId).length;
    const missingCount = missingPaintIds.length;
    const matchPercent = Math.round(((ownedDirectCount + substitutedCount) / totalRequired) * 100);

    return {
      totalRequired,
      ownedDirectCount,
      substitutedCount,
      missingCount,
      matchPercent,
      ownedDirectIds,
      substitutedByPaintId,
      missingPaintIds,
    };
  }

  private findCustomOverrideMatch(
    requiredPaintId: string,
    invSet: Set<string>
  ): PaintSubstituteMatch | null {
    const userOverrideIds = this.userState.customCompatibilityOverrides()[requiredPaintId] ?? [];
    if (userOverrideIds.length === 0) {
      return null;
    }

    const customById = this.userState.customPaintById();
    const tpById = this.catalog.thirdPartyPaintById();
    const paintById = this.catalog.paintById();

    for (const eqId of userOverrideIds) {
      if (!invSet.has(eqId)) {
        continue;
      }
      const customOrTp = customById.get(eqId) ?? tpById.get(eqId);
      if (customOrTp) {
        return {
          requiredPaintId,
          substitutePaintId: eqId,
          substituteName: customOrTp.name,
          substituteBrand: `${customOrTp.brand} (${customOrTp.range})`,
          substituteHex: customOrTp.hex,
          matchType: 'custom_override',
        };
      }
      const citP = paintById.get(eqId);
      if (citP) {
        return {
          requiredPaintId,
          substitutePaintId: eqId,
          substituteName: citP.name,
          substituteBrand: getCitadelBrandLabel(citP.range),
          substituteHex: citP.gradientStartHex,
          matchType: 'custom_override',
        };
      }
    }
    return null;
  }

  private findOfficialCompatibilityMatch(
    requiredPaintId: string,
    invSet: Set<string>
  ): PaintSubstituteMatch | null {
    const proLinks = this.catalog.classicToToneProMap().get(requiredPaintId) ?? [];
    for (const link of proLinks) {
      if (invSet.has(link.tone_pro_paint_id)) {
        return {
          requiredPaintId,
          substitutePaintId: link.tone_pro_paint_id,
          substituteName: link.tone_pro_paint_name,
          substituteBrand: 'Citadel Tone Pro',
          substituteHex: link.tone_pro_hex,
          matchType: 'tone_pro',
        };
      }
    }

    const classicLinks = this.catalog.toneProToClassicMap().get(requiredPaintId) ?? [];
    const paintById = this.catalog.paintById();
    for (const link of classicLinks) {
      if (invSet.has(link.classic_paint_id)) {
        const cp = paintById.get(link.classic_paint_id);
        return {
          requiredPaintId,
          substitutePaintId: link.classic_paint_id,
          substituteName: link.classic_paint_name,
          substituteBrand: 'Citadel Classic',
          substituteHex: cp?.gradientStartHex ?? '#888888',
          matchType: 'classic_citadel',
        };
      }
    }
    return null;
  }

  private findThirdPartyMatch(
    requiredPaintId: string,
    invSet: Set<string>
  ): PaintSubstituteMatch | null {
    const tpMatches = this.catalog.citadelToThirdPartyMap()[requiredPaintId] ?? [];
    for (const tpm of tpMatches) {
      if (invSet.has(tpm.thirdPartyPaintId)) {
        return {
          requiredPaintId,
          substitutePaintId: tpm.thirdPartyPaintId,
          substituteName: tpm.name,
          substituteBrand: `${tpm.brand} (${tpm.range})`,
          substituteHex: tpm.hex,
          matchType: 'third_party',
          deltaE: tpm.deltaE,
        };
      }
    }
    return null;
  }

  /**
   * Computes "Can I Paint This?" readiness split across the 3 finish tiers:
   * 1. Base Finish (Battle Ready)
   * 2. Detail Finish (Parade Ready)
   * 3. Artificer Finish (Masterclass)
   */
  evaluateStagedReadiness(stages: {
    base?: string[] | null;
    detail?: string[] | null;
    artificer?: string[] | null;
    all?: string[] | null;
  }): StagedReadinessResult {
    const baseIds = stages.base ?? [];
    const detailIds = stages.detail ?? [];
    const artificerIds = stages.artificer ?? [];
    const allIds =
      stages.all && stages.all.length > 0
        ? stages.all
        : [...baseIds, ...detailIds, ...artificerIds];

    return {
      base: this.evaluateReadiness(baseIds),
      detail: this.evaluateReadiness(detailIds),
      artificer: this.evaluateReadiness(artificerIds),
      overall: this.evaluateReadiness(allIds),
    };
  }

  /**
   * Aggregates required paints across all attached models and colors in a project
   * and evaluates 3-stage readiness.
   */
  evaluateProjectStagedReadiness(
    project: Pick<UserProject, 'recipeIds' | 'colorIds'>
  ): StagedReadinessResult {
    const baseIds = new Set<string>();
    const detailIds = new Set<string>();
    const artificerIds = new Set<string>();
    const allIds = new Set<string>();

    const modelById = this.catalog.modelById();
    const colorById = this.catalog.colorById();

    for (const rid of project.recipeIds) {
      const model = modelById.get(rid);
      if (model) {
        for (const id of model.paintsByStage?.base ?? []) {
          baseIds.add(id);
        }
        for (const id of model.paintsByStage?.detail ?? []) {
          detailIds.add(id);
        }
        for (const id of model.paintsByStage?.artificer ?? []) {
          artificerIds.add(id);
        }
        for (const id of model.requiredPaintIds) {
          allIds.add(id);
        }
      }
    }

    for (const cid of project.colorIds) {
      const color = colorById.get(cid);
      if (color) {
        for (const id of color.basePaintIds) {
          baseIds.add(id);
        }
        for (const id of color.detailPaintIds) {
          detailIds.add(id);
        }
        for (const id of color.artificerPaintIds) {
          artificerIds.add(id);
        }
        for (const id of color.requiredPaintIds) {
          allIds.add(id);
        }
      }
    }

    return this.evaluateStagedReadiness({
      base: Array.from(baseIds),
      detail: Array.from(detailIds),
      artificer: Array.from(artificerIds),
      all: Array.from(allIds),
    });
  }
}
