import { Injectable, inject } from '@angular/core';
import {
  InventoryReadinessResult,
  PaintSubstituteMatch,
} from '../models/warhammer.models';
import { CatalogService } from './catalog.service';
import { UserStateService } from './user-state.service';

@Injectable({
  providedIn: 'root',
})
export class InventoryMatchService {
  private readonly catalog = inject(CatalogService);
  private readonly userState = inject(UserStateService);

  /**
   * Computes "Can I Paint This?" inventory readiness for any list of required Citadel Paint IDs.
   * Respects:
   * - Direct ownership in `inventoryPaintIds`
   * - Official Citadel Classic <-> Tone Pro compatibility (when `allowCompatibleSubstitutions` is enabled)
   * - Pre-seeded & custom 3rd-party paint equivalents (when `allowThirdPartySubstitutions` is enabled)
   */
  evaluateReadiness(requiredPaintIds: string[]): InventoryReadinessResult {
    const deduped = Array.from(new Set(requiredPaintIds.filter(Boolean)));
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
    const overrides = this.userState.customCompatibilityOverrides();
    const paintById = this.catalog.paintById();
    const tpById = this.catalog.thirdPartyPaintById();
    const customById = new Map(this.userState.customPaints().map((c) => [c.id, c]));
    const classicToPro = this.catalog.classicToToneProMap();
    const proToClassic = this.catalog.toneProToClassicMap();
    const citadelToTp = this.catalog.citadelToThirdPartyMap();

    const ownedDirectIds: string[] = [];
    const substitutedByPaintId: Record<string, PaintSubstituteMatch> = {};
    const missingPaintIds: string[] = [];

    for (const pid of deduped) {
      if (invSet.has(pid)) {
        ownedDirectIds.push(pid);
        continue;
      }

      let foundSub: PaintSubstituteMatch | null = null;

      // 1. Check user custom compatibility overrides first
      const userOverrideIds = overrides[pid] ?? [];
      for (const eqId of userOverrideIds) {
        if (invSet.has(eqId)) {
          const customP = customById.get(eqId) ?? tpById.get(eqId);
          const citP = paintById.get(eqId);
          if (customP) {
            foundSub = {
              requiredPaintId: pid,
              substitutePaintId: eqId,
              substituteName: customP.name,
              substituteBrand: `${customP.brand} (${customP.range})`,
              substituteHex: customP.hex,
              matchType: 'custom_override',
            };
            break;
          } else if (citP) {
            foundSub = {
              requiredPaintId: pid,
              substitutePaintId: eqId,
              substituteName: citP.name,
              substituteBrand: citP.range === 'warhammer_pro' ? 'Citadel Tone Pro' : 'Citadel Classic',
              substituteHex: citP.gradientStartHex,
              matchType: 'custom_override',
            };
            break;
          }
        }
      }

      // 2. Check official Citadel Classic <-> Tone Pro compatibility
      if (!foundSub && prefs.allowCompatibleSubstitutions) {
        const proLinks = classicToPro.get(pid) ?? [];
        for (const link of proLinks) {
          if (invSet.has(link.tone_pro_paint_id)) {
            foundSub = {
              requiredPaintId: pid,
              substitutePaintId: link.tone_pro_paint_id,
              substituteName: link.tone_pro_paint_name,
              substituteBrand: 'Citadel Tone Pro',
              substituteHex: link.tone_pro_hex,
              matchType: 'tone_pro',
            };
            break;
          }
        }

        if (!foundSub) {
          const classicLinks = proToClassic.get(pid) ?? [];
          for (const link of classicLinks) {
            if (invSet.has(link.classic_paint_id)) {
              const cp = paintById.get(link.classic_paint_id);
              foundSub = {
                requiredPaintId: pid,
                substitutePaintId: link.classic_paint_id,
                substituteName: link.classic_paint_name,
                substituteBrand: 'Citadel Classic',
                substituteHex: cp?.gradientStartHex ?? '#888888',
                matchType: 'classic_citadel',
              };
              break;
            }
          }
        }
      }

      // 3. Check 3rd-party paint equivalents (Army Painter, Vallejo, Two Thin Coats, Pro Acryl, AK 3G)
      if (!foundSub && prefs.allowThirdPartySubstitutions) {
        const tpMatches = citadelToTp[pid] ?? [];
        for (const tpm of tpMatches) {
          if (invSet.has(tpm.thirdPartyPaintId)) {
            foundSub = {
              requiredPaintId: pid,
              substitutePaintId: tpm.thirdPartyPaintId,
              substituteName: tpm.name,
              substituteBrand: `${tpm.brand} (${tpm.range})`,
              substituteHex: tpm.hex,
              matchType: 'third_party',
              deltaE: tpm.deltaE,
            };
            break;
          }
        }
      }

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
}
