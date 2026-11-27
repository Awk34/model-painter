import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const metaDir = path.join(repoRoot, 'public', 'data', 'catalog_meta');

function computeBundleHashesViaPython(bundleKeys) {
  const py = `
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(${JSON.stringify(repoRoot)}) / "scripts"))
from prepare_local_bundles import sha256_json
meta_dir = Path(${JSON.stringify(metaDir)})
keys = json.loads(sys.argv[1])
out = {}
for key in keys:
    p = meta_dir / f"{key}.json"
    out[key] = sha256_json(json.loads(p.read_text(encoding="utf-8")))
print(json.dumps(out))
`;
  const stdout = execFileSync('python3', ['-c', py, JSON.stringify(bundleKeys)], {
    cwd: repoRoot,
    env: { ...process.env, PYTHONPYCACHEPREFIX: '/tmp/pycache' },
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

test('third_party_paints_bundle.json matches paint.models.ts schema (matchQuality, category, potStyle, no matchType)', () => {
  const paintModelsSrc = fs.readFileSync(
    path.join(repoRoot, 'src/app/core/models/paint.models.ts'),
    'utf8'
  );
  const qualityMatch = paintModelsSrc.match(
    /matchQuality:\s*'([^']+)'\s*\|\s*'([^']+)'\s*\|\s*'([^']+)'/
  );
  assert.ok(qualityMatch, 'Expected matchQuality union in paint.models.ts');
  const allowedQualities = new Set([qualityMatch[1], qualityMatch[2], qualityMatch[3]]);

  const bundle = JSON.parse(
    fs.readFileSync(path.join(metaDir, 'third_party_paints_bundle.json'), 'utf8')
  );
  assert.equal(bundle.thirdPartyPaints.length, 145);

  const tpById = new Map();
  let citadelMatchesCount = 0;
  for (const tp of bundle.thirdPartyPaints) {
    assert.ok(tp.id && tp.brand && tp.range && tp.name && tp.category);
    tpById.set(tp.id, tp);
    for (const m of tp.citadelMatches) {
      citadelMatchesCount++;
      assert.ok(
        allowedQualities.has(m.matchQuality),
        `Invalid matchQuality on ${tp.id} -> ${m.citadelPaintId}: ${m.matchQuality}`
      );
      assert.equal(Object.hasOwn(m, 'matchType'), false, `Legacy matchType found on ${tp.id}`);
    }
  }
  assert.equal(citadelMatchesCount, 871);

  let mapRefsCount = 0;
  for (const [citadelId, refs] of Object.entries(bundle.citadelToThirdPartyMap)) {
    assert.ok(Array.isArray(refs) && refs.length > 0, `Empty refs for ${citadelId}`);
    for (const ref of refs) {
      mapRefsCount++;
      assert.ok(
        allowedQualities.has(ref.matchQuality),
        `Invalid matchQuality on ${citadelId} -> ${ref.thirdPartyPaintId}: ${ref.matchQuality}`
      );
      assert.equal(
        Object.hasOwn(ref, 'matchType'),
        false,
        `Legacy matchType found on map entry ${citadelId}`
      );
      const srcTp = tpById.get(ref.thirdPartyPaintId);
      assert.ok(srcTp, `Missing source paint ${ref.thirdPartyPaintId}`);
      assert.equal(ref.category, srcTp.category);
      assert.equal(ref.potStyle, srcTp.potStyle);
    }
  }
  assert.equal(mapRefsCount, 1633);
});

test('manifest.json SHA-256 hashes, sizeBytes, and staticOnly flags match catalog_meta files', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(metaDir, 'manifest.json'), 'utf8'));
  const bundleKeys = Object.keys(manifest.bundles);
  assert.ok(bundleKeys.length >= 10);
  const expectedHashes = computeBundleHashesViaPython(bundleKeys);

  for (const key of bundleKeys) {
    const filePath = path.join(metaDir, `${key}.json`);
    assert.ok(fs.existsSync(filePath), `Missing bundle file ${key}.json`);
    const fileSize = fs.statSync(filePath).size;
    const expectedHash = expectedHashes[key];

    const entry = manifest.bundles[key];
    if (key.startsWith('models_index_') || fileSize > 950_000) {
      assert.equal(typeof entry, 'object', `${key} must use CatalogBundleMeta object`);
      assert.equal(entry.hash, expectedHash, `Hash mismatch for ${key}`);
      assert.equal(entry.sizeBytes, fileSize, `sizeBytes mismatch for ${key}`);
      assert.equal(entry.staticOnly, true, `${key} must be marked staticOnly: true`);
    } else {
      const actualHash = typeof entry === 'string' ? entry : entry.hash;
      assert.equal(actualHash, expectedHash, `Hash mismatch for ${key}`);
    }
  }
});

