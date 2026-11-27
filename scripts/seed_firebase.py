#!/usr/bin/env python3
"""
Seeds Cloud Firestore and Firebase Cloud Storage from the prepared local catalog bundles
and mirrored media assets using only Python 3 stdlib + OpenSSL (no pip packages required).

Note: For local development (`pnpm run start`) and static builds (`ng build`),
seeding Firestore is OPTIONAL. `CatalogService` automatically falls back to
`/data/recipes/{id}.json` and `/data/colours/{id}.json` under `public/data/`.

Usage:
  python3 scripts/seed_firebase.py --credentials /path/to/serviceAccountKey.json
  # or via environment variables / gcloud Application Default Credentials:
  export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
  python3 scripts/seed_firebase.py
  # or with an OAuth2 access token directly:
  python3 scripts/seed_firebase.py --access-token "$(gcloud auth print-access-token)"
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "public" / "data"
META_DIR = DATA_DIR / "catalog_meta"
RECIPES_DIR = DATA_DIR / "recipes"
COLOURS_DIR = DATA_DIR / "colours"
EXPORT_DIR = Path(
    os.environ.get("WARHAMMER_EXPORT_DIR", str(BASE_DIR / "data" / "export"))
)
ASSETS_DIR = EXPORT_DIR / "assets" / "images"

# Leave headroom below Firestore's strict 1,048,576-byte per-document limit.
MAX_FIRESTORE_DOC_BYTES = 950_000
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
DEFAULT_PROJECT_ID = "model-painter-a8724"
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
TRANSIENT_HTTP_CODES = {408, 429, 500, 502, 503, 504}


class FirestoreHttpError(RuntimeError):
    """Represents an HTTP failure from Google Cloud REST APIs."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.message = message


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _validate_https_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError(f"Refusing non-HTTPS URL: {url}")
    return url


def _resolve_openssl_binary() -> str:
    preferred = Path("/usr/bin/openssl")
    if preferred.is_file():
        return str(preferred)
    found = shutil.which("openssl")
    if found:
        return found
    raise RuntimeError("openssl binary is required to sign service account JWTs.")


def sign_rs256(signing_input: bytes, private_key_pem: str) -> bytes:
    """Sign JWT bytes with RS256 using `openssl dgst -sha256 -sign` and a 0600 temp file."""
    openssl_bin = _resolve_openssl_binary()
    key_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".pem",
            encoding="utf-8",
            delete=False,
        ) as key_file:
            key_path = key_file.name
            os.chmod(key_path, 0o600)
            key_file.write(private_key_pem)

        proc = subprocess.run(
            [openssl_bin, "dgst", "-sha256", "-sign", key_path],
            input=signing_input,
            check=True,
            capture_output=True,
        )
        return proc.stdout
    finally:
        if key_path and os.path.exists(key_path):
            try:
                os.unlink(key_path)
            except OSError:
                pass


def build_service_account_jwt(sa_info: dict[str, Any], scope: str = CLOUD_PLATFORM_SCOPE) -> str:
    """Build and RS256-sign a Google OAuth2 JWT assertion from a service account dict."""
    client_email = sa_info.get("client_email")
    private_key = sa_info.get("private_key")
    token_uri = sa_info.get("token_uri") or TOKEN_ENDPOINT
    if not isinstance(client_email, str) or not isinstance(private_key, str):
        raise ValueError("Service account JSON must contain 'client_email' and 'private_key'.")
    _validate_https_url(token_uri)

    now = int(time.time())
    header: dict[str, Any] = {"alg": "RS256", "typ": "JWT"}
    key_id = sa_info.get("private_key_id")
    if isinstance(key_id, str) and key_id:
        header["kid"] = key_id

    claims = {
        "iss": client_email,
        "sub": client_email,
        "scope": scope,
        "aud": token_uri,
        "iat": now,
        "exp": now + 3600,
    }
    signing_input = (
        f"{_b64url(json.dumps(header, separators=(',', ':')).encode('utf-8'))}."
        f"{_b64url(json.dumps(claims, separators=(',', ':')).encode('utf-8'))}"
    ).encode("ascii")
    signature = sign_rs256(signing_input, private_key)
    return f"{signing_input.decode('ascii')}.{_b64url(signature)}"


