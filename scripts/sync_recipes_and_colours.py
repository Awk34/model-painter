#!/usr/bin/env python3
"""
Syncs full miniature recipe documents (with real colourPoints (x, y) coordinates and
step-by-step paintingAreas) and full standalone colour guides into:
  - public/data/recipes/{id}.json
  - public/data/colours/{id}.json

Reads the target IDs and summary metadata directly from public/data/catalog_meta/
so no external extractor directory is required.

Authentication options:
  1. --token "<BEARER_TOKEN>" (or WARHAMMER_BEARER_TOKEN env var)
  2. --tokens-file path/to/tokens.json (auto-refreshes if refresh_token is present)
  3. --interactive-pkce (prints My Warhammer Auth0 login URL and exchanges pasted callback URL)
  4. --callback-url "citadel-colour://.../callback?code=..." --code-verifier "<VERIFIER>"
"""

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "public" / "data"
META_DIR = DATA_DIR / "catalog_meta"
RECIPES_DIR = DATA_DIR / "recipes"
COLOURS_DIR = DATA_DIR / "colours"
DEFAULT_TOKENS_FILE = BASE_DIR / "tokens.json"

API_BASE = "https://api.apps.paint.warhammer.com"
AUTH0_DOMAIN = "login.mywarhammer.com"
AUTH0_CLIENT_ID = "GfkrpDHeRsWqbwJM1tB6deAjJnd8U8jp"
AUTH0_AUDIENCE = "https://warhammer-paint.com/app"
AUTH0_SCOPE = "openid profile offline_access"
AUTH0_REDIRECT_URI = (
    "citadel-colour://login.mywarhammer.com/android/com.gamesworkshop.citadelpaint/callback"
)

SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")
STAGE_LABELS = {
    "base": "Basic",
    "detail": "Battle Ready",
    "artificer": "Parade Ready",
}


def validate_entity_id(entity_id: str) -> str:
    if not isinstance(entity_id, str) or not SAFE_ID_RE.match(entity_id):
        raise ValueError(f"Invalid entity ID: {entity_id!r}")
    return entity_id


def safe_child_path(parent_dir: Path, filename: str) -> Path:
    parent_resolved = parent_dir.resolve()
    target = (parent_resolved / filename).resolve()
    if target.parent != parent_resolved:
        raise ValueError(f"Unsafe output path outside {parent_resolved}: {target}")
    return target


