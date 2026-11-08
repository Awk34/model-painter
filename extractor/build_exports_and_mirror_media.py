#!/usr/bin/env python3
"""
Phase 3 & 4: High-Resolution Media Mirror & Web-App JSON/CSV Exporter
for Paint Warhammer / Citadel Colour (com.gamesworkshop.citadelpaint).
"""

import csv
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE_DIR = Path("/home/antigravity/warhammer_extractor")
RAW_DIR = BASE_DIR / "data" / "raw"
EXPORT_DIR = BASE_DIR / "data" / "export"
JSON_DIR = EXPORT_DIR / "json"
CSV_DIR = EXPORT_DIR / "csv"
ASSETS_DIR = EXPORT_DIR / "assets" / "images"

STAGE_LABELS = {
    "base": "Basic",
    "detail": "Battle Ready",
    "artificer": "Parade Ready",
}


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    tmp.replace(path)


def hex_to_rgb(hex_str):
    if not hex_str or not isinstance(hex_str, str):
        return None
    h = hex_str.strip().lstrip("#")
    if len(h) == 6:
        try:
            return {
                "r": int(h[0:2], 16),
                "g": int(h[2:4], 16),
                "b": int(h[4:6], 16),
            }
        except ValueError:
            return None
    return None


def url_to_rel_path(url: str, category: str) -> str:
    if not url or not isinstance(url, str):
        return None
    parsed = urllib.parse.urlparse(url)
    basename = os.path.basename(parsed.path)
    # Clean any weird prefixes like "undefined" while keeping uniqueness via short hash if needed
    ext = os.path.splitext(basename)[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"):
        ext = ".jpg"
    stem = os.path.splitext(basename)[0]
    stem = re.sub(r"[^a-zA-Z0-9_-]", "_", stem)
    if not stem or len(stem) < 8:
        stem = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    return f"assets/images/{category}/{stem}{ext}"


def main():
    t0 = time.time()
    for d in [JSON_DIR, CSV_DIR, ASSETS_DIR]:
        d.mkdir(parents=True, exist_ok=True)

    print("=== Loading Raw API Data ===", flush=True)
    games_raw = load_json(RAW_DIR / "games.json")
    factions_raw = load_json(RAW_DIR / "factions.json")
    colour_groups_raw = load_json(RAW_DIR / "colour_groups.json")
    colour_group_mappings = load_json(RAW_DIR / "colour_group_mappings.json")
    paints_list = load_json(RAW_DIR / "paints_list.json")
    compat_list = load_json(RAW_DIR / "paints_compatibility_list.json")
    colours_list = load_json(RAW_DIR / "colours_list.json")
    colours_basing = load_json(RAW_DIR / "colours_basing.json")
    user_inventory = load_json(RAW_DIR / "user_inventory.json")
    user_wishlist = load_json(RAW_DIR / "user_wishlist.json")
    user_projects = load_json(RAW_DIR / "user_projects_detailed.json")
    game_recipes_map = load_json(RAW_DIR / "game_recipes_map.json")
    faction_recipes_map = load_json(RAW_DIR / "faction_recipes_map.json")

    # Track all media URLs -> relative local path
    url_to_local = {}

    def register_media(url: str, category: str):
        if not url or not isinstance(url, str) or not url.startswith("http"):
            return None
        if url not in url_to_local:
            url_to_local[url] = url_to_rel_path(url, category)
        return url_to_local[url]

    # 1. Process Paints & Compatibility
    print("=== Processing Paints & Compatibility ===", flush=True)
    paint_compat_by_id = {}
    for cp in compat_list:
        pid = cp["id"]
        c_file = RAW_DIR / "paint_compatibles" / f"{pid}.json"
        if c_file.exists():
            paint_compat_by_id[pid] = load_json(c_file)
        else:
            paint_compat_by_id[pid] = []

    paints_by_id = {}
    paints_export = []
    paint_compat_rows = []

    for p_summary in paints_list:
        pid = p_summary["id"]
        det_file = RAW_DIR / "paint_details" / f"{pid}.json"
        p = load_json(det_file) if det_file.exists() else dict(p_summary)

        img_url = p.get("imageUrl")
        local_img = register_media(img_url, "paints")
        rgb = hex_to_rgb(p.get("gradientStartHex"))

        pro_range = p.get("warhammerProRange")
        if pro_range and isinstance(pro_range, dict):
            for rp in pro_range.get("paints") or []:
                rp["localImagePath"] = register_media(rp.get("imageUrl"), "paints")

        compat_paints = paint_compat_by_id.get(pid, [])
        compat_enriched = []
        for tcp in compat_paints:
            tcp_local = register_media(tcp.get("imageUrl"), "paints")
            compat_enriched.append({
                "id": tcp["id"],
                "name": tcp["name"],
                "category": tcp.get("category"),
                "range": tcp.get("range"),
                "gradientStartHex": tcp.get("gradientStartHex"),
                "imageUrl": tcp.get("imageUrl"),
                "localImagePath": tcp_local,
            })
            paint_compat_rows.append({
                "classic_paint_id": pid,
                "classic_paint_name": p["name"],
                "classic_category": p.get("category"),
                "tone_pro_paint_id": tcp["id"],
                "tone_pro_paint_name": tcp["name"],
                "tone_pro_hex": tcp.get("gradientStartHex"),
            })

        paint_obj = {
            "id": pid,
            "name": p["name"],
            "range": p.get("range"),
            "category": p.get("category"),
            "potStyle": p.get("potStyle"),
            "gradientStartHex": p.get("gradientStartHex"),
            "gradientMiddleHex": p.get("gradientMiddleHex"),
            "gradientEndHex": p.get("gradientEndHex"),
            "rgb": rgb,
            "isInInventory": bool(p.get("isInInventory", False)),
            "isInWishlist": bool(p.get("isInWishlist", False)),
            "imageUrl": img_url,
            "localImagePath": local_img,
            "warhammerProRange": pro_range,
            "compatibleToneProPaints": compat_enriched,
        }
        paints_by_id[pid] = paint_obj
        paints_export.append(paint_obj)

    paints_export.sort(key=lambda x: (x["range"] or "", x["category"] or "", x["name"] or ""))

    # 2. Process Standalone Colours & Basing Guides
    print("=== Processing Standalone Colours & Basing Guides ===", flush=True)
    basing_ids = {c["id"] for c in colours_basing}
    colour_to_groups = {}
    for cg_id, cg_info in colour_group_mappings.items():
        for cid in cg_info.get("colourIds") or []:
            colour_to_groups.setdefault(cid, []).append({
                "id": cg_id,
                "name": cg_info["name"],
                "hex": cg_info.get("hex"),
            })

    colours_by_id = {c["id"]: c for c in colours_list}
    # Include any extra colour_details files fetched during step 6b
    for c_file in sorted((RAW_DIR / "colour_details").glob("*.json")):
        cid = c_file.stem
        if cid not in colours_by_id:
            cd = load_json(c_file)
            colours_by_id[cid] = {
                "id": cid,
                "name": cd.get("name"),
                "hex": cd.get("hex"),
                "range": "warhammer_colour",
                "imageUrl": cd.get("headerImage"),
            }

    colours_export = []
    colour_stages_rows = []

    for cid, c_sum in colours_by_id.items():
        det_file = RAW_DIR / "colour_details" / f"{cid}.json"
        c_det = load_json(det_file) if det_file.exists() else {}

        img_url = c_sum.get("imageUrl")
        local_img = register_media(img_url, "colours")
        header_url = c_det.get("headerImage") or img_url
        local_header = register_media(header_url, "colours")

        gallery_urls = c_det.get("galleryImages") or []
        local_gallery = [register_media(u, "colours") for u in gallery_urls if u]

        guide_type = "basing" if cid in basing_ids else "miniature"
        groups = colour_to_groups.get(cid, [])

        finishes_export = {}
        stage_paint_names = {"base": [], "detail": [], "artificer": []}

        for finish_key, stage_code in [
            ("baseFinish", "base"),
            ("detailFinish", "detail"),
            ("artificerFinish", "artificer"),
        ]:
            f_obj = c_det.get(finish_key)
            if not f_obj:
                finishes_export[finish_key] = None
                continue
            bp_url = f_obj.get("backpackImage")
            local_bp = register_media(bp_url, "colours")
            stages_out = []
            for idx, st in enumerate(f_obj.get("stages") or [], start=1):
                st_paint = st.get("paint") or {}
                st_pid = st_paint.get("id")
                full_paint = paints_by_id.get(st_pid, st_paint)
                p_img = full_paint.get("imageUrl") or st_paint.get("imageUrl")
                p_local = register_media(p_img, "paints")
                if st_paint.get("name"):
                    stage_paint_names[stage_code].append(st_paint["name"])
                stages_out.append({
                    "id": st.get("id"),
                    "stepOrder": idx,
                    "technique": st.get("technique"),
                    "paint": {
                        "id": st_pid,
                        "name": st_paint.get("name"),
                        "category": st_paint.get("category"),
                        "range": st_paint.get("range"),
                        "potStyle": st_paint.get("potStyle"),
                        "gradientStartHex": st_paint.get("gradientStartHex"),
                        "gradientMiddleHex": st_paint.get("gradientMiddleHex"),
                        "gradientEndHex": st_paint.get("gradientEndHex"),
                        "isInInventory": bool(st_paint.get("isInInventory", False)),
                        "isInWishlist": bool(st_paint.get("isInWishlist", False)),
                        "imageUrl": p_img,
                        "localImagePath": p_local,
                    },
                })
                colour_stages_rows.append({
                    "colour_id": cid,
                    "colour_name": c_det.get("name") or c_sum.get("name"),
                    "guide_type": guide_type,
                    "finish_stage": stage_code,
                    "quality_tier_label": STAGE_LABELS[stage_code],
                    "step_order": idx,
                    "stage_id": st.get("id"),
                    "technique": st.get("technique"),
                    "paint_id": st_pid,
                    "paint_name": st_paint.get("name"),
                    "paint_category": st_paint.get("category"),
                    "paint_hex": st_paint.get("gradientStartHex"),
                    "finish_backpack_image_url": bp_url,
                    "local_backpack_image_path": local_bp,
                })
            finishes_export[finish_key] = {
                "backpackImage": bp_url,
                "localBackpackImagePath": local_bp,
                "stages": stages_out,
            }

        colours_export.append({
            "id": cid,
            "name": c_det.get("name") or c_sum.get("name"),
            "hex": c_det.get("hex") or c_sum.get("hex"),
            "rgb": hex_to_rgb(c_det.get("hex") or c_sum.get("hex")),
            "range": c_sum.get("range"),
            "guideType": guide_type,
            "colourGroups": groups,
            "imageUrl": img_url,
            "localImagePath": local_img,
            "headerImage": header_url,
            "localHeaderImagePath": local_header,
            "galleryImages": gallery_urls,
            "localGalleryImagePaths": local_gallery,
            "baseFinish": finishes_export["baseFinish"],
            "detailFinish": finishes_export["detailFinish"],
            "artificerFinish": finishes_export["artificerFinish"],
            "_stagePaintNames": stage_paint_names,
        })

    colours_export.sort(key=lambda x: (x["guideType"], x["name"] or ""))

    # 3. Process Games & Factions
    print("=== Processing Games & Factions ===", flush=True)
    recipe_to_games = {}
    for gid, ginfo in game_recipes_map.items():
        for rid in ginfo.get("recipeIds") or []:
            recipe_to_games.setdefault(rid, []).append({
                "id": gid,
                "name": ginfo["gameName"],
            })

    recipe_to_factions = {}
    faction_recipe_lookup = {}
    for fm in faction_recipes_map:
        key = (fm["gameId"], fm["factionId"])
        faction_recipe_lookup[key] = fm.get("recipeIds") or []
        # Only attach leaf faction or unparented top faction to recipe_to_factions to avoid duplicate parent/child entries when child exists
        for rid in fm.get("recipeIds") or []:
            recipe_to_factions.setdefault(rid, []).append({
                "gameId": fm["gameId"],
                "gameName": fm["gameName"],
                "parentFactionId": fm["parentFactionId"],
                "parentFactionName": fm["parentFactionName"],
                "factionId": fm["factionId"],
                "factionName": fm["factionName"],
            })

    games_export = []
    games_factions_rows = []
    factions_by_game_id = {f["id"]: f for f in factions_raw}

    for g in games_raw:
        gid = g["id"]
        g_img = g.get("imageUrl")
        g_local = register_media(g_img, "games")
        g_rids = game_recipes_map.get(gid, {}).get("recipeIds") or []

        f_tree = factions_by_game_id.get(gid, {}).get("childFactions") or []
        factions_out = []
        for top_f in f_tree:
            tf_id = top_f["id"]
            tf_icon = top_f.get("iconUrl")
            tf_local = register_media(tf_icon, "factions")
            tf_rids = faction_recipe_lookup.get((gid, tf_id), [])
            children_out = []
            for ch_f in top_f.get("childFactions") or []:
                cf_id = ch_f["id"]
                cf_icon = ch_f.get("iconUrl")
                cf_local = register_media(cf_icon, "factions")
                cf_rids = faction_recipe_lookup.get((gid, cf_id), [])
                children_out.append({
                    "id": cf_id,
                    "name": ch_f["name"],
                    "iconUrl": cf_icon,
                    "localIconPath": cf_local,
                    "recipeCount": len(cf_rids),
                    "recipeIds": cf_rids,
                })
                games_factions_rows.append({
                    "game_id": gid,
                    "game_name": g["name"],
                    "parent_faction_id": tf_id,
                    "parent_faction_name": top_f["name"],
                    "faction_id": cf_id,
                    "faction_name": ch_f["name"],
                    "recipe_count": len(cf_rids),
                    "icon_url": cf_icon,
                    "local_icon_path": cf_local,
                })
            if not children_out:
                games_factions_rows.append({
                    "game_id": gid,
                    "game_name": g["name"],
                    "parent_faction_id": None,
                    "parent_faction_name": None,
                    "faction_id": tf_id,
                    "faction_name": top_f["name"],
                    "recipe_count": len(tf_rids),
                    "icon_url": tf_icon,
                    "local_icon_path": tf_local,
                })
            factions_out.append({
                "id": tf_id,
                "name": top_f["name"],
                "iconUrl": tf_icon,
                "localIconPath": tf_local,
                "recipeCount": len(tf_rids),
                "recipeIds": tf_rids,
                "childFactions": children_out,
            })

        games_export.append({
            "id": gid,
            "name": g["name"],
            "imageUrl": g_img,
            "localImagePath": g_local,
            "recipeCount": len(g_rids),
            "recipeIds": g_rids,
            "factions": factions_out,
        })

    # 4. Process Full Miniature Recipes
    print("=== Processing Miniature Progressive Recipes ===", flush=True)
    recipes_export = []
    model_rows = []
    model_area_steps_rows = []
    model_colour_points_rows = []

    recipe_files = sorted((RAW_DIR / "recipes").glob("*.json"))
    for r_file in recipe_files:
        r = load_json(r_file)
        rid = r["id"]
        r_name = r.get("name")
        r_range = r.get("range")

        imgs = r.get("images") or []
        local_imgs = [register_media(u, "models") for u in imgs if u]

        r_games = recipe_to_games.get(rid, [])
        r_factions_all = recipe_to_factions.get(rid, [])
        # Prefer child faction rows when both parent & child matched, or keep all unique
        parent_ids_with_children = {
            f["parentFactionId"] for f in r_factions_all if f.get("parentFactionId")
        }
        r_factions = [
            f for f in r_factions_all
            if f["factionId"] not in parent_ids_with_children
        ]

        # Colour Points
        cp_out = []
        for cp in r.get("colourPoints") or []:
            cp_img = cp.get("imageUrl")
            cp_local = register_media(cp_img, "colours")
            pt = cp.get("point") or {}
            cp_out.append({
                "id": cp.get("id"),
                "name": cp.get("name"),
                "colourId": cp.get("colourId"),
                "hex": cp.get("hex"),
                "point": pt,
                "imageUrl": cp_img,
                "localImagePath": cp_local,
            })
            model_colour_points_rows.append({
                "recipe_id": rid,
                "model_name": r_name,
                "point_id": cp.get("id"),
                "point_name": cp.get("name"),
                "colour_id": cp.get("colourId"),
                "hex": cp.get("hex"),
                "x": pt.get("x"),
                "y": pt.get("y"),
                "remote_image_url": cp_img,
                "local_image_path": cp_local,
            })

        # Painting Areas & Steps
        areas_out = []
        total_steps = 0
        for area_idx, area in enumerate(r.get("paintingAreas") or [], start=1):
            a_img = area.get("imageUrl")
            a_local = register_media(a_img, "recipe_steps")
            steps_out = []
            for step_idx, st in enumerate(area.get("paintingSteps") or [], start=1):
                total_steps += 1
                s_img = st.get("imageUrl")
                s_local = register_media(s_img, "recipe_steps")
                st_stage = st.get("paintingStage")
                tier_label = STAGE_LABELS.get(st_stage, st_stage)
                st_paint = st.get("paint") or {}
                st_pid = st_paint.get("id")
                full_p = paints_by_id.get(st_pid, st_paint)
                p_img = full_p.get("imageUrl") or st_paint.get("imageUrl")
                p_local = register_media(p_img, "paints")

                steps_out.append({
                    "id": st.get("id"),
                    "stepOrder": step_idx,
                    "stepNumber": st.get("stepNumber"),
                    "title": st.get("title"),
                    "paintingStage": st_stage,
                    "qualityTierLabel": tier_label,
                    "techniqueName": st.get("techniqueName"),
                    "brushName": st.get("brushName"),
                    "text": st.get("text"),
                    "imageUrl": s_img,
                    "localImagePath": s_local,
                    "paint": {
                        "id": st_pid,
                        "name": st_paint.get("name"),
                        "category": st_paint.get("category"),
                        "range": st_paint.get("range"),
                        "potStyle": st_paint.get("potStyle"),
                        "gradientStartHex": st_paint.get("gradientStartHex"),
                        "gradientMiddleHex": st_paint.get("gradientMiddleHex"),
                        "gradientEndHex": st_paint.get("gradientEndHex"),
                        "isInInventory": bool(st_paint.get("isInInventory", False)),
                        "isInWishlist": bool(st_paint.get("isInWishlist", False)),
                        "imageUrl": p_img,
                        "localImagePath": p_local,
                    } if st_pid else None,
                })

                model_area_steps_rows.append({
                    "recipe_id": rid,
                    "model_name": r_name,
                    "range": r_range,
                    "area_order": area_idx,
                    "area_id": area.get("id"),
                    "area_name": area.get("name"),
                    "subsection_name": area.get("subsectionName"),
                    "step_order": step_idx,
                    "step_id": st.get("id"),
                    "step_number": st.get("stepNumber"),
                    "step_title": st.get("title"),
                    "painting_stage": st_stage,
                    "quality_tier_label": tier_label,
                    "technique_name": st.get("techniqueName"),
                    "brush_name": st.get("brushName"),
                    "step_text": st.get("text"),
                    "paint_id": st_pid,
                    "paint_name": st_paint.get("name"),
                    "paint_category": st_paint.get("category"),
                    "paint_range": st_paint.get("range"),
                    "paint_hex": st_paint.get("gradientStartHex"),
                    "in_inventory": bool(st_paint.get("isInInventory", False)),
                    "in_wishlist": bool(st_paint.get("isInWishlist", False)),
                    "step_image_url": s_img,
                    "local_step_image_path": s_local,
                })

            areas_out.append({
                "id": area.get("id"),
                "areaOrder": area_idx,
                "name": area.get("name"),
                "subsectionName": area.get("subsectionName"),
                "imageUrl": a_img,
                "localImagePath": a_local,
                "paintingSteps": steps_out,
            })

        recipes_export.append({
            "id": rid,
            "name": r_name,
            "range": r_range,
            "games": r_games,
            "factions": r_factions,
            "images": imgs,
            "localImagePaths": local_imgs,
            "colourPoints": cp_out,
            "paintingAreas": areas_out,
        })

        game_names = " | ".join(sorted({g["name"] for g in r_games if g.get("name")}))
        pf_names = " | ".join(sorted({f["parentFactionName"] for f in r_factions if f.get("parentFactionName")}))
        f_names = " | ".join(sorted({f["factionName"] for f in r_factions if f.get("factionName")}))

        model_rows.append({
            "recipe_id": rid,
            "name": r_name,
            "range": r_range,
            "game_names": game_names,
            "parent_faction_names": pf_names,
            "faction_names": f_names,
            "area_count": len(areas_out),
            "total_steps_count": total_steps,
            "colour_points_count": len(cp_out),
            "remote_image_url": imgs[0] if imgs else None,
            "local_image_path": local_imgs[0] if local_imgs else None,
        })

    recipes_export.sort(key=lambda x: (x["name"] or "", x["id"]))
    model_rows.sort(key=lambda x: (x["name"] or "", x["recipe_id"]))

    # 5. Process Personal Account Data (Inventory, Wishlist, Projects)
    print("=== Processing Personal Account Data ===", flush=True)
    user_projects_out = []
    user_project_rows = []
    for proj in user_projects:
        p_img = proj.get("imageUrl")
        p_local = register_media(p_img, "projects")
        p_recipes_out = []
        for pr in proj.get("recipes") or []:
            pr_imgs = pr.get("images") or []
            pr_locals = [register_media(u, "models") for u in pr_imgs if u]
            p_recipes_out.append({
                "id": pr["id"],
                "name": pr.get("name"),
                "range": pr.get("range"),
                "images": pr_imgs,
                "localImagePaths": pr_locals,
            })
            user_project_rows.append({
                "project_id": proj["id"],
                "project_name": proj.get("name"),
                "item_type": "recipe",
                "item_id": pr["id"],
                "item_name": pr.get("name"),
                "item_range": pr.get("range"),
                "remote_image_url": pr_imgs[0] if pr_imgs else None,
                "local_image_path": pr_locals[0] if pr_locals else None,
            })

        p_colours_out = []
        for pc in proj.get("colours") or []:
            pc_img = pc.get("imageUrl")
            pc_local = register_media(pc_img, "colours")
            p_colours_out.append({
                **pc,
                "localImagePath": pc_local,
            })
            user_project_rows.append({
                "project_id": proj["id"],
                "project_name": proj.get("name"),
                "item_type": "colour",
                "item_id": pc.get("id"),
                "item_name": pc.get("name"),
                "item_range": pc.get("range"),
                "remote_image_url": pc_img,
                "local_image_path": pc_local,
            })

        user_projects_out.append({
            "id": proj["id"],
            "name": proj.get("name"),
            "imageUrl": p_img,
            "localImagePath": p_local,
            "notes": proj.get("notes") or [],
            "colours": p_colours_out,
            "recipes": p_recipes_out,
        })

    inv_ids = [p["id"] for p in user_inventory]
    wish_ids = [p["id"] for p in user_wishlist]
    user_account_export = {
        "inventoryCount": len(inv_ids),
        "wishlistCount": len(wish_ids),
        "projectsCount": len(user_projects_out),
        "inventoryPaintIds": inv_ids,
        "wishlistPaintIds": wish_ids,
        "inventoryPaints": [paints_by_id.get(pid, p) for pid, p in zip(inv_ids, user_inventory)],
        "wishlistPaints": [paints_by_id.get(pid, p) for pid, p in zip(wish_ids, user_wishlist)],
        "projects": user_projects_out,
    }

    # 6. Write JSON Exports
    print("=== Writing Structured JSON Exports ===", flush=True)
    # Remove internal helper key _stagePaintNames before saving colours.json
    colours_csv_rows = []
    for c in colours_export:
        sp = c.pop("_stagePaintNames", {})
        colours_csv_rows.append({
            "colour_id": c["id"],
            "name": c["name"],
            "range": c["range"],
            "guide_type": c["guideType"],
            "hex": c["hex"],
            "colour_group_names": " | ".join(g["name"] for g in c["colourGroups"]),
            "base_paint_names": " -> ".join(sp.get("base", [])),
            "detail_paint_names": " -> ".join(sp.get("detail", [])),
            "artificer_paint_names": " -> ".join(sp.get("artificer", [])),
            "remote_image_url": c["imageUrl"],
            "local_image_path": c["localImagePath"],
            "header_image_url": c["headerImage"],
            "local_header_image_path": c["localHeaderImagePath"],
        })

    save_json(JSON_DIR / "paints.json", paints_export)
    save_json(JSON_DIR / "paint_compatibility.json", paint_compat_rows)
    save_json(JSON_DIR / "colours.json", colours_export)
    save_json(JSON_DIR / "colour_groups.json", list(colour_group_mappings.values()))
    save_json(JSON_DIR / "games.json", games_export)
    save_json(JSON_DIR / "models_recipes.json", recipes_export)
    save_json(JSON_DIR / "user_account.json", user_account_export)
    save_json(EXPORT_DIR / "asset_manifest.json", url_to_local)

    summary_stats = {
        "extractedAtUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "counts": {
            "games": len(games_export),
            "factionNodes": len(games_factions_rows),
            "paintsTotal": len(paints_export),
            "paintsWarhammerColour": sum(1 for p in paints_export if p["range"] == "warhammer_colour"),
            "paintsWarhammerPro": sum(1 for p in paints_export if p["range"] == "warhammer_pro"),
            "paintCompatibilityLinks": len(paint_compat_rows),
            "standaloneColoursTotal": len(colours_export),
            "standaloneColoursMiniature": sum(1 for c in colours_export if c["guideType"] == "miniature"),
            "standaloneColoursBasing": sum(1 for c in colours_export if c["guideType"] == "basing"),
            "colourGroups": len(colour_group_mappings),
            "miniatureRecipesTotal": len(recipes_export),
            "miniatureAreaStepsTotal": len(model_area_steps_rows),
            "miniatureColourPointsTotal": len(model_colour_points_rows),
            "userInventoryPaints": len(inv_ids),
            "userWishlistPaints": len(wish_ids),
            "userProjects": len(user_projects_out),
            "uniqueMediaAssets": len(url_to_local),
        },
    }
    save_json(JSON_DIR / "summary_stats.json", summary_stats)

    # 7. Write Flat CSV Exports
    print("=== Writing Flat Relational CSV Exports ===", flush=True)

    def write_csv(filename: str, rows: list, fieldnames: list):
        out_file = CSV_DIR / filename
        with open(out_file, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)
        print(f"  Wrote {filename} ({len(rows)} rows)", flush=True)

    paints_csv_rows = []
    user_inv_wish_rows = []
    for p in paints_export:
        rgb = p.get("rgb") or {}
        pro_range = p.get("warhammerProRange") or {}
        compat = p.get("compatibleToneProPaints") or []
        paints_csv_rows.append({
            "paint_id": p["id"],
            "name": p["name"],
            "range": p["range"],
            "category": p["category"],
            "pot_style": p["potStyle"],
            "hex_start": p["gradientStartHex"],
            "hex_middle": p["gradientMiddleHex"],
            "hex_end": p["gradientEndHex"],
            "r": rgb.get("r"),
            "g": rgb.get("g"),
            "b": rgb.get("b"),
            "in_inventory": p["isInInventory"],
            "in_wishlist": p["isInWishlist"],
            "pro_range_id": pro_range.get("id"),
            "pro_range_name": pro_range.get("name"),
            "compatible_tone_pro_ids": " | ".join(c["id"] for c in compat),
            "compatible_tone_pro_names": " | ".join(c["name"] for c in compat),
            "remote_image_url": p["imageUrl"],
            "local_image_path": p["localImagePath"],
        })
        if p["isInInventory"] or p["isInWishlist"]:
            status = "both" if (p["isInInventory"] and p["isInWishlist"]) else (
                "inventory" if p["isInInventory"] else "wishlist"
            )
            user_inv_wish_rows.append({
                "paint_id": p["id"],
                "paint_name": p["name"],
                "category": p["category"],
                "range": p["range"],
                "status": status,
                "hex_start": p["gradientStartHex"],
                "remote_image_url": p["imageUrl"],
                "local_image_path": p["localImagePath"],
            })

    write_csv("paints.csv", paints_csv_rows, list(paints_csv_rows[0].keys()) if paints_csv_rows else [])
    write_csv("paint_compatibility.csv", paint_compat_rows, list(paint_compat_rows[0].keys()) if paint_compat_rows else [])
    write_csv("colours.csv", colours_csv_rows, list(colours_csv_rows[0].keys()) if colours_csv_rows else [])
    write_csv("colour_stages.csv", colour_stages_rows, list(colour_stages_rows[0].keys()) if colour_stages_rows else [])
    write_csv("games_factions.csv", games_factions_rows, list(games_factions_rows[0].keys()) if games_factions_rows else [])
    write_csv("models.csv", model_rows, list(model_rows[0].keys()) if model_rows else [])
    write_csv("model_area_steps.csv", model_area_steps_rows, list(model_area_steps_rows[0].keys()) if model_area_steps_rows else [])
    write_csv("model_colour_points.csv", model_colour_points_rows, list(model_colour_points_rows[0].keys()) if model_colour_points_rows else [])
    write_csv("user_inventory_wishlist.csv", user_inv_wish_rows, list(user_inv_wish_rows[0].keys()) if user_inv_wish_rows else [])
    write_csv("user_projects.csv", user_project_rows, list(user_project_rows[0].keys()) if user_project_rows else [])

    # 8. Download High-Res Media Mirror
    print(f"\n=== Mirroring {len(url_to_local)} Unique High-Res Media Assets ===", flush=True)
    for sub in ["paints", "colours", "games", "factions", "models", "recipe_steps", "projects"]:
        (ASSETS_DIR / sub).mkdir(parents=True, exist_ok=True)

    def download_asset(item):
        url, rel_path = item
        dest = EXPORT_DIR / rel_path
        if dest.exists() and dest.stat().st_size > 0:
            return "cached"
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "okhttp/4.12.0"})
                with urllib.request.urlopen(req, timeout=25) as r:
                    data = r.read()
                tmp = dest.with_suffix(".tmp")
                with open(tmp, "wb") as f:
                    f.write(data)
                tmp.replace(dest)
                return "downloaded"
            except urllib.error.HTTPError as e:
                if e.code in (403, 404):
                    return f"http_{e.code}"
                time.sleep(0.5 * (attempt + 1))
            except Exception:
                time.sleep(0.5 * (attempt + 1))
        return "failed"

    items = list(url_to_local.items())
    stats = {"downloaded": 0, "cached": 0, "failed": 0}
    with ThreadPoolExecutor(max_workers=32) as pool:
        futs = [pool.submit(download_asset, it) for it in items]
        done_cnt = 0
        for fut in as_completed(futs):
            res = fut.result()
            if res in ("downloaded", "cached"):
                stats[res] += 1
            else:
                stats["failed"] += 1
            done_cnt += 1
            if done_cnt % 500 == 0 or done_cnt == len(items):
                print(
                    f"  Media mirror progress: {done_cnt}/{len(items)} "
                    f"(downloaded={stats['downloaded']}, cached={stats['cached']}, missing/404={stats['failed']})",
                    flush=True,
                )

    summary_stats["mediaMirror"] = stats
    save_json(JSON_DIR / "summary_stats.json", summary_stats)
    print(f"\n[DONE] Exports & Media Mirror completed in {time.time() - t0:.1f}s!", flush=True)


if __name__ == "__main__":
    main()