def http_request_with_retry(
    url: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: int = 30,
    max_attempts: int = 4,
) -> tuple[int, bytes]:
    """Execute an HTTPS request with exponential backoff on transient failures."""
    _validate_https_url(url)
    req_headers = dict(headers or {})
    last_exc: Exception | None = None

    for attempt in range(max_attempts):
        req = urllib.request.Request(
            url,
            data=body,
            headers=req_headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as err:
            err_body = err.read().decode("utf-8", errors="replace")
            if err.code in TRANSIENT_HTTP_CODES and attempt < max_attempts - 1:
                time.sleep(min(20, 2**attempt))
                continue
            raise FirestoreHttpError(err.code, err_body) from err
        except (urllib.error.URLError, TimeoutError) as err:
            last_exc = err
            if attempt < max_attempts - 1:
                time.sleep(min(20, 2**attempt))
                continue
            raise RuntimeError(f"Network error contacting {url}: {err}") from err

    raise RuntimeError(f"Request failed after {max_attempts} attempts: {last_exc}")


class StaticTokenProvider:
    """Returns a user-supplied OAuth2 bearer access token."""

    def __init__(self, token: str) -> None:
        self._token = token.strip()

    def get_token(self, force_refresh: bool = False) -> str:
        return self._token


class ServiceAccountTokenProvider:
    """Mints and auto-refreshes OAuth2 access tokens from a Service Account JSON key."""

    def __init__(self, sa_info: dict[str, Any]) -> None:
        self._sa_info = sa_info
        self._token_uri = _validate_https_url(sa_info.get("token_uri") or TOKEN_ENDPOINT)
        self._cached_token: str | None = None
        self._expires_at = 0.0

    def get_token(self, force_refresh: bool = False) -> str:
        now = time.time()
        if not force_refresh and self._cached_token and now < self._expires_at - 60:
            return self._cached_token

        assertion = build_service_account_jwt(self._sa_info)
        form = urllib.parse.urlencode(
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            }
        ).encode("utf-8")
        _, raw = http_request_with_retry(
            self._token_uri,
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            body=form,
        )
        token_resp = json.loads(raw.decode("utf-8"))
        access_token = token_resp.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise RuntimeError(f"OAuth token response missing access_token: {token_resp}")
        expires_in = int(token_resp.get("expires_in") or 3600)
        self._cached_token = access_token
        self._expires_at = now + expires_in
        return access_token


class AuthorizedUserTokenProvider:
    """Refreshes OAuth2 access tokens from a gcloud authorized_user ADC JSON file."""

    def __init__(self, adc_info: dict[str, Any]) -> None:
        self._adc_info = adc_info
        self._cached_token: str | None = None
        self._expires_at = 0.0

    def get_token(self, force_refresh: bool = False) -> str:
        now = time.time()
        if not force_refresh and self._cached_token and now < self._expires_at - 60:
            return self._cached_token

        form = urllib.parse.urlencode(
            {
                "grant_type": "refresh_token",
                "client_id": self._adc_info["client_id"],
                "client_secret": self._adc_info["client_secret"],
                "refresh_token": self._adc_info["refresh_token"],
            }
        ).encode("utf-8")
        _, raw = http_request_with_retry(
            TOKEN_ENDPOINT,
            method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            body=form,
        )
        token_resp = json.loads(raw.decode("utf-8"))
        access_token = token_resp.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise RuntimeError(f"ADC token refresh failed: {token_resp}")
        expires_in = int(token_resp.get("expires_in") or 3600)
        self._cached_token = access_token
        self._expires_at = now + expires_in
        return access_token