def write_json_atomic(path: Path, obj: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def generate_pkce_pair() -> tuple[str, str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )
    state = base64.urlsafe_b64encode(secrets.token_bytes(16)).rstrip(b"=").decode("ascii")
    return verifier, challenge, state


def build_authorize_url(code_challenge: str, state: str) -> str:
    query = urllib.parse.urlencode(
        {
            "client_id": AUTH0_CLIENT_ID,
            "response_type": "code",
            "redirect_uri": AUTH0_REDIRECT_URI,
            "scope": AUTH0_SCOPE,
            "audience": AUTH0_AUDIENCE,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "state": state,
        }
    )
    return f"https://{AUTH0_DOMAIN}/authorize?{query}"


def extract_code_from_callback(callback_input: str) -> str:
    trimmed = callback_input.strip()
    if "://" in trimmed:
        parsed = urllib.parse.urlparse(trimmed)
        params = urllib.parse.parse_qs(parsed.query)
        codes = params.get("code")
        if codes and codes[0]:
            return codes[0]
    if len(trimmed) > 10 and " " not in trimmed and "=" not in trimmed:
        return trimmed
    raise ValueError(
        "Could not extract ?code=... from callback URL. Pass the full "
        "citadel-colour://.../callback?code=... link or raw authorization code."
    )


def exchange_pkce_code(code: str, code_verifier: str) -> dict:
    payload = json.dumps(
        {
            "grant_type": "authorization_code",
            "client_id": AUTH0_CLIENT_ID,
            "code": code,
            "code_verifier": code_verifier,
            "redirect_uri": AUTH0_REDIRECT_URI,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"https://{AUTH0_DOMAIN}/oauth/token",
        data=payload,
        headers={"Content-Type": "application/json", "User-Agent": "okhttp/4.12.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        return json.loads(resp.read().decode("utf-8"))


class WarhammerCatalogClient:
    def __init__(self, access_token: str, refresh_token: str | None = None):
        self.access_token = access_token.strip()
        self.refresh_token = refresh_token

    def refresh_access_token(self) -> bool:
        if not self.refresh_token:
            return False
        payload = json.dumps(
            {
                "grant_type": "refresh_token",
                "client_id": AUTH0_CLIENT_ID,
                "refresh_token": self.refresh_token,
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            f"https://{AUTH0_DOMAIN}/oauth/token",
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": "okhttp/4.12.0"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            token_data = json.loads(resp.read().decode("utf-8"))
        new_token = token_data.get("access_token") or token_data.get("id_token")
        if not new_token:
            return False
        self.access_token = new_token
        if token_data.get("refresh_token"):
            self.refresh_token = token_data["refresh_token"]
        return True

    def fetch_entity(self, collection: str, entity_id: str, retries: int = 4) -> dict | None:
        if collection not in ("recipes", "colours"):
            raise ValueError(f"Unsupported collection: {collection}")
        safe_id = validate_entity_id(entity_id)
        encoded_id = urllib.parse.quote(safe_id, safe="")
        url = f"{API_BASE}/{collection}/{encoded_id}?locale=en"

        for attempt in range(retries):
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {self.access_token}",
                    "Accept": "application/json",
                    "User-Agent": "Ktor client",
                },
                method="GET",
            )
            try:
                with urllib.request.urlopen(req, timeout=25) as resp:
                    raw = resp.read().decode("utf-8")
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as exc:
                if exc.code == 404:
                    return None
                if exc.code == 401 and attempt == 0 and self.refresh_access_token():
                    continue
                if attempt < retries - 1:
                    time.sleep(0.8 * (2**attempt))
                else:
                    err_body = exc.read().decode("utf-8", errors="ignore")[:200]
                    raise RuntimeError(f"HTTP {exc.code} on GET {url}: {err_body}") from exc
            except Exception as exc:
                if attempt < retries - 1:
                    time.sleep(0.8 * (2**attempt))
                else:
                    raise RuntimeError(f"Request error on GET {url}: {exc}") from exc
        return None


def load_catalog_indexes() -> tuple[dict[str, dict], dict[str, dict], dict[str, dict]]:
    paints_bundle = json.loads((META_DIR / "paints_bundle.json").read_text(encoding="utf-8"))
    paints_by_id = {p["id"]: p for p in paints_bundle.get("paints") or [] if p.get("id")}

    colours_bundle = json.loads((META_DIR / "colours_bundle.json").read_text(encoding="utf-8"))
    colours_by_id = {c["id"]: c for c in colours_bundle.get("colours") or [] if c.get("id")}

    models_by_id: dict[str, dict] = {}
    for idx in range(6):
        chunk_path = META_DIR / f"models_index_{idx}.json"
        if not chunk_path.exists():
            continue
        chunk_data = json.loads(chunk_path.read_text(encoding="utf-8"))
        for m in chunk_data.get("models") or []:
            if m.get("id"):
                models_by_id[m["id"]] = m

    return models_by_id, colours_by_id, paints_by_id


def enrich_step_paint(raw_paint: dict | None, paints_by_id: dict[str, dict]) -> dict | None:
    if not raw_paint or not isinstance(raw_paint, dict):
        return None
    pid = raw_paint.get("id")
    catalog_paint = paints_by_id.get(pid, {}) if pid else {}
    out = dict(raw_paint)
    for field in (
        "name",
        "category",
        "range",
        "potStyle",
        "gradientStartHex",
        "gradientMiddleHex",
        "gradientEndHex",
        "imageUrl",
        "localImagePath",
    ):
        if not out.get(field) and catalog_paint.get(field):
            out[field] = catalog_paint[field]
    return out


def enrich_recipe(
    raw: dict,
    summary: dict | None,
    colours_by_id: dict[str, dict],
    paints_by_id: dict[str, dict],
) -> dict:
    summary = summary or {}
    out = dict(raw)

    if not out.get("games") and summary.get("gameIds"):
        g_ids = summary.get("gameIds") or []
        g_names = summary.get("gameNames") or []
        out["games"] = [
            {"id": gid, "name": g_names[i] if i < len(g_names) else "Miniature Game"}
            for i, gid in enumerate(g_ids)
        ]

    if not out.get("factions") and summary.get("factionIds"):
        f_ids = summary.get("factionIds") or []
        f_names = summary.get("factionNames") or []
        g_id = (summary.get("gameIds") or [""])[0]
        g_name = (summary.get("gameNames") or [""])[0]
        out["factions"] = [
            {
                "gameId": g_id,
                "gameName": g_name,
                "factionId": fid,
                "factionName": f_names[i] if i < len(f_names) else "",
            }
            for i, fid in enumerate(f_ids)
        ]

    if not out.get("images") and summary.get("primaryImage"):
        out["images"] = [summary["primaryImage"]]
    if not out.get("localImagePaths") and summary.get("localPrimaryImage"):
        out["localImagePaths"] = [summary["localPrimaryImage"]]

    enriched_points = []
    for cp in out.get("colourPoints") or out.get("colorPoints") or []:
        cp_out = dict(cp)
        cid = cp_out.get("colourId") or cp_out.get("colorId")
        c_sum = colours_by_id.get(cid, {}) if cid else {}
        if not cp_out.get("localImagePath") and c_sum.get("localImagePath"):
            cp_out["localImagePath"] = c_sum["localImagePath"]
        enriched_points.append(cp_out)
    out["colourPoints"] = enriched_points

    enriched_areas = []
    for area_idx, area in enumerate(out.get("paintingAreas") or [], start=1):
        a_out = dict(area)
        a_out.setdefault("areaOrder", area_idx)
        steps_out = []
        for step_idx, step in enumerate(a_out.get("paintingSteps") or [], start=1):
            s_out = dict(step)
            s_out.setdefault("stepOrder", step_idx)
            stg = s_out.get("paintingStage")
            if stg in STAGE_LABELS and not s_out.get("qualityTierLabel"):
                s_out["qualityTierLabel"] = STAGE_LABELS[stg]
            if s_out.get("paint"):
                s_out["paint"] = enrich_step_paint(s_out["paint"], paints_by_id)
            steps_out.append(s_out)
        a_out["paintingSteps"] = steps_out
        enriched_areas.append(a_out)
    out["paintingAreas"] = enriched_areas

    if summary.get("updatedAt") and not out.get("updatedAt"):
        out["updatedAt"] = summary["updatedAt"]
    return out


def enrich_colour(raw: dict, summary: dict | None, paints_by_id: dict[str, dict]) -> dict:
    summary = summary or {}
    out = dict(raw)
    for field in (
        "range",
        "guideType",
        "imageUrl",
        "localImagePath",
        "headerImage",
        "localHeaderImagePath",
        "updatedAt",
    ):
        if not out.get(field) and summary.get(field):
            out[field] = summary[field]

    if not out.get("colourGroups") and not out.get("colorGroups"):
        if summary.get("colourGroups"):
            out["colourGroups"] = summary["colourGroups"]
        elif summary.get("colorGroups"):
            out["colorGroups"] = summary["colorGroups"]

    for finish_key in ("baseFinish", "detailFinish", "artificerFinish"):
        finish_obj = out.get(finish_key)
        if not isinstance(finish_obj, dict):
            continue
        f_out = dict(finish_obj)
        stages_out = []
        for idx, st in enumerate(f_out.get("stages") or [], start=1):
            st_out = dict(st)
            st_out.setdefault("stepOrder", idx)
            if st_out.get("paint"):
                st_out["paint"] = enrich_step_paint(st_out["paint"], paints_by_id)
            stages_out.append(st_out)
        f_out["stages"] = stages_out
        out[finish_key] = f_out

    return out


def resolve_client(args: argparse.Namespace) -> WarhammerCatalogClient:
    token = args.token or os.environ.get("WARHAMMER_BEARER_TOKEN")
    refresh_token = None

    if token:
        return WarhammerCatalogClient(token)

    if args.callback_url:
        if not args.code_verifier:
            raise ValueError("--code-verifier is required when passing --callback-url.")
        code = extract_code_from_callback(args.callback_url)
        token_data = exchange_pkce_code(code, args.code_verifier)
        bearer = token_data.get("access_token") or token_data.get("id_token")
        if not bearer:
            raise RuntimeError("No access_token returned from Auth0 token exchange.")
        return WarhammerCatalogClient(bearer, token_data.get("refresh_token"))

    if args.interactive_pkce:
        verifier, challenge, state = generate_pkce_pair()
        auth_url = build_authorize_url(challenge, state)
        print("\n1. Open this My Warhammer Auth0 login URL in your browser:\n")
        print(f"   {auth_url}\n")
        print(
            "2. After signing in, copy the redirected citadel-colour://.../callback?code=... "
            "URL from your browser DevTools Network tab and paste it below."
        )
        callback_input = input("Callback URL: ").strip()
        code = extract_code_from_callback(callback_input)
        token_data = exchange_pkce_code(code, verifier)
        bearer = token_data.get("access_token") or token_data.get("id_token")
        if not bearer:
            raise RuntimeError("No access_token returned from Auth0 token exchange.")
        if args.save_tokens:
            write_json_atomic(Path(args.tokens_file), token_data)
            print(f"[AUTH] Saved tokens to {args.tokens_file}")
        return WarhammerCatalogClient(bearer, token_data.get("refresh_token"))

    tokens_path = Path(args.tokens_file)
    if tokens_path.exists():
        token_data = json.loads(tokens_path.read_text(encoding="utf-8"))
        bearer = token_data.get("access_token") or token_data.get("id_token")
        refresh_token = token_data.get("refresh_token")
        if bearer:
            return WarhammerCatalogClient(bearer, refresh_token)

    raise RuntimeError(
        "No Warhammer API credentials provided. Pass --token, --interactive-pkce, "
        "--callback-url + --code-verifier, WARHAMMER_BEARER_TOKEN, or provide tokens.json."
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fetch full model recipes (with real colourPoints coordinates & paintingAreas) "
            "and standalone colour guides into public/data/recipes/ and public/data/colours/."
        )
    )
    parser.add_argument(
        "--token",
        help="My Warhammer API Bearer access token (or set WARHAMMER_BEARER_TOKEN).",
    )
    parser.add_argument(
        "--tokens-file",
        default=str(DEFAULT_TOKENS_FILE),
        help="Path to tokens.json containing access_token / refresh_token (default: ./tokens.json).",
    )
    parser.add_argument(
        "--interactive-pkce",
        action="store_true",
        help="Run interactive Auth0 PKCE login in the terminal and exchange the callback URL.",
    )
    parser.add_argument(
        "--save-tokens",
        action="store_true",
        help="Save exchanged OAuth tokens to --tokens-file when using --interactive-pkce.",
    )
    parser.add_argument(
        "--callback-url",
        help="citadel-colour://.../callback?code=... URL to exchange via Auth0 PKCE.",
    )
    parser.add_argument(
        "--code-verifier",
        help="PKCE code_verifier paired with --callback-url.",
    )
    parser.add_argument(
        "--recipes-only",
        action="store_true",
        help="Only fetch model recipes into public/data/recipes/.",
    )
    parser.add_argument(
        "--colours-only",
        action="store_true",
        help="Only fetch standalone colour guides into public/data/colours/.",
    )
    parser.add_argument(
        "--ids",
        help="Optional comma-separated subset of recipe/colour UUIDs to fetch (e.g. for testing).",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=16,
        help="Concurrent worker threads (default: 16).",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Re-fetch and overwrite existing JSON files instead of skipping them.",
    )
    return parser.parse_args()


def sync_collection(
    label: str,
    collection: str,
    target_ids: list[str],
    out_dir: Path,
    client: WarhammerCatalogClient,
    enrich_fn,
    workers: int,
    overwrite: bool,
) -> tuple[int, int, int]:
    out_dir.mkdir(parents=True, exist_ok=True)
    pending_ids: list[str] = []
    skipped = 0
    for eid in target_ids:
        validate_entity_id(eid)
        out_path = safe_child_path(out_dir, f"{eid}.json")
        if out_path.exists() and not overwrite:
            skipped += 1
        else:
            pending_ids.append(eid)

    print(
        f"=== {label}: {len(pending_ids)} to fetch ({skipped} already present) ===",
        flush=True,
    )
    if not pending_ids:
        return 0, skipped, 0

    fetched = 0
    missing = 0

    def process_one(eid: str) -> bool:
        raw = client.fetch_entity(collection, eid)
        if not raw:
            return False
        enriched = enrich_fn(eid, raw)
        out_path = safe_child_path(out_dir, f"{eid}.json")
        write_json_atomic(out_path, enriched)
        return True

    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(process_one, eid): eid for eid in pending_ids}
        for idx, fut in enumerate(as_completed(futures), start=1):
            if fut.result():
                fetched += 1
            else:
                missing += 1
            if idx % 250 == 0 or idx == len(pending_ids):
                elapsed = time.time() - t0
                print(
                    f"  {label} progress: {idx}/{len(pending_ids)} "
                    f"(saved={fetched}, not_found={missing}, {elapsed:.1f}s)",
                    flush=True,
                )

    return fetched, skipped, missing


def main() -> int:
    args = parse_args()
    if args.recipes_only and args.colours_only:
        print("ERROR: --recipes-only and --colours-only are mutually exclusive.", file=sys.stderr)
        return 1

    try:
        client = resolve_client(args)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    models_by_id, colours_by_id, paints_by_id = load_catalog_indexes()
    subset_ids = (
        [validate_entity_id(item.strip()) for item in args.ids.split(",") if item.strip()]
        if args.ids
        else None
    )

    if not args.recipes_only:
        colour_ids = (
            [cid for cid in subset_ids if cid in colours_by_id]
            if subset_ids is not None
            else sorted(colours_by_id.keys())
        )
        sync_collection(
            label="Colours",
            collection="colours",
            target_ids=colour_ids,
            out_dir=COLOURS_DIR,
            client=client,
            enrich_fn=lambda cid, raw: enrich_colour(raw, colours_by_id.get(cid), paints_by_id),
            workers=args.workers,
            overwrite=args.overwrite,
        )

    if not args.colours_only:
        recipe_ids = (
            [rid for rid in subset_ids if rid in models_by_id or not colours_by_id.get(rid)]
            if subset_ids is not None
            else sorted(models_by_id.keys())
        )
        sync_collection(
            label="Recipes",
            collection="recipes",
            target_ids=recipe_ids,
            out_dir=RECIPES_DIR,
            client=client,
            enrich_fn=lambda rid, raw: enrich_recipe(
                raw, models_by_id.get(rid), colours_by_id, paints_by_id
            ),
            workers=args.workers,
            overwrite=args.overwrite,
        )

    print("[DONE] Sync complete. Restart `pnpm run start` or run `scripts/seed_firebase.py` to publish.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

