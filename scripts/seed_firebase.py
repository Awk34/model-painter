#!/usr/bin/env python3
"""
Seeds Cloud Firestore and Firebase Cloud Storage from the prepared local catalog bundles
and 6,430 mirrored media assets.

Usage:
  export GOOGLE_APPLICATION_CREDENTIALS="/path/to/serviceAccountKey.json"
  export FIREBASE_STORAGE_BUCKET="your-project-id.firebasestorage.app"
  python3 scripts/seed_firebase.py
"""
import json
import os
import sys
from pathlib import Path

BASE_DIR = Path("/home/antigravity/warhammer_webapp")
DATA_DIR = BASE_DIR / "public" / "data"
META_DIR = DATA_DIR / "catalog_meta"
RECIPES_DIR = DATA_DIR / "recipes"
COLOURS_DIR = DATA_DIR / "colours"
ASSETS_DIR = Path("/home/antigravity/warhammer_extractor/data/export/assets/images")


def main():
    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    bucket_name = os.environ.get("FIREBASE_STORAGE_BUCKET")
    if not creds_path or not os.path.exists(creds_path):
        print(
            "ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your Firebase service account JSON path."
        )
        sys.exit(1)

    try:
        import firebase_admin
        from firebase_admin import credentials, firestore, storage
    except ImportError:
        print("Install firebase-admin first: pip install firebase-admin")
        sys.exit(1)

    cred = credentials.Certificate(creds_path)
    firebase_admin.initialize_app(
        cred, {"storageBucket": bucket_name} if bucket_name else None
    )
    db = firestore.client()

    print("1. Uploading catalog_meta bundles & manifest (with SHA-256 hashes)...")
    for bundle_file in sorted(META_DIR.glob("*.json")):
        doc_id = bundle_file.stem
        payload = json.loads(bundle_file.read_text(encoding="utf-8"))
        db.collection("catalog_meta").document(doc_id).set(payload)
        print(f"   -> catalog_meta/{doc_id}")

    print("2. Uploading split colour detail documents (596 docs)...")
    batch = db.batch()
    count = 0
    for cfile in sorted(COLOURS_DIR.glob("*.json")):
        payload = json.loads(cfile.read_text(encoding="utf-8"))
        batch.set(db.collection("colours").document(cfile.stem), payload)
        count += 1
        if count % 400 == 0:
            batch.commit()
            batch = db.batch()
    batch.commit()
    print(f"   -> Uploaded {count} colour documents.")

    print("3. Uploading split model recipe documents (4,531 docs)...")
    batch = db.batch()
    count = 0
    for rfile in sorted(RECIPES_DIR.glob("*.json")):
        payload = json.loads(rfile.read_text(encoding="utf-8"))
        batch.set(db.collection("recipes").document(rfile.stem), payload)
        count += 1
        if count % 250 == 0:
            batch.commit()
            batch = db.batch()
            print(f"   -> {count} recipes committed...")
    batch.commit()
    print(f"   -> Uploaded {count} recipe documents.")

    if bucket_name and ASSETS_DIR.exists():
        print(f"4. Uploading media assets from {ASSETS_DIR} to gs://{bucket_name}...")
        bucket = storage.bucket()
        uploaded = 0
        for img_path in ASSETS_DIR.rglob("*"):
            if img_path.is_file():
                rel = img_path.relative_to(ASSETS_DIR.parent.parent)
                blob = bucket.blob(str(rel))
                if not blob.exists():
                    blob.upload_from_filename(str(img_path))
                uploaded += 1
                if uploaded % 250 == 0:
                    print(f"   -> {uploaded} images processed...")
        print(f"   -> Completed {uploaded} media assets.")

    print("[DONE] Firebase Firestore & Cloud Storage seeding complete!")


if __name__ == "__main__":
    main()
