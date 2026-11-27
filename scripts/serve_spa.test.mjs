import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createSpaServer, DEFAULT_HOST, DEFAULT_ROOT } from './serve_spa.mjs';

function requestRaw(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: rawPath,
        method: 'GET',
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('serve_spa defaults to loopback 127.0.0.1 and repo dist/model-painter/browser', () => {
  assert.equal(DEFAULT_HOST, '127.0.0.1');
  assert.ok(
    DEFAULT_ROOT.endsWith(path.join('dist', 'model-painter', 'browser')),
    `Expected DEFAULT_ROOT to end with dist/model-painter/browser, got ${DEFAULT_ROOT}`
  );
});

test('serve_spa serves static files and SPA fallback without wildcard CORS, and blocks traversal/malformed URIs', async (t) => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-spa-test-'));
  const rootDir = path.join(tmpBase, 'browser');
  const siblingDir = path.join(tmpBase, 'browser-secret');
  const outsideFile = path.join(tmpBase, 'outside.txt');

  fs.mkdirSync(path.join(rootDir, 'nested'), { recursive: true });
  fs.mkdirSync(siblingDir, { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'index.html'), '<html>spa-index</html>', 'utf8');
  fs.writeFileSync(path.join(rootDir, 'main.js'), 'console.log("ok");', 'utf8');
  fs.writeFileSync(path.join(rootDir, 'nested', 'index.html'), '<html>nested-index</html>', 'utf8');
  fs.writeFileSync(path.join(siblingDir, 'leak.txt'), 'secret-sibling', 'utf8');
  fs.writeFileSync(outsideFile, 'secret-outside', 'utf8');
  fs.symlinkSync(outsideFile, path.join(rootDir, 'escape-link.txt'));

  const server = createSpaServer({ rootDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  const { port } = server.address();

  // 1. Static JS asset returns 200 without Access-Control-Allow-Origin
  const jsRes = await requestRaw(port, '/main.js?v=1');
  assert.equal(jsRes.status, 200);
  assert.equal(jsRes.body, 'console.log("ok");');
  assert.equal(jsRes.headers['access-control-allow-origin'], undefined);

  // 2. Directory index returns nested index.html
  const dirRes = await requestRaw(port, '/nested');
  assert.equal(dirRes.status, 200);
  assert.equal(dirRes.body, '<html>nested-index</html>');

  // 3. SPA route falls back to root index.html
  const spaRes = await requestRaw(port, '/hobby-desk/projects/123');
  assert.equal(spaRes.status, 200);
  assert.equal(spaRes.body, '<html>spa-index</html>');

  // 4. Raw, percent-encoded, mixed, and sibling traversal attempts return 403
  for (const evilPath of [
    '/../../outside.txt',
    '/../outside.txt',
    '/%2e%2e/outside.txt',
    '/..%2foutside.txt',
    '/nested/../../outside.txt',
    '/../browser-secret/leak.txt',
    '/escape-link.txt',
  ]) {
    const res = await requestRaw(port, evilPath);
    assert.equal(res.status, 403, `Expected 403 for ${evilPath}, got ${res.status}`);
  }

  // 5. Malformed percent-encoding and null bytes return 400
  for (const badPath of ['/%E0%A4%A', '/main.js%00.png']) {
    const res = await requestRaw(port, badPath);
    assert.equal(res.status, 400, `Expected 400 for ${badPath}, got ${res.status}`);
  }
});
