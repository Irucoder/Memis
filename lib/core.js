// Lógica del juego, independiente de dónde corra (Netlify o servidor local).
// Recibe un Request estándar y devuelve un Response. El almacenamiento se
// inyecta: en Netlify usa Netlify Blobs, en local usa la carpeta data/.

import crypto from 'node:crypto';

const SESSION_DAYS = 30;

const EXT_MIME = {
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
};

const MAX_THREADS = 500;
const MAX_NOTES = 300;
const NOTE_CHARS = 80;
const STYLES = ['papel', 'polaroid', 'foto', 'nota', 'recorte'];
const PREVIEW_OPTS = ['default', 'show', 'hide'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function defaultDb() {
  return { settings: { unlockAt: null, showPendingDefault: true }, docs: [] };
}

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

const ts = (iso) => (iso ? new Date(iso).getTime() : null);
// Solo cuentan letras y números: "admin memis", "ADMIN–MEMIS" o "adminmemis" valen lo mismo
// (en el celular el guion se suele convertir en raya o perderse).
const normalizePassword = (p) => String(p || '').normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g, '');

const clamp = (n, min, max, fallback) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
};

function parseDate(value) {
  if (value === null || value === '' || value === undefined) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Fecha inválida');
  return d.toISOString();
}

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/\.[a-z0-9]{1,5}$/);
  return m ? m[0] : '';
}

/**
 * storage: {
 *   readDb(): Promise<object|null>, writeDb(db): Promise<void>,
 *   readSecret(): Promise<string|null>, writeSecret(s): Promise<void>,
 *   putFile(name, Uint8Array, mime), getFile(name): Promise<{ body, mime }|null>, deleteFile(name),
 *   readThreads(): Promise<{ id, from, to }[]>, addThread(id, from, to), deleteThread(id), clearThreads(),
 *   readLayouts(): Promise<{ [docId]: { x, y, z, rot, w } }>, updateLayouts(fn),
 *   readNotes(): Promise<{ [noteId]: { x, y, z, rot, text } }>, updateNotes(fn)
 * }
 * Las posiciones que eligen los jugadores (y el admin al acomodar) también van
 * aparte y se superponen a las del documento.
 * Los hilos se guardan aparte de los documentos: cargar o editar evidencia
 * nunca los toca. Cada hilo es una entrada propia cuyo id sale de las dos
 * pistas que une, así dos jugadores conectando a la vez nunca se pisan.
 */
