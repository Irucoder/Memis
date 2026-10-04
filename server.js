'use strict';

// Servidor sin dependencias externas: sirve el sitio, guarda los documentos
// en disco (data/) y controla quién puede ver qué y cuándo.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 25;
const SESSION_DAYS = 30;

const PASSWORDS = {
  player: process.env.PLAYER_PASSWORD || 'ANA',
  preview: process.env.PREVIEW_PASSWORD || 'POPIS',
  admin: process.env.ADMIN_PASSWORD || 'ADMIN-MEMIS',
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, s);
    return s;
  }
})();

// ---------- Base de datos (archivo JSON) ----------

function defaultDb() {
  return { settings: { unlockAt: null, showPendingDefault: true }, docs: [] };
}

let db = (() => {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const base = defaultDb();
    return { settings: { ...base.settings, ...parsed.settings }, docs: parsed.docs || [] };
  } catch {
    return defaultDb();
  }
})();

function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- Sesiones ----------

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function makeToken(role) {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return payload + '.' + sign(payload);
}

function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data.role;
  } catch {
    return null;
  }
}

function getRole(req) {
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2)
  );
  return readToken(cookies.memis_session);
}

function sessionCookie(req, value, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `memis_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

// ---------- Reglas de visibilidad ----------

const ts = (iso) => (iso ? new Date(iso).getTime() : null);

function isLocked(role, now) {
  if (role === 'admin' || role === 'preview') return false;
  const unlock = ts(db.settings.unlockAt);
  return unlock === null || now < unlock;
}

function isPublished(doc, now) {
  const at = ts(doc.publishAt);
  return at === null || at <= now;
}

function showsSilhouette(doc) {
  if (doc.preview === 'show') return true;
  if (doc.preview === 'hide') return false;
  return db.settings.showPendingDefault;
}

function layout(doc) {
  return { id: doc.id, x: doc.x, y: doc.y, w: doc.w, rot: doc.rot, z: doc.z || 0, style: doc.style };
}

function fullDoc(doc, now) {
  return {
    ...layout(doc),
    title: doc.title,
    kind: doc.kind,
    mime: doc.mime || null,
    text: doc.text || '',
    caption: doc.caption || '',
    file: doc.file ? '/files/' + doc.file : null,
    publishAt: doc.publishAt,
    pending: !isPublished(doc, now),
  };
}

function visibleDocs(role, now) {
  if (role === 'admin') return db.docs.map((d) => fullDoc(d, now));
  const out = [];
  for (const d of db.docs) {
    if (isPublished(d, now)) out.push(fullDoc(d, now));
    else if (showsSilhouette(d)) out.push({ ...layout(d), pending: true });
  }
  return out;
}

// ---------- Utilidades HTTP ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(Object.assign(new Error('El archivo es demasiado grande'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, filePath, extraHeaders = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'No encontrado');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      ...extraHeaders,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function normalizePassword(p) {
  return String(p || '').trim().toUpperCase();
}

function parseDate(value) {
  if (value === null || value === '' || value === undefined) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Fecha inválida'), { status: 400 });
  return d.toISOString();
}

const clamp = (n, min, max, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};

const STYLES = ['papel', 'polaroid', 'foto', 'nota', 'recorte'];
const PREVIEW_OPTS = ['default', 'show', 'hide'];

function applyDocFields(doc, body) {
  if ('title' in body) doc.title = String(body.title || '').slice(0, 200);
  if ('caption' in body) doc.caption = String(body.caption || '').slice(0, 300);
  if ('text' in body && doc.kind === 'text') doc.text = String(body.text || '').slice(0, 20000);
  if ('publishAt' in body) doc.publishAt = parseDate(body.publishAt);
  if ('preview' in body && PREVIEW_OPTS.includes(body.preview)) doc.preview = body.preview;
  if ('style' in body && STYLES.includes(body.style)) doc.style = body.style;
  if ('x' in body) doc.x = clamp(body.x, 0, 100, doc.x);
  if ('y' in body) doc.y = clamp(body.y, 0, 100, doc.y);
  if ('w' in body) doc.w = clamp(body.w, 4, 60, doc.w);
  if ('rot' in body) doc.rot = clamp(body.rot, -45, 45, doc.rot);
  if ('z' in body) doc.z = clamp(body.z, 0, 100000, doc.z);
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const now = Date.now();
  const role = getRole(req);
  const route = req.method + ' ' + url.pathname;

  if (route === 'POST /api/login') {
    const { password } = await readBody(req, 10_000);
    const p = normalizePassword(password);
    const match = Object.entries(PASSWORDS).find(([, pw]) => normalizePassword(pw) === p);
    if (!p || !match) return send(res, 401, { error: 'Contraseña incorrecta' });
    return send(res, 200, { role: match[0] }, {
      'Set-Cookie': sessionCookie(req, makeToken(match[0]), SESSION_DAYS * 86400),
    });
  }

  if (route === 'POST /api/logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  if (!role) return send(res, 401, { error: 'Sesión no válida' });

  if (route === 'GET /api/state') {
    const locked = isLocked(role, now);
    return send(res, 200, {
      role,
      serverNow: now,
      unlockAt: db.settings.unlockAt,
      locked,
      docs: locked ? [] : visibleDocs(role, now),
    });
  }

  if (role !== 'admin') return send(res, 403, { error: 'Solo administración' });

  if (route === 'GET /api/admin/state') {
    return send(res, 200, {
      serverNow: now,
      settings: db.settings,
      docs: db.docs.map((d) => ({ ...fullDoc(d, now), preview: d.preview, createdAt: d.createdAt, originalName: d.originalName })),
    });
  }

  if (route === 'PUT /api/admin/settings') {
    const body = await readBody(req, 10_000);
    if ('unlockAt' in body) db.settings.unlockAt = parseDate(body.unlockAt);
    if ('showPendingDefault' in body) db.settings.showPendingDefault = !!body.showPendingDefault;
    saveDb();
    return send(res, 200, { settings: db.settings });
  }

  if (route === 'POST /api/admin/docs') {
    const body = await readBody(req, MAX_UPLOAD_MB * 1024 * 1024 * 1.4);
    const kind = body.kind === 'text' ? 'text' : 'file';
    const maxZ = db.docs.reduce((m, d) => Math.max(m, d.z || 0), 0);
    const doc = {
      id: crypto.randomUUID(),
      kind,
      title: '',
      caption: '',
      text: '',
      publishAt: null,
      preview: 'default',
      style: 'papel',
      x: 30 + Math.random() * 40,
      y: 30 + Math.random() * 40,
      w: 14,
      rot: Math.round((Math.random() * 10 - 5) * 10) / 10,
      z: maxZ + 1,
      createdAt: new Date(now).toISOString(),
    };

    if (kind === 'file') {
      if (!body.fileData) return send(res, 400, { error: 'Falta el archivo' });
      const buf = Buffer.from(String(body.fileData).replace(/^data:[^,]*,/, ''), 'base64');
      if (!buf.length) return send(res, 400, { error: 'Archivo vacío' });
      const ext = (path.extname(String(body.fileName || '')).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || [''])[0];
      doc.file = doc.id + ext;
      doc.mime = MIME[ext] || String(body.mime || 'application/octet-stream');
      doc.originalName = String(body.fileName || '').slice(0, 200);
      doc.style = doc.mime.startsWith('image/') ? 'polaroid' : 'papel';
      fs.writeFileSync(path.join(UPLOAD_DIR, doc.file), buf);
    }

    applyDocFields(doc, body);
    db.docs.push(doc);
    saveDb();
    return send(res, 201, { doc: fullDoc(doc, now) });
  }

  const m = url.pathname.match(/^\/api\/admin\/docs\/([\w-]+)$/);
  if (m) {
    const doc = db.docs.find((d) => d.id === m[1]);
    if (!doc) return send(res, 404, { error: 'Documento no encontrado' });

    if (req.method === 'PATCH') {
      applyDocFields(doc, await readBody(req, 50_000));
      saveDb();
      return send(res, 200, { doc: fullDoc(doc, now) });
    }
    if (req.method === 'DELETE') {
      db.docs = db.docs.filter((d) => d !== doc);
      if (doc.file) fs.rm(path.join(UPLOAD_DIR, doc.file), { force: true }, () => {});
      saveDb();
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'Ruta no encontrada' });
}

// ---------- Archivos subidos (protegidos) ----------

function handleUpload(req, res, url) {
  const name = decodeURIComponent(url.pathname.slice('/files/'.length));
  const doc = db.docs.find((d) => d.file === name);
  const role = getRole(req);
  const now = Date.now();
  if (!doc || !role) return send(res, 404, 'No encontrado');
  const allowed = role === 'admin' || (!isLocked(role, now) && isPublished(doc, now));
  if (!allowed) return send(res, 404, 'No encontrado');
  serveFile(res, path.join(UPLOAD_DIR, doc.file), { 'Cache-Control': 'private, max-age=3600' });
}

// ---------- Páginas ----------

const PAGES = { '/': 'index.html', '/tablero': 'board.html', '/admin': 'admin.html' };

function handleStatic(req, res, url) {
  const page = PAGES[url.pathname];
  const rel = page || url.pathname.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'No encontrado');
  serveFile(res, filePath, { 'Cache-Control': page ? 'no-store' : 'public, max-age=300' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/files/')) return handleUpload(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
    return handleStatic(req, res, url);
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Error interno' });
    if (!err.status) console.error(err);
  }
});

server.listen(PORT, () => {
  console.log(`Memis escuchando en http://localhost:${PORT}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log('Aviso: usando la contraseña de admin por defecto. Definí ADMIN_PASSWORD para cambiarla.');
  }
});
