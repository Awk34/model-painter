#!/usr/bin/env python3
"""
Generates the read-optimized catalog_meta bundles, SHA-256 manifest.json
(for 1-read Firestore cache invalidation), split per-model recipe JSONs,
split per-colour JSONs, and symlinks the 1.2 GB high-res media mirror into
the Angular app's public/ directory.
"""

import hashlib
import json
import math
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

EXPORT_DIR = Path("/home/antigravity/warhammer_extractor/data/export")
JSON_DIR = EXPORT_DIR / "json"
WEBAPP_PUBLIC = Path("/home/antigravity/warhammer_webapp/public")
DATA_OUT = WEBAPP_PUBLIC / "data"
META_OUT = DATA_OUT / "catalog_meta"
RECIPES_OUT = DATA_OUT / "recipes"
COLOURS_OUT = DATA_OUT / "colours"


def sha256_json(obj) -> str:
    raw = json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(raw).hexdigest()[:24]


def main():
    META_OUT.mkdir(parents=True, exist_ok=True)
    RECIPES_OUT.mkdir(parents=True, exist_ok=True)
    COLOURS_OUT.mkdir(parents=True, exist_ok=True)

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    manifest_bundles = {}

    print("1. Building paints_bundle.json...")
    paints = json.loads((JSON_DIR / "paints.json").read_text(encoding="utf-8"))
    compat = json.loads((JSON_DIR / "paint_compatibility.json").read_text(encoding="utf-8"))
    clean_paints = []
    for p in paints:
        cp = dict(p)
        cp.pop("isInInventory", None)
        cp.pop("isInWishlist", None)
        clean_paints.append(cp)

    paints_bundle = {
        "updatedAt": now_iso,
        "paints": clean_paints,
        "compatibility": compat,
    }
    manifest_bundles["paints_bundle"] = sha256_json(paints_bundle)
    (META_OUT / "paints_bundle.json").write_text(json.dumps(paints_bundle), encoding="utf-8")

    print("2. Building third_party_paints_bundle.json...")
    tp_data = json.loads((JSON_DIR / "third_party_paints.json").read_text(encoding="utf-8"))
    tp_bundle = {
        "updatedAt": now_iso,
        "thirdPartyPaints": tp_data["thirdPartyPaints"],
        "citadelToThirdPartyMap": tp_data["citadelToThirdPartyMap"],
    }
    manifest_bundles["third_party_paints_bundle"] = sha256_json(tp_bundle)
    (META_OUT / "third_party_paints_bundle.json").write_text(json.dumps(tp_bundle), encoding="utf-8")

    print("3. Building colours_bundle.json & split colours/{id}.json...")
    colours = json.loads((JSON_DIR / "colours.json").read_text(encoding="utf-8"))
    colour_groups = json.loads((JSON_DIR / "colour_groups.json").read_text(encoding="utf-8"))
    colour_summaries = []
    for c in colours:
        c_with_ts = dict(c)
        c_with_ts["updatedAt"] = now_iso
        (COLOURS_OUT / f"{c['id']}.json").write_text(json.dumps(c_with_ts), encoding="utf-8")

        paints_by_stage = {}
        all_paint_ids = []
        for stage_key, finish_field in (
            ("base", "baseFinish"),
            ("detail", "detailFinish"),
            ("artificer", "artificerFinish"),
        ):
            st_obj = c.get(finish_field) or {}
            s_pids = []
            for st in st_obj.get("stages") or []:
                pt = st.get("paint") or {}
                pid = pt.get("id")
                if pid:
                    s_pids.append(pid)
                    if pid not in all_paint_ids:
                        all_paint_ids.append(pid)
            paints_by_stage[stage_key] = s_pids

        colour_summaries.append({
            "id": c["id"],
            "name": c["name"],
            "range": c.get("range"),
            "hex": c.get("hex"),
            "guideType": c.get("guideType", "miniature"),
            "isBasing": c.get("guideType") == "basing",
            "colourGroups": c.get("colourGroups", []),
            "imageUrl": c.get("imageUrl"),
            "localImagePath": c.get("localImagePath"),
            "headerImage": c.get("headerImage"),
            "localHeaderImagePath": c.get("localHeaderImagePath"),
            "paintsByStage": paints_by_stage,
            "allPaintIds": all_paint_ids,
            "updatedAt": now_iso,
        })

    colours_bundle = {
        "updatedAt": now_iso,
        "colourGroups": colour_groups,
        "colours": colour_summaries,
    }
    manifest_bundles["colours_bundle"] = sha256_json(colours_bundle)
    (META_OUT / "colours_bundle.json").write_text(json.dumps(colours_bundle), encoding="utf-8")

    print("4. Building games_factions_bundle.json...")
    games = json.loads((JSON_DIR / "games.json").read_text(encoding="utf-8"))
    games_bundle = {
        "updatedAt": now_iso,
        "games": games,
    }
    manifest_bundles["games_factions_bundle"] = sha256_json(games_bundle)
    (META_OUT / "games_factions_bundle.json").write_text(json.dumps(games_bundle), encoding="utf-8")

    print("5. Building models_index_0..5.json & split recipes/{id}.json (4,531 models)...")
    models_recipes = json.loads((JSON_DIR / "models_recipes.json").read_text(encoding="utf-8"))
    model_summaries = []

    for r in models_recipes:
        r_with_ts = dict(r)
        r_with_ts["updatedAt"] = now_iso
        (RECIPES_OUT / f"{r['id']}.json").write_text(json.dumps(r_with_ts), encoding="utf-8")

        imgs = r.get("images") or []
        local_imgs = r.get("localImagePaths") or []
        primary_img = imgs[0] if imgs else None
        local_primary_img = local_imgs[0] if local_imgs else None

        c_points = r.get("colourPoints") or []
        c_ids = []
        for cp in c_points:
            cid = cp.get("colourId")
            if cid and cid not in c_ids:
                c_ids.append(cid)

        paints_by_stage = {"base": [], "detail": [], "artificer": []}
        all_pids = []
        for area in r.get("paintingAreas") or []:
            for step in area.get("paintingSteps") or []:
                pt = step.get("paint") or {}
                pid = pt.get("id")
                stg = step.get("paintingStage") or "base"
                if pid:
                    if stg in paints_by_stage and pid not in paints_by_stage[stg]:
                        paints_by_stage[stg].append(pid)
                    if pid not in all_pids:
                        all_pids.append(pid)

        faction_ids = []
        faction_names = []
        for f in r.get("factions") or []:
            fid = f.get("factionId") or f.get("id")
            fname = f.get("factionName") or f.get("name")
            pfid = f.get("parentFactionId")
            pfname = f.get("parentFactionName")
            if fid and fid not in faction_ids:
                faction_ids.append(fid)
            if pfid and pfid not in faction_ids:
                faction_ids.append(pfid)
            if fname and fname not in faction_names:
                faction_names.append(fname)
            if pfname and pfname not in faction_names:
                faction_names.append(pfname)

        model_summaries.append({
            "id": r["id"],
            "name": r["name"],
            "range": r.get("range"),
            "primaryImage": primary_img,
            "localPrimaryImage": local_primary_img,
            "gameIds": [g["id"] for g in (r.get("games") or []) if g.get("id")],
            "gameNames": [g["name"] for g in (r.get("games") or []) if g.get("name")],
            "factionIds": faction_ids,
            "factionNames": faction_names,
            "colourIds": c_ids,
            "areaCount": len(r.get("paintingAreas") or []),
            "paintsByStage": paints_by_stage,
            "allPaintIds": all_pids,
            "updatedAt": now_iso,
        })

    num_chunks = 6
    chunk_size = math.ceil(len(model_summaries) / num_chunks)
    for idx in range(num_chunks):
        chunk = model_summaries[idx * chunk_size : (idx + 1) * chunk_size]
        chunk_key = f"models_index_{idx}"
        chunk_doc = {
            "chunkIndex": idx,
            "totalChunks": num_chunks,
            "updatedAt": now_iso,
            "models": chunk,
        }
        manifest_bundles[chunk_key] = sha256_json(chunk_doc)
        (META_OUT / f"{chunk_key}.json").write_text(json.dumps(chunk_doc), encoding="utf-8")

    print("6. Writing catalog_meta/manifest.json...")
    manifest_doc = {
        "schemaVersion": 1,
        "updatedAt": now_iso,
        "totalModels": len(model_summaries),
        "totalColours": len(colour_summaries),
        "totalCitadelPaints": len(clean_paints),
        "totalThirdPartyPaints": len(tp_data["thirdPartyPaints"]),
        "bundles": manifest_bundles,
    }
    (META_OUT / "manifest.json").write_text(json.dumps(manifest_doc, indent=2), encoding="utf-8")

    shutil.copy2(JSON_DIR / "user_account.json", DATA_OUT / "user_account_snapshot.json")

    assets_link = WEBAPP_PUBLIC / "assets"
    if assets_link.is_symlink() or assets_link.exists():
        if assets_link.is_symlink():
            assets_link.unlink()
    os.symlink(str(EXPORT_DIR / "assets"), str(assets_link))

    print(f"[DONE] Prepared all catalog_meta bundles, {len(model_summaries)} split recipe files, {len(colour_summaries)} split colour files, and symlinked {assets_link}")


if __name__ == "__main__":
    main()