def to_firestore_value(value: Any) -> dict[str, Any]:
    """Convert a Python JSON value into a Firestore v1 REST API typed Value dict."""
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return {"nullValue": None}
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [to_firestore_value(item) for item in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": to_firestore_fields(value)}}
    raise TypeError(f"Unsupported JSON value type for Firestore: {type(value).__name__}")


def to_firestore_fields(doc: dict[str, Any]) -> dict[str, Any]:
    """Convert a JSON object dict into Firestore v1 `fields` mapping."""
    return {str(key): to_firestore_value(val) for key, val in doc.items()}


class FirestoreRestClient:
    """Minimal Cloud Firestore v1 REST client using `documents:commit`."""

    def __init__(self, project_id: str, token_provider: Any) -> None:
        if not SAFE_ID_RE.match(project_id):
            raise ValueError(f"Invalid Firebase/GCP project ID: {project_id!r}")
        self.project_id = project_id
        self._token_provider = token_provider
        self._commit_url = (
            f"https://firestore.googleapis.com/v1/projects/"
            f"{urllib.parse.quote(project_id, safe='')}/databases/(default)/documents:commit"
        )

    def _authorized_post(self, body_bytes: bytes) -> None:
        for attempt in range(2):
            token = self._token_provider.get_token(force_refresh=(attempt > 0))
            try:
                http_request_with_retry(
                    self._commit_url,
                    method="POST",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": "application/json; charset=utf-8",
                    },
                    body=body_bytes,
                )
                return
            except FirestoreHttpError as err:
                if err.status == 401 and attempt == 0:
                    continue
                raise

    def commit_documents(self, items: list[tuple[str, str, dict[str, Any]]]) -> None:
        """Upsert a batch of `(collection_name, doc_id, payload)` entries."""
        if not items:
            return
        writes = []
        for collection_name, doc_id, payload in items:
            if not SAFE_ID_RE.match(collection_name) or not SAFE_ID_RE.match(doc_id):
                raise ValueError(f"Unsafe Firestore document path: {collection_name}/{doc_id}")
            doc_name = (
                f"projects/{self.project_id}/databases/(default)/documents/"
                f"{collection_name}/{doc_id}"
            )
            writes.append(
                {
                    "update": {
                        "name": doc_name,
                        "fields": to_firestore_fields(payload),
                    }
                }
            )
        payload_bytes = json.dumps({"writes": writes}, separators=(",", ":")).encode("utf-8")
        self._authorized_post(payload_bytes)

    def set_document(self, collection_name: str, doc_id: str, payload: dict[str, Any]) -> None:
        """Upsert a single Firestore document."""
        self.commit_documents([(collection_name, doc_id, payload)])


class CloudStorageRestClient:
    """Minimal Google Cloud Storage JSON API client for uploading mirrored assets."""

    def __init__(self, bucket_name: str, token_provider: Any) -> None:
        if not SAFE_ID_RE.match(bucket_name):
            raise ValueError(f"Invalid Firebase Storage bucket name: {bucket_name!r}")
        self.bucket_name = bucket_name
        self._token_provider = token_provider

    def object_exists(self, object_name: str) -> bool:
        url = (
            f"https://storage.googleapis.com/storage/v1/b/"
            f"{urllib.parse.quote(self.bucket_name, safe='')}/o/"
            f"{urllib.parse.quote(object_name, safe='')}?fields=name"
        )
        for attempt in range(2):
            token = self._token_provider.get_token(force_refresh=(attempt > 0))
            try:
                http_request_with_retry(
                    url,
                    method="GET",
                    headers={"Authorization": f"Bearer {token}"},
                )
                return True
            except FirestoreHttpError as err:
                if err.status == 404:
                    return False
                if err.status == 401 and attempt == 0:
                    continue
                raise
        return False

    def upload_file(self, object_name: str, file_path: Path) -> None:
        content_type, _ = mimetypes.guess_type(str(file_path))
        url = (
            f"https://storage.googleapis.com/upload/storage/v1/b/"
            f"{urllib.parse.quote(self.bucket_name, safe='')}/o"
            f"?uploadType=media&name={urllib.parse.quote(object_name, safe='')}"
        )
        data = file_path.read_bytes()
        for attempt in range(2):
            token = self._token_provider.get_token(force_refresh=(attempt > 0))
            try:
                http_request_with_retry(
                    url,
                    method="POST",
                    headers={
                        "Authorization": f"Bearer {token}",
                        "Content-Type": content_type or "application/octet-stream",
                    },
                    body=data,
                )
                return
            except FirestoreHttpError as err:
                if err.status == 401 and attempt == 0:
                    continue
                raise


