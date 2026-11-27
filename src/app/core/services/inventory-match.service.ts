import { Injectable, inject } from '@angular/core';
import {
  CitadelThirdPartyMatchRef,
  InventoryReadinessResult,
  ModelRecipe,
  Paint,
  PaintCompatibilityLink,
  PaintSubstituteMatch,
  StagedReadinessResult,
  ThirdPartyPaint,
  UserPreferences,
  UserProject,
} from '../models/catalog.models';
import { getCitadelBrandLabel, getPaintRepresentativeHex } from '../utils/catalog-filter.util';
import { CatalogService } from './catalog.service';
import { UserStateService } from './user-state.service';

interface MatchContext {
  invSet: Set<string>;
  prefs: Partial<UserPreferences> | undefined;
  overrides: Record<string, string[]>;
  customById: ReadonlyMap<string, ThirdPartyPaint>;
  tpById: ReadonlyMap<string, ThirdPartyPaint>;
  paintById: ReadonlyMap<string, Paint>;
  classicToToneProMap: ReadonlyMap<string, PaintCompatibilityLink[]>;
  toneProToClassicMap: ReadonlyMap<string, PaintCompatibilityLink[]>;
  citadelToThirdPartyMap: Record<string, CitadelThirdPartyMatchRef[]>;
  preferredBrandsSet: Set<string> | null;
}

type ResolvedPaintOutcome = 'direct' | PaintSubstituteMatch | null;

@Injectable({
  providedIn: 'root',
})
export class InventoryMatchService {
  private readonly catalog = inject(CatalogService);
  private readonly userState = inject(UserStateService);

