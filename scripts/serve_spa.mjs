import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 4200);
const ROOT = path.resolve('/home/antigravity/warhammer_webapp/dist/warhammer-webapp/browser');

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
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  try {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const decodedPath = decodeURIComponent(parsedUrl.pathname);
    let filePath = path.join(ROOT, decodedPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': mime,
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // SPA Fallback for Angular Router paths (/hobby-desk, /models, /colours, /search, /projects/:id)
    const indexHtml = path.join(ROOT, 'index.html');
    if (fs.existsSync(indexHtml)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(indexHtml).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Paint Warhammer Angular SPA server listening on http://localhost:${PORT}`);
});
