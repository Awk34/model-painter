#!/usr/bin/env python3
"""
Builds a self-contained, < 900 KB interactive HTML artifact (`paint_warhammer_web_app.html`)
for the Antigravity Artifact Preview pane.
Embeds the real catalog data compressed with gzip + base64 (decoded in-browser via
standard `DecompressionStream('gzip')`) and converted APK SVG icons.
"""
import base64
import gzip
import json
from pathlib import Path

WEBAPP_DIR = Path("/home/antigravity/warhammer_webapp")
META_DIR = WEBAPP_DIR / "public" / "data" / "catalog_meta"
RECIPES_DIR = WEBAPP_DIR / "public" / "data" / "recipes"
COLOURS_DIR = WEBAPP_DIR / "public" / "data" / "colours"
SNAPSHOT_PATH = WEBAPP_DIR / "public" / "data" / "user_account_snapshot.json"
ARTIFACT_OUT = Path(
    "/home/antigravity/.gemini/jetski/brain/v1/default/jetski_remote_agents_3p/52f75f7a-af6e-4d42-a0f0-2d0193b84ca2/paint_warhammer_web_app.html"
)


def build_compact_payload():
    manifest = json.loads((META_DIR / "manifest.json").read_text(encoding="utf-8"))
    paints_bundle = json.loads((META_DIR / "paints_bundle.json").read_text(encoding="utf-8"))
    tp_bundle = json.loads((META_DIR / "third_party_paints_bundle.json").read_text(encoding="utf-8"))
    colours_bundle = json.loads((META_DIR / "colours_bundle.json").read_text(encoding="utf-8"))
    games_bundle = json.loads((META_DIR / "games_factions_bundle.json").read_text(encoding="utf-8"))
    snapshot = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))

    # Compact paints
    paints = []
    for p in paints_bundle["paints"]:
        paints.append({
            "id": p["id"],
            "name": p["name"],
            "range": p.get("range", "warhammer_colour"),
            "category": p.get("category", "Base"),
            "gradientStartHex": p.get("gradientStartHex") or "#888888",
            "gradientEndHex": p.get("gradientEndHex") or p.get("gradientStartHex") or "#555555",
            "warhammerProRange": p.get("warhammerProRange") or [],
        })

    # Compact colours (all 596!)
    colours = []
    for c in colours_bundle["colours"]:
        colours.append({
            "id": c["id"],
            "name": c["name"],
            "hex": c.get("hex") or "#888888",
            "range": c.get("range", "warhammer_colour"),
            "guideType": c.get("guideType", "miniature"),
            "colourGroups": c.get("colourGroups") or [],
            "basePaintIds": c.get("basePaintIds") or [],
            "detailPaintIds": c.get("detailPaintIds") or [],
            "artificerPaintIds": c.get("artificerPaintIds") or [],
            "requiredPaintIds": c.get("requiredPaintIds") or [],
        })

    # Compact games & factions (all 15 games & 335 factions, trimming huge recipeIds arrays to keep payload < 850KB)
    games = []
    for g in games_bundle["games"]:
        factions = []
        for f in g.get("factions") or []:
            children = []
            for cf in f.get("childFactions") or []:
                children.append({
                    "id": cf["id"],
                    "name": cf["name"],
                    "recipeCount": cf.get("recipeCount", 0),
                })
            factions.append({
                "id": f["id"],
                "name": f["name"],
                "recipeCount": f.get("recipeCount", 0),
                "childFactions": children,
            })
        games.append({
            "id": g["id"],
            "name": g["name"],
            "recipeCount": g.get("recipeCount", 0),
            "factions": factions,
        })

    # Load all 4,531 models (compact summary for instant search, faction filtering, and "Can I Paint This?")
    all_models = []
    for i in range(6):
        m_chunk = json.loads((META_DIR / f"models_index_{i}.json").read_text(encoding="utf-8"))
        for m in m_chunk["models"]:
            all_models.append({
                "id": m["id"],
                "name": m["name"],
                "range": m.get("range", "warhammer_colour"),
                "gameIds": m.get("gameIds") or [],
                "gameNames": m.get("gameNames") or [],
                "factionIds": m.get("factionIds") or [],
                "factionNames": (m.get("factionNames") or [])[:3],
                "colourIds": (m.get("colourIds") or [])[:8],
                "requiredPaintIds": m.get("requiredPaintIds") or [],
            })

    # Embed rich full recipes (with colourPoints & paintingAreas) for all models in user's projects + 60 diverse showcase models
    priority_recipe_ids = set()
    for proj in snapshot.get("projects") or []:
        for r in proj.get("recipes") or []:
            if r.get("id"):
                priority_recipe_ids.add(r["id"])

    # Add top models per game system
    seen_games = {}
    for m in all_models:
        gid = (m["gameIds"] or ["other"])[0]
        if seen_games.get(gid, 0) < 5:
            priority_recipe_ids.add(m["id"])
            seen_games[gid] = seen_games.get(gid, 0) + 1

    detailed_recipes = {}
    for rid in priority_recipe_ids:
        rpath = RECIPES_DIR / f"{rid}.json"
        if rpath.exists():
            rdata = json.loads(rpath.read_text(encoding="utf-8"))
            areas = []
            for a in (rdata.get("paintingAreas") or [])[:8]:
                steps = []
                for s in (a.get("paintingSteps") or [])[:10]:
                    sp = s.get("paint")
                    steps.append({
                        "id": s.get("id", ""),
                        "stepNumber": s.get("stepNumber") or s.get("stepOrder") or 1,
                        "paintingStage": s.get("paintingStage", "Base Finish"),
                        "techniqueName": s.get("techniqueName", ""),
                        "brushName": s.get("brushName", ""),
                        "text": s.get("text", ""),
                        "paint": {
                            "id": sp["id"],
                            "name": sp["name"],
                            "category": sp.get("category", ""),
                            "gradientStartHex": sp.get("gradientStartHex") or "#888888",
                        } if sp and sp.get("id") else None,
                    })
                areas.append({
                    "id": a.get("id", ""),
                    "name": a.get("name", "Painting Area"),
                    "subsectionName": a.get("subsectionName", ""),
                    "paintingSteps": steps,
                })
            cpoints = []
            for cp in (rdata.get("colourPoints") or [])[:10]:
                cpoints.append({
                    "id": cp.get("id", ""),
                    "name": cp.get("name", ""),
                    "colourId": cp.get("colourId", ""),
                    "hex": cp.get("hex") or "#888888",
                    "point": cp.get("point") or {"x": 0.5, "y": 0.5},
                })
            detailed_recipes[rid] = {
                "colourPoints": cpoints,
                "paintingAreas": areas,
            }

    tp_paints = tp_bundle.get("thirdPartyPaints") or []
    tp_brands = tp_bundle.get("brands") or sorted(list({p["brand"] for p in tp_paints if p.get("brand")}))
    payload = {
        "manifest": {
            "catalogVersion": str(manifest.get("catalogVersion") or manifest.get("schemaVersion") or "3.1.1"),
            "updatedAt": manifest.get("updatedAt", ""),
            "bundles": manifest.get("bundles", {}),
        },
        "paints": paints,
        "compatibility": paints_bundle["compatibility"],
        "thirdPartyBrands": tp_brands,
        "thirdPartyPaints": tp_paints,
        "citadelToThirdParty": tp_bundle.get("citadelToThirdPartyMap") or tp_bundle.get("citadelToThirdParty") or {},
        "colours": colours,
        "colourGroups": colours_bundle["colourGroups"],
        "games": games,
        "models": all_models,
        "detailedRecipes": detailed_recipes,
        "snapshot": {
            "inventoryPaintIds": snapshot.get("inventoryPaintIds") or [],
            "wishlistPaintIds": snapshot.get("wishlistPaintIds") or [],
            "projects": snapshot.get("projects") or [],
        },
    }

    raw_bytes = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    gz_bytes = gzip.compress(raw_bytes, compresslevel=9)
    b64_str = base64.b64encode(gz_bytes).decode("ascii")
    print(f"Payload raw={len(raw_bytes)//1024} KB -> gzipped={len(gz_bytes)//1024} KB -> base64={len(b64_str)//1024} KB")
    return b64_str


