// Servidor local para probar el sitio en tu computadora (npm start).
// Usa la misma lógica que Netlify, pero guarda todo en la carpeta data/.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createHandler } from './lib/core.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret');
const THREADS_FILE = path.join(DATA_DIR, 'threads.json');
const PUBLIC_DIR = path.join(ROOT, 'public');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const readOrNull = (file, enc) => fsp.readFile(file, enc).catch(() => null);
const safeName = (name) => path.basename(name);

// Un solo proceso: alcanza con encadenar las escrituras de hilos
let threadsQueue = Promise.resolve();
function writeThreads(fn) {
  const run = threadsQueue.then(async () => {
    const raw = await readOrNull(THREADS_FILE, 'utf8');
    await fsp.writeFile(THREADS_FILE, JSON.stringify(fn(raw ? JSON.parse(raw) : []), null, 2));
  });
  threadsQueue = run.catch(() => {});
  return run;
}

const handle = createHandler(
  {
    async readDb() {
      const raw = await readOrNull(DB_FILE, 'utf8');
      return raw ? JSON.parse(raw) : null;
    },
    async writeDb(db) {
      await fsp.writeFile(DB_FILE + '.tmp', JSON.stringify(db, null, 2));
      await fsp.rename(DB_FILE + '.tmp', DB_FILE);
    },
    readSecret: () => readOrNull(SECRET_FILE, 'utf8'),
    writeSecret: (s) => fsp.writeFile(SECRET_FILE, s, { flag: 'wx' }).catch(() => {}), // la primera gana
    putFile: (name, bytes) => fsp.writeFile(path.join(UPLOAD_DIR, safeName(name)), bytes),
    async getFile(name) {
      const body = await readOrNull(path.join(UPLOAD_DIR, safeName(name)));
      return body && { body, mime: null };
    },
    deleteFile: (name) => fsp.rm(path.join(UPLOAD_DIR, safeName(name)), { force: true }),
    async readThreads() {
      const raw = await readOrNull(THREADS_FILE, 'utf8');
      return raw ? JSON.parse(raw) : [];
    },
    addThread(id, from, to) {
      return writeThreads((list) => (list.some((t) => t.id === id) ? list : [...list, { id, from, to }]));
    },
    deleteThread: (id) => writeThreads((list) => list.filter((t) => t.id !== id)),
    clearThreads: () => writeThreads(() => []),
  },
  {
    passwords: {
      player: process.env.PLAYER_PASSWORD,
      preview: process.env.PREVIEW_PASSWORD,
      admin: process.env.ADMIN_PASSWORD,
    },
    secret: process.env.SESSION_SECRET,
    maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 25) * 1024 * 1024,
  }
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

// Mismas URLs lindas que netlify.toml
const PAGES = { '/': 'index.html', '/tablero': 'board.html', '/admin': 'admin.html' };

function serveStatic(req, res, url) {
  const rel = PAGES[url.pathname] || url.pathname.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  const fail = () => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No encontrado'); };
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return fail();
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return fail();
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/files/')) return serveStatic(req, res, url);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: 'half',
  });
  const response = await handle(request);
  const headers = Object.fromEntries(response.headers);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`Memis escuchando en http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) console.log('Aviso: contraseña de admin por defecto. Definí ADMIN_PASSWORD para cambiarla.');
});