def load_local_firebase_config() -> dict[str, str]:
    """Read default `projectId` and `storageBucket` from local Firebase config files."""
    config: dict[str, str] = {}

    local_cfg_path = BASE_DIR / "public" / "firebase-config.local.json"
    if local_cfg_path.is_file():
        try:
            local_cfg = json.loads(local_cfg_path.read_text(encoding="utf-8"))
            if isinstance(local_cfg, dict):
                project_id = local_cfg.get("projectId")
                storage_bucket = local_cfg.get("storageBucket")
                if isinstance(project_id, str) and project_id.strip():
                    config["projectId"] = project_id.strip()
                if isinstance(storage_bucket, str) and storage_bucket.strip():
                    config["storageBucket"] = storage_bucket.strip()
        except (OSError, json.JSONDecodeError):
            pass

    if "projectId" not in config:
        firebaserc_path = BASE_DIR / ".firebaserc"
        if firebaserc_path.is_file():
            try:
                rc = json.loads(firebaserc_path.read_text(encoding="utf-8"))
                default_proj = (
                    rc.get("projects", {}).get("default")
                    if isinstance(rc, dict) and isinstance(rc.get("projects"), dict)
                    else None
                )
                if isinstance(default_proj, str) and default_proj.strip():
                    config["projectId"] = default_proj.strip()
            except (OSError, json.JSONDecodeError):
                pass

    return config


def build_parser(defaults: dict[str, str]) -> argparse.ArgumentParser:
    """Create the CLI argument parser with config-derived defaults."""
    parser = argparse.ArgumentParser(
        description=(
            "Seed Cloud Firestore and Firebase Cloud Storage from local catalog "
            "bundles, recipes, and colours using Python 3 stdlib + OpenSSL."
        )
    )
    parser.add_argument(
        "--credentials",
        default=os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"),
        help=(
            "Path to Firebase service account JSON key "
            "(defaults to GOOGLE_APPLICATION_CREDENTIALS env var)."
        ),
    )
    parser.add_argument(
        "--access-token",
        default=os.environ.get("FIREBASE_ACCESS_TOKEN"),
        help=(
            "Pre-minted Google OAuth2 bearer access token "
            "(defaults to FIREBASE_ACCESS_TOKEN env var)."
        ),
    )
    parser.add_argument(
        "--project",
        default=os.environ.get("GOOGLE_CLOUD_PROJECT"),
        help=(
            "Firebase/GCP project ID (defaults to service account project_id or "
            f"local firebase config: {defaults.get('projectId', DEFAULT_PROJECT_ID)})."
        ),
    )
    parser.add_argument(
        "--bucket",
        default=os.environ.get("FIREBASE_STORAGE_BUCKET")
        or defaults.get("storageBucket"),
        help="Firebase Storage bucket name (defaults to local firebase config).",
    )
    scope_group = parser.add_mutually_exclusive_group()
    scope_group.add_argument(
        "--recipes-only",
        action="store_true",
        help="Upload only public/data/recipes/*.json to Firestore.",
    )
    scope_group.add_argument(
        "--colours-only",
        action="store_true",
        help="Upload only public/data/colours/*.json to Firestore.",
    )
    parser.add_argument(
        "--skip-meta",
        action="store_true",
        help="Skip uploading public/data/catalog_meta/*.json.",
    )
    parser.add_argument(
        "--skip-storage",
        action="store_true",
        help="Skip uploading mirrored images to Firebase Cloud Storage.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Firestore commit batch size for recipes/colours (1..400, default: 100).",
    )
    return parser