def main():
    b64_payload = build_compact_payload()
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Paint Warhammer — Citadel Colour Web Companion</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background-color: #121418;
      color: #f4f3ef;
      font-family: Georgia, 'Bitter', serif;
      -webkit-font-smoothing: antialiased;
    }}
    .font-display {{
      font-family: Impact, 'Anton', 'Arial Narrow', sans-serif;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }}
    .font-sans-ui {{
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }}
    .gold-grad {{
      background: linear-gradient(180deg, #fbba00 0%, #edb304 100%);
      color: #111215;
    }}
    .pro-grad {{
      background: linear-gradient(135deg, #57c2d0 0%, #9e5bd6 50%, #e3a73b 100%);
      color: #ffffff;
    }}
    .studio-card {{
      background: #1f232b;
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 12px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.35);
    }}
    .studio-card-hover:hover {{
      border-color: rgba(237, 179, 4, 0.5);
      transform: translateY(-2px);
      transition: all 0.16s ease;
    }}
    .swatch-circle {{
      border-radius: 9999px;
      border: 2px solid rgba(255,255,255,0.28);
      box-shadow: inset 0 2px 4px rgba(255,255,255,0.25), 0 2px 6px rgba(0,0,0,0.45);
      flex-shrink: 0;
    }}
    ::-webkit-scrollbar {{ width: 8px; height: 8px; }}
    ::-webkit-scrollbar-track {{ background: #0d0e11; }}
    ::-webkit-scrollbar-thumb {{ background: #2f3542; border-radius: 4px; }}
  </style>
</head>
<body class="min-h-screen bg-[#121418] text-[#f4f3ef]">
  <div id="app-root" class="flex min-h-screen flex-col md:flex-row">
    <div class="flex flex-1 items-center justify-center p-12 text-center">
      <div>
        <div class="font-display text-2xl text-[#fbba00] mb-2">Hydrating Citadel Colour Catalog...</div>
        <div class="font-sans-ui text-sm text-[#b4b9c4]">Decompressing 4,531 Models, 596 Colours, 487 Citadel Paints & 145 Cross-Brand Equivalents...</div>
      </div>
    </div>
  </div>

  <!-- Modal Portal -->
  <div id="modal-root"></div>
  <!-- Toast Portal -->
  <div id="toast-root" class="fixed bottom-5 right-5 z-50"></div>

  <script>
    const COMPRESSED_CATALOG_B64 = "{b64_payload}";
  </script>
  <script>
    // =========================================================================
    // STATE & CATALOG HYDRATION (WITH INDEXEDDB + MANIFEST HASH-DIFFING)
    // =========================================================================
    const STORAGE_KEY = 'whc_user_state_v1';
    let CATALOG = null;
    let MAPS = {{}};

    function createDefaultUserState() {{
      return {{
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        inventoryPaintIds: [],
        wishlistPaintIds: [],
        customPaints: [],
        customCompatibilityOverrides: {{}},
        projects: [],
        preferences: {{
          allowCompatibleSubstitutions: true,
          allowThirdPartySubstitutions: true,
        }}
      }};
    }}

    let USER_STATE = loadUserState();

    let UI = {{
      mainTab: 'hobby-desk', // 'hobby-desk' | 'models' | 'colours' | 'search'
      deskTab: 'projects',   // 'projects' | 'paints' | 'converter' | 'settings'
      paintSubMode: 'inventory', // 'inventory' | 'wishlist' | 'catalogue'
      paintSearch: '',
      paintBrandFilter: 'all',
      paintCategoryFilter: 'all',
      converterMode: 'cross-brand', // 'cross-brand' | 'tone-pro'
      converterSearch: '',
      converterBrand: 'all',
      converterOnlyOwned: false,
      activeProjectId: null,
      projectSubTab: 'paints', // 'paints' | 'models' | 'colours' | 'notes'
      projectSearch: '',
      // Paint A Model state
      selectedGameId: null,
      selectedFactionId: null,
      modelSearch: '',
      modelReadinessFilter: 'all', // 'all' | 'ready100' | 'missing2' | 'sortReady'
      modelRangeFilter: 'all',
      modelLimit: 48,
      activeModelId: null,
      activeModelStageFilter: 'all',
      selectedPinId: null,
      // Paint A Colour state
      selectedColourGroup: null,
      onlyBasing: false,
      colourSearch: '',
      colourReadinessFilter: 'all',
      activeColourId: null,
      activeColourTier: 'artificer', // 'base' | 'detail' | 'artificer'
      // Global Search
      globalSearch: '',
      globalSearchTab: 'all',
      // Modals
      activePaintModalId: null,
      newProjectModalOpen: false,
      customPaintModalOpen: false,
      addModelToProjectModal: false,
      addColourToProjectModal: false,
      noteEditorModal: null, // {{ projectId, noteId, title, components }}
      pkceUrl: '',
      pkceCallbackInput: '',
      importMode: 'merge',
    }};

    function loadUserState() {{
      try {{
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return createDefaultUserState();
        const parsed = JSON.parse(raw);
        const def = createDefaultUserState();
        return {{
          ...def,
          ...parsed,
          preferences: {{ ...def.preferences, ...(parsed.preferences || {{}}) }}
        }};
      }} catch (e) {{
        return createDefaultUserState();
      }}
    }}

    function saveUserState() {{
      USER_STATE.updatedAt = new Date().toISOString();
      try {{
        localStorage.setItem(STORAGE_KEY, JSON.stringify(USER_STATE));
      }} catch (e) {{}}
      renderApp();
    }}

    function showToast(msg) {{
      const root = document.getElementById('toast-root');
      if (!root) return;
      root.innerHTML = `<div class="bg-[#0d0e11] border border-[#fbba00] text-[#fbba00] font-sans-ui text-xs font-semibold px-4 py-3 rounded-lg shadow-2xl">${{escapeHtml(msg)}}</div>`;
      setTimeout(() => {{ root.innerHTML = ''; }}, 3200);
    }}

    function escapeHtml(str) {{
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }}

    async function decompressCatalog(b64) {{
      const binStr = atob(b64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(bytes);
      writer.close();
      const resp = new Response(ds.readable);
      return await resp.json();
    }}

    function buildLookupMaps() {{
      CATALOG.models = CATALOG.models.map(m => ({{
        id: m.id,
        name: m.n,
        range: m.r === 1 ? 'warhammer_pro' : 'warhammer_colour',
        gameIds: m.g || [],
        gameNames: m.gn || [],
        factionIds: m.f || [],
        factionNames: m.fn || [],
        colourIds: (m.c || []).map(i => CATALOG.colours[i]?.id).filter(Boolean),
        requiredPaintIds: (m.p || []).map(i => CATALOG.paints[i]?.id).filter(Boolean),
      }}));

      MAPS.paintById = new Map();
      for (const p of CATALOG.paints) MAPS.paintById.set(p.id, p);

      MAPS.tpById = new Map();
      for (const tp of CATALOG.thirdPartyPaints) MAPS.tpById.set(tp.id, tp);

      MAPS.colourById = new Map();
      for (const c of CATALOG.colours) MAPS.colourById.set(c.id, c);

      MAPS.modelById = new Map();
      for (const m of CATALOG.models) MAPS.modelById.set(m.id, m);

      MAPS.classicToPro = new Map();
      MAPS.proToClassic = new Map();
      for (const link of CATALOG.compatibility) {{
        if (!MAPS.classicToPro.has(link.classic_paint_id)) MAPS.classicToPro.set(link.classic_paint_id, []);
        MAPS.classicToPro.get(link.classic_paint_id).push(link);

        if (!MAPS.proToClassic.has(link.tone_pro_paint_id)) MAPS.proToClassic.set(link.tone_pro_paint_id, []);
        MAPS.proToClassic.get(link.tone_pro_paint_id).push(link);
      }}

      MAPS.modelsUsingPaint = new Map();
      MAPS.modelsUsingColour = new Map();
      for (const m of CATALOG.models) {{
        for (const pid of m.requiredPaintIds) {{
          if (!MAPS.modelsUsingPaint.has(pid)) MAPS.modelsUsingPaint.set(pid, []);
          MAPS.modelsUsingPaint.get(pid).push(m);
        }}
        for (const cid of m.colourIds) {{
          if (!MAPS.modelsUsingColour.has(cid)) MAPS.modelsUsingColour.set(cid, []);
          MAPS.modelsUsingColour.get(cid).push(m);
        }}
      }}

      MAPS.coloursUsingPaint = new Map();
      for (const c of CATALOG.colours) {{
        for (const pid of c.requiredPaintIds) {{
          if (!MAPS.coloursUsingPaint.has(pid)) MAPS.coloursUsingPaint.set(pid, []);
          MAPS.coloursUsingPaint.get(pid).push(c);
        }}
      }}
    }}

    // =========================================================================
    // "CAN I PAINT THIS?" INVENTORY READINESS ENGINE
    // =========================================================================
    function evaluateReadiness(requiredPaintIds) {{
      const deduped = Array.from(new Set((requiredPaintIds || []).filter(Boolean)));
      if (deduped.length === 0) {{
        return {{
          totalRequired: 0,
          ownedDirectCount: 0,
          substitutedCount: 0,
          missingCount: 0,
          matchPercent: 100,
          ownedDirectIds: [],
          substitutedByPaintId: {{}},
          missingPaintIds: [],
        }};
      }}

      const invSet = new Set(USER_STATE.inventoryPaintIds);
      const prefs = USER_STATE.preferences;
      const overrides = USER_STATE.customCompatibilityOverrides || {{}};
      const customById = new Map((USER_STATE.customPaints || []).map(c => [c.id, c]));

      const ownedDirectIds = [];
      const substitutedByPaintId = {{}};
      const missingPaintIds = [];

      for (const pid of deduped) {{
        if (invSet.has(pid)) {{
          ownedDirectIds.push(pid);
          continue;
        }}

        let foundSub = null;

        // 1. Custom user overrides
        const uList = overrides[pid] || [];
        for (const eqId of uList) {{
          if (invSet.has(eqId)) {{
            const cp = customById.get(eqId) || MAPS.tpById.get(eqId) || MAPS.paintById.get(eqId);
            if (cp) {{
              foundSub = {{
                requiredPaintId: pid,
                substitutePaintId: eqId,
                substituteName: cp.name,
                substituteBrand: cp.brand ? `${{cp.brand}} (${{cp.range}})` : 'Citadel',
                substituteHex: cp.hex || cp.gradientStartHex || '#888',
              }};
              break;
            }}
          }}
        }}

        // 2. Official Citadel Classic <-> Tone Pro
        if (!foundSub && prefs.allowCompatibleSubstitutions) {{
          const proLinks = MAPS.classicToPro.get(pid) || [];
          for (const l of proLinks) {{
            if (invSet.has(l.tone_pro_paint_id)) {{
              foundSub = {{
                requiredPaintId: pid,
                substitutePaintId: l.tone_pro_paint_id,
                substituteName: l.tone_pro_paint_name,
                substituteBrand: 'Citadel Tone Pro',
                substituteHex: l.tone_pro_hex,
              }};
              break;
            }}
          }}
          if (!foundSub) {{
            const clLinks = MAPS.proToClassic.get(pid) || [];
            for (const l of clLinks) {{
              if (invSet.has(l.classic_paint_id)) {{
                const cp = MAPS.paintById.get(l.classic_paint_id);
                foundSub = {{
                  requiredPaintId: pid,
                  substitutePaintId: l.classic_paint_id,
                  substituteName: l.classic_paint_name,
                  substituteBrand: 'Citadel Classic',
                  substituteHex: cp ? cp.gradientStartHex : '#888',
                }};
                break;
              }}
            }}
          }}
        }}

        // 3. Pre-seeded 3rd-party equivalents
        if (!foundSub && prefs.allowThirdPartySubstitutions) {{
          const tpList = CATALOG.citadelToThirdParty[pid] || [];
          for (const tpm of tpList) {{
            if (invSet.has(tpm.thirdPartyPaintId)) {{
              foundSub = {{
                requiredPaintId: pid,
                substitutePaintId: tpm.thirdPartyPaintId,
                substituteName: tpm.name,
                substituteBrand: `${{tpm.brand}} (${{tpm.range}})`,
                substituteHex: tpm.hex,
                deltaE: tpm.deltaE,
              }};
              break;
            }}
          }}
        }}

        if (foundSub) {{
          substitutedByPaintId[pid] = foundSub;
        }} else {{
          missingPaintIds.push(pid);
        }}
      }}

      const totalRequired = deduped.length;
      const ownedDirectCount = ownedDirectIds.length;
      const substitutedCount = Object.keys(substitutedByPaintId).length;
      const missingCount = missingPaintIds.length;
      const matchPercent = Math.round(((ownedDirectCount + substitutedCount) / totalRequired) * 100);

      return {{
        totalRequired,
        ownedDirectCount,
        substitutedCount,
        missingCount,
        matchPercent,
        ownedDirectIds,
        substitutedByPaintId,
        missingPaintIds,
      }};
    }}

    // =========================================================================
    // USER ACTIONS
    // =========================================================================
    function isOwned(pid) {{
      return USER_STATE.inventoryPaintIds.includes(pid);
    }}
    function isWishlisted(pid) {{
      return USER_STATE.wishlistPaintIds.includes(pid);
    }}
    function toggleInventory(pid) {{
      const inv = new Set(USER_STATE.inventoryPaintIds);
      const wish = new Set(USER_STATE.wishlistPaintIds);
      if (inv.has(pid)) {{
        inv.delete(pid);
      }} else {{
        inv.add(pid);
        wish.delete(pid);
      }}
      USER_STATE.inventoryPaintIds = Array.from(inv);
      USER_STATE.wishlistPaintIds = Array.from(wish);
      saveUserState();
    }}
    function toggleWishlist(pid) {{
      const wish = new Set(USER_STATE.wishlistPaintIds);
      if (wish.has(pid)) wish.delete(pid);
      else wish.add(pid);
      USER_STATE.wishlistPaintIds = Array.from(wish);
      saveUserState();
    }}
    function addManyToWishlist(pids) {{
      const inv = new Set(USER_STATE.inventoryPaintIds);
      const wish = new Set(USER_STATE.wishlistPaintIds);
      let added = 0;
      for (const pid of pids) {{
        if (!inv.has(pid) && !wish.has(pid)) {{
          wish.add(pid);
          added++;
        }}
      }}
      USER_STATE.wishlistPaintIds = Array.from(wish);
      saveUserState();
      showToast(added > 0 ? `Added ${{added}} missing paints to Wishlist` : 'All missing paints are already on your Wishlist');
    }}
    function addManyToInventory(pids) {{
      const inv = new Set(USER_STATE.inventoryPaintIds);
      const wish = new Set(USER_STATE.wishlistPaintIds);
      let added = 0;
      for (const pid of pids) {{
        if (!inv.has(pid)) {{
          inv.add(pid);
          wish.delete(pid);
          added++;
        }}
      }}
      USER_STATE.inventoryPaintIds = Array.from(inv);
      USER_STATE.wishlistPaintIds = Array.from(wish);
      saveUserState();
      showToast(`Marked ${{added}} paints as Owned in Inventory`);
    }}

    function importAccountPayload(raw, mode = 'merge') {{
      const base = mode === 'replace' ? createDefaultUserState() : USER_STATE;
      const inv = new Set([...base.inventoryPaintIds, ...(raw.inventoryPaintIds || [])]);
      const wish = new Set([...base.wishlistPaintIds, ...(raw.wishlistPaintIds || [])]);
      for (const id of inv) wish.delete(id);

      const incomingProjs = (raw.projects || []).map((rp, idx) => ({{
        id: rp.id || `proj_${{Date.now()}}_${{idx}}`,
        name: rp.name || 'Imported Project',
        createdAt: rp.createdAt || new Date().toISOString(),
        updatedAt: rp.updatedAt || new Date().toISOString(),
        recipeIds: Array.isArray(rp.recipeIds) ? rp.recipeIds : (rp.recipes || []).map(r => r.id),
        colourIds: Array.isArray(rp.colourIds) ? rp.colourIds : (rp.colours || []).map(c => c.id),
        notes: (rp.notes || []).map((n, nIdx) => ({{
          id: n.id || `note_${{idx}}_${{nIdx}}`,
          title: n.title || 'Project Note',
          components: (n.components || []).map(c => ({{
            type: c.type === 'checkbox' ? 'checkbox' : 'text',
            value: c.value || c.text || '',
            checked: Boolean(c.checked),
          }}))
        }}))
      }}));

      const projMap = new Map();
      for (const p of base.projects) projMap.set(p.id, p);
      for (const p of incomingProjs) projMap.set(p.id, p);

      USER_STATE = {{
        ...base,
        inventoryPaintIds: Array.from(inv),
        wishlistPaintIds: Array.from(wish),
        projects: Array.from(projMap.values()),
      }};
      saveUserState();
      showToast(`Imported Account: ${{USER_STATE.inventoryPaintIds.length}} Owned, ${{USER_STATE.wishlistPaintIds.length}} Wishlist, ${{USER_STATE.projects.length}} Projects`);
    }}

    function loadExtractedSnapshot() {{
      importAccountPayload(CATALOG.snapshot, UI.importMode);
    }}

    function exportBackupJson() {{
      const blob = new Blob([JSON.stringify(USER_STATE, null, 2)], {{ type: 'application/json' }});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `warhammer_colour_backup_${{new Date().toISOString().slice(0, 10)}}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Exported JSON Backup');
    }}

    function resetUserState() {{
      USER_STATE = createDefaultUserState();
      UI.activeProjectId = null;
      saveUserState();
      showToast('Reset browser data to a blank slate');
    }}

    // Helper: create synthetic SVG badge/avatar for models & colours
    function renderModelPaletteStrip(colourIds, requiredPaintIds) {{
      const hexes = [];
      for (const cid of (colourIds || []).slice(0, 5)) {{
        const c = MAPS.colourById.get(cid);
        if (c && c.hex) hexes.push(c.hex);
      }}
      if (hexes.length < 4) {{
        for (const pid of (requiredPaintIds || []).slice(0, 6)) {{
          const p = MAPS.paintById.get(pid);
          if (p && p.gradientStartHex && !hexes.includes(p.gradientStartHex)) {{
            hexes.push(p.gradientStartHex);
          }}
        }}
      }}
      if (hexes.length === 0) hexes.push('#edb304', '#3b82f6', '#ef4444');
      return hexes.slice(0, 6).map(h => `<span class="w-4 h-4 rounded-full border border-white/30 shadow-sm" style="background:${{h}}"></span>`).join('');
    }}

    // =========================================================================
    // RENDER ENGINE
    // =========================================================================
    function renderApp() {{
      if (!CATALOG) return;
      const root = document.getElementById('app-root');
      if (!root) return;

      const invCount = USER_STATE.inventoryPaintIds.length;
      const wishCount = USER_STATE.wishlistPaintIds.length;
      const projCount = USER_STATE.projects.length;

      root.innerHTML = `
        <!-- Left Desktop Sidebar -->
        <aside class="w-full md:w-64 bg-[#0d0e11] border-b md:border-b-0 md:border-r border-white/10 p-4 flex flex-col justify-between shrink-0">
          <div>
            <div class="flex items-center gap-3 pb-4 mb-4 border-b border-white/10 cursor-pointer" onclick="UI.mainTab='hobby-desk'; UI.activeProjectId=null; renderApp()">
              <div class="w-10 h-10 rounded-lg pro-grad flex items-center justify-center font-display text-lg shadow-md">W</div>
              <div>
                <div class="font-display text-xl text-[#fbba00] leading-none">CITADEL COLOUR</div>
                <div class="font-sans-ui text-xs text-[#b4b9c4] mt-0.5">Paint Warhammer Web App</div>
              </div>
            </div>

            <nav class="flex md:flex-col gap-1.5 overflow-x-auto">
              <button onclick="UI.mainTab='hobby-desk'; UI.activeProjectId=null; renderApp()"
                class="flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg font-sans-ui text-xs font-semibold transition ${{UI.mainTab === 'hobby-desk' ? 'bg-[#edb304]/15 text-[#fbba00] border border-[#edb304]/40' : 'text-[#b4b9c4] hover:bg-white/5'}}">
                <span>🛠 Hobby Desk</span>
                <span class="px-2 py-0.5 rounded-full bg-[#edb304]/20 text-[#fbba00] text-xs">${{projCount}}</span>
              </button>

              <button onclick="UI.mainTab='models'; UI.activeModelId=null; renderApp()"
                class="flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg font-sans-ui text-xs font-semibold transition ${{UI.mainTab === 'models' ? 'bg-[#edb304]/15 text-[#fbba00] border border-[#edb304]/40' : 'text-[#b4b9c4] hover:bg-white/5'}}">
                <span>🛡 Paint A Model</span>
                <span class="px-2 py-0.5 rounded-full bg-white/5 text-[#7b8292] text-xs">${{CATALOG.models.length.toLocaleString()}}</span>
              </button>

              <button onclick="UI.mainTab='colours'; UI.activeColourId=null; renderApp()"
                class="flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg font-sans-ui text-xs font-semibold transition ${{UI.mainTab === 'colours' ? 'bg-[#edb304]/15 text-[#fbba00] border border-[#edb304]/40' : 'text-[#b4b9c4] hover:bg-white/5'}}">
                <span>💧 Paint A Colour</span>
                <span class="px-2 py-0.5 rounded-full bg-white/5 text-[#7b8292] text-xs">${{CATALOG.colours.length}}</span>
              </button>

              <button onclick="UI.mainTab='search'; renderApp()"
                class="flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg font-sans-ui text-xs font-semibold transition ${{UI.mainTab === 'search' ? 'bg-[#edb304]/15 text-[#fbba00] border border-[#edb304]/40' : 'text-[#b4b9c4] hover:bg-white/5'}}">
                <span>🔍 Global Search</span>
                <span class="px-1.5 py-0.5 rounded bg-white/5 text-[#7b8292] text-xs font-mono">⌘K</span>
              </button>
            </nav>
          </div>

          <div class="hidden md:flex flex-col gap-2 studio-card p-3.5 mt-6 font-sans-ui text-xs">
            <div class="flex justify-between">
              <span class="text-[#b4b9c4]">Inventory Owned</span>
              <strong class="text-[#29c26a]">${{invCount}} Paints</strong>
            </div>
            <div class="flex justify-between">
              <span class="text-[#b4b9c4]">Wishlist</span>
              <strong class="text-[#f59e0b]">${{wishCount}} Paints</strong>
            </div>
            <div class="flex justify-between">
              <span class="text-[#b4b9c4]">3rd-Party Brands</span>
              <strong class="text-[#38bdf8]">${{CATALOG.thirdPartyBrands.length}} Brands</strong>
            </div>
            <div class="flex justify-between pt-1.5 border-t border-white/10">
              <span class="text-[#b4b9c4]">Manifest Cache</span>
              <span class="text-[#29c26a] font-bold">● v${{CATALOG.manifest.catalogVersion}}</span>
            </div>
          </div>
        </aside>

        <!-- Main Content Area -->
        <main class="flex-1 min-w-0 p-4 md:p-7 overflow-y-auto">
          ${{renderMainContent()}}
        </main>
      `;

      renderModalPortal();
    }}

    function renderMainContent() {{
      if (UI.mainTab === 'hobby-desk') {{
        if (UI.activeProjectId) return renderProjectDetailView();
        return renderHobbyDeskView();
      }}
      if (UI.mainTab === 'models') {{
        if (UI.activeModelId) return renderModelDetailView();
        return renderPaintModelView();
      }}
      if (UI.mainTab === 'colours') {{
        if (UI.activeColourId) return renderColourDetailView();
        return renderPaintColourView();
      }}
      return renderGlobalSearchView();
    }}

    // =========================================================================
    // TAB 1: HOBBY DESK
    // =========================================================================
    function renderHobbyDeskView() {{
      const isEmpty = USER_STATE.projects.length === 0 && USER_STATE.inventoryPaintIds.length === 0 && USER_STATE.wishlistPaintIds.length === 0;

      return `
        <div class="flex flex-col gap-5">
          <!-- Header -->
          <div class="studio-card p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 class="font-display text-3xl text-[#fbba00]">Hobby Desk</h1>
              <p class="font-sans-ui text-xs text-[#b4b9c4] mt-1">
                Manage your custom projects, paint inventory, wishlist, cross-brand equivalents, and My Warhammer account sync.
              </p>
            </div>
            <div class="flex gap-2.5 font-sans-ui">
              <button onclick="UI.deskTab='projects'; renderApp()" class="px-4 py-2 rounded-lg bg-[#15181e] border border-white/10 text-center">
                <div class="font-display text-xl text-[#fbba00]">${{USER_STATE.projects.length}}</div>
                <div class="text-xs text-[#b4b9c4]">Projects</div>
              </button>
              <button onclick="UI.deskTab='paints'; UI.paintSubMode='inventory'; renderApp()" class="px-4 py-2 rounded-lg bg-[#15181e] border border-white/10 text-center">
                <div class="font-display text-xl text-[#29c26a]">${{USER_STATE.inventoryPaintIds.length}}</div>
                <div class="text-xs text-[#b4b9c4]">Owned</div>
              </button>
              <button onclick="UI.deskTab='paints'; UI.paintSubMode='wishlist'; renderApp()" class="px-4 py-2 rounded-lg bg-[#15181e] border border-white/10 text-center">
                <div class="font-display text-xl text-[#f59e0b]">${{USER_STATE.wishlistPaintIds.length}}</div>
                <div class="text-xs text-[#b4b9c4]">Wishlist</div>
              </button>
            </div>
          </div>

          <!-- Sub-Tabs -->
          <div class="flex flex-wrap gap-2 border-b border-white/10 pb-3 font-sans-ui text-xs font-semibold">
            <button onclick="UI.deskTab='projects'; renderApp()" class="px-4 py-2 rounded-lg ${{UI.deskTab==='projects' ? 'gold-grad font-bold' : 'bg-[#191c22] text-[#b4b9c4] hover:text-white'}}">
              📁 My Projects (${{USER_STATE.projects.length}})
            </button>
            <button onclick="UI.deskTab='paints'; renderApp()" class="px-4 py-2 rounded-lg ${{UI.deskTab==='paints' ? 'gold-grad font-bold' : 'bg-[#191c22] text-[#b4b9c4] hover:text-white'}}">
              🎨 My Paints & Catalogue (${{CATALOG.paints.length + CATALOG.thirdPartyPaints.length}})
            </button>
            <button onclick="UI.deskTab='converter'; renderApp()" class="px-4 py-2 rounded-lg ${{UI.deskTab==='converter' ? 'gold-grad font-bold' : 'bg-[#191c22] text-[#b4b9c4] hover:text-white'}}">
              ⇄ Cross-Brand Paint Converter
            </button>
            <button onclick="UI.deskTab='settings'; renderApp()" class="px-4 py-2 rounded-lg ${{UI.deskTab==='settings' ? 'gold-grad font-bold' : 'bg-[#191c22] text-[#b4b9c4] hover:text-white'}}">
              🔑 Account Importer & Cache Settings
            </button>
          </div>

          ${{isEmpty && UI.deskTab !== 'settings' ? `
            <div class="studio-card p-5 border-[#edb304]/50 bg-gradient-to-r from-[#edb304]/10 to-[#191c22] flex flex-wrap items-center justify-between gap-4">
              <div class="max-w-2xl">
                <h3 class="font-display text-lg text-[#fbba00]">Start Fresh or Import a My Warhammer Account</h3>
                <p class="font-sans-ui text-xs text-[#b4b9c4] mt-1">
                  Your local browser Hobby Desk starts with a blank slate. Load the extracted APK account snapshot (64 owned paints, 34 wishlist paints, and 5 projects) with one click, or import any user's My Warhammer account.
                </p>
              </div>
              <div class="flex flex-wrap gap-2 font-sans-ui text-xs font-semibold">
                <button onclick="loadExtractedSnapshot()" class="px-4 py-2.5 rounded-lg gold-grad font-bold shadow">
                  ⚡ Load Extracted Account Snapshot (64 Owned, 5 Projects)
                </button>
                <button onclick="UI.deskTab='settings'; renderApp()" class="px-3.5 py-2.5 rounded-lg bg-[#1f232b] border border-white/15 text-white">
                  Import Another Account →
                </button>
              </div>
            </div>
          ` : ''}}

          ${{UI.deskTab === 'projects' ? renderProjectsSubTab() : ''}}
          ${{UI.deskTab === 'paints' ? renderPaintsSubTab() : ''}}
          ${{UI.deskTab === 'converter' ? renderConverterSubTab() : ''}}
          ${{UI.deskTab === 'settings' ? renderSettingsSubTab() : ''}}
        </div>
      `;
    }}

    function renderProjectsSubTab() {{
      const q = UI.projectSearch.trim().toLowerCase();
      const projs = USER_STATE.projects.filter(p => !q || p.name.toLowerCase().includes(q));

      return `
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap justify-between items-center gap-3 font-sans-ui">
            <input type="text" placeholder="Search projects..." value="${{escapeHtml(UI.projectSearch)}}"
              oninput="UI.projectSearch=this.value; renderApp()"
              class="bg-[#15181e] border border-white/15 rounded-lg px-3.5 py-2 text-xs text-white w-full sm:w-72" />
            <button onclick="createNewProjectPrompt()" class="px-4 py-2 rounded-lg gold-grad font-sans-ui text-xs font-bold">
              + New Hobby Project
            </button>
          </div>

          ${{projs.length > 0 ? `
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              ${{projs.map(p => {{
                const reqIds = [];
                for (const rid of p.recipeIds) {{
                  const m = MAPS.modelById.get(rid);
                  if (m) reqIds.push(...m.requiredPaintIds);
                }}
                for (const cid of p.colourIds) {{
                  const c = MAPS.colourById.get(cid);
                  if (c) reqIds.push(...c.requiredPaintIds);
                }}
                const ready = evaluateReadiness(reqIds);
                return `
                  <div onclick="UI.activeProjectId='${{p.id}}'; UI.projectSubTab='paints'; renderApp()"
                    class="studio-card studio-card-hover p-4 flex flex-col justify-between gap-3 cursor-pointer">
                    <div>
                      <div class="flex items-center justify-between gap-2 mb-2">
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-sans-ui font-bold ${{ready.matchPercent===100 ? 'bg-[#29c26a]/20 text-[#29c26a]' : 'bg-[#edb304]/20 text-[#fbba00]'}}">
                          ${{ready.matchPercent}}% Ready (${{ready.ownedDirectCount + ready.substitutedCount}}/${{ready.totalRequired}} Paints)
                        </span>
                        <div class="flex gap-1">${{renderModelPaletteStrip(p.colourIds, reqIds)}}</div>
                      </div>
                      <h3 class="font-display text-xl text-white">${{escapeHtml(p.name)}}</h3>
                      <p class="font-sans-ui text-xs text-[#b4b9c4] mt-1">
                        ${{p.recipeIds.length}} Model Guides • ${{p.colourIds.length}} Colour Guides • ${{p.notes.length}} Notes
                      </p>
                    </div>
                    <div class="flex justify-between items-center pt-3 border-t border-white/10 font-sans-ui text-xs" onclick="event.stopPropagation()">
                      <span class="text-[#fbba00] font-semibold" onclick="UI.activeProjectId='${{p.id}}'; renderApp()">Open Project & Paint Rollup →</span>
                      <button onclick="deleteProjectById('${{p.id}}')" class="text-red-400 hover:underline">Delete</button>
                    </div>
                  </div>
                `;
              }}).join('')}}
            </div>
          ` : `
            <div class="studio-card p-10 text-center flex flex-col items-center gap-3">
              <div class="font-display text-xl text-[#fbba00]">No Projects Yet</div>
              <p class="font-sans-ui text-xs text-[#b4b9c4] max-w-md">
                Create a hobby project to group model recipes, colour guides, checklists, and see an automatic rollup of required & missing paints.
              </p>
              <div class="flex gap-2.5 font-sans-ui text-xs font-bold mt-2">
                <button onclick="createNewProjectPrompt()" class="px-4 py-2 rounded-lg gold-grad">+ Create First Project</button>
                <button onclick="loadExtractedSnapshot()" class="px-4 py-2 rounded-lg bg-[#15181e] border border-white/15 text-white">⚡ Load Extracted Account (5 Projects)</button>
              </div>
            </div>
          `}}
        </div>
      `;
    }}

    function createNewProjectPrompt() {{
      const name = prompt('Enter New Hobby Project Name:', 'Ultramarines Strike Force');
      if (!name) return;
      const newProj = {{
        id: 'proj_' + Date.now(),
        name: name.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        recipeIds: [],
        colourIds: [],
        notes: [{{
          id: 'note_' + Date.now(),
          title: 'Painting Checklist',
          components: [
            {{ type: 'checkbox', value: 'Assemble & clean mould lines', checked: true }},
            {{ type: 'checkbox', value: 'Prime miniature undercoat', checked: false }},
            {{ type: 'checkbox', value: 'Apply Base Finish coats', checked: false }},
          ]
        }}]
      }};
      USER_STATE.projects.unshift(newProj);
      UI.activeProjectId = newProj.id;
      saveUserState();
      showToast(`Created project "${{newProj.name}}"`);
    }}

    function deleteProjectById(pid) {{
      USER_STATE.projects = USER_STATE.projects.filter(p => p.id !== pid);
      if (UI.activeProjectId === pid) UI.activeProjectId = null;
      saveUserState();
      showToast('Deleted project');
    }}

    // =========================================================================
    // PROJECT DETAIL VIEW (WITH REQUIRED & MISSING PAINTS ROLLUP)
    // =========================================================================
    function renderProjectDetailView() {{
      const proj = USER_STATE.projects.find(p => p.id === UI.activeProjectId);
      if (!proj) {{
        UI.activeProjectId = null;
        return renderHobbyDeskView();
      }}

      const attachedModels = proj.recipeIds.map(id => MAPS.modelById.get(id)).filter(Boolean);
      const attachedColours = proj.colourIds.map(id => MAPS.colourById.get(id)).filter(Boolean);

      const reqSet = new Set();
      for (const m of attachedModels) m.requiredPaintIds.forEach(id => reqSet.add(id));
      for (const c of attachedColours) c.requiredPaintIds.forEach(id => reqSet.add(id));
      const ready = evaluateReadiness(Array.from(reqSet));

      const missingPaints = ready.missingPaintIds.map(id => MAPS.paintById.get(id)).filter(Boolean);
      const ownedPaints = ready.ownedDirectIds.map(id => MAPS.paintById.get(id)).filter(Boolean);
      const subEntries = Object.entries(ready.substitutedByPaintId).map(([pid, sub]) => ({{
        paint: MAPS.paintById.get(pid),
        sub
      }})).filter(x => x.paint);

      return `
        <div class="flex flex-col gap-5">
          <div class="flex justify-between items-center font-sans-ui text-xs">
            <button onclick="UI.activeProjectId=null; renderApp()" class="px-3 py-1.5 rounded-lg bg-[#191c22] border border-white/10 text-[#b4b9c4] hover:text-white">
              ← Back to My Projects
            </button>
            <div class="flex gap-2">
              <button onclick="renameProjectPrompt('${{proj.id}}')" class="px-3 py-1.5 rounded-lg bg-[#191c22] border border-white/10 text-white">✎ Rename</button>
              <button onclick="deleteProjectById('${{proj.id}}')" class="px-3 py-1.5 rounded-lg bg-[#191c22] border border-white/10 text-red-400">🗑 Delete</button>
            </div>
          </div>

          <div class="studio-card p-5 flex flex-col gap-4">
            <div class="flex flex-wrap justify-between items-start gap-4">
              <div>
                <h1 class="font-display text-3xl text-[#fbba00]">${{escapeHtml(proj.name)}}</h1>
                <p class="font-sans-ui text-xs text-[#b4b9c4] mt-1">
                  ${{attachedModels.length}} Model Guides • ${{attachedColours.length}} Colour Guides • ${{proj.notes.length}} Notes
                </p>
              </div>
              ${{ready.missingCount > 0 ? `
                <button onclick="addManyToWishlist(${{JSON.stringify(ready.missingPaintIds).replace(/"/g, '&quot;')}})"
                  class="px-4 py-2 rounded-lg gold-grad font-sans-ui text-xs font-bold shadow">
                  ★ Add All ${{ready.missingCount}} Missing Paints to Wishlist
                </button>
              ` : ''}}
            </div>

            <div class="bg-[#121418] p-3.5 rounded-lg border border-white/10 font-sans-ui text-xs">
              <div class="flex justify-between mb-1.5">
                <strong>Project Paint Readiness: ${{ready.matchPercent}}%</strong>
                <span class="text-[#b4b9c4]">${{ready.ownedDirectCount}} Owned • ${{ready.substitutedCount}} Covered by Equivalent • ${{ready.missingCount}} Missing</span>
              </div>
              <div class="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div class="h-full ${{ready.matchPercent===100 ? 'bg-[#29c26a]' : 'bg-[#fbba00]'}}" style="width:${{ready.matchPercent}}%"></div>
              </div>
            </div>
          </div>

          <!-- Project Sub-Tabs -->
          <div class="flex flex-wrap gap-2 border-b border-white/10 pb-3 font-sans-ui text-xs font-semibold">
            <button onclick="UI.projectSubTab='paints'; renderApp()" class="px-4 py-2 rounded-lg ${{UI.projectSubTab==='paints' ? 'gold-grad font-bold' : 'bg-[#191c22] text-[#b4b9c4]'}}">
              🎨 Required & Missing Paints (${{ready.totalRequired}})
            </button>
            <button onclick="UI.projectSubTab='models'; renderApp()" class="px-4 py-2 rounded-lg ${{UI.projectSubTab==='models' ? 'gold-grad font-bold' : 'bg-[#191c22] text-[#b4b9c4]'}}">
              🛡 Models (${{attachedModels.length}})
            </button>
            <button onclick="UI.projectSubTab='colours'; renderApp()" class="px-4 py-2 rounded-lg ${{UI.projectSubTab==='colours' ? 'gold-grad font-bold' : 'bg-[#191c22] text-[#b4b9c4]'}}">
              💧 Colours (${{attachedColours.length}})
            </button>
            <button onclick="UI.projectSubTab='notes'; renderApp()" class="px-4 py-2 rounded-lg ${{UI.projectSubTab==='notes' ? 'gold-grad font-bold' : 'bg-[#191c22] text-[#b4b9c4]'}}">
              📝 Notes & Checklists (${{proj.notes.length}})
            </button>
          </div>

          ${{UI.projectSubTab === 'paints' ? `
            <div class="flex flex-col gap-4 font-sans-ui">
              <!-- Missing -->
              <div class="studio-card p-4">
                <div class="flex justify-between items-center mb-3">
                  <span class="px-2.5 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-bold">Missing Paints (${{missingPaints.length}})</span>
                  ${{missingPaints.length > 0 ? `
                    <button onclick="addManyToInventory(${{JSON.stringify(ready.missingPaintIds).replace(/"/g, '&quot;')}})" class="text-xs text-[#29c26a] hover:underline font-semibold">✓ Mark All Missing as Owned</button>
                  ` : ''}}
                </div>
                ${{missingPaints.length > 0 ? `
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    ${{missingPaints.map(p => renderPaintPillRow(p.id, p.name, p.category, p.gradientStartHex)).join('')}}
                  </div>
                ` : `<p class="text-xs text-[#29c26a] font-semibold">🎉 Every paint needed for this project is in your Inventory (or covered by an equivalent)!</p>`}}
              </div>

              <!-- Substituted -->
              ${{subEntries.length > 0 ? `
                <div class="studio-card p-4">
                  <div class="mb-3">
                    <span class="px-2.5 py-1 rounded-full bg-sky-500/20 text-sky-400 text-xs font-bold">Covered by Equivalent in Inventory (${{subEntries.length}})</span>
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    ${{subEntries.map(x => `
                      <div onclick="UI.activePaintModalId='${{x.paint.id}}'; renderApp()" class="p-2.5 rounded-lg bg-[#15181e] border border-sky-500/30 flex items-center gap-3 cursor-pointer">
                        <span class="w-7 h-7 swatch-circle" style="background:${{x.paint.gradientStartHex}}"></span>
                        <div class="min-w-0 flex-1">
                          <div class="text-xs font-bold text-white truncate">${{escapeHtml(x.paint.name)}}</div>
                          <div class="text-xs text-sky-400 truncate">⇄ Covered by ${{escapeHtml(x.sub.substituteName)}}</div>
                        </div>
                      </div>
                    `).join('')}}
                  </div>
                </div>
              ` : ''}}

              <!-- Owned Directly -->
              ${{ownedPaints.length > 0 ? `
                <div class="studio-card p-4">
                  <div class="mb-3">
                    <span class="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">Owned Directly (${{ownedPaints.length}})</span>
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                    ${{ownedPaints.map(p => renderPaintPillRow(p.id, p.name, p.category, p.gradientStartHex)).join('')}}
                  </div>
                </div>
              ` : ''}}
            </div>
          ` : ''}}

          ${{UI.projectSubTab === 'models' ? `
            <div class="flex flex-col gap-3">
              <div class="flex justify-between items-center font-sans-ui">
                <h3 class="text-sm font-bold">Attached Model Guides (${{attachedModels.length}})</h3>
                <button onclick="UI.mainTab='models'; renderApp()" class="px-3 py-1.5 rounded-lg gold-grad text-xs font-bold">+ Browse Models to Add</button>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                ${{attachedModels.map(m => `
                  <div onclick="UI.mainTab='models'; UI.activeModelId='${{m.id}}'; renderApp()" class="studio-card studio-card-hover p-4 cursor-pointer flex justify-between items-center">
                    <div>
                      <div class="font-display text-lg text-[#fbba00]">${{escapeHtml(m.name)}}</div>
                      <div class="font-sans-ui text-xs text-[#b4b9c4]">${{escapeHtml(m.gameNames.join(', '))}} • ${{m.requiredPaintIds.length}} Paints</div>
                    </div>
                    <button onclick="event.stopPropagation(); removeModelFromProject('${{proj.id}}', '${{m.id}}')" class="text-xs text-red-400 font-sans-ui px-2 py-1">Remove</button>
                  </div>
                `).join('')}}
              </div>
            </div>
          ` : ''}}

          ${{UI.projectSubTab === 'colours' ? `
            <div class="flex flex-col gap-3">
              <div class="flex justify-between items-center font-sans-ui">
                <h3 class="text-sm font-bold">Attached Colour Guides (${{attachedColours.length}})</h3>
                <button onclick="UI.mainTab='colours'; renderApp()" class="px-3 py-1.5 rounded-lg gold-grad text-xs font-bold">+ Browse Colours to Add</button>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                ${{attachedColours.map(c => `
                  <div onclick="UI.mainTab='colours'; UI.activeColourId='${{c.id}}'; renderApp()" class="studio-card studio-card-hover p-3.5 cursor-pointer flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3">
                      <span class="w-8 h-8 swatch-circle" style="background:${{c.hex}}"></span>
                      <div>
                        <div class="font-display text-base text-white">${{escapeHtml(c.name)}}</div>
                        <div class="font-sans-ui text-xs text-[#b4b9c4]">${{escapeHtml(c.colourGroups.join(', '))}}</div>
                      </div>
                    </div>
                    <button onclick="event.stopPropagation(); removeColourFromProject('${{proj.id}}', '${{c.id}}')" class="text-xs text-red-400 font-sans-ui">Remove</button>
                  </div>
                `).join('')}}
              </div>
            </div>
          ` : ''}}

          ${{UI.projectSubTab === 'notes' ? `
            <div class="flex flex-col gap-3 font-sans-ui">
              <div class="flex justify-between items-center">
                <h3 class="text-sm font-bold">Project Notes & Checklists (${{proj.notes.length}})</h3>
                <button onclick="addNotePrompt('${{proj.id}}')" class="px-3 py-1.5 rounded-lg gold-grad text-xs font-bold">+ Add Checklist / Note</button>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                ${{proj.notes.map((n, nIdx) => `
                  <div class="studio-card p-4 flex flex-col gap-2.5">
                    <div class="flex justify-between items-center border-b border-white/10 pb-2">
                      <strong class="text-sm text-[#fbba00]">${{escapeHtml(n.title)}}</strong>
                      <div class="flex gap-2">
                        <button onclick="addChecklistItemPrompt('${{proj.id}}', '${{n.id}}')" class="text-xs text-sky-400">+ Step</button>
                        <button onclick="deleteNote('${{proj.id}}', '${{n.id}}')" class="text-xs text-red-400">✕</button>
                      </div>
                    </div>
                    <div class="flex flex-col gap-2">
                      ${{(n.components || []).map((comp, cIdx) => comp.type === 'checkbox' ? `
                        <label class="flex items-center gap-2.5 text-xs cursor-pointer ${{comp.checked ? 'line-through text-[#7b8292]' : 'text-white'}}">
                          <input type="checkbox" ${{comp.checked ? 'checked' : ''}} onchange="toggleNoteCheck('${{proj.id}}', '${{n.id}}', ${{cIdx}})" />
                          <span>${{escapeHtml(comp.value)}}</span>
                        </label>
                      ` : `<p class="text-xs text-[#b4b9c4] whitespace-pre-wrap">${{escapeHtml(comp.value)}}</p>`).join('')}}
                    </div>
                  </div>
                `).join('')}}
              </div>
            </div>
          ` : ''}}
        </div>
      `;
    }}

    function renameProjectPrompt(pid) {{
      const p = USER_STATE.projects.find(x => x.id === pid);
      if (!p) return;
      const next = prompt('Rename Project:', p.name);
      if (next && next.trim()) {{
        p.name = next.trim();
        saveUserState();
      }}
    }}
    function removeModelFromProject(projId, rid) {{
      const p = USER_STATE.projects.find(x => x.id === projId);
      if (!p) return;
      p.recipeIds = p.recipeIds.filter(id => id !== rid);
      saveUserState();
    }}
    function removeColourFromProject(projId, cid) {{
      const p = USER_STATE.projects.find(x => x.id === projId);
      if (!p) return;
      p.colourIds = p.colourIds.filter(id => id !== cid);
      saveUserState();
    }}
    function toggleNoteCheck(projId, noteId, cIdx) {{
      const p = USER_STATE.projects.find(x => x.id === projId);
      if (!p) return;
      const n = p.notes.find(x => x.id === noteId);
      if (!n || !n.components[cIdx]) return;
      n.components[cIdx].checked = !n.components[cIdx].checked;
      saveUserState();
    }}
    function addNotePrompt(projId) {{
      const p = USER_STATE.projects.find(x => x.id === projId);
      if (!p) return;
      const title = prompt('Note / Checklist Title:', 'Batch Painting Steps');
      if (!title) return;
      const firstItem = prompt('First checklist item (or note text):', 'Basecoat primary armour');
      p.notes.unshift({{
        id: 'note_' + Date.now(),
        title: title.trim(),
        components: firstItem ? [{{ type: 'checkbox', value: firstItem, checked: false }}] : []
      }});
      saveUserState();
    }}
    function addChecklistItemPrompt(projId, noteId) {{
      const p = USER_STATE.projects.find(x => x.id === projId);
      if (!p) return;
      const n = p.notes.find(x => x.id === noteId);
      if (!n) return;
      const text = prompt('Add checklist step:');
      if (!text) return;
      n.components.push({{ type: 'checkbox', value: text.trim(), checked: false }});
      saveUserState();
    }}
    function deleteNote(projId, noteId) {{
      const p = USER_STATE.projects.find(x => x.id === projId);
      if (!p) return;
      p.notes = p.notes.filter(x => x.id !== noteId);
      saveUserState();
    }}

    // =========================================================================
    // MY PAINTS & CATALOGUE SUB-TAB
    // =========================================================================
    function getUnifiedPaints() {{
      const list = [];
      for (const p of CATALOG.paints) {{
        const isPro = p.range === 'warhammer_pro';
        list.push({{
          id: p.id,
          name: p.name,
          brand: isPro ? 'Citadel Tone Pro' : 'Citadel Classic',
          rangeLabel: isPro ? 'Citadel Tone Pro' : 'Citadel Colour',
          category: p.category,
          hex: p.gradientStartHex,
        }});
      }}
      for (const tp of [...(USER_STATE.customPaints || []), ...CATALOG.thirdPartyPaints]) {{
        list.push({{
          id: tp.id,
          name: tp.name,
          brand: tp.brand,
          rangeLabel: `${{tp.brand}} • ${{tp.range}}`,
          category: tp.category,
          hex: tp.hex,
        }});
      }}
      return list;
    }}

    function renderPaintsSubTab() {{
      const all = getUnifiedPaints();
      const invSet = new Set(USER_STATE.inventoryPaintIds);
      const wishSet = new Set(USER_STATE.wishlistPaintIds);
      const q = UI.paintSearch.trim().toLowerCase();

      const filtered = all.filter(p => {{
        if (UI.paintSubMode === 'inventory' && !invSet.has(p.id)) return false;
        if (UI.paintSubMode === 'wishlist' && !wishSet.has(p.id)) return false;
        if (UI.paintBrandFilter !== 'all' && p.brand !== UI.paintBrandFilter) return false;
        if (q && !`${{p.name}} ${{p.brand}} ${{p.category}} ${{p.hex}}`.toLowerCase().includes(q)) return false;
        return true;
      }});

      return `
        <div class="flex flex-col gap-4 font-sans-ui">
          <div class="flex flex-wrap justify-between items-center gap-3">
            <div class="flex flex-wrap gap-2 text-xs font-semibold">
              <button onclick="UI.paintSubMode='inventory'; renderApp()" class="px-3.5 py-1.5 rounded-full border ${{UI.paintSubMode==='inventory' ? 'border-[#fbba00] bg-[#edb304]/15 text-[#fbba00]' : 'border-white/10 bg-[#191c22] text-[#b4b9c4]'}}">
                ✓ My Inventory (${{USER_STATE.inventoryPaintIds.length}})
              </button>
              <button onclick="UI.paintSubMode='wishlist'; renderApp()" class="px-3.5 py-1.5 rounded-full border ${{UI.paintSubMode==='wishlist' ? 'border-[#fbba00] bg-[#edb304]/15 text-[#fbba00]' : 'border-white/10 bg-[#191c22] text-[#b4b9c4]'}}">
                ★ My Wishlist (${{USER_STATE.wishlistPaintIds.length}})
              </button>
              <button onclick="UI.paintSubMode='catalogue'; renderApp()" class="px-3.5 py-1.5 rounded-full border ${{UI.paintSubMode==='catalogue' ? 'border-[#fbba00] bg-[#edb304]/15 text-[#fbba00]' : 'border-white/10 bg-[#191c22] text-[#b4b9c4]'}}">
                All Paints Catalogue (${{all.length}})
              </button>
            </div>
            <button onclick="addCustomPaintPrompt()" class="px-3.5 py-1.5 rounded-lg bg-[#191c22] border border-white/15 text-xs font-semibold text-white hover:border-[#fbba00]">
              + Add Custom 3rd-Party Paint
            </button>
          </div>

          <div class="flex flex-wrap gap-3">
            <input type="text" placeholder="Search paints by name, brand, category, or hex..." value="${{escapeHtml(UI.paintSearch)}}"
              oninput="UI.paintSearch=this.value; renderApp()"
              class="flex-1 min-w-[220px] bg-[#15181e] border border-white/15 rounded-lg px-3.5 py-2 text-xs text-white" />
            <select onchange="UI.paintBrandFilter=this.value; renderApp()" class="bg-[#15181e] border border-white/15 rounded-lg px-3 py-2 text-xs text-white">
              <option value="all" ${{UI.paintBrandFilter==='all'?'selected':''}}>All Brands (Citadel + 5 Third-Party)</option>
              <option value="Citadel Classic" ${{UI.paintBrandFilter==='Citadel Classic'?'selected':''}}>Citadel Colour (Classic)</option>
              <option value="Citadel Tone Pro" ${{UI.paintBrandFilter==='Citadel Tone Pro'?'selected':''}}>Citadel Tone Pro</option>
              ${{CATALOG.thirdPartyBrands.map(b => `<option value="${{escapeHtml(b)}}" ${{UI.paintBrandFilter===b?'selected':''}}>${{escapeHtml(b)}}</option>`).join('')}}
            </select>
          </div>

          ${{filtered.length > 0 ? `
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              ${{filtered.slice(0, 120).map(p => renderPaintPillRow(p.id, p.name, `${{p.rangeLabel}} • ${{p.category}}`, p.hex)).join('')}}
            </div>
          ` : `
            <div class="studio-card p-8 text-center">
              <p class="text-xs text-[#b4b9c4] mb-3">No paints match your current view or filter.</p>
              <button onclick="UI.paintSubMode='catalogue'; UI.paintBrandFilter='all'; UI.paintSearch=''; renderApp()" class="px-4 py-2 rounded-lg gold-grad text-xs font-bold">
                Browse All ${{all.length}} Paints
              </button>
            </div>
          `}}
        </div>
      `;
    }}

    function renderPaintPillRow(id, name, subtitle, hex) {{
      const owned = isOwned(id);
      const wish = isWishlisted(id);
      return `
        <div class="studio-card p-2.5 flex items-center justify-between gap-2">
          <button onclick="UI.activePaintModalId='${{id}}'; renderApp()" class="flex items-center gap-2.5 text-left min-w-0 flex-1">
            <span class="w-8 h-8 swatch-circle" style="background:${{hex}}"></span>
            <div class="min-w-0 flex-1 font-sans-ui">
              <div class="text-xs font-bold text-white truncate">${{escapeHtml(name)}}</div>
              <div class="text-xs text-[#b4b9c4] truncate">${{escapeHtml(subtitle)}}</div>
            </div>
          </button>
          <div class="flex gap-1 shrink-0 font-sans-ui text-xs">
            <button onclick="toggleInventory('${{id}}')" class="px-2 py-1 rounded font-bold ${{owned ? 'bg-[#29c26a]/20 text-[#29c26a] border border-[#29c26a]/40' : 'bg-[#15181e] text-[#b4b9c4] border border-white/10'}}">
              ${{owned ? '✓ Owned' : '+ Own'}}
            </button>
            <button onclick="toggleWishlist('${{id}}')" class="px-2 py-1 rounded font-bold ${{wish ? 'bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/40' : 'bg-[#15181e] text-[#b4b9c4] border border-white/10'}}">
              ${{wish ? '★' : '☆'}}
            </button>
          </div>
        </div>
      `;
    }}

    function addCustomPaintPrompt() {{
      const brand = prompt('3rd-Party Brand Name (e.g., The Army Painter, Scale75, Vallejo):', 'The Army Painter');
      if (!brand) return;
      const name = prompt('Paint Name:', 'Warpaints Fanatic Custom Shade');
      if (!name) return;
      const hex = prompt('Hex Color Code:', '#3b82f6') || '#3b82f6';
      const custom = {{
        id: 'custom_' + Date.now(),
        brand: brand.trim(),
        range: 'Custom Range',
        name: name.trim(),
        category: 'Layer',
        hex: hex.trim(),
        citadelMatches: [],
        isCustom: true,
      }};
      USER_STATE.customPaints.unshift(custom);
      USER_STATE.inventoryPaintIds.push(custom.id);
      saveUserState();
      showToast(`Added custom paint "${{custom.name}}" to Inventory`);
    }}

    // =========================================================================
    // CROSS-BRAND CONVERTER SUB-TAB
    // =========================================================================
    function renderConverterSubTab() {{
      const q = UI.converterSearch.trim().toLowerCase();
      const brandFilter = UI.converterBrand;
      const rows = [];

      for (const cp of CATALOG.paints) {{
        let matches = CATALOG.citadelToThirdParty[cp.id] || [];
        if (brandFilter !== 'all') matches = matches.filter(m => m.brand === brandFilter);
        if (matches.length === 0) continue;
        if (q) {{
          const hitCit = cp.name.toLowerCase().includes(q);
          const hitTp = matches.some(m => m.name.toLowerCase().includes(q) || m.brand.toLowerCase().includes(q));
          if (!hitCit && !hitTp) continue;
        }}
        rows.push({{ citadel: cp, matches: matches.slice(0, 5) }});
      }}

      return `
        <div class="flex flex-col gap-4 font-sans-ui">
          <div class="studio-card p-4 flex flex-col gap-3">
            <div class="text-xs text-[#b4b9c4]">
              Compare official <strong>Citadel Colour & Tone Pro</strong> paints with <strong>The Army Painter</strong> (Fanatic / Speedpaint 2.0), <strong>Vallejo</strong> (Game / Model Color), <strong>Two Thin Coats</strong>, <strong>Monument Hobbies Pro Acryl</strong>, and <strong>AK Interactive 3rd Gen</strong>.
            </div>
            <div class="flex flex-wrap gap-3">
              <input type="text" placeholder="Search any Citadel or 3rd-party paint to convert..." value="${{escapeHtml(UI.converterSearch)}}"
                oninput="UI.converterSearch=this.value; renderApp()"
                class="flex-1 min-w-[220px] bg-[#15181e] border border-white/15 rounded-lg px-3.5 py-2 text-xs text-white" />
              <select onchange="UI.converterBrand=this.value; renderApp()" class="bg-[#15181e] border border-white/15 rounded-lg px-3 py-2 text-xs text-white">
                <option value="all" ${{UI.converterBrand==='all'?'selected':''}}>All 3rd-Party Brands</option>
                ${{CATALOG.thirdPartyBrands.map(b => `<option value="${{escapeHtml(b)}}" ${{UI.converterBrand===b?'selected':''}}>${{escapeHtml(b)}}</option>`).join('')}}
              </select>
            </div>
          </div>

          <div class="flex flex-col gap-2.5">
            ${{rows.slice(0, 60).map(r => `
              <div class="studio-card p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
                <div class="lg:col-span-4 flex items-center justify-between gap-2">
                  <button onclick="UI.activePaintModalId='${{r.citadel.id}}'; renderApp()" class="flex items-center gap-2.5 text-left">
                    <span class="w-8 h-8 swatch-circle" style="background:${{r.citadel.gradientStartHex}}"></span>
                    <div>
                      <div class="text-xs font-bold text-white">${{escapeHtml(r.citadel.name)}}</div>
                      <div class="text-xs text-[#b4b9c4]">${{r.citadel.range==='warhammer_pro'?'Citadel Tone Pro':'Citadel Classic'}} • ${{r.citadel.category}}</div>
                    </div>
                  </button>
                  <button onclick="toggleInventory('${{r.citadel.id}}')" class="px-2 py-1 rounded text-xs font-bold ${{isOwned(r.citadel.id) ? 'bg-[#29c26a]/20 text-[#29c26a]' : 'bg-[#15181e] text-[#b4b9c4]'}}">
                    ${{isOwned(r.citadel.id) ? '✓ Owned' : '+ Own'}}
                  </button>
                </div>
                <div class="hidden lg:flex lg:col-span-1 justify-center text-[#fbba00] font-bold">⇄</div>
                <div class="lg:col-span-7 flex flex-wrap gap-2">
                  ${{r.matches.map(m => `
                    <div class="flex items-center gap-2 bg-[#15181e] border border-white/10 rounded-lg px-2.5 py-1.5">
                      <button onclick="UI.activePaintModalId='${{m.thirdPartyPaintId}}'; renderApp()" class="flex items-center gap-2 text-left">
                        <span class="w-5 h-5 swatch-circle" style="background:${{m.hex}}"></span>
                        <div>
                          <div class="text-xs font-semibold text-white">${{escapeHtml(m.name)}}</div>
                          <div class="text-xs text-[#7b8292]">${{escapeHtml(m.brand)}} • ΔE ${{m.deltaE}}</div>
                        </div>
                      </button>
                      <button onclick="toggleInventory('${{m.thirdPartyPaintId}}')" class="px-2 py-0.5 rounded text-xs font-bold ${{isOwned(m.thirdPartyPaintId) ? 'bg-[#29c26a]/20 text-[#29c26a]' : 'bg-white/5 text-[#b4b9c4]'}}">
                        ${{isOwned(m.thirdPartyPaintId) ? '✓' : '+'}}
                      </button>
                    </div>
                  `).join('')}}
                </div>
              </div>
            `).join('')}}
          </div>
        </div>
      `;
    }}

    // =========================================================================
    // SETTINGS, MULTI-USER MY WARHAMMER IMPORTER & CACHE MANIFEST SUB-TAB
    // =========================================================================
    async function generatePkceLink() {{
      const bytes = new Uint8Array(32);
      crypto.getRandomValues(bytes);
      const b64url = b => btoa(String.fromCharCode(...b)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      const verifier = b64url(bytes);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const challenge = b64url(new Uint8Array(digest));
      const params = new URLSearchParams({{
        client_id: '256418625992-265571283910099920',
        response_type: 'code',
        redirect_uri: 'citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback',
        scope: 'openid profile email offline_access',
        audience: 'https://login.mywarhammer.com/userinfo',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }});
      UI.pkceUrl = `https://login.mywarhammer.com/authorize?${{params.toString()}}`;
      renderApp();
    }}

    function handleFileImport(event) {{
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {{
        try {{
          const data = JSON.parse(String(reader.result));
          importAccountPayload(data, UI.importMode);
        }} catch (e) {{
          showToast('Invalid JSON file');
        }}
      }};
      reader.readAsText(file);
    }}

    function renderSettingsSubTab() {{
      const mf = CATALOG.manifest;
      return `
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 font-sans-ui">
          <!-- Multi-User Importer -->
          <div class="studio-card p-5 flex flex-col gap-3">
            <span class="px-2.5 py-0.5 rounded-full bg-[#edb304]/20 text-[#fbba00] text-xs font-bold w-fit">Multi-User Account Importer</span>
            <h3 class="font-display text-xl text-white">Import from Any "My Warhammer" Account</h3>
            <p class="text-xs text-[#b4b9c4]">
              Import your live Inventory, Wishlist, and custom Projects using the extracted APK snapshot, the self-service Auth0 PKCE login wizard, or a JSON backup upload.
            </p>

            <div class="p-3 rounded-lg bg-[#15181e] border border-white/10 flex flex-col gap-2">
              <strong class="text-xs text-[#fbba00]">Option 1: 1-Click Extracted Account Snapshot</strong>
              <p class="text-xs text-[#b4b9c4]">Loads 64 Owned Paints, 34 Wishlist Paints, and 5 Custom Projects extracted from the APK.</p>
              <button onclick="loadExtractedSnapshot()" class="px-4 py-2 rounded-lg gold-grad text-xs font-bold w-fit">
                ⚡ Import Extracted Account Snapshot
              </button>
            </div>

            <div class="p-3 rounded-lg bg-[#15181e] border border-white/10 flex flex-col gap-2">
              <strong class="text-xs text-[#fbba00]">Option 2: Self-Service My Warhammer Auth0 PKCE Login</strong>
              <p class="text-xs text-[#b4b9c4]">Generate a PKCE login link for <code>login.mywarhammer.com</code>, sign in, and paste your <code>citadel-colour://.../callback?code=...</code> URL.</p>
              <button onclick="generatePkceLink()" class="px-3 py-1.5 rounded bg-[#1f232b] border border-white/15 text-xs text-white w-fit">
                🔑 Generate My Warhammer PKCE Login URL
              </button>
              ${{UI.pkceUrl ? `
                <a href="${{escapeHtml(UI.pkceUrl)}}" target="_blank" rel="noopener" class="text-xs text-sky-400 underline break-all">Open login.mywarhammer.com Authorize Page ↗</a>
              ` : ''}}
            </div>

            <div class="p-3 rounded-lg bg-[#15181e] border border-white/10 flex flex-col gap-2">
              <strong class="text-xs text-[#fbba00]">Option 3: Upload user_account.json or Backup File</strong>
              <input type="file" accept=".json" onchange="handleFileImport(event)" class="text-xs text-[#b4b9c4]" />
            </div>
          </div>

          <!-- Substitution Rules, Backup & Manifest Cache -->
          <div class="studio-card p-5 flex flex-col gap-4">
            <span class="px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-400 text-xs font-bold w-fit">Readiness Rules & Smart Cache</span>
            <h3 class="font-display text-xl text-white">"Can I Paint This?" & Cache Manifest</h3>

            <label class="flex items-start gap-2.5 text-xs cursor-pointer">
              <input type="checkbox" ${{USER_STATE.preferences.allowCompatibleSubstitutions ? 'checked' : ''}}
                onchange="USER_STATE.preferences.allowCompatibleSubstitutions=this.checked; saveUserState()" class="mt-0.5" />
              <div>
                <strong class="text-white">Allow Official Citadel ↔ Tone Pro Substitutions</strong>
                <div class="text-[#b4b9c4]">Count a required paint as covered if you own its official Tone Pro or Classic counterpart.</div>
              </div>
            </label>

            <label class="flex items-start gap-2.5 text-xs cursor-pointer">
              <input type="checkbox" ${{USER_STATE.preferences.allowThirdPartySubstitutions ? 'checked' : ''}}
                onchange="USER_STATE.preferences.allowThirdPartySubstitutions=this.checked; saveUserState()" class="mt-0.5" />
              <div>
                <strong class="text-white">Allow 3rd-Party Brand Substitutions (Army Painter, Vallejo, etc.)</strong>
                <div class="text-[#b4b9c4]">Count a required Citadel paint as covered if you own a linked 3rd-party equivalent.</div>
              </div>
            </label>

            <div class="p-3 rounded-lg bg-[#15181e] border border-white/10 text-xs flex flex-col gap-1.5">
              <div class="flex justify-between">
                <span class="text-[#b4b9c4]">Catalog Manifest Version:</span>
                <strong class="text-[#29c26a]">${{mf.catalogVersion}}</strong>
              </div>
              <div class="flex justify-between">
                <span class="text-[#b4b9c4]">Bundle Hash-Diff Protocol:</span>
                <span class="text-white font-mono">1-Doc Manifest Check</span>
              </div>
              <div class="text-[#7b8292] mt-1">
                Clients compare SHA-256 hashes per bundle in <code>catalog_meta/manifest</code> and re-fetch only updated bundles.
              </div>
            </div>

            <div class="flex flex-wrap gap-2 mt-auto pt-2 border-t border-white/10">
              <button onclick="exportBackupJson()" class="px-3.5 py-2 rounded-lg bg-[#15181e] border border-white/15 text-xs font-semibold text-white">
                ⬇ Export Full JSON Backup
              </button>
              <button onclick="resetUserState()" class="px-3.5 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-400">
                🗑 Reset Local Data
              </button>
            </div>
          </div>
        </div>
      `;
    }}

    // =========================================================================
    // TAB 2: PAINT A MODEL (4,531 MODELS)
    // =========================================================================
    function renderPaintModelView() {{
      const gid = UI.selectedGameId;
      const fid = UI.selectedFactionId;
      const q = UI.modelSearch.trim().toLowerCase();
      const rf = UI.modelReadinessFilter;
      const rangeF = UI.modelRangeFilter;

      const selectedGame = gid ? CATALOG.games.find(g => g.id === gid) : null;

      let matched = CATALOG.models.filter(m => {{
        if (gid && !m.gameIds.includes(gid)) return false;
        if (fid && !m.factionIds.includes(fid)) return false;
        if (rangeF !== 'all' && m.range !== rangeF) return false;
        if (q) {{
          const hit = m.name.toLowerCase().includes(q) || m.factionNames.some(f => f.toLowerCase().includes(q));
          if (!hit) return false;
        }}
        return true;
      }});

      let evaluated = matched.map(m => ({{
        model: m,
        readiness: evaluateReadiness(m.requiredPaintIds)
      }}));

      if (rf === 'ready100') evaluated = evaluated.filter(x => x.readiness.totalRequired > 0 && x.readiness.matchPercent === 100);
      else if (rf === 'missing2') evaluated = evaluated.filter(x => x.readiness.totalRequired > 0 && x.readiness.missingCount <= 2);
      else if (rf === 'sortReady') evaluated.sort((a, b) => b.readiness.matchPercent - a.readiness.matchPercent);

      const visible = evaluated.slice(0, UI.modelLimit);

      return `
        <div class="flex flex-col gap-4">
          <div class="studio-card p-5">
            <h1 class="font-display text-3xl text-[#fbba00]">Paint A Model</h1>
            <p class="font-sans-ui text-xs text-[#b4b9c4] mt-1">
              Browse all ${{CATALOG.models.length.toLocaleString()}} official miniature recipes across ${{CATALOG.games.length}} Game Systems & 335 Factions, with instant "Can I Paint This?" matching.
            </p>
          </div>

          <!-- 15 Game Systems Strip -->
          <div class="flex gap-2 overflow-x-auto pb-2 font-sans-ui text-xs">
            <button onclick="UI.selectedGameId=null; UI.selectedFactionId=null; UI.modelLimit=48; renderApp()"
              class="px-3.5 py-2 rounded-lg shrink-0 border ${{!gid ? 'border-[#fbba00] bg-[#edb304]/15 text-[#fbba00] font-bold' : 'border-white/10 bg-[#191c22] text-[#b4b9c4]'}}">
              All Games (${{CATALOG.models.length.toLocaleString()}})
            </button>
            ${{CATALOG.games.map(g => `
              <button onclick="UI.selectedGameId='${{g.id}}'; UI.selectedFactionId=null; UI.modelLimit=48; renderApp()"
                class="px-3.5 py-2 rounded-lg shrink-0 border ${{gid===g.id ? 'border-[#fbba00] bg-[#edb304]/15 text-[#fbba00] font-bold' : 'border-white/10 bg-[#191c22] text-[#b4b9c4]'}}">
                ${{escapeHtml(g.name)}} (${{g.recipeCount}})
              </button>
            `).join('')}}
          </div>

          <!-- Faction Chips when Game is Selected -->
          ${{selectedGame ? `
            <div class="studio-card p-3.5 flex flex-wrap gap-1.5 font-sans-ui text-xs">
              <button onclick="UI.selectedFactionId=null; renderApp()"
                class="px-3 py-1 rounded-full border ${{!fid ? 'border-[#fbba00] text-[#fbba00]' : 'border-white/10 text-[#b4b9c4]'}}">
                All ${{escapeHtml(selectedGame.name)}}
              </button>
              ${{selectedGame.factions.map(f => `
                <button onclick="UI.selectedFactionId='${{f.id}}'; renderApp()"
                  class="px-3 py-1 rounded-full border ${{fid===f.id ? 'border-[#fbba00] bg-[#edb304]/15 text-[#fbba00]' : 'border-white/10 text-[#b4b9c4]'}}">
                  ${{escapeHtml(f.name)}} (${{f.recipeCount}})
                </button>
              `).join('')}}
            </div>
          ` : ''}}

          <!-- Search & Readiness Filter Bar -->
          <div class="studio-card p-3.5 flex flex-wrap gap-3 font-sans-ui text-xs">
            <input type="text" placeholder="Search 4,531 models by unit, character, or faction..." value="${{escapeHtml(UI.modelSearch)}}"
              oninput="UI.modelSearch=this.value; UI.modelLimit=48; renderApp()"
              class="flex-1 min-w-[220px] bg-[#15181e] border border-white/15 rounded-lg px-3.5 py-2 text-white" />

            <select onchange="UI.modelReadinessFilter=this.value; UI.modelLimit=48; renderApp()"
              class="bg-[#15181e] border border-white/15 rounded-lg px-3 py-2 text-white">
              <option value="all" ${{rf==='all'?'selected':''}}>Can I Paint This? — All Models</option>
              <option value="ready100" ${{rf==='ready100'?'selected':''}}>✓ 100% Paint Ready Now</option>
              <option value="missing2" ${{rf==='missing2'?'selected':''}}>⚡ Missing ≤ 2 Paints</option>
              <option value="sortReady" ${{rf==='sortReady'?'selected':''}}>Sort by Highest Match %</option>
            </select>
          </div>

          <div class="font-sans-ui text-xs text-[#b4b9c4]">
            Showing <strong>${{visible.length}}</strong> of <strong>${{evaluated.length.toLocaleString()}}</strong> matching models
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            ${{visible.map(({{ model, readiness }}) => `
              <div onclick="UI.activeModelId='${{model.id}}'; UI.selectedPinId=null; renderApp()"
                class="studio-card studio-card-hover p-4 flex flex-col justify-between gap-3 cursor-pointer">
                <div>
                  <div class="flex items-center justify-between gap-2 mb-2.5">
                    <div class="flex gap-1">${{renderModelPaletteStrip(model.colourIds, model.requiredPaintIds)}}</div>
                    <span class="px-2 py-0.5 rounded-full font-sans-ui text-xs font-bold ${{readiness.matchPercent===100 ? 'bg-[#29c26a]/20 text-[#29c26a]' : 'bg-white/10 text-[#fbba00]'}}">
                      ${{readiness.matchPercent}}% Ready (${{readiness.ownedDirectCount + readiness.substitutedCount}}/${{readiness.totalRequired}})
                    </span>
                  </div>
                  <h3 class="font-display text-lg text-white leading-snug">${{escapeHtml(model.name)}}</h3>
                  <p class="font-sans-ui text-xs text-[#b4b9c4] mt-1">
                    ${{escapeHtml(model.factionNames.join(' • ') || model.gameNames[0] || 'Warhammer')}}
                  </p>
                </div>
                <div class="flex justify-between items-center pt-2.5 border-t border-white/10 font-sans-ui text-xs text-[#fbba00]">
                  <span>${{model.requiredPaintIds.length}} Required Paints</span>
                  <span>View Guide →</span>
                </div>
              </div>
            `).join('')}}
          </div>

          ${{evaluated.length > UI.modelLimit ? `
            <div class="flex justify-center py-4">
              <button onclick="UI.modelLimit += 48; renderApp()" class="px-5 py-2.5 rounded-lg bg-[#191c22] border border-white/15 font-sans-ui text-xs font-bold text-white hover:border-[#fbba00]">
                Load More Models (${{(evaluated.length - UI.modelLimit).toLocaleString()}} remaining)
              </button>
            </div>
          ` : ''}}
        </div>
      `;
    }}

    function renderModelDetailView() {{
      const m = MAPS.modelById.get(UI.activeModelId);
      if (!m) {{
        UI.activeModelId = null;
        return renderPaintModelView();
      }}
      const detail = CATALOG.detailedRecipes[m.id] || null;
      const ready = evaluateReadiness(m.requiredPaintIds);
      const modelColours = (m.colourIds || []).map(cid => MAPS.colourById.get(cid)).filter(Boolean);

      return `
        <div class="flex flex-col gap-5">
          <div class="flex flex-wrap justify-between items-center gap-2 font-sans-ui text-xs">
            <button onclick="UI.activeModelId=null; renderApp()" class="px-3 py-1.5 rounded-lg bg-[#191c22] border border-white/10 text-[#b4b9c4] hover:text-white">
              ← Back to Paint A Model
            </button>
            <div class="flex flex-wrap gap-2">
              ${{ready.missingCount > 0 ? `
                <button onclick="addManyToWishlist(${{JSON.stringify(ready.missingPaintIds).replace(/"/g, '&quot;')}})"
                  class="px-3.5 py-1.5 rounded-lg gold-grad font-bold">
                  ★ Add ${{ready.missingCount}} Missing Paints to Wishlist
                </button>
              ` : ''}}
              <button onclick="addModelToProjectPrompt('${{m.id}}')" class="px-3.5 py-1.5 rounded-lg bg-[#191c22] border border-white/15 text-white font-semibold">
                + Add Model to Project
              </button>
            </div>
          </div>

          <div class="studio-card p-5 flex flex-col gap-4">
            <div class="flex flex-wrap justify-between items-start gap-4">
              <div>
                <span class="px-2.5 py-0.5 rounded-full bg-[#edb304]/20 text-[#fbba00] font-sans-ui text-xs font-bold">
                  ${{escapeHtml(m.gameNames.join(' • ') || 'Warhammer Miniature')}}
                </span>
                <h1 class="font-display text-3xl text-[#fbba00] mt-2">${{escapeHtml(m.name)}}</h1>
                <p class="font-sans-ui text-xs text-[#b4b9c4]">${{escapeHtml(m.factionNames.join(' • '))}}</p>
              </div>
              <div class="bg-[#15181e] p-3.5 rounded-lg border border-white/10 font-sans-ui text-xs min-w-[260px]">
                <div class="flex justify-between mb-1">
                  <strong class="text-white">Can I Paint This? — ${{ready.matchPercent}}%</strong>
                  <span class="text-[#29c26a] font-bold">${{ready.ownedDirectCount + ready.substitutedCount}}/${{ready.totalRequired}}</span>
                </div>
                <div class="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-1">
                  <div class="h-full ${{ready.matchPercent===100?'bg-[#29c26a]':'bg-[#fbba00]'}}" style="width:${{ready.matchPercent}}%"></div>
                </div>
                <div class="text-[#7b8292]">${{ready.ownedDirectCount}} Owned • ${{ready.substitutedCount}} Substituted • ${{ready.missingCount}} Missing</div>
              </div>
            </div>

            <!-- Colours on this Model -->
            ${{modelColours.length > 0 ? `
              <div class="pt-3 border-t border-white/10">
                <h3 class="font-display text-base text-white mb-2">Colours On This Model (${{modelColours.length}})</h3>
                <div class="flex flex-wrap gap-2 font-sans-ui text-xs">
                  ${{modelColours.map(c => `
                    <button onclick="UI.mainTab='colours'; UI.activeColourId='${{c.id}}'; renderApp()"
                      class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#15181e] border border-white/15 hover:border-[#fbba00]">
                      <span class="w-4 h-4 rounded-full border border-white/30" style="background:${{c.hex}}"></span>
                      <span class="text-white font-semibold">${{escapeHtml(c.name)}}</span>
                      <span class="text-[#fbba00]">→</span>
                    </button>
                  `).join('')}}
                </div>
              </div>
            ` : ''}}
          </div>

          <!-- Step-by-Step Painting Areas (when full recipe is embedded) -->
          ${{detail && detail.paintingAreas && detail.paintingAreas.length > 0 ? `
            <div class="flex flex-col gap-4">
              <h2 class="font-display text-2xl text-[#fbba00]">Step-by-Step Painting Areas (${{detail.paintingAreas.length}})</h2>
              ${{detail.paintingAreas.map(area => `
                <div class="studio-card p-4 flex flex-col gap-3">
                  <div class="border-b border-white/10 pb-2">
                    <h3 class="font-display text-lg text-white">${{escapeHtml(area.name)}}</h3>
                    ${{area.subsectionName ? `<span class="font-sans-ui text-xs text-[#b4b9c4]">${{escapeHtml(area.subsectionName)}}</span>` : ''}}
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 font-sans-ui">
                    ${{area.paintingSteps.map(st => {{
                      const sp = st.paint;
                      const sub = sp ? ready.substitutedByPaintId[sp.id] : null;
                      return `
                        <div class="p-3 rounded-lg bg-[#15181e] border border-white/10 flex flex-col justify-between gap-2">
                          <div>
                            <div class="flex flex-wrap gap-1.5 text-xs mb-1.5">
                              <span class="px-2 py-0.5 rounded bg-[#edb304]/20 text-[#fbba00] font-bold">Step ${{st.stepNumber}}</span>
                              <span class="px-2 py-0.5 rounded bg-white/10 text-[#b4b9c4]">${{escapeHtml(st.paintingStage)}}</span>
                              ${{st.techniqueName ? `<span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-400">${{escapeHtml(st.techniqueName)}}</span>` : ''}}
                            </div>
                            ${{st.text ? `<p class="text-xs text-[#b4b9c4] mb-2">${{escapeHtml(st.text)}}</p>` : ''}}
                          </div>
                          ${{sp ? `
                            <div class="pt-2 border-t border-white/10 flex items-center justify-between gap-2">
                              <button onclick="UI.activePaintModalId='${{sp.id}}'; renderApp()" class="flex items-center gap-2 text-left min-w-0">
                                <span class="w-6 h-6 swatch-circle" style="background:${{sp.gradientStartHex}}"></span>
                                <span class="text-xs font-bold text-white truncate">${{escapeHtml(sp.name)}}</span>
                              </button>
                              ${{isOwned(sp.id) ? `<span class="text-xs text-[#29c26a] font-bold">✓ Owned</span>` :
                                sub ? `<span class="text-xs text-sky-400 font-bold truncate" title="Covered by ${{escapeHtml(sub.substituteName)}}">⇄ ${{escapeHtml(sub.substituteName)}}</span>` :
                                `<button onclick="toggleInventory('${{sp.id}}')" class="px-2 py-0.5 rounded bg-white/10 text-xs text-white">+ Own</button>`
                              }}
                            </div>
                          ` : ''}}
                        </div>
                      `;
                    }}).join('')}}
                  </div>
                </div>
              `).join('')}}
            </div>
          ` : ''}}

          <!-- Complete Required Paints Breakdown -->
          <div class="studio-card p-5 flex flex-col gap-3 font-sans-ui">
            <h2 class="font-display text-xl text-[#fbba00]">All Required Paints For This Miniature (${{m.requiredPaintIds.length}})</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              ${{m.requiredPaintIds.map(pid => {{
                const p = MAPS.paintById.get(pid);
                if (!p) return '';
                const sub = ready.substitutedByPaintId[pid];
                const subtitle = sub ? `⇄ Covered by ${{sub.substituteName}}` : p.category;
                return renderPaintPillRow(p.id, p.name, subtitle, p.gradientStartHex);
              }}).join('')}}
            </div>
          </div>
        </div>
      `;
    }}

    function addModelToProjectPrompt(modelId) {{
      if (USER_STATE.projects.length === 0) {{
        createNewProjectPrompt();
        if (USER_STATE.projects[0]) {{
          USER_STATE.projects[0].recipeIds.push(modelId);
          saveUserState();
        }}
        return;
      }}
      const names = USER_STATE.projects.map((p, idx) => `${{idx + 1}}. ${{p.name}}`).join('\\n');
      const choice = prompt(`Select Project number to add this Model Guide to:\\n${{names}}`, '1');
      const idx = parseInt(choice || '1', 10) - 1;
      const target = USER_STATE.projects[idx];
      if (target) {{
        if (!target.recipeIds.includes(modelId)) target.recipeIds.push(modelId);
        saveUserState();
        showToast(`Added model guide to "${{target.name}}"`);
      }}
    }}

    // =========================================================================
    // TAB 3: PAINT A COLOUR (596 GUIDES + 17 BASING GUIDES)
    // =========================================================================
    function renderPaintColourView() {{
      const grp = UI.selectedColourGroup;
      const basing = UI.onlyBasing;
      const q = UI.colourSearch.trim().toLowerCase();
      const rf = UI.colourReadinessFilter;

      let matched = CATALOG.colours.filter(c => {{
        if (basing && c.guideType !== 'basing') return false;
        if (grp && !c.colourGroups.some(g => g.toLowerCase() === grp.toLowerCase())) return false;
        if (q && !`${{c.name}} ${{c.colourGroups.join(' ')}}`.toLowerCase().includes(q)) return false;
        return true;
      }});

      let evaluated = matched.map(c => ({{
        colour: c,
        readiness: evaluateReadiness(c.requiredPaintIds)
      }}));

      if (rf === 'ready100') evaluated = evaluated.filter(x => x.readiness.totalRequired > 0 && x.readiness.matchPercent === 100);
      else if (rf === 'sortReady') evaluated.sort((a, b) => b.readiness.matchPercent - a.readiness.matchPercent);

      return `
        <div class="flex flex-col gap-4">
          <div class="studio-card p-5 flex flex-wrap justify-between items-center gap-4">
            <div>
              <h1 class="font-display text-3xl text-[#fbba00]">Paint A Colour</h1>
              <p class="font-sans-ui text-xs text-[#b4b9c4] mt-1">
                Explore all ${{CATALOG.colours.length}} official Citadel colour & basing guides across 16 colour families with Base, Detail, and Artificer stages.
              </p>
            </div>
            <label class="flex items-center gap-2 px-3.5 py-2 rounded-full bg-[#15181e] border border-white/15 font-sans-ui text-xs font-semibold cursor-pointer">
              <input type="checkbox" ${{basing ? 'checked' : ''}} onchange="UI.onlyBasing=this.checked; renderApp()" />
              <span>🪨 Only show guides for painting bases (17 Basing Guides)</span>
            </label>
          </div>

          <!-- 16 Colour Group Chips -->
          <div class="flex flex-wrap gap-1.5 font-sans-ui text-xs">
            <button onclick="UI.selectedColourGroup=null; renderApp()"
              class="px-3 py-1.5 rounded-full border ${{!grp ? 'border-[#fbba00] bg-[#edb304]/15 text-[#fbba00] font-bold' : 'border-white/10 bg-[#191c22] text-[#b4b9c4]'}}">
              All Colour Families (${{CATALOG.colours.length}})
            </button>
            ${{CATALOG.colourGroups.map(g => `
              <button onclick="UI.selectedColourGroup='${{escapeHtml(g.name)}}'; renderApp()"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${{grp===g.name ? 'border-[#fbba00] bg-[#edb304]/15 text-[#fbba00] font-bold' : 'border-white/10 bg-[#191c22] text-[#b4b9c4]'}}">
                ${{g.hex ? `<span class="w-3 h-3 rounded-full border border-white/30" style="background:${{g.hex}}"></span>` : ''}}
                <span>${{escapeHtml(g.name)}}</span>
              </button>
            `).join('')}}
          </div>

          <!-- Search & Readiness -->
          <div class="studio-card p-3.5 flex flex-wrap gap-3 font-sans-ui text-xs">
            <input type="text" placeholder="Search 596 colour schemes (e.g., Ultramarine Blue, Bone, Gold, Lava Base)..." value="${{escapeHtml(UI.colourSearch)}}"
              oninput="UI.colourSearch=this.value; renderApp()"
              class="flex-1 min-w-[220px] bg-[#15181e] border border-white/15 rounded-lg px-3.5 py-2 text-white" />
            <select onchange="UI.colourReadinessFilter=this.value; renderApp()" class="bg-[#15181e] border border-white/15 rounded-lg px-3 py-2 text-white">
              <option value="all" ${{rf==='all'?'selected':''}}>Can I Paint This? — All Colours</option>
              <option value="ready100" ${{rf==='ready100'?'selected':''}}>✓ 100% Paint Ready Now</option>
              <option value="sortReady" ${{rf==='sortReady'?'selected':''}}>Sort by Highest Match %</option>
            </select>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            ${{evaluated.map(({{ colour, readiness }}) => `
              <div onclick="UI.activeColourId='${{colour.id}}'; renderApp()"
                class="studio-card studio-card-hover overflow-hidden cursor-pointer flex flex-col justify-between">
                <div class="h-20 relative flex items-end p-3" style="background: linear-gradient(135deg, ${{colour.hex}} 0%, #14171d 100%)">
                  <span class="w-8 h-8 swatch-circle" style="background:${{colour.hex}}"></span>
                  <span class="ml-auto px-2 py-0.5 rounded-full bg-black/75 font-sans-ui text-xs font-bold ${{readiness.matchPercent===100?'text-[#29c26a]':'text-[#fbba00]'}}">
                    ${{readiness.matchPercent}}% Ready (${{readiness.ownedDirectCount + readiness.substitutedCount}}/${{readiness.totalRequired}})
                  </span>
                </div>
                <div class="p-3.5">
                  <div class="font-display text-lg text-white">${{escapeHtml(colour.name)}}</div>
                  <div class="font-sans-ui text-xs text-[#b4b9c4] mt-0.5">
                    ${{escapeHtml(colour.colourGroups.join(' • '))}} • ${{colour.requiredPaintIds.length}} Paints
                  </div>
                </div>
              </div>
            `).join('')}}
          </div>
        </div>
      `;
    }}

    function renderColourDetailView() {{
      const c = MAPS.colourById.get(UI.activeColourId);
      if (!c) {{
        UI.activeColourId = null;
        return renderPaintColourView();
      }}
      const ready = evaluateReadiness(c.requiredPaintIds);
      const modelsUsing = MAPS.modelsUsingColour.get(c.id) || [];

      const tiers = [
        {{ key: 'base', label: '1. Base Finish (Battle Ready)', ids: c.basePaintIds || [] }},
        {{ key: 'detail', label: '2. Detail Finish (Shade & Layer)', ids: c.detailPaintIds || [] }},
        {{ key: 'artificer', label: '3. Artificer Finish (Edge Highlights)', ids: c.artificerPaintIds || [] }},
      ];

      return `
        <div class="flex flex-col gap-5">
          <div class="flex flex-wrap justify-between items-center gap-2 font-sans-ui text-xs">
            <button onclick="UI.activeColourId=null; renderApp()" class="px-3 py-1.5 rounded-lg bg-[#191c22] border border-white/10 text-[#b4b9c4] hover:text-white">
              ← Back to Paint A Colour
            </button>
            <div class="flex gap-2">
              ${{ready.missingCount > 0 ? `
                <button onclick="addManyToWishlist(${{JSON.stringify(ready.missingPaintIds).replace(/"/g, '&quot;')}})"
                  class="px-3.5 py-1.5 rounded-lg gold-grad font-bold">
                  ★ Add ${{ready.missingCount}} Missing Paints to Wishlist
                </button>
              ` : ''}}
              <button onclick="addColourToProjectPrompt('${{c.id}}')" class="px-3.5 py-1.5 rounded-lg bg-[#191c22] border border-white/15 text-white font-semibold">
                + Add Colour to Project
              </button>
            </div>
          </div>

          <div class="studio-card p-5 flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              <span class="w-16 h-16 swatch-circle" style="background:${{c.hex}}"></span>
              <div>
                <span class="px-2.5 py-0.5 rounded-full bg-[#edb304]/20 text-[#fbba00] font-sans-ui text-xs font-bold">
                  ${{c.guideType === 'basing' ? 'Miniature Basing Guide' : escapeHtml(c.colourGroups.join(' • '))}}
                </span>
                <h1 class="font-display text-3xl text-white mt-1">${{escapeHtml(c.name)}}</h1>
                <span class="font-mono text-xs text-[#b4b9c4]">${{c.hex}}</span>
              </div>
            </div>
            <div class="bg-[#15181e] p-3.5 rounded-lg border border-white/10 font-sans-ui text-xs min-w-[240px]">
              <div class="flex justify-between mb-1">
                <strong>Readiness: ${{ready.matchPercent}}%</strong>
                <span class="text-[#29c26a] font-bold">${{ready.ownedDirectCount + ready.substitutedCount}}/${{ready.totalRequired}} Paints</span>
              </div>
              <div class="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div class="h-full ${{ready.matchPercent===100?'bg-[#29c26a]':'bg-[#fbba00]'}}" style="width:${{ready.matchPercent}}%"></div>
              </div>
            </div>
          </div>

          <!-- Progressive Stage Tiers -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 font-sans-ui">
            ${{tiers.map(t => `
              <div class="studio-card p-4 flex flex-col gap-3">
                <h3 class="font-display text-lg text-[#fbba00] border-b border-white/10 pb-2">${{t.label}}</h3>
                <div class="flex flex-col gap-2">
                  ${{t.ids.map((pid, idx) => {{
                    const p = MAPS.paintById.get(pid);
                    if (!p) return '';
                    const sub = ready.substitutedByPaintId[pid];
                    const subtitle = sub ? `⇄ ${{sub.substituteName}}` : `Step ${{idx + 1}} • ${{p.category}}`;
                    return renderPaintPillRow(p.id, p.name, subtitle, p.gradientStartHex);
                  }}).join('')}}
                </div>
              </div>
            `).join('')}}
          </div>

          <!-- Models Using This Colour -->
          ${{modelsUsing.length > 0 ? `
            <div class="studio-card p-5 flex flex-col gap-3">
              <h2 class="font-display text-xl text-[#fbba00]">Models Using "${{escapeHtml(c.name)}}" (${{modelsUsing.length}})</h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-sans-ui">
                ${{modelsUsing.slice(0, 16).map(m => `
                  <div onclick="UI.mainTab='models'; UI.activeModelId='${{m.id}}'; renderApp()"
                    class="p-3 rounded-lg bg-[#15181e] border border-white/10 hover:border-[#fbba00] cursor-pointer">
                    <div class="text-xs font-bold text-white">${{escapeHtml(m.name)}}</div>
                    <div class="text-xs text-[#b4b9c4] mt-0.5">${{escapeHtml(m.gameNames[0] || '')}}</div>
                  </div>
                `).join('')}}
              </div>
            </div>
          ` : ''}}
        </div>
      `;
    }}

    function addColourToProjectPrompt(colourId) {{
      if (USER_STATE.projects.length === 0) {{
        createNewProjectPrompt();
        if (USER_STATE.projects[0]) {{
          USER_STATE.projects[0].colourIds.push(colourId);
          saveUserState();
        }}
        return;
      }}
      const names = USER_STATE.projects.map((p, idx) => `${{idx + 1}}. ${{p.name}}`).join('\\n');
      const choice = prompt(`Select Project number to add this Colour Guide to:\\n${{names}}`, '1');
      const idx = parseInt(choice || '1', 10) - 1;
      const target = USER_STATE.projects[idx];
      if (target) {{
        if (!target.colourIds.includes(colourId)) target.colourIds.push(colourId);
        saveUserState();
        showToast(`Added colour guide to "${{target.name}}"`);
      }}
    }}

    // =========================================================================
    // TAB 4: GLOBAL SEARCH
    // =========================================================================
    function renderGlobalSearchView() {{
      const q = UI.globalSearch.trim().toLowerCase();
      const matchedPaints = q
        ? getUnifiedPaints().filter(p => `${{p.name}} ${{p.brand}} ${{p.category}}`.toLowerCase().includes(q))
        : getUnifiedPaints().slice(0, 12);
      const matchedColours = q
        ? CATALOG.colours.filter(c => c.name.toLowerCase().includes(q) || c.colourGroups.some(g => g.toLowerCase().includes(q)))
        : CATALOG.colours.slice(0, 12);
      const matchedModels = q
        ? CATALOG.models.filter(m => m.name.toLowerCase().includes(q) || m.factionNames.some(f => f.toLowerCase().includes(q)))
        : CATALOG.models.slice(0, 12);

      return `
        <div class="flex flex-col gap-5 font-sans-ui">
          <div class="studio-card p-5 flex flex-col gap-3">
            <h1 class="font-display text-3xl text-[#fbba00]">Global Search</h1>
            <input type="text" placeholder="Search across 4,531 Models, 596 Colours, 487 Citadel Paints, and 145 3rd-Party Paints..."
              value="${{escapeHtml(UI.globalSearch)}}"
              oninput="UI.globalSearch=this.value; renderApp()"
              class="w-full bg-[#15181e] border border-white/20 rounded-lg px-4 py-3 text-sm text-white" />
          </div>

          <div>
            <h2 class="font-display text-xl text-[#fbba00] mb-2.5">Paints (${{matchedPaints.length}})</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              ${{matchedPaints.slice(0, 18).map(p => renderPaintPillRow(p.id, p.name, `${{p.rangeLabel}} • ${{p.category}}`, p.hex)).join('')}}
            </div>
          </div>

          <div>
            <h2 class="font-display text-xl text-[#fbba00] mb-2.5">Colour Guides (${{matchedColours.length}})</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              ${{matchedColours.slice(0, 12).map(c => `
                <div onclick="UI.mainTab='colours'; UI.activeColourId='${{c.id}}'; renderApp()"
                  class="studio-card studio-card-hover p-3.5 flex items-center gap-3 cursor-pointer">
                  <span class="w-8 h-8 swatch-circle" style="background:${{c.hex}}"></span>
                  <div>
                    <div class="text-xs font-bold text-white">${{escapeHtml(c.name)}}</div>
                    <div class="text-xs text-[#b4b9c4]">${{escapeHtml(c.colourGroups.join(', '))}}</div>
                  </div>
                </div>
              `).join('')}}
            </div>
          </div>

          <div>
            <h2 class="font-display text-xl text-[#fbba00] mb-2.5">Model Guides (${{matchedModels.length}})</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              ${{matchedModels.slice(0, 16).map(m => `
                <div onclick="UI.mainTab='models'; UI.activeModelId='${{m.id}}'; renderApp()"
                  class="studio-card studio-card-hover p-3.5 cursor-pointer">
                  <div class="text-xs font-bold text-white">${{escapeHtml(m.name)}}</div>
                  <div class="text-xs text-[#b4b9c4] mt-1">${{escapeHtml(m.factionNames.join(' • ') || m.gameNames[0] || '')}}</div>
                </div>
              `).join('')}}
            </div>
          </div>
        </div>
      `;
    }}

    // =========================================================================
    // GLOBAL PAINT DETAIL MODAL (TONE PRO 1-5 PENTAD + CROSS-BRAND EQUIVALENTS)
    // =========================================================================
    function renderModalPortal() {{
      const portal = document.getElementById('modal-root');
      if (!portal) return;
      const pid = UI.activePaintModalId;
      if (!pid) {{
        portal.innerHTML = '';
        return;
      }}

      const cp = MAPS.paintById.get(pid);
      const tp = MAPS.tpById.get(pid) || (USER_STATE.customPaints || []).find(x => x.id === pid);
      if (!cp && !tp) {{
        portal.innerHTML = '';
        return;
      }}

      const name = cp ? cp.name : tp.name;
      const hex = cp ? cp.gradientStartHex : tp.hex;
      const badge = cp ? (cp.range === 'warhammer_pro' ? 'Citadel Tone Pro' : 'Citadel Colour') : `${{tp.brand}} • ${{tp.range}}`;
      const category = cp ? cp.category : tp.category;
      const pentad = (cp && cp.warhammerProRange) ? cp.warhammerProRange : [];
      const tpEquivs = cp ? (CATALOG.citadelToThirdParty[cp.id] || []) : [];
      const proEquivs = cp ? (MAPS.classicToPro.get(cp.id) || []) : [];
      const classicEquivs = cp ? (MAPS.proToClassic.get(cp.id) || []) : [];
      const coloursUsing = cp ? (MAPS.coloursUsingPaint.get(cp.id) || []) : [];
      const modelsUsing = cp ? (MAPS.modelsUsingPaint.get(cp.id) || []) : [];

      portal.innerHTML = `
        <div onclick="UI.activePaintModalId=null; renderApp()" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 flex items-center justify-center p-4">
          <div onclick="event.stopPropagation()" class="bg-[#191c22] border border-white/20 rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl font-sans-ui">
            <!-- Header -->
            <div class="p-5 bg-[#0d0e11] border-b border-white/10 flex items-center justify-between gap-4">
              <div class="flex items-center gap-4">
                <span class="w-14 h-14 swatch-circle" style="background:${{hex}}"></span>
                <div>
                  <div class="flex flex-wrap gap-1.5 text-xs mb-1">
                    <span class="px-2.5 py-0.5 rounded-full bg-[#edb304]/20 text-[#fbba00] font-bold">${{escapeHtml(badge)}}</span>
                    <span class="px-2.5 py-0.5 rounded-full bg-white/10 text-[#b4b9c4]">${{escapeHtml(category)}}</span>
                    <span class="px-2 py-0.5 rounded bg-white/5 text-[#7b8292] font-mono">${{hex}}</span>
                  </div>
                  <h2 class="font-display text-2xl text-white">${{escapeHtml(name)}}</h2>
                </div>
              </div>
              <button onclick="UI.activePaintModalId=null; renderApp()" class="w-8 h-8 rounded-full bg-white/10 text-white">✕</button>
            </div>

            <!-- Action Bar -->
            <div class="px-5 py-3 bg-[#15181e] border-b border-white/10 flex gap-3 text-xs font-bold">
              <button onclick="toggleInventory('${{pid}}')" class="px-4 py-2 rounded-lg ${{isOwned(pid) ? 'bg-[#29c26a]/20 text-[#29c26a] border border-[#29c26a]/40' : 'bg-[#1f232b] text-white border border-white/15'}}">
                ${{isOwned(pid) ? '✓ In Inventory' : '+ Add to Inventory'}}
              </button>
              <button onclick="toggleWishlist('${{pid}}')" class="px-4 py-2 rounded-lg ${{isWishlisted(pid) ? 'bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/40' : 'bg-[#1f232b] text-white border border-white/15'}}">
                ${{isWishlisted(pid) ? '★ On Wishlist' : '☆ Add to Wishlist'}}
              </button>
            </div>

            <!-- Body -->
            <div class="p-5 overflow-y-auto flex flex-col gap-5">
              ${{pentad.length > 0 ? `
                <div>
                  <h3 class="font-display text-base text-[#fbba00] mb-2">Tone Pro 1–5 Pentad System</h3>
                  <div class="grid grid-cols-5 gap-2">
                    ${{pentad.map((st, idx) => `
                      <button onclick="UI.activePaintModalId='${{st.id}}'; renderApp()"
                        class="p-2 rounded-lg border text-center flex flex-col items-center gap-1 ${{st.id===pid ? 'border-[#fbba00] bg-[#edb304]/15' : 'border-white/10 bg-[#15181e]'}}">
                        <span class="text-xs text-[#7b8292] font-bold">${{st.position || idx + 1}}</span>
                        <span class="w-7 h-7 swatch-circle" style="background:${{st.hex}}"></span>
                        <span class="text-xs text-white font-semibold line-clamp-2">${{escapeHtml(st.name)}}</span>
                      </button>
                    `).join('')}}
                  </div>
                </div>
              ` : ''}}

              ${{(proEquivs.length > 0 || classicEquivs.length > 0) ? `
                <div>
                  <h3 class="font-display text-base text-[#fbba00] mb-2">Official Citadel Classic ↔ Tone Pro Equivalents</h3>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    ${{proEquivs.map(l => renderPaintPillRow(l.tone_pro_paint_id, l.tone_pro_paint_name, 'Citadel Tone Pro', l.tone_pro_hex)).join('')}}
                    ${{classicEquivs.map(l => {{
                      const cl = MAPS.paintById.get(l.classic_paint_id);
                      return renderPaintPillRow(l.classic_paint_id, l.classic_paint_name, 'Citadel Classic', cl ? cl.gradientStartHex : '#888');
                    }}).join('')}}
                  </div>
                </div>
              ` : ''}}

              ${{tpEquivs.length > 0 ? `
                <div>
                  <h3 class="font-display text-base text-[#fbba00] mb-2">Cross-Brand 3rd-Party Equivalents (${{tpEquivs.length}})</h3>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    ${{tpEquivs.map(eq => renderPaintPillRow(eq.thirdPartyPaintId, eq.name, `${{eq.brand}} • ΔE ${{eq.deltaE}}`, eq.hex)).join('')}}
                  </div>
                </div>
              ` : ''}}

              ${{tp && tp.citadelMatches && tp.citadelMatches.length > 0 ? `
                <div>
                  <h3 class="font-display text-base text-[#fbba00] mb-2">Equivalent Citadel Paints</h3>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    ${{tp.citadelMatches.map(cm => renderPaintPillRow(cm.citadelPaintId, cm.citadelPaintName, `${{cm.citadelCategory}} • ΔE ${{cm.deltaE}}`, cm.citadelHex)).join('')}}
                  </div>
                </div>
              ` : ''}}

              ${{coloursUsing.length > 0 ? `
                <div>
                  <h3 class="font-display text-base text-[#fbba00] mb-2">Colours Using This Paint (${{coloursUsing.length}})</h3>
                  <div class="flex flex-wrap gap-1.5">
                    ${{coloursUsing.slice(0, 18).map(c => `
                      <button onclick="UI.activePaintModalId=null; UI.mainTab='colours'; UI.activeColourId='${{c.id}}'; renderApp()"
                        class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#15181e] border border-white/10 text-xs text-white hover:border-[#fbba00]">
                        <span class="w-3 h-3 rounded-full" style="background:${{c.hex}}"></span>
                        <span>${{escapeHtml(c.name)}}</span>
                      </button>
                    `).join('')}}
                  </div>
                </div>
              ` : ''}}

              ${{modelsUsing.length > 0 ? `
                <div>
                  <h3 class="font-display text-base text-[#fbba00] mb-2">Models Using This Paint (${{modelsUsing.length}})</h3>
                  <div class="flex flex-wrap gap-1.5">
                    ${{modelsUsing.slice(0, 15).map(m => `
                      <button onclick="UI.activePaintModalId=null; UI.mainTab='models'; UI.activeModelId='${{m.id}}'; renderApp()"
                        class="px-2.5 py-1 rounded-lg bg-[#15181e] border border-white/10 text-xs text-white hover:border-[#fbba00]">
                        ${{escapeHtml(m.name)}}
                      </button>
                    `).join('')}}
                  </div>
                </div>
              ` : ''}}
            </div>
          </div>
        </div>
      `;
    }}

    // Keyboard shortcut Cmd/Ctrl + K
    window.addEventListener('keydown', (e) => {{
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {{
        e.preventDefault();
        UI.mainTab = 'search';
        renderApp();
      }}
    }});

    // Boot
    (async () => {{
      CATALOG = await decompressCatalog(COMPRESSED_CATALOG_B64);
      buildLookupMaps();
      renderApp();
    }})();
  </script>
</body>
</html>
"""
    ARTIFACT_OUT.write_text(html, encoding="utf-8")
    size_kb = ARTIFACT_OUT.stat().st_size / 1024
    print(f"[DONE] Wrote self-contained HTML artifact ({size_kb:.1f} KB) -> {ARTIFACT_OUT}")


if __name__ == "__main__":
    main()
