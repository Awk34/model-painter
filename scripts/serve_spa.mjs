import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_PORT = 4200;
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_ROOT = path.resolve(__dirname, '../dist/model-painter/browser');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

function sendPlainText(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function isContainedInRoot(targetPath, rootPath) {
  return targetPath === rootPath || targetPath.startsWith(rootPath + path.sep);
}

export function createSpaServer({ rootDir = process.env.SPA_ROOT || DEFAULT_ROOT } = {}) {
  const resolvedRoot = path.resolve(rootDir);

  return http.createServer((req, res) => {
    try {
      const rawTarget = req.url || '/';
      const rawPathname = rawTarget.split('?')[0].split('#')[0];

      let decodedRawPathname;
      try {
        decodedRawPathname = decodeURIComponent(rawPathname);
      } catch {
        sendPlainText(res, 400, 'Bad Request');
        return;
      }

      if (rawPathname.includes('\0') || decodedRawPathname.includes('\0')) {
        sendPlainText(res, 400, 'Bad Request');
        return;
      }

      // Reject raw dot-dot segments before WHATWG URL normalization collapses them
      if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(decodedRawPathname)) {
        sendPlainText(res, 403, 'Forbidden');
        return;
      }

      const normalizedTarget = rawTarget.startsWith('/') ? rawTarget.replace(/^\/+/, '/') : `/${rawTarget}`;
      let parsedUrl;
      try {
        parsedUrl = new URL(normalizedTarget, 'http://localhost');
      } catch {
        sendPlainText(res, 400, 'Bad Request');
        return;
      }

      let decodedPath;
      try {
        decodedPath = decodeURIComponent(parsedUrl.pathname);
      } catch {
        sendPlainText(res, 400, 'Bad Request');
        return;
      }

      if (decodedPath.includes('\0')) {
        sendPlainText(res, 400, 'Bad Request');
        return;
      }

      const relPath = decodedPath.replace(/^\/+/, '');
      let filePath = path.resolve(resolvedRoot, relPath);

      if (!isContainedInRoot(filePath, resolvedRoot)) {
        sendPlainText(res, 403, 'Forbidden');
        return;
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.resolve(filePath, 'index.html');
        if (!isContainedInRoot(filePath, resolvedRoot)) {
          sendPlainText(res, 403, 'Forbidden');
          return;
        }
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const realRoot = fs.realpathSync(resolvedRoot);
        const realFile = fs.realpathSync(filePath);
        if (!isContainedInRoot(realFile, realRoot)) {
          sendPlainText(res, 403, 'Forbidden');
          return;
        }
        const ext = path.extname(realFile).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        fs.createReadStream(realFile).pipe(res);
        return;
      }

      // SPA Fallback for Angular Router paths (/hobby-desk, /models, /colours, /search, /projects/:id)
      const indexHtml = path.resolve(resolvedRoot, 'index.html');
      if (fs.existsSync(indexHtml) && fs.statSync(indexHtml).isFile()) {
        const realRoot = fs.realpathSync(resolvedRoot);
        const realIndex = fs.realpathSync(indexHtml);
        if (!isContainedInRoot(realIndex, realRoot)) {
          sendPlainText(res, 403, 'Forbidden');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(realIndex).pipe(res);
      } else {
        sendPlainText(res, 404, 'Not Found');
      }
    } catch {
      sendPlainText(res, 500, 'Internal Server Error');
    }
  });
}

const isMainModule =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  const portEnv = process.env.PORT;
  const port = portEnv !== undefined ? Number(portEnv) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${portEnv}`);
  }
  const host = process.env.HOST || DEFAULT_HOST;
  const server = createSpaServer();
  server.listen(port, host, () => {
    console.log(`Model Painter Angular SPA server listening on http://${host}:${port}`);
  });
}