def print_setup_instructions(project_id: str | None, reason: str) -> None:
    """Print actionable local-dev and zero-dependency Firestore credential instructions."""
    proj = project_id or DEFAULT_PROJECT_ID
    sa_url = (
        f"https://console.firebase.google.com/project/{proj}"
        "/settings/serviceaccounts/adminsdk"
    )
    print(f"ERROR: {reason}", file=sys.stderr)
    print("", file=sys.stderr)
    print(
        "Note for local development: seeding Firestore is OPTIONAL.",
        file=sys.stderr,
    )
    print(
        "  Your 596 colours and 4,531 recipes are already in public/data/. Restart "
        "`pnpm run start` (or run `ng build`) and CatalogService will load "
        "/data/recipes/{id}.json and /data/colours/{id}.json directly.",
        file=sys.stderr,
    )
    print("", file=sys.stderr)
    print(
        "To seed Cloud Firestore (no extra Python packages needed):",
        file=sys.stderr,
    )
    print(
        f"  1. Download a Service Account private key JSON from:\n"
        f"     {sa_url}",
        file=sys.stderr,
    )
    print(
        "  2. Run:\n"
        "     python3 scripts/seed_firebase.py --credentials /path/to/serviceAccountKey.json\n"
        "     # or: export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json\n"
        "     # or pass an OAuth2 token via --access-token / FIREBASE_ACCESS_TOKEN\n"
        "     # or sign in with `gcloud auth application-default login`",
        file=sys.stderr,
    )


def _find_gcloud_adc_file() -> Path | None:
    cloudsdk_cfg = os.environ.get("CLOUDSDK_CONFIG")
    adc_dir = Path(cloudsdk_cfg) if cloudsdk_cfg else Path.home() / ".config" / "gcloud"
    adc_path = adc_dir / "application_default_credentials.json"
    return adc_path if adc_path.is_file() else None