export function createHandler(storage, options = {}) {
  const passwords = {
    player: options.passwords?.player || 'ANA',
    preview: options.passwords?.preview || 'POPIS',
    admin: options.passwords?.admin || 'ADMIN-MEMIS',
  };
  const maxUploadBytes = options.maxUploadBytes || 6 * 1024 * 1024;

  let secretPromise = null;
  function getSecret() {
    if (options.secret) return Promise.resolve(options.secret);
    if (!secretPromise) {
      secretPromise = (async () => {
        const existing = await storage.readSecret();
        if (existing) return existing;
        // Varias copias del servidor pueden llegar acá a la vez: writeSecret solo
        // guarda si todavía no hay una, y todas usan la que quedó guardada.
        await storage.writeSecret(crypto.randomBytes(32).toString('hex'));
        const stored = await storage.readSecret();
        if (!stored) throw new Error('No se pudo guardar la clave de sesiones');
        return stored;
      })();
      secretPromise.catch(() => { secretPromise = null; });
    }
    return secretPromise;
  }

  async function loadDb() {
    const parsed = await storage.readDb();
    const base = defaultDb();
    if (!parsed) return base;
    return { settings: { ...base.settings, ...parsed.settings }, docs: parsed.docs || [] };
  }

  // ---------- Sesiones ----------

  async function sign(payload) {
    return crypto.createHmac('sha256', await getSecret()).update(payload).digest('base64url');
  }

  async function makeToken(role) {
    const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
    return payload + '.' + (await sign(payload));
  }

  async function getRole(request) {
    const cookies = Object.fromEntries(
      (request.headers.get('cookie') || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2)
    );
    const token = cookies.memis_session;
    if (!token || !token.includes('.')) return null;
    const [payload, sig] = token.split('.');
    const expected = await sign(payload);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return data.exp < Date.now() ? null : data.role;
    } catch {
      return null;
    }
  }

  function sessionCookie(request, value, maxAge) {
    const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
    return `memis_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
  }

  // ---------- Reglas de visibilidad ----------

  function isLocked(db, role, now) {
    if (role === 'admin' || role === 'preview') return false;
    const unlock = ts(db.settings.unlockAt);
    return unlock === null || now < unlock;
  }

  const isPublished = (doc, now) => {
    const at = ts(doc.publishAt);
    return at === null || at <= now;
  };

  function showsSilhouette(db, doc) {
    if (doc.preview === 'show') return true;
    if (doc.preview === 'hide') return false;
    return db.settings.showPendingDefault;
  }

  const layout = (doc) => ({ id: doc.id, x: doc.x, y: doc.y, w: doc.w, rot: doc.rot, z: doc.z || 0, style: doc.style });

  const fullDoc = (doc, now) => ({
    ...layout(doc),
    title: doc.title,
    kind: doc.kind,
    mime: doc.mime || null,
    text: doc.text || '',
    caption: doc.caption || '',
    file: doc.file ? '/files/' + doc.file : null,
    publishAt: doc.publishAt,
    pending: !isPublished(doc, now),
  });

  function visibleDocs(db, role, now) {
    if (role === 'admin') return db.docs.map((d) => fullDoc(d, now));
    const out = [];
    for (const d of db.docs) {
      if (isPublished(d, now)) out.push(fullDoc(d, now));
      else if (showsSilhouette(db, d)) out.push({ ...layout(d), pending: true });
    }
    return out;
  }

  const LAYOUT_KEYS = ['x', 'y', 'z', 'rot', 'w'];
  const LIMITS = { x: [0, 100], y: [0, 100], z: [0, 1e6], rot: [-45, 45], w: [4, 60] };

  function pickLayout(body, keys) {
    const out = {};
    for (const k of keys) {
      if (!(k in body)) continue;
      const v = Number(body[k]);
      if (Number.isFinite(v)) out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Math.round(v * 100) / 100));
    }
    return out;
  }

  // Copia de la base con las posiciones guardadas aplicadas (solo lectura)
  async function withLayouts(db) {
    const layouts = (await storage.readLayouts()) || {};
    return { ...db, docs: db.docs.map((d) => (layouts[d.id] ? { ...d, ...layouts[d.id] } : d)) };
  }

  // Hilos que se pueden ver: los dos extremos tienen que ser documentos revelados.
  // (también se pueden atar a los post-its)
  function visibleThreads(db, threads, role, now, notes = {}) {
    const ok = new Set(db.docs.filter((d) => role === 'admin' || isPublished(d, now)).map((d) => d.id));
    for (const id of Object.keys(notes)) ok.add(id);
    return threads.filter((t) => ok.has(t.from) && ok.has(t.to));
  }

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

  // ---------- Lectura del cuerpo ----------

  async function readBytes(request, limit) {
    const declared = Number(request.headers.get('content-length'));
    if (declared > limit) throw new HttpError(413, 'El archivo es demasiado grande');
    const buf = new Uint8Array(await request.arrayBuffer());
    if (buf.length > limit) throw new HttpError(413, 'El archivo es demasiado grande');
    return buf;
  }

  async function readJson(request, limit = 100_000) {
    const buf = await readBytes(request, limit);
    if (!buf.length) return {};
    try {
      return JSON.parse(Buffer.from(buf).toString());
    } catch {
      throw new HttpError(400, 'JSON inválido');
    }
  }

  // ---------- API ----------

  async function handleApi(request, url) {
    const now = Date.now();
    const route = request.method + ' ' + url.pathname;

    if (route === 'POST /api/login') {
      const { password } = await readJson(request, 10_000);
      const p = normalizePassword(password);
      const match = Object.entries(passwords).find(([, pw]) => normalizePassword(pw) === p);
      if (!p || !match) return json(401, { error: 'Contraseña incorrecta' });
      return json(200, { role: match[0] }, {
        'Set-Cookie': sessionCookie(request, await makeToken(match[0]), SESSION_DAYS * 86400),
      });
    }

    if (route === 'POST /api/logout') {
      return json(200, { ok: true }, { 'Set-Cookie': sessionCookie(request, '', 0) });
    }

    const role = await getRole(request);
    if (!role) return json(401, { error: 'Sesión no válida' });
    const db = await loadDb();

    if (route === 'GET /api/state') {
      const locked = isLocked(db, role, now);
      return json(200, {
        role,
        serverNow: now,
        unlockAt: db.settings.unlockAt,
        locked,
        docs: locked ? [] : visibleDocs(await withLayouts(db), role, now),
        ...(locked ? { threads: [], notes: [] } : await (async () => {
          const notes = (await storage.readNotes()) || {};
          return {
            threads: visibleThreads(db, await storage.readThreads(), role, now, notes),
            notes: Object.entries(notes).map(([id, n]) => ({ id, ...n })),
          };
        })()),
      });
    }

    // ---------- Acomodar documentos (cualquiera que ya tenga acceso al tablero) ----------

    const lm = url.pathname.match(/^\/api\/layout\/([\w-]+)$/);
    if (lm && request.method === 'POST') {
      if (isLocked(db, role, now)) return json(403, { error: 'El tablero todavía no está abierto' });
      const doc = db.docs.find((d) => d.id === lm[1]);
      if (!doc || (role !== 'admin' && !isPublished(doc, now))) return json(404, { error: 'Documento no encontrado' });
      // Los jugadores mueven; rotar y cambiar el tamaño queda para el admin
      const fields = pickLayout(await readJson(request, 2_000), role === 'admin' ? LAYOUT_KEYS : ['x', 'y', 'z']);
      await storage.updateLayouts((all) => ({ ...all, [doc.id]: { ...all[doc.id], ...fields } }));
      return json(200, { ok: true });
    }

    // ---------- Hilos (cualquiera que ya tenga acceso al tablero) ----------

    if (route === 'POST /api/threads') {
      if (isLocked(db, role, now)) return json(403, { error: 'El tablero todavía no está abierto' });
      const { from, to } = await readJson(request, 2_000);
      const notes = (await storage.readNotes()) || {};
      const allowed = (id) => id in notes || db.docs.some((d) => d.id === id && (role === 'admin' || isPublished(d, now)));
      if (!from || !to || from === to || !allowed(from) || !allowed(to)) return json(400, { error: 'Pistas inválidas' });
      const [a, b] = [from, to].sort();
      const id = a + '_' + b;
      let threads = await storage.readThreads();
      if (!threads.some((t) => t.id === id)) {
        if (threads.length >= MAX_THREADS) return json(400, { error: 'Se alcanzó el máximo de hilos' });
        await storage.addThread(id, a, b);
        threads = [...threads, { id, from: a, to: b }];
      }
      return json(200, { threads: visibleThreads(db, threads, role, now, notes) });
    }

    const tm = url.pathname.match(/^\/api\/threads\/([\w-]+)$/);
    if (tm && request.method === 'DELETE') {
      if (isLocked(db, role, now)) return json(403, { error: 'El tablero todavía no está abierto' });
      await storage.deleteThread(tm[1]);
      const threads = (await storage.readThreads()).filter((t) => t.id !== tm[1]);
      return json(200, { threads: visibleThreads(db, threads, role, now, (await storage.readNotes()) || {}) });
    }

    // ---------- Post-its (cualquiera que ya tenga acceso al tablero) ----------

    const noteText = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, NOTE_CHARS);

    if (route === 'POST /api/notes') {
      if (isLocked(db, role, now)) return json(403, { error: 'El tablero todavía no está abierto' });
      const body = await readJson(request, 2_000);
      const id = 'n-' + crypto.randomUUID();
      const note = {
        ...pickLayout(body, ['x', 'y', 'z']),
        rot: Math.round((Math.random() * 8 - 4) * 10) / 10,
        text: noteText(body.text),
        createdAt: new Date(now).toISOString(),
      };
      let full = false;
      await storage.updateNotes((all) => {
        if (Object.keys(all).length >= MAX_NOTES) { full = true; return all; }
        return { ...all, [id]: note };
      });
      if (full) return json(400, { error: 'Hay demasiados post-its en el tablero' });
      return json(201, { note: { id, ...note } });
    }

    const nm = url.pathname.match(/^\/api\/notes\/(n-[\w-]+)$/);
    if (nm && (request.method === 'PATCH' || request.method === 'DELETE')) {
      if (isLocked(db, role, now)) return json(403, { error: 'El tablero todavía no está abierto' });
      const id = nm[1];
      if (request.method === 'DELETE') {
        await storage.updateNotes((all) => {
          const { [id]: _gone, ...rest } = all;
          return rest;
        });
        return json(200, { ok: true });
      }
      const body = await readJson(request, 2_000);
      const fields = pickLayout(body, ['x', 'y', 'z']);
      if ('text' in body) fields.text = noteText(body.text);
      let missing = false;
      await storage.updateNotes((all) => {
        if (!all[id]) { missing = true; return all; }
        return { ...all, [id]: { ...all[id], ...fields } };
      });
      if (missing) return json(404, { error: 'Ese post-it ya no existe' });
      return json(200, { ok: true });
    }

    if (role !== 'admin') return json(403, { error: 'Solo administración' });

    if (route === 'GET /api/admin/state') {
      return json(200, {
        serverNow: now,
        settings: db.settings,
        maxUploadBytes,
        docs: (await withLayouts(db)).docs.map((d) => ({ ...fullDoc(d, now), preview: d.preview, createdAt: d.createdAt, originalName: d.originalName })),
        threadCount: (await storage.readThreads()).length,
        noteCount: Object.keys((await storage.readNotes()) || {}).length,
      });
    }

    if (route === 'DELETE /api/admin/notes') {
      await storage.updateNotes(() => ({}));
      return json(200, { ok: true });
    }

    if (route === 'DELETE /api/admin/threads') {
      await storage.clearThreads();
      return json(200, { ok: true });
    }

    if (route === 'PUT /api/admin/settings') {
      const body = await readJson(request);
      if ('unlockAt' in body) db.settings.unlockAt = parseDate(body.unlockAt);
      if ('showPendingDefault' in body) db.settings.showPendingDefault = !!body.showPendingDefault;
      await storage.writeDb(db);
      return json(200, { settings: db.settings });
    }

    if (route === 'POST /api/admin/docs') {
      // Texto: JSON. Archivo: el cuerpo es el archivo y los datos van en X-Doc-Meta.
      const contentType = request.headers.get('content-type') || '';
      const isJson = contentType.startsWith('application/json');
      let body;
      let bytes = null;
      if (isJson) {
        body = await readJson(request);
        body.kind = 'text';
      } else {
        try {
          body = JSON.parse(decodeURIComponent(request.headers.get('x-doc-meta') || '%7B%7D'));
        } catch {
          throw new HttpError(400, 'Datos del documento inválidos');
        }
        bytes = await readBytes(request, maxUploadBytes);
        if (!bytes.length) return json(400, { error: 'Archivo vacío' });
        body.kind = 'file';
      }

      const maxZ = db.docs.reduce((m, d) => Math.max(m, d.z || 0), 0);
      const doc = {
        id: crypto.randomUUID(),
        kind: body.kind,
        title: '',
        caption: '',
        text: '',
        publishAt: null,
        preview: 'default',
        style: 'papel',
        x: 30 + Math.random() * 40,
        y: 30 + Math.random() * 40,
        w: 11,
        rot: Math.round((Math.random() * 10 - 5) * 10) / 10,
        z: maxZ + 1,
        createdAt: new Date(now).toISOString(),
      };

      if (bytes) {
        const ext = extOf(body.fileName);
        doc.file = doc.id + ext;
        doc.mime = EXT_MIME[ext] || contentType.split(';')[0] || 'application/octet-stream';
        doc.originalName = String(body.fileName || '').slice(0, 200);
        doc.style = doc.mime.startsWith('image/') ? 'polaroid' : 'papel';
        await storage.putFile(doc.file, bytes, doc.mime);
      }

      applyDocFields(doc, body);
      db.docs.push(doc);
      await storage.writeDb(db);
      return json(201, { doc: fullDoc(doc, now) });
    }

    const m = url.pathname.match(/^\/api\/admin\/docs\/([\w-]+)$/);
    if (m) {
      const doc = db.docs.find((d) => d.id === m[1]);
      if (!doc) return json(404, { error: 'Documento no encontrado' });

      if (request.method === 'PATCH') {
        const body = await readJson(request);
        applyDocFields(doc, body);
        await storage.writeDb(db);
        const fields = pickLayout(body, LAYOUT_KEYS);
        if (Object.keys(fields).length) {
          await storage.updateLayouts((all) => (all[doc.id] ? { ...all, [doc.id]: { ...all[doc.id], ...fields } } : all));
        }
        return json(200, { doc: fullDoc(doc, now) });
      }
      if (request.method === 'DELETE') {
        db.docs = db.docs.filter((d) => d !== doc);
        await storage.writeDb(db);
        if (doc.file) await storage.deleteFile(doc.file).catch(() => {});
        return json(200, { ok: true });
      }
    }

    return json(404, { error: 'Ruta no encontrada' });
  }

  // ---------- Archivos subidos (protegidos) ----------

  async function handleFile(request, url) {
    const notFound = () => new Response('No encontrado', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const role = await getRole(request);
    if (!role) return notFound();
    const name = decodeURIComponent(url.pathname.slice('/files/'.length));
    const db = await loadDb();
    const doc = db.docs.find((d) => d.file === name);
    const now = Date.now();
    if (!doc) return notFound();
    const allowed = role === 'admin' || (!isLocked(db, role, now) && isPublished(doc, now));
    if (!allowed) return notFound();
    const file = await storage.getFile(doc.file);
    if (!file) return notFound();
    return new Response(file.body, {
      status: 200,
      headers: { 'Content-Type': file.mime || doc.mime || 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' },
    });
  }

  return async function handle(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/files/')) return await handleFile(request, url);
      return await handleApi(request, url);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      return json(err.status || 500, { error: err instanceof HttpError ? err.message : 'Error interno' });
    }
  };
}