test('Python catalog scripts pass unit tests and parameterized --help CLI checks', () => {
  const pyCode = `
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(${JSON.stringify(repoRoot)}) / "scripts"))
import build_third_party_paints as btp
import prepare_local_bundles as plb
import seed_firebase as sf


class CatalogScriptsTests(unittest.TestCase):
    def test_compute_match_quality_thresholds(self):
        self.assertEqual(btp.compute_match_quality(0.0), "exact")
        self.assertEqual(btp.compute_match_quality(5.0), "exact")
        self.assertEqual(btp.compute_match_quality(5.01), "close")
        self.assertEqual(btp.compute_match_quality(12.0), "close")
        self.assertEqual(btp.compute_match_quality(12.01), "similar")

    def test_build_third_party_payload_schema_and_curated_sort(self):
        citadel = [
            {
                "id": "c-red",
                "name": "Mephiston Red",
                "range": "warhammer_colour",
                "category": "base",
                "potStyle": "flat",
                "gradientStartHex": "#991E22",
            },
            {
                "id": "c-dark-red",
                "name": "Khorne Red",
                "range": "warhammer_colour",
                "category": "base",
                "potStyle": "flat",
                "gradientStartHex": "#6C1D24",
            },
        ]
        tp_defs = [
            {
                "id": "tp-close-noncurated",
                "brand": "Vallejo",
                "range": "Game Color",
                "code": "V-1",
                "name": "Close Non-Curated",
                "category": "base",
                "potStyle": "flat",
                "hex": "#991E22",
                "curatedCitadelNames": [],
            },
            {
                "id": "tp-curated",
                "brand": "The Army Painter",
                "range": "Warpaints Fanatic",
                "code": "AP-1",
                "name": "Curated Farther",
                "category": "base",
                "potStyle": "flat",
                "hex": "#8B2226",
                "curatedCitadelNames": ["Mephiston Red"],
            },
        ]
        payload = btp.build_third_party_paints_payload(citadel, third_party_defs=tp_defs)
        for tp in payload["thirdPartyPaints"]:
            for m in tp["citadelMatches"]:
                self.assertIn(m["matchQuality"], ("exact", "close", "similar"))
                self.assertNotIn("matchType", m)

        mephiston_refs = payload["citadelToThirdPartyMap"]["c-red"]
        self.assertEqual(mephiston_refs[0]["thirdPartyPaintId"], "tp-curated")
        for ref in mephiston_refs:
            self.assertIn(ref["matchQuality"], ("exact", "close", "similar"))
            self.assertEqual(ref["category"], "base")
            self.assertEqual(ref["potStyle"], "flat")
            self.assertNotIn("matchType", ref)

    def test_prepare_local_bundles_static_only_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            meta_out = Path(tmp)
            small_meta = plb.write_bundle_and_meta(meta_out, "paints_bundle", {"paints": []})
            self.assertIsInstance(small_meta, str)
            self.assertTrue(small_meta.startswith("sha256:"))

            idx_meta = plb.write_bundle_and_meta(meta_out, "models_index_0", {"models": []})
            self.assertIsInstance(idx_meta, dict)
            self.assertTrue(idx_meta["staticOnly"])
            self.assertEqual(idx_meta["sizeBytes"], (meta_out / "models_index_0.json").stat().st_size)

            big_payload = {"blob": "x" * (plb.MAX_FIRESTORE_DOC_BYTES + 100)}
            big_meta = plb.write_bundle_and_meta(meta_out, "huge_bundle", big_payload)
            self.assertIsInstance(big_meta, dict)
            self.assertTrue(big_meta["staticOnly"])
            self.assertGreater(big_meta["sizeBytes"], plb.MAX_FIRESTORE_DOC_BYTES)

    def test_upload_meta_bundles_skips_static_and_uploads_manifest_last(self):
        class MockClient:
            def __init__(self):
                self.calls = []

            def set_document(self, collection, doc_id, payload):
                if doc_id == "encoded_limit_bundle":
                    raise sf.FirestoreHttpError(400, "Document size exceeds maximum 1048576 bytes")
                self.calls.append((collection, doc_id, payload))

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            (tmp_dir / "paints_bundle.json").write_text(json.dumps({"paints": [1]}), encoding="utf-8")
            (tmp_dir / "models_index_0.json").write_text(json.dumps({"models": []}), encoding="utf-8")
            (tmp_dir / "oversized_bundle.json").write_text(
                json.dumps({"data": "a" * (sf.MAX_FIRESTORE_DOC_BYTES + 50)}),
                encoding="utf-8",
            )
            (tmp_dir / "encoded_limit_bundle.json").write_text(
                json.dumps({"nested": [1, 2, 3]}),
                encoding="utf-8",
            )
            manifest = {
                "schemaVersion": 1,
                "bundles": {
                    "paints_bundle": "sha256:paints",
                    "models_index_0": {"hash": "sha256:m0", "sizeBytes": 13, "staticOnly": True},
                    "oversized_bundle": "sha256:over",
                    "encoded_limit_bundle": "sha256:enc",
                },
            }
            (tmp_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

            client = MockClient()
            sf.upload_meta_bundles(client, meta_dir=tmp_dir)

            doc_ids = [doc_id for _, doc_id, _ in client.calls]
            self.assertEqual(doc_ids, ["paints_bundle", "manifest"])
            uploaded_manifest = client.calls[-1][2]
            self.assertEqual(uploaded_manifest["bundles"]["paints_bundle"], "sha256:paints")
            self.assertTrue(uploaded_manifest["bundles"]["models_index_0"]["staticOnly"])
            self.assertTrue(uploaded_manifest["bundles"]["oversized_bundle"]["staticOnly"])
            self.assertGreater(
                uploaded_manifest["bundles"]["oversized_bundle"]["sizeBytes"],
                sf.MAX_FIRESTORE_DOC_BYTES,
            )
            self.assertTrue(uploaded_manifest["bundles"]["encoded_limit_bundle"]["staticOnly"])
            self.assertEqual(uploaded_manifest["bundles"]["encoded_limit_bundle"]["hash"], "sha256:enc")


suite = unittest.defaultTestLoader.loadTestsFromTestCase(CatalogScriptsTests)
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.wasSuccessful() else 1)
`;

  execFileSync('python3', ['-c', pyCode], {
    cwd: repoRoot,
    env: { ...process.env, PYTHONPYCACHEPREFIX: '/tmp/pycache' },
    stdio: 'pipe',
  });

  for (const scriptRel of [
    'scripts/extract_apk_assets.py',
    'scripts/build_third_party_paints.py',
    'scripts/seed_firebase.py',
    'scripts/sync_recipes_and_colours.py',
    'extractor/build_exports_and_mirror_media.py',
    'extractor/extract_api_data.py',
  ]) {
    const out = execFileSync('python3', [path.join(repoRoot, scriptRel), '--help'], {
      cwd: repoRoot,
      env: { ...process.env, PYTHONPYCACHEPREFIX: '/tmp/pycache' },
      encoding: 'utf8',
    });
    assert.match(out, /usage:/i, `Missing --help usage output for ${scriptRel}`);
  }
});