def _provider_from_json_file(
    cred_path: Path,
) -> tuple[ServiceAccountTokenProvider | AuthorizedUserTokenProvider, str | None]:
    raw = json.loads(cred_path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError(f"Credentials file is not a JSON object: {cred_path}")

    cred_type = raw.get("type")
    if cred_type == "authorized_user":
        for field in ("client_id", "client_secret", "refresh_token"):
            if not isinstance(raw.get(field), str) or not raw.get(field):
                raise ValueError(f"Authorized user ADC file missing {field!r}: {cred_path}")
        quota_proj = raw.get("quota_project_id")
        return AuthorizedUserTokenProvider(raw), (
            quota_proj.strip() if isinstance(quota_proj, str) and quota_proj.strip() else None
        )

    sa_project = raw.get("project_id")
    return ServiceAccountTokenProvider(raw), (
        sa_project.strip() if isinstance(sa_project, str) and sa_project.strip() else None
    )


def resolve_credentials(
    creds_path: str | None,
    access_token: str | None,
    cli_project: str | None,
    default_project: str | None,
) -> tuple[Any, str]:
    """Resolve an OAuth2 token provider and target Firebase project ID."""
    fallback_project = cli_project or default_project or DEFAULT_PROJECT_ID

    if access_token and access_token.strip():
        return StaticTokenProvider(access_token), fallback_project

    if creds_path:
        cred_file = Path(creds_path)
        if not cred_file.is_file():
            print_setup_instructions(fallback_project, f"Credentials file not found: {creds_path}")
            sys.exit(1)
        try:
            provider, sa_project = _provider_from_json_file(cred_file)
            provider.get_token()
            return provider, cli_project or sa_project or default_project or DEFAULT_PROJECT_ID
        except Exception as exc:
            print_setup_instructions(
                fallback_project,
                f"Failed to load credentials from {creds_path}: {exc}",
            )
            sys.exit(1)

    adc_file = _find_gcloud_adc_file()
    if adc_file is not None:
        try:
            provider, adc_project = _provider_from_json_file(adc_file)
            provider.get_token()
            return provider, cli_project or adc_project or default_project or DEFAULT_PROJECT_ID
        except Exception as exc:
            print_setup_instructions(
                fallback_project,
                f"Found ADC file at {adc_file}, but authentication failed: {exc}",
            )
            sys.exit(1)

    print_setup_instructions(
        fallback_project,
        "No Firebase credentials found (--credentials, GOOGLE_APPLICATION_CREDENTIALS, "
        "--access-token, or gcloud Application Default Credentials).",
    )
    sys.exit(1)


def _is_firestore_doc_size_error(err: FirestoreHttpError) -> bool:
    if err.status != 400:
        return False
    lowered = err.message.lower()
    return any(
        needle in lowered
        for needle in ("exceeds", "maximum", "too large", "1048576", "size")
    )


def upload_meta_bundles(
    client: FirestoreRestClient, meta_dir: Path | None = None
) -> None:
    """Upload catalog_meta JSON files that fit within Firestore's 1 MiB doc limit, uploading manifest last."""
    target_dir = meta_dir if meta_dir is not None else META_DIR
    print("1. Uploading catalog_meta bundles & manifest...")
    bundle_files = sorted(target_dir.glob("*.json")) if target_dir.exists() else []
    if not bundle_files:
        print(f"   [WARN] No catalog_meta JSON files found in {target_dir}.")
        return

    manifest_path = target_dir / "manifest.json"
    manifest_doc: dict[str, Any] | None = None
    if manifest_path.is_file():
        manifest_doc = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest_doc.get("bundles"), dict):
            manifest_doc["bundles"] = {}

    def mark_static_only(
        doc_id: str, file_size: int, payload: dict[str, Any] | None = None
    ) -> None:
        if manifest_doc is None:
            return
        bundles_map = manifest_doc["bundles"]
        existing = bundles_map.get(doc_id)
        existing_hash: str | None = None
        if isinstance(existing, dict) and isinstance(existing.get("hash"), str):
            existing_hash = existing["hash"]
        elif isinstance(existing, str):
            existing_hash = existing
        elif payload is not None:
            raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
            existing_hash = "sha256:" + hashlib.sha256(raw).hexdigest()[:24]

        entry: dict[str, Any] = {
            "sizeBytes": file_size,
            "staticOnly": True,
        }
        if existing_hash:
            entry["hash"] = existing_hash
        bundles_map[doc_id] = entry

    for bundle_file in bundle_files:
        doc_id = bundle_file.stem
        if doc_id == "manifest":
            continue

        file_size = bundle_file.stat().st_size
        manifest_entry = (
            manifest_doc["bundles"].get(doc_id) if manifest_doc is not None else None
        )
        is_marked_static = (
            isinstance(manifest_entry, dict) and manifest_entry.get("staticOnly") is True
        )
        if is_marked_static or file_size > MAX_FIRESTORE_DOC_BYTES:
            size_mb = file_size / (1024 * 1024)
            reason = (
                "marked staticOnly in manifest.json"
                if is_marked_static and file_size <= MAX_FIRESTORE_DOC_BYTES
                else f"{size_mb:.2f} MiB exceeds Firestore's 1 MiB document limit"
            )
            print(
                f"   -> [SKIP] catalog_meta/{doc_id} ({reason}; "
                "served statically from /data/catalog_meta/)"
            )
            mark_static_only(doc_id, file_size)
            continue

        payload = json.loads(bundle_file.read_text(encoding="utf-8"))
        try:
            client.set_document("catalog_meta", doc_id, payload)
            print(f"   -> catalog_meta/{doc_id}")
        except FirestoreHttpError as err:
            if _is_firestore_doc_size_error(err):
                print(
                    f"   -> [SKIP] catalog_meta/{doc_id} (Firestore 1 MiB encoded limit; "
                    "served statically from /data/catalog_meta/)"
                )
                mark_static_only(doc_id, file_size, payload)
                continue
            raise

    if manifest_doc is not None:
        client.set_document("catalog_meta", "manifest", manifest_doc)
        print("   -> catalog_meta/manifest")