  private createMatchContext(): MatchContext {
    const prefs = this.userState.preferences();
    const rawPreferred = prefs?.preferredThirdPartyBrands;
    const normalizedPreferred = Array.isArray(rawPreferred)
      ? rawPreferred.map((b) => b.trim().toLowerCase()).filter(Boolean)
      : [];

    return {
      invSet: this.userState.inventorySet(),
      prefs,
      overrides: this.userState.customCompatibilityOverrides(),
      customById: this.userState.customPaintById(),
      tpById: this.catalog.thirdPartyPaintById(),
      paintById: this.catalog.paintById(),
      classicToToneProMap: this.catalog.classicToToneProMap(),
      toneProToClassicMap: this.catalog.toneProToClassicMap(),
      citadelToThirdPartyMap: this.catalog.citadelToThirdPartyMap(),
      preferredBrandsSet: normalizedPreferred.length > 0 ? new Set(normalizedPreferred) : null,
    };
  }

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
    return this.evaluateReadinessWithContext(deduped, this.createMatchContext());
  }

  private evaluateReadinessWithContext(
    dedupedOrRawIds: readonly string[],
    ctx: MatchContext,
    cache?: Map<string, ResolvedPaintOutcome>,
    alreadyDeduped = false
  ): InventoryReadinessResult {
    const deduped = alreadyDeduped
      ? dedupedOrRawIds
      : Array.from(new Set(dedupedOrRawIds.filter(Boolean)));

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

    const ownedDirectIds: string[] = [];
    const substitutedByPaintId: Record<string, PaintSubstituteMatch> = {};
    const missingPaintIds: string[] = [];

    for (const pid of deduped) {
      let resolved: ResolvedPaintOutcome | undefined = cache?.get(pid);
      if (resolved === undefined) {
        if (ctx.invSet.has(pid)) {
          resolved = 'direct';
        } else {
          resolved =
            this.findCustomOverrideMatch(pid, ctx) ??
            (ctx.prefs?.allowCompatibleSubstitutions
              ? this.findOfficialCompatibilityMatch(pid, ctx)
              : null) ??
            (ctx.prefs?.allowThirdPartySubstitutions
              ? this.findThirdPartyMatch(pid, ctx)
              : null);
        }
        cache?.set(pid, resolved);
      }

      if (resolved === 'direct') {
        ownedDirectIds.push(pid);
      } else if (resolved) {
        Object.defineProperty(substitutedByPaintId, pid, {
          value: resolved,
          enumerable: true,
          configurable: true,
          writable: true,
        });
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
    ctx: MatchContext
  ): PaintSubstituteMatch | null {
    const userOverrideIds =
      (Object.hasOwn(ctx.overrides, requiredPaintId) ? ctx.overrides[requiredPaintId] : undefined) ??
      [];
    if (userOverrideIds.length === 0) {
      return null;
    }

    for (const eqId of userOverrideIds) {
      if (!ctx.invSet.has(eqId)) {
        continue;
      }
      const customOrTp = ctx.customById.get(eqId) ?? ctx.tpById.get(eqId);
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
      const citP = ctx.paintById.get(eqId);
      if (citP) {
        return {
          requiredPaintId,
          substitutePaintId: eqId,
          substituteName: citP.name,
          substituteBrand: getCitadelBrandLabel(citP.range),
          substituteHex: getPaintRepresentativeHex(citP),
          matchType: 'custom_override',
        };
      }
    }
    return null;
  }

  private findOfficialCompatibilityMatch(
    requiredPaintId: string,
    ctx: MatchContext
  ): PaintSubstituteMatch | null {
    const rangeFilter = ctx.prefs?.defaultRangeFilter ?? 'all';

    if (rangeFilter === 'all' || rangeFilter === 'warhammer_pro') {
      const proLinks = ctx.classicToToneProMap.get(requiredPaintId) ?? [];
      for (const link of proLinks) {
        if (ctx.invSet.has(link.tone_pro_paint_id)) {
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
    }

    if (rangeFilter === 'all' || rangeFilter === 'warhammer_colour') {
      const classicLinks = ctx.toneProToClassicMap.get(requiredPaintId) ?? [];
      for (const link of classicLinks) {
        if (ctx.invSet.has(link.classic_paint_id)) {
          const cp = ctx.paintById.get(link.classic_paint_id);
          return {
            requiredPaintId,
            substitutePaintId: link.classic_paint_id,
            substituteName: link.classic_paint_name,
            substituteBrand: 'Citadel Classic',
            substituteHex: getPaintRepresentativeHex(cp),
            matchType: 'classic_citadel',
          };
        }
      }
    }

    return null;
  }

  private findThirdPartyMatch(
    requiredPaintId: string,
    ctx: MatchContext
  ): PaintSubstituteMatch | null {
    const tpMatches =
      (Object.hasOwn(ctx.citadelToThirdPartyMap, requiredPaintId)
        ? ctx.citadelToThirdPartyMap[requiredPaintId]
        : undefined) ?? [];
    for (const tpm of tpMatches) {
      if (ctx.preferredBrandsSet && !ctx.preferredBrandsSet.has(tpm.brand.trim().toLowerCase())) {
        continue;
      }
      if (ctx.invSet.has(tpm.thirdPartyPaintId)) {
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

    const ctx = this.createMatchContext();
    const resolvedCache = new Map<string, ResolvedPaintOutcome>();

    return {
      base: this.evaluateReadinessWithContext(baseIds, ctx, resolvedCache),
      detail: this.evaluateReadinessWithContext(detailIds, ctx, resolvedCache),
      artificer: this.evaluateReadinessWithContext(artificerIds, ctx, resolvedCache),
      overall: this.evaluateReadinessWithContext(allIds, ctx, resolvedCache),
    };
  }

  /**
   * Computes 3-stage readiness for a full ModelRecipe, falling back to the catalog ModelSummary
   * when recipe steps omit stage assignments or paint lists.
   */
  evaluateModelRecipeStagedReadiness(recipe: ModelRecipe | null | undefined): StagedReadinessResult {
    if (!recipe) {
      return this.evaluateStagedReadiness({});
    }

    const baseIds: string[] = [];
    const detailIds: string[] = [];
    const artificerIds: string[] = [];
    const allIds: string[] = [];

    for (const area of recipe.paintingAreas ?? []) {
      for (const step of area.paintingSteps ?? []) {
        const pid = step.paint?.id;
        if (!pid) {
          continue;
        }
        allIds.push(pid);
        const stage = (step.paintingStage ?? '').toLowerCase();
        if (stage.includes('base')) {
          baseIds.push(pid);
        } else if (stage.includes('detail')) {
          detailIds.push(pid);
        } else {
          artificerIds.push(pid);
        }
      }
    }

    const summary = this.catalog.modelById().get(recipe.id);
    if (allIds.length === 0 && summary) {
      return this.evaluateStagedReadiness({
        base: summary.paintsByStage?.base,
        detail: summary.paintsByStage?.detail,
        artificer: summary.paintsByStage?.artificer,
        all: summary.requiredPaintIds,
      });
    }

    return this.evaluateStagedReadiness({
      base: baseIds.length ? baseIds : summary?.paintsByStage?.base,
      detail: detailIds.length ? detailIds : summary?.paintsByStage?.detail,
      artificer: artificerIds.length ? artificerIds : summary?.paintsByStage?.artificer,
      all: allIds,
    });
  }

  /**
   * Aggregates required paints across all attached models and colors in a project
   * and evaluates 3-stage readiness.
   */
  evaluateProjectStagedReadiness(
    project: Pick<UserProject, 'models' | 'colorIds'>
  ): StagedReadinessResult {
    const baseIds = new Set<string>();
    const detailIds = new Set<string>();
    const artificerIds = new Set<string>();
    const allIds = new Set<string>();

    const modelById = this.catalog.modelById();
    const colorById = this.catalog.colorById();
    const seenRecipeIds = new Set<string>();

    for (const entry of project.models) {
      if (!entry.recipeId || seenRecipeIds.has(entry.recipeId)) {
        continue;
      }
      seenRecipeIds.add(entry.recipeId);
      const model = modelById.get(entry.recipeId);
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
