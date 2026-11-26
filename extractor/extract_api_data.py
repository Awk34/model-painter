#!/usr/bin/env python3
"""
Phase 2/3 API Data Extractor for Paint Warhammer / Citadel Colour (com.gamesworkshop.citadelpaint)
Extracts:
  1. Global Catalog: Games, Factions (hierarchical), Colour Groups, Paints (487 + details),
     Compatibility mappings (128 classic -> Tone Pro), Standalone Colours (596 + details + basing/group tags),
     and Miniature Recipes (4,531+ full progressive recipes + game/faction mappings).
  2. Personal Account: Inventory paints, Wishlist paints, and User Projects (with notes, colours, recipes).
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent
DEFAULT_BASE_DIR = Path(
    os.environ.get("WARHAMMER_EXTRACTOR_DIR", str(REPO_DIR))
)

API_BASE = "https://api.apps.paint.warhammer.com"
MAX_WORKERS = 20


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Extract catalog and personal account data from the Paint Warhammer API."
        )
    )
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=DEFAULT_BASE_DIR,
        help=(
            "Base directory for data/raw output "
            "(defaults to WARHAMMER_EXTRACTOR_DIR env var or repo root)."
        ),
    )
    parser.add_argument(
        "--tokens-file",
        type=Path,
        default=None,
        help="Path to tokens.json (defaults to <base-dir>/tokens.json).",
    )
    parser.add_argument(
        "--pkce-file",
        type=Path,
        default=None,
        help="Path to pkce_state.json (defaults to <base-dir>/pkce_state.json).",
    )
    return parser


class WarhammerApiClient:
    def __init__(self, tokens_file: Path, pkce_file: Path):
        self.tokens_file = tokens_file
        self.pkce_file = pkce_file
        with open(self.tokens_file, "r", encoding="utf-8") as f:
            self.tokens = json.load(f)
        self.access_token = self.tokens["access_token"]

    def refresh_access_token(self):
        with open(self.pkce_file, "r", encoding="utf-8") as f:
            pkce = json.load(f)
        payload = json.dumps({
            "grant_type": "refresh_token",
            "client_id": pkce["client_id"],
            "refresh_token": self.tokens["refresh_token"],
        }).encode("utf-8")
        req = urllib.request.Request(
            f"https://{pkce['domain']}/oauth/token",
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": "okhttp/4.12.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            new_tokens = json.loads(r.read().decode("utf-8"))
        self.tokens.update(new_tokens)
        self.access_token = self.tokens["access_token"]
        with open(self.tokens_file, "w", encoding="utf-8") as f:
            json.dump(self.tokens, f, indent=2)
        print("[AUTH] Refreshed access_token successfully.", flush=True)

    def request(self, method: str, path: str, body=None, retries: int = 4):
        url = f"{API_BASE}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        for attempt in range(retries):
            headers = {
                "Authorization": f"Bearer {self.access_token}",
                "Accept": "application/json",
                "User-Agent": "Ktor client",
            }
            if data is not None:
                headers["Content-Type"] = "application/json"
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=25) as r:
                    raw = r.read().decode("utf-8")
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as e:
                if e.code == 401 and attempt == 0:
                    try:
                        self.refresh_access_token()
                        continue
                    except Exception as re:
                        print(f"[WARN] Token refresh failed: {re}", flush=True)
                if e.code == 404:
                    return None
                if attempt < retries - 1:
                    time.sleep(0.8 * (2 ** attempt))
                else:
                    err_txt = e.read().decode("utf-8", errors="ignore")[:200]
                    raise RuntimeError(f"HTTP {e.code} on {method} {path}: {err_txt}") from e
            except Exception as e:
                if attempt < retries - 1:
                    time.sleep(0.8 * (2 ** attempt))
                else:
                    raise RuntimeError(f"Error on {method} {path}: {e}") from e


def save_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
    tmp.replace(path)


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main(argv: list[str] | None = None):
    args = build_parser().parse_args(argv)
    base_dir: Path = args.base_dir
    raw_dir = base_dir / "data" / "raw"
    tokens_file = args.tokens_file if args.tokens_file is not None else base_dir / "tokens.json"
    pkce_file = args.pkce_file if args.pkce_file is not None else base_dir / "pkce_state.json"

    t0 = time.time()
    for sub in ["paint_details", "paint_compatibles", "colour_details", "recipes", "projects"]:
        (raw_dir / sub).mkdir(parents=True, exist_ok=True)

    client = WarhammerApiClient(tokens_file=tokens_file, pkce_file=pkce_file)

    # 1. Core Index & Filter Endpoints
    print("=== Step 1: Fetching Core Indexes & Personal Lists ===", flush=True)
    games = client.request("GET", "/games?locale=en")
    save_json(raw_dir / "games.json", games)
    print(f"  Games: {len(games)}", flush=True)

    factions = client.request("GET", "/factions?locale=en")
    save_json(raw_dir / "factions.json", factions)
    print(f"  Faction Game Trees: {len(factions)}", flush=True)

    colour_groups = client.request("GET", "/colour-groups?locale=en")
    save_json(raw_dir / "colour_groups.json", colour_groups)
    print(f"  Colour Groups: {len(colour_groups)}", flush=True)

    paints = client.request("POST", "/paints?locale=en", {})
    save_json(raw_dir / "paints_list.json", paints)
    print(f"  Paints (catalog list): {len(paints)}", flush=True)

    compat_paints = client.request("POST", "/paints/compatibility?locale=en", {})
    save_json(raw_dir / "paints_compatibility_list.json", compat_paints)
    print(f"  Paints (compatibility base/layer list): {len(compat_paints)}", flush=True)

    colours = client.request("POST", "/colours?locale=en", {})
    save_json(raw_dir / "colours_list.json", colours)
    print(f"  Colours (all): {len(colours)}", flush=True)

    basing_colours = client.request("POST", "/colours?locale=en", {"guideType": "basing"})
    save_json(raw_dir / "colours_basing.json", basing_colours)
    print(f"  Colours (basing guides): {len(basing_colours)}", flush=True)

    inventory = client.request("POST", "/inventory/paints?locale=en", {})
    save_json(raw_dir / "user_inventory.json", inventory)
    print(f"  User Inventory Paints: {len(inventory)}", flush=True)

    wishlist = client.request("POST", "/wishlist/paints?locale=en", {})
    save_json(raw_dir / "user_wishlist.json", wishlist)
    print(f"  User Wishlist Paints: {len(wishlist)}", flush=True)

    projects_list = client.request("GET", "/projects?locale=en")
    save_json(raw_dir / "user_projects_list.json", projects_list)
    print(f"  User Projects: {len(projects_list)}", flush=True)

    # Fetch full details for each user project
    projects_detailed = []
    for p in projects_list:
        pid = p["id"]
        p_det = client.request("GET", f"/projects/{pid}?locale=en")
        save_json(raw_dir / "projects" / f"{pid}.json", p_det)
        projects_detailed.append(p_det)
    save_json(raw_dir / "user_projects_detailed.json", projects_detailed)
    print(f"  Fetched {len(projects_detailed)} full user project records.", flush=True)

    # 2. Colour Group -> Colour IDs mapping
    print("\n=== Step 2: Mapping Colour Groups to Colours ===", flush=True)
    colour_group_mappings = {}
    for cg in colour_groups:
        cg_id = cg["id"]
        cg_res = client.request("POST", "/colours?locale=en", {"colourGroups": [cg_id]})
        colour_group_mappings[cg_id] = {
            "id": cg_id,
            "name": cg["name"],
            "hex": cg.get("hex"),
            "colourIds": [c["id"] for c in (cg_res or [])],
        }
    save_json(raw_dir / "colour_group_mappings.json", colour_group_mappings)
    print(f"  Mapped {len(colour_group_mappings)} colour groups.", flush=True)

    # 3. Game & Faction -> Recipe IDs mapping
    print("\n=== Step 3: Mapping Games & Factions to Recipes ===", flush=True)
    game_recipes_map = {}
    all_recipe_summaries = {}

    for g in games:
        gid = g["id"]
        g_recipes = client.request("POST", f"/games/{gid}/recipes?locale=en", {}) or []
        game_recipes_map[gid] = {
            "gameId": gid,
            "gameName": g["name"],
            "imageUrl": g.get("imageUrl"),
            "recipeIds": [r["id"] for r in g_recipes],
        }
        for r in g_recipes:
            all_recipe_summaries[r["id"]] = r
        print(f"  Game '{g['name']}': {len(g_recipes)} recipes", flush=True)

    # Also include any recipe IDs referenced in user projects
    for p_det in projects_detailed:
        for r in p_det.get("recipes") or []:
            if r["id"] not in all_recipe_summaries:
                all_recipe_summaries[r["id"]] = r

    save_json(raw_dir / "game_recipes_map.json", game_recipes_map)

    # Flatten all faction queries (gameId, parentFaction, leafFaction)
    faction_queries = []
    for game_node in factions:
        gid = game_node["id"]
        gname = game_node["name"]
        for top_f in game_node.get("childFactions") or []:
            children = top_f.get("childFactions") or []
            if children:
                # Query both top_f and its leaf children
                faction_queries.append((gid, gname, None, None, top_f["id"], top_f["name"], top_f.get("iconUrl")))
                for child_f in children:
                    faction_queries.append((
                        gid,
                        gname,
                        top_f["id"],
                        top_f["name"],
                        child_f["id"],
                        child_f["name"],
                        child_f.get("iconUrl"),
                    ))
            else:
                faction_queries.append((gid, gname, None, None, top_f["id"], top_f["name"], top_f.get("iconUrl")))

    print(f"  Querying recipe lists for {len(faction_queries)} faction nodes...", flush=True)
    faction_recipes_map = []

    def fetch_faction_recipes(fq):
        gid, gname, pf_id, pf_name, fid, fname, ficon = fq
        res = client.request("POST", f"/games/{gid}/recipes?locale=en", {"factions": [fid]}) or []
        return {
            "gameId": gid,
            "gameName": gname,
            "parentFactionId": pf_id,
            "parentFactionName": pf_name,
            "factionId": fid,
            "factionName": fname,
            "iconUrl": ficon,
            "recipeIds": [r["id"] for r in res],
            "recipes": res,
        }

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futs = [pool.submit(fetch_faction_recipes, fq) for fq in faction_queries]
        for fut in as_completed(futs):
            item = fut.result()
            for r in item.pop("recipes", []):
                if r["id"] not in all_recipe_summaries:
                    all_recipe_summaries[r["id"]] = r
            faction_recipes_map.append(item)

    save_json(raw_dir / "faction_recipes_map.json", faction_recipes_map)
    save_json(raw_dir / "all_recipe_summaries.json", list(all_recipe_summaries.values()))
    print(f"  Completed faction-recipe mapping. Total unique recipes discovered: {len(all_recipe_summaries)}", flush=True)

    # 4. Fetch Paint Details (487) & Paint Compatibles (128)
    print(f"\n=== Step 4: Fetching {len(paints)} Paint Details & {len(compat_paints)} Compatibility Mappings ===", flush=True)

    def fetch_paint_detail(p):
        pid = p["id"]
        out_path = raw_dir / "paint_details" / f"{pid}.json"
        if out_path.exists():
            return load_json(out_path)
        det = client.request("GET", f"/paints/{pid}?locale=en")
        if det:
            save_json(out_path, det)
        return det

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        list(pool.map(fetch_paint_detail, paints))
    print(f"  Fetched all {len(paints)} paint details.", flush=True)

    def fetch_paint_compat(p):
        pid = p["id"]
        out_path = raw_dir / "paint_compatibles" / f"{pid}.json"
        if out_path.exists():
            return load_json(out_path)
        comp = client.request("GET", f"/paints/{pid}/compatibles?locale=en") or []
        save_json(out_path, comp)
        return comp

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        list(pool.map(fetch_paint_compat, compat_paints))
    print(f"  Fetched all {len(compat_paints)} paint compatibility mappings.", flush=True)

    # 5. Fetch Colour Details (596)
    print(f"\n=== Step 5: Fetching {len(colours)} Standalone Colour Details ===", flush=True)

    def fetch_colour_detail(c):
        cid = c["id"]
        out_path = raw_dir / "colour_details" / f"{cid}.json"
        if out_path.exists():
            return load_json(out_path)
        det = client.request("GET", f"/colours/{cid}?locale=en")
        if det:
            save_json(out_path, det)
        return det

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futs = [pool.submit(fetch_colour_detail, c) for c in colours]
        done_cnt = 0
        for fut in as_completed(futs):
            fut.result()
            done_cnt += 1
            if done_cnt % 150 == 0 or done_cnt == len(colours):
                print(f"  Colours progress: {done_cnt}/{len(colours)}", flush=True)

    # 6. Fetch Full Recipe Details (4,531+)
    recipe_ids = sorted(all_recipe_summaries.keys())
    print(f"\n=== Step 6: Fetching {len(recipe_ids)} Full Progressive Miniature Recipes ===", flush=True)

    def fetch_recipe_detail(rid):
        out_path = raw_dir / "recipes" / f"{rid}.json"
        if out_path.exists():
            return True
        det = client.request("GET", f"/recipes/{rid}?locale=en")
        if det:
            save_json(out_path, det)
            return True
        return False

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futs = {pool.submit(fetch_recipe_detail, rid): rid for rid in recipe_ids}
        done_cnt = 0
        for fut in as_completed(futs):
            fut.result()
            done_cnt += 1
            if done_cnt % 500 == 0 or done_cnt == len(recipe_ids):
                elapsed = time.time() - t0
                print(f"  Recipes progress: {done_cnt}/{len(recipe_ids)} ({elapsed:.1f}s elapsed)", flush=True)

    # Also check if any recipes reference colourIds not in our 596 colours list
    extra_colour_ids = set()
    known_colour_ids = {c["id"] for c in colours}
    for rid in recipe_ids:
        r_path = raw_dir / "recipes" / f"{rid}.json"
        if r_path.exists():
            r_data = load_json(r_path)
            for cp in r_data.get("colourPoints") or []:
                cid = cp.get("colourId")
                if cid and cid not in known_colour_ids:
                    extra_colour_ids.add(cid)

    if extra_colour_ids:
        print(f"\n=== Step 6b: Fetching {len(extra_colour_ids)} Additional Colour Details Referenced by Recipes ===", flush=True)
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
            futs = [pool.submit(fetch_colour_detail, {"id": cid}) for cid in sorted(extra_colour_ids)]
            for fut in as_completed(futs):
                fut.result()

    total_time = time.time() - t0
    print(f"\n[DONE] Phase 2 API Data Extraction completed in {total_time:.1f}s!", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