def upload_json_collection(
    client: FirestoreRestClient,
    step_num: int,
    label: str,
    collection_name: str,
    source_dir: Path,
    batch_size: int,
    progress_every: int | None = None,
) -> None:
    """Batch-upload split entity JSON files from `source_dir` to `collection_name`."""
    files = sorted(source_dir.glob("*.json")) if source_dir.exists() else []
    if not files:
        print(
            f"{step_num}. [WARN] No split {label} JSON files found in {source_dir}; "
            "run scripts/sync_recipes_and_colours.py first to populate them."
        )
        return

    print(
        f"{step_num}. Uploading split {label} documents "
        f"({len(files)} docs, batch_size={batch_size})..."
    )
    batch_items: list[tuple[str, str, dict[str, Any]]] = []
    count = 0

    for json_file in files:
        payload = json.loads(json_file.read_text(encoding="utf-8"))
        batch_items.append((collection_name, json_file.stem, payload))
        count += 1
        if len(batch_items) >= batch_size:
            client.commit_documents(batch_items)
            batch_items.clear()
            if progress_every and count % progress_every < batch_size:
                print(f"   -> {count}/{len(files)} {label} documents committed...")

    if batch_items:
        client.commit_documents(batch_items)
    print(f"   -> Uploaded {count} {label} documents.")


def upload_media_assets(
    storage_client: CloudStorageRestClient,
) -> None:
    """Upload mirrored image files to Firebase Cloud Storage when available."""
    if not ASSETS_DIR.exists():
        return

    print(
        f"4. Uploading media assets from {ASSETS_DIR} "
        f"to gs://{storage_client.bucket_name}..."
    )
    uploaded = 0
    for img_path in ASSETS_DIR.rglob("*"):
        if img_path.is_file():
            rel = img_path.relative_to(ASSETS_DIR.parent.parent).as_posix()
            if not storage_client.object_exists(rel):
                storage_client.upload_file(rel, img_path)
            uploaded += 1
            if uploaded % 250 == 0:
                print(f"   -> {uploaded} images processed...")
    print(f"   -> Completed {uploaded} media assets.")


def main(argv: list[str] | None = None) -> None:
    defaults = load_local_firebase_config()
    parser = build_parser(defaults)
    args = parser.parse_args(argv)

    batch_size = max(1, min(args.batch_size, 400))
    provider, project_id = resolve_credentials(
        args.credentials,
        args.access_token,
        args.project,
        defaults.get("projectId"),
    )
    firestore_client = FirestoreRestClient(project_id, provider)

    if args.recipes_only:
        run_meta, run_colours, run_recipes, run_storage = False, False, True, False
    elif args.colours_only:
        run_meta, run_colours, run_recipes, run_storage = False, True, False, False
    else:
        run_meta = not args.skip_meta
        run_colours = True
        run_recipes = True
        run_storage = not args.skip_storage

    if run_meta:
        upload_meta_bundles(firestore_client)

    if run_colours:
        upload_json_collection(
            firestore_client,
            step_num=2,
            label="colour",
            collection_name="colours",
            source_dir=COLOURS_DIR,
            batch_size=batch_size,
        )

    if run_recipes:
        upload_json_collection(
            firestore_client,
            step_num=3,
            label="recipe",
            collection_name="recipes",
            source_dir=RECIPES_DIR,
            batch_size=batch_size,
            progress_every=250,
        )

    if run_storage and args.bucket:
        storage_client = CloudStorageRestClient(args.bucket, provider)
        upload_media_assets(storage_client)

    print("[DONE] Firebase seeding complete!")


if __name__ == "__main__":
    main()
