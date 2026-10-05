import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.env.NEON_FETCH_ENDPOINT) {
  const { neonConfig } = await import('@neondatabase/serverless');
  neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.md': 'text/markdown; charset=utf-8',
};

function resolveApi(pathname) {
  const parts = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const query = {};
  let dir = path.join(root, 'api');
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const exact = path.join(dir, parts[i] + (last ? '.js' : ''));
    if (fs.existsSync(exact)) { dir = exact; continue; }
    const folder = path.join(dir, parts[i]);
    if (last && fs.existsSync(path.join(folder, 'index.js'))) { dir = path.join(folder, 'index.js'); continue; }
    if (!last && fs.existsSync(folder)) { dir = folder; continue; }
    const dynamic = fs.existsSync(dir) && fs.statSync(dir).isDirectory()
      ? fs.readdirSync(dir).find((f) => /^\[.+\]/.test(f) && (last ? f.endsWith('.js') : !f.endsWith('.js')))
      : null;
    if (!dynamic) return null;
    query[dynamic.replace(/^\[|\](\.js)?$/g, '')] = decodeURIComponent(parts[i]);
    dir = path.join(dir, dynamic);
  }
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) dir = path.join(dir, 'index.js');
  return fs.existsSync(dir) ? { file: dir, query } : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    const target = resolveApi(url.pathname);
    if (!target) { res.writeHead(404).end('{}'); return; }
    req.query = { ...Object.fromEntries(url.searchParams), ...target.query };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.end(body); return res; };
    try {
      const mod = await import(pathToFileURL(target.file).href);
      await mod.default(req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500).end('{}');
    }
    return;
  }

  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('não encontrado'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, () => console.log(`Nestra em http://localhost:${port}`));
