'use strict';

const $ = (id) => document.getElementById(id);
const POLL_MS = 15000;
const PDFJS = '/vendor/pdfjs/'; // lector de PDF incluido en el sitio (pdf.js 3.11)

let role = null;
let clockOffset = 0; // serverNow - Date.now()
let unlockAt = null;
let firstRender = true;
let editing = false;
let dragging = null;
let threads = [];
let threading = false;
let threadFrom = null; // id del documento donde se ató la primera punta
const rendered = new Map(); // id -> { el, sig, doc }
const notesMap = new Map(); // id -> { el, sig, doc: nota, type: 'note' }

// Margen dentro del corcho, en %: nada se puede ubicar encima de la madera
const FRAME_X = 0.6;
const FRAME_Y = 1;

// Zona del corcho en pantalla (sin el marco), que es donde se ubican pistas e hilos
function corkBox() {
  const b = $('board');
  const r = b.getBoundingClientRect();
  const left = r.left + b.clientLeft;
  const top = r.top + b.clientTop;
  return { left, top, width: b.clientWidth, height: b.clientHeight, right: left + b.clientWidth, bottom: top + b.clientHeight };
}

function fitInside(r, x, y) {
  const board = $('board');
  const hw = (r.el.offsetWidth / 2 / board.clientWidth) * 100;
  const hh = (r.el.offsetHeight / 2 / board.clientHeight) * 100;
  const clampAxis = (v, frame, half) => {
    const min = frame + half;
    const max = 100 - frame - half;
    return min > max ? 50 : Math.min(max, Math.max(min, v));
  };
  return { x: clampAxis(x, FRAME_X, hw), y: clampAxis(y, FRAME_Y, hh) };
}

// Si algo quedó afuera del corcho (por ejemplo, de antes de este límite), se muestra adentro
function keepInside(r) {
  const { x, y } = fitInside(r, r.doc.x, r.doc.y);
  if (Math.abs(x - r.doc.x) > 0.01 || Math.abs(y - r.doc.y) > 0.01) {
    r.doc.x = x;
    r.doc.y = y;
    placeDoc(r.el, r.doc);
  }
}

const now = () => Date.now() + clockOffset;
const pad = (n) => String(n).padStart(2, '0');

function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ---------- Estado ----------

async function load() {
  let s;
  try {
    const r = await fetch('/api/state', { credentials: 'same-origin' });
    if (r.status === 401) return location.replace('/?salida=' + ((await r.json().catch(() => ({}))).reason || 'sesion'));
    s = await r.json();
  } catch {
    return; // sin conexión: se reintenta en el próximo ciclo
  }
  clockOffset = s.serverNow - Date.now();
  role = s.role;
  unlockAt = s.unlockAt ? new Date(s.unlockAt).getTime() : null;

  $('editBtn').classList.toggle('hidden', role !== 'admin');
  $('adminLink').classList.toggle('hidden', role !== 'admin');

  $('spool').classList.toggle('hidden', s.locked);
  $('notepad').classList.toggle('hidden', s.locked);
  $('folderBtn').classList.toggle('hidden', s.locked);
  if (s.locked) {
    setThreading(false);
    showWait();
  } else {
    threads = s.threads || [];
    showBoard(s.docs.filter((d) => !d.folder));
    showArchive(s.docs.filter((d) => d.folder));
    showNotes(s.notes || []);
  }
}

setInterval(load, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  memisSession.clear();
  location.replace('/');
});

// ---------- Cuenta regresiva ----------

let tickTimer = null;

function formatWhen(ts) {
  const d = new Date(ts);
  const date = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(d)
    .replace(',', '');
  const time = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `Se podrá tener acceso a esta página el <strong>${date}</strong> a las <strong>${time} hs</strong>.`;
}

function showWait() {
  $('boardView').classList.add('hidden');
  $('waitView').classList.remove('hidden');

  if (unlockAt === null) {
    $('cdLabel').textContent = 'Acceso aún no habilitado';
    $('cdH').textContent = $('cdM').textContent = $('cdS').textContent = '--';
    $('cdWhen').textContent = 'La fecha de apertura todavía no fue anunciada. Volvé a revisar pronto.';
    clearInterval(tickTimer);
    tickTimer = null;
    return;
  }

  $('cdLabel').textContent = 'La investigación se abre en';
  $('cdWhen').innerHTML = formatWhen(unlockAt);
  if (!tickTimer) {
    tick();
    tickTimer = setInterval(tick, 250);
  }
}

function tick() {
  const left = Math.max(0, unlockAt - now());
  const total = Math.floor(left / 1000);
  $('cdH').textContent = pad(Math.floor(total / 3600));
  $('cdM').textContent = pad(Math.floor((total % 3600) / 60));
  $('cdS').textContent = pad(total % 60);
  if (left <= 0) {
    clearInterval(tickTimer);
    tickTimer = null;
    setTimeout(load, 800);
  }
}

// ---------- Tablero ----------

function showBoard(docs) {
  clearInterval(tickTimer);
  tickTimer = null;
  $('waitView').classList.add('hidden');
  $('boardView').classList.remove('hidden');
  if (dragging) return; // no pisar lo que el admin está moviendo

  const board = $('board');
  const seen = new Set();
  for (const d of docs) {
    seen.add(d.id);
    const sig = JSON.stringify(d);
    const prev = rendered.get(d.id);
    if (prev && (prev.sig === sig || unsaved.has(d.id))) continue; // no pisar un movimiento que se está guardando
    const el = buildDoc(d);
    const becameVisible = !prev || (prev.doc.pending && !d.pending);
    if (!firstRender && becameVisible) el.classList.add('appear');
    if (prev) prev.el.replaceWith(el);
    else board.appendChild(el);
    const entry = { el, sig, doc: d };
    rendered.set(d.id, entry);
    keepInside(entry);
    el.querySelectorAll('img').forEach((img) => img.addEventListener('load', () => keepInside(entry), { once: true }));
  }
  for (const [id, r] of rendered) {
    if (!seen.has(id)) {
      r.el.remove();
      rendered.delete(id);
    }
  }
  $('boardEmpty').classList.toggle('hidden', rendered.size > 0);
  if (firstRender) { // en pantallas angostas el tablero se recorre de costado: arrancar centrado
    const sc = $('boardView');
    sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
  }
  firstRender = false;
}

function isImage(d) { return d.mime && d.mime.startsWith('image/'); }
function isPdf(d) { return d.mime === 'application/pdf'; }
function isVideo(d) { return d.kind === 'link' || (d.mime && d.mime.startsWith('video/')); }

// Videos por link: YouTube, Vimeo, Google Drive o un .mp4 directo
function videoLink(url) {
  let u;
  try { u = new URL(url); } catch { return { type: 'other', url }; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host.endsWith('youtube.com')) id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/) || [])[1];
  if (id) {
    return {
      type: 'youtube',
      embed: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`,
      thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    };
  }
  const vimeo = host.endsWith('vimeo.com') && u.pathname.match(/\/(\d+)/);
  if (vimeo) return { type: 'vimeo', embed: `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1` };
  const drive = host === 'drive.google.com' && (u.pathname.match(/\/file\/d\/([\w-]+)/) || [null, u.searchParams.get('id')])[1];
  if (drive) return { type: 'drive', embed: `https://drive.google.com/file/d/${drive}/preview` };
  if (/\.(mp4|webm|m4v|mov)$/i.test(u.pathname)) return { type: 'direct', src: url };
  return { type: 'other', url };
}

const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><rect x="4.5" y="10" width="15" height="11" rx="2" fill="currentColor"/><circle cx="12" cy="15.2" r="1.6" fill="#7a1418"/><path d="M12 16.4v2" stroke="#7a1418" stroke-width="1.6" stroke-linecap="round"/></svg>';

// Cartelito de NUEVO (lo activa y desactiva el admin)
function newTag() {
  return Object.assign(document.createElement('span'), { className: 'new-tag', textContent: 'Nuevo' });
}

function playBadge() {
  return Object.assign(document.createElement('span'), { className: 'play-badge', ariaHidden: 'true' });
}

function placeDoc(el, d) {
  el.style.left = d.x + '%';
  el.style.top = d.y + '%';
  el.style.width = d.w + '%';
  el.style.zIndex = d.z || 0;
  el.style.setProperty('--rot', d.rot + 'deg');
}

function buildDoc(d) {
  const el = document.createElement('div');
  el.className = 'doc s-' + (d.style || 'papel');
  el.dataset.id = d.id;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  placeDoc(el, d);

  const body = document.createElement('div');
  body.className = 'doc-body';
  el.appendChild(body);

  const silhouette = d.pending && !d.kind; // jugadores: solo la forma
  if (silhouette) {
    el.classList.add('pending');
    el.setAttribute('aria-label', 'Documento aún no revelado');
    body.classList.add('s-' + (d.style || 'papel'));
    body.innerHTML = '<span class="q">?</span>';
    return el;
  }

  if (d.locked) { // pista con clave, todavía cerrada: solo la forma y el candado
    el.classList.add('sealed');
    el.setAttribute('aria-label', 'Pista bloqueada con clave');
    el.appendChild(Object.assign(document.createElement('span'), { className: 'pin' }));
    body.classList.add('seal-body');
    body.innerHTML = '<span class="seal-stamp">Clasificado</span><span class="wax">' + LOCK_SVG + '</span><span class="seal-label">Bloqueada</span>';
    if (d.isNew) el.appendChild(newTag());
    return el;
  }

  el.setAttribute('aria-label', d.title || 'Documento');
  el.appendChild(Object.assign(document.createElement('span'), { className: 'pin' }));

  if (d.kind === 'text') {
    if (d.title) body.appendChild(Object.assign(document.createElement('div'), { className: 'doc-title', textContent: d.title }));
    body.appendChild(Object.assign(document.createElement('div'), { className: 'doc-text', textContent: d.text }));
  } else if (isImage(d)) {
    body.classList.add('has-media');
    const img = document.createElement('img');
    img.src = d.file;
    img.alt = d.title || '';
    img.loading = 'lazy';
    img.draggable = false;
    body.appendChild(img);
  } else if (isVideo(d)) {
    body.classList.add('has-media');
    const frame = document.createElement('div');
    frame.className = 'video-frame';
    const link = d.kind === 'link' ? videoLink(d.url) : null;
    if (!link) { // archivo de video: se muestra el primer cuadro
      const v = document.createElement('video');
      v.src = d.file + '#t=0.5';
      v.muted = true;
      v.preload = 'metadata';
      v.playsInline = true;
      frame.appendChild(v);
    } else if (link.thumb) {
      const thumb = Object.assign(document.createElement('img'), { src: link.thumb, alt: '', loading: 'lazy', draggable: false });
      thumb.addEventListener('error', () => { thumb.remove(); frame.classList.add('film'); }); // sin miniatura: rollo de película
      frame.appendChild(thumb);
    } else {
      frame.classList.add('film');
    }
    frame.appendChild(playBadge());
    body.appendChild(frame);
  } else {
    body.appendChild(fileCard(d));
    if (isPdf(d)) renderPdfThumb(d.file, el, body);
  }

  if (d.style === 'polaroid' && d.kind !== 'text') {
    body.appendChild(Object.assign(document.createElement('div'), { className: 'doc-caption', textContent: d.caption || d.title || '' }));
  }

  if (d.isNew) el.appendChild(newTag());
  if (d.sealed) { // vista admin: tiene clave y nadie la abrió todavía
    el.appendChild(Object.assign(document.createElement('span'), { className: 'lock-badge', textContent: '🔒' }));
  }
  if (d.pending) { // vista admin: programado
    el.classList.add('is-scheduled');
    const badge = document.createElement('span');
    badge.className = 'sched-badge';
    badge.textContent = 'Aparece ' + new Date(d.publishAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    el.appendChild(badge);
  }
  return el;
}

function fileCard(d) {
  const card = document.createElement('div');
  card.className = 'doc-file-card';
  card.innerHTML = '<div class="doc-title"></div><div class="lines"></div><span class="ftype"></span>';
  card.querySelector('.doc-title').textContent = d.title || 'Documento';
  card.querySelector('.ftype').textContent = isPdf(d) ? 'PDF' : (d.file.split('.').pop() || 'ARCHIVO').toUpperCase();
  return card;
}

let pdfjsReady = null;
function loadPdfJs() {
  if (!pdfjsReady) {
    pdfjsReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return pdfjsReady;
}

const pdfCache = new Map(); // url -> Promise<PDFDocumentProxy>
function getPdf(url) {
  if (!pdfCache.has(url)) {
    const p = loadPdfJs().then((pdfjs) => pdfjs.getDocument(url).promise);
    p.catch(() => pdfCache.delete(url));
    pdfCache.set(url, p);
  }
  return pdfCache.get(url);
}

async function renderPage(pdf, number, cssWidth) {
  const page = await pdf.getPage(number);
  const base = page.getViewport({ scale: 1 });
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const viewport = page.getViewport({ scale: (cssWidth * ratio) / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

// Miniatura en el tablero. Si el PDF tiene más páginas, quedan hojas debajo
// que asoman la esquina inferior al pasar el mouse.
async function renderPdfThumb(url, el, body) {
  try {
    const pdf = await getPdf(url);
    body.replaceChildren(await renderPage(pdf, 1, 260));
    body.classList.add('has-media');
    const extra = Math.min(2, pdf.numPages - 1);
    for (let i = extra; i >= 1; i--) {
      const sheet = document.createElement('div');
      sheet.className = 'doc-under u' + i;
      sheet.appendChild(await renderPage(pdf, i + 1, 260));
      el.insertBefore(sheet, body);
    }
    if (extra) el.classList.add('multi-page');
  } catch {
    // se queda la tarjeta genérica
  }
}

// Visor: las páginas como hojas, sin la barra del navegador
async function renderPdfPages(d, container) {
  const status = Object.assign(document.createElement('div'), { className: 'lb-status', textContent: 'Abriendo documento…' });
  container.appendChild(status);
  try {
    const pdf = await getPdf(d.file);
    const width = Math.min(900, window.innerWidth - 48);
    status.remove();
    for (let n = 1; n <= pdf.numPages; n++) {
      if (!lightbox.classList.contains('open') || !container.isConnected) return;
      const sheet = document.createElement('div');
      sheet.className = 'lb-sheet';
      sheet.style.width = width + 'px';
      sheet.appendChild(await renderPage(pdf, n, width));
      container.appendChild(sheet);
    }
  } catch {
    status.remove();
    container.appendChild(Object.assign(document.createElement('iframe'), { src: d.file, title: d.title || 'Documento PDF' }));
  }
}

// ---------- Visor ampliado ----------

const lightbox = $('lightbox');

function openLightbox(d) {
  const content = $('lbContent');
  content.replaceChildren();
  const dl = $('lbDownload');
  dl.classList.add('hidden');
  dl.textContent = 'Abrir original';
  // Guardar en el archivo / pasar al tablero, desde el documento abierto
  const mv = $('lbMove');
  mv.classList.toggle('hidden', !!d.pending && !d.kind);
  mv.textContent = d.folder ? '📌 Pasar al tablero' : '🗂 Guardar en el archivo';
  mv.onclick = async () => {
    closeLightbox();
    await moveDoc(d.id, !d.folder);
  };

  if (d.kind === 'text') {
    const paper = document.createElement('div');
    paper.className = 'lb-paper';
    if (d.title) paper.appendChild(Object.assign(document.createElement('div'), { className: 'doc-title', textContent: d.title }));
    paper.appendChild(Object.assign(document.createElement('div'), { className: 'doc-text', textContent: d.text }));
    content.appendChild(paper);
  } else if (isImage(d)) {
    content.appendChild(Object.assign(document.createElement('img'), { src: d.file, alt: d.title || '' }));
  } else if (isVideo(d)) {
    const link = d.kind === 'link' ? videoLink(d.url) : { type: 'file', src: d.file };
    if (link.embed) {
      content.appendChild(Object.assign(document.createElement('iframe'), {
        className: 'lb-video',
        src: link.embed,
        title: d.title || 'Video',
        allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media',
        allowFullscreen: true,
      }));
    } else if (link.src) {
      content.appendChild(Object.assign(document.createElement('video'), {
        className: 'lb-video', src: link.src, controls: true, autoplay: true, playsInline: true,
      }));
    } else {
      dl.href = d.url;
      dl.textContent = 'Abrir video';
      dl.classList.remove('hidden');
      const paper = document.createElement('div');
      paper.className = 'lb-paper';
      paper.appendChild(Object.assign(document.createElement('div'), { className: 'doc-text', textContent: 'Este video se abre en otra pestaña: tocá "Abrir video".' }));
      content.appendChild(paper);
    }
  } else if (isPdf(d)) {
    const pages = Object.assign(document.createElement('div'), { className: 'lb-pages' });
    content.appendChild(pages);
    renderPdfPages(d, pages);
  } else {
    const paper = document.createElement('div');
    paper.className = 'lb-paper';
    paper.appendChild(Object.assign(document.createElement('div'), { className: 'doc-title', textContent: d.title || 'Documento' }));
    paper.appendChild(Object.assign(document.createElement('div'), { className: 'doc-text', textContent: 'Este archivo no se puede previsualizar. Usá "Abrir original".' }));
    content.appendChild(paper);
    dl.href = d.file;
    dl.classList.remove('hidden');
  }

  const caption = d.caption || (d.kind !== 'text' ? d.title : '');
  if (caption) content.appendChild(Object.assign(document.createElement('div'), { className: 'lb-caption', textContent: caption }));

  lightbox.classList.add('open');
  $('lbClose').focus();
}

// ---------- Desbloquear una pista con clave ----------

function openUnlock(d) {
  const content = $('lbContent');
  content.replaceChildren();
  $('lbDownload').classList.add('hidden');
  const mv = $('lbMove');
  mv.classList.remove('hidden');
  mv.textContent = d.folder ? '📌 Pasar al tablero' : '🗂 Guardar en el archivo';
  mv.onclick = async () => {
    closeLightbox();
    await moveDoc(d.id, !d.folder);
  };

  const box = document.createElement('form');
  box.className = 'lb-lock';
  box.autocomplete = 'off';
  box.innerHTML = `
    <span class="seal-stamp">Clasificado</span>
    <span class="wax big">${LOCK_SVG}</span>
    <h2>Pista bloqueada</h2>
    <p class="lock-hint"></p>
    <label class="lock-label" for="unlockInput">Ingresá la clave para desbloquear este documento</label>
    <input id="unlockInput" type="text" spellcheck="false" autocapitalize="characters" autocomplete="off" required>
    <button class="btn" type="submit">Desbloquear</button>
    <div class="lock-error" role="alert"></div>`;
  box.querySelector('.lock-hint').textContent = d.hint || 'Esta pista está protegida con una clave.';
  content.appendChild(box);
  lightbox.classList.add('open');
  const input = box.querySelector('input');
  const error = box.querySelector('.lock-error');
  setTimeout(() => input.focus(), 50);

  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = box.querySelector('button');
    btn.disabled = true;
    error.textContent = '';
    try {
      const res = await fetch('/api/unlock/' + d.id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: input.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo desbloquear');
      box.classList.add('opened');
      box.querySelector('h2').textContent = '¡Desbloqueada!';
      await new Promise((r) => setTimeout(r, 900));
      await load();
      const opened = (rendered.get(d.id) || {}).doc || archiveDocs.find((x) => x.id === d.id);
      if (opened && !opened.locked) openLightbox(opened);
      else closeLightbox();
    } catch (err) {
      error.textContent = err.message;
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
      input.select();
    } finally {
      btn.disabled = false;
    }
  });
}

function closeLightbox() {
  lightbox.classList.remove('open');
  $('lbContent').replaceChildren();
}

$('lbClose').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && lightbox.classList.contains('open')) {
    e.preventDefault(); // que el Escape no cierre también el archivo de abajo
    closeLightbox();
  }
});

function docFromEvent(e) {
  const el = e.target.closest('.doc, .note');
  if (!el) return null;
  return el.classList.contains('note') ? notesMap.get(el.dataset.id) : rendered.get(el.dataset.id);
}

$('board').addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  if (e.target.closest('.note-del, .note-input')) return;
  const r = docFromEvent(e);
  if (threading) return r && pickThreadEnd(r);
  if (!r) return;
  if (r.type === 'note') return editNote(r);
  if (r.doc.locked) return openUnlock(r.doc);
  if (r.doc.pending && !r.doc.kind) return toast('Este documento todavía no fue revelado…');
  openLightbox(r.doc);
});

$('board').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('.note-input')) return;
  const r = docFromEvent(e);
  if (!r) return;
  e.preventDefault();
  if (threading) return pickThreadEnd(r);
  if (r.type === 'note') return editNote(r);
  if (r.doc.locked) return openUnlock(r.doc);
  if (r.doc.pending && !r.doc.kind) return toast('Este documento todavía no fue revelado…');
  openLightbox(r.doc);
});

// ---------- Acomodar ----------
// Cualquiera puede arrastrar las pistas reveladas; la posición se guarda para todos.
// El admin además puede rotar y cambiar el tamaño en modo "Acomodar".

$('editBtn').addEventListener('click', () => {
  setThreading(false);
  editing = !editing;
  $('board').classList.toggle('editing', editing);
  $('editBtn').textContent = editing ? 'Listo' : 'Acomodar';
  $('editHint').classList.toggle('hidden', !editing);
});

let suppressClick = false;
let pressed = null;
const DRAG_THRESHOLD = 6;

const saveTimers = new Map();
const unsaved = new Set();
function saveLayout(r) {
  r.sig = JSON.stringify(r.doc);
  unsaved.add(r.doc.id);
  clearTimeout(saveTimers.get(r.doc.id));
  saveTimers.set(r.doc.id, setTimeout(async () => {
    const { x, y, z, rot, w } = r.doc;
    const isNote = r.type === 'note';
    const res = await fetch(isNote ? '/api/notes/' + r.doc.id : '/api/layout/' + r.doc.id, {
      method: isNote ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(role === 'admin' && !isNote ? { x, y, z, rot, w } : { x, y, z }),
    }).catch(() => null);
    if (!res || !res.ok) toast('No se pudo guardar la posición');
    unsaved.delete(r.doc.id);
  }, 300));
}

const maxZ = () => Math.max(0, ...[...rendered.values(), ...notesMap.values()].map((r) => r.doc.z || 0));

$('board').addEventListener('pointerdown', (e) => {
  if (threading || e.button > 0) return;
  if (e.target.closest('.note-del, .note-input')) return;
  const r = docFromEvent(e);
  if (!r) return;
  if (r.doc.pending && !r.doc.kind) return; // las siluetas no se mueven
  pressed = { r, id: e.pointerId, startX: e.clientX, startY: e.clientY, x0: r.doc.x, y0: r.doc.y };
});

$('board').addEventListener('pointermove', (e) => {
  if (!pressed || e.pointerId !== pressed.id) return;
  const { r, startX, startY, x0, y0 } = pressed;
  if (!dragging) {
    if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
    dragging = { r, rect: corkBox(), x0, y0 };
    r.el.classList.add('dragging');
    r.el.setPointerCapture(e.pointerId);
  }
  const { rect } = dragging;
  const p = fitInside(r, x0 + ((e.clientX - startX) / rect.width) * 100, y0 + ((e.clientY - startY) / rect.height) * 100);
  r.doc.x = Math.round(p.x * 100) / 100;
  r.doc.y = Math.round(p.y * 100) / 100;
  placeDoc(r.el, r.doc);
  // ¿la está soltando sobre la carpeta del archivo?
  if (r.type !== 'note') {
    const f = $('folderBtn').getBoundingClientRect();
    const over = e.clientX >= f.left - 12 && e.clientX <= f.right + 12 && e.clientY >= f.top - 12 && e.clientY <= f.bottom + 12;
    dragging.overFolder = over;
    $('folderBtn').classList.toggle('drop-target', over);
    r.el.classList.toggle('to-folder', over);
  }
});

function endDrag() {
  const wasDragging = dragging;
  pressed = null;
  if (!wasDragging) return;
  const { r } = wasDragging;
  dragging = null;
  suppressClick = true; // el click que sigue al soltar no abre el documento
  setTimeout(() => { suppressClick = false; }, 0);
  r.el.classList.remove('dragging', 'to-folder');
  $('folderBtn').classList.remove('drop-target');
  if (wasDragging.overFolder) { // vuelve a su lugar en el corcho (para cuando la saquen) y se guarda
    r.doc.x = wasDragging.x0;
    r.doc.y = wasDragging.y0;
    placeDoc(r.el, r.doc);
    moveDoc(r.doc.id, true);
    return;
  }
  r.doc.z = maxZ() + 1;
  placeDoc(r.el, r.doc);
  saveLayout(r);
}

// ---------- Archivo (carpeta de evidencias) ----------
// Pistas guardadas fuera del corcho. Cualquiera puede guardar una pista acá o
// pasarla al tablero; se guarda para todos. El admin elige dónde empieza cada una.

let archiveDocs = [];
let archiveSig = '';

async function moveDoc(id, toFolder) {
  try {
    const res = await fetch('/api/layout/' + id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toFolder ? { folder: true } : { folder: false, z: maxZ() + 1 }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo mover');
    toast(toFolder ? 'Guardada en el archivo' : 'Pasó al tablero');
    $('folderBtn').classList.add('bump');
    setTimeout(() => $('folderBtn').classList.remove('bump'), 500);
  } catch (e) {
    toast(e.message);
  }
  await load();
}

function archiveThumb(d) {
  const box = document.createElement('div');
  box.className = 'archive-thumb';
  if (d.pending && !d.kind) {
    box.classList.add('unknown');
    box.textContent = '?';
  } else if (d.locked) {
    box.classList.add('sealed-thumb');
    box.innerHTML = '<span class="wax">' + LOCK_SVG + '</span>';
  } else if (d.kind === 'text' && d.text.trim().length <= 12) { // letras o palabras sueltas: bien grandes
    box.classList.add('paper', 'big');
    if (d.style === 'nota') box.classList.add('nota');
    box.textContent = d.text.trim();
  } else if (d.kind === 'text') {
    box.classList.add('paper');
    if (d.style === 'nota') box.classList.add('nota');
    if (d.title) box.appendChild(Object.assign(document.createElement('div'), { className: 'doc-title', textContent: d.title }));
    box.appendChild(Object.assign(document.createElement('div'), { className: 'doc-text', textContent: d.text }));
  } else if (isImage(d)) {
    box.appendChild(Object.assign(document.createElement('img'), { src: d.file, alt: '', loading: 'lazy' }));
  } else if (isVideo(d)) {
    const link = d.kind === 'link' ? videoLink(d.url) : null;
    if (!link) {
      box.appendChild(Object.assign(document.createElement('video'), { src: d.file + '#t=0.5', muted: true, preload: 'metadata', playsInline: true }));
    } else if (link.thumb) {
      const img = Object.assign(document.createElement('img'), { src: link.thumb, alt: '', loading: 'lazy' });
      img.addEventListener('error', () => { img.remove(); box.classList.add('film'); });
      box.appendChild(img);
    } else {
      box.classList.add('film');
    }
    box.appendChild(playBadge());
  } else if (isPdf(d)) {
    box.classList.add('paper');
    getPdf(d.file).then((pdf) => renderPage(pdf, 1, 160)).then((c) => box.replaceChildren(c)).catch(() => { box.textContent = 'PDF'; });
  } else {
    box.classList.add('paper');
    box.textContent = 'Documento';
  }
  return box;
}

function showArchive(docs) {
  archiveDocs = docs;
  const count = $('folderCount');
  count.textContent = docs.length;
  count.classList.toggle('hidden', docs.length === 0);
  // si hay algo nuevo guardado en el archivo, la carpeta también lo avisa
  $('folderBtn').classList.toggle('has-new', docs.some((d) => d.isNew && !(d.pending && !d.kind)));

  const sig = JSON.stringify(docs);
  if (sig === archiveSig) return;
  archiveSig = sig;
  const grid = $('archiveGrid');
  grid.replaceChildren();
  $('archiveEmpty').classList.toggle('hidden', docs.length > 0);
  for (const d of [...docs].sort((a, b) => (b.z || 0) - (a.z || 0))) {
    const unknown = d.pending && !d.kind;
    const card = document.createElement('div');
    card.className = 'archive-card';
    card.appendChild(archiveThumb(d));
    if (d.isNew && !unknown) card.appendChild(newTag());
    card.appendChild(Object.assign(document.createElement('div'), {
      className: 'archive-title',
      textContent: unknown ? 'Todavía no revelado' : d.locked ? 'Pista bloqueada' : d.title || d.caption || 'Sin título',
    }));
    if (!unknown) {
      const actions = document.createElement('div');
      actions.className = 'archive-actions';
      const view = Object.assign(document.createElement('button'), { className: 'btn small dark', type: 'button', textContent: 'Ver' });
      if (d.locked) view.textContent = 'Abrir';
      view.addEventListener('click', () => (d.locked ? openUnlock(d) : openLightbox(d)));
      const pin = Object.assign(document.createElement('button'), { className: 'btn small', type: 'button', textContent: 'Al tablero' });
      pin.addEventListener('click', async () => {
        pin.disabled = true;
        await moveDoc(d.id, false);
      });
      actions.append(view, pin);
      card.appendChild(actions);
    }
    grid.appendChild(card);
  }
}

function openArchive() {
  setThreading(false);
  $('archive').classList.add('open');
  $('archiveClose').focus();
}
function closeArchive() {
  $('archive').classList.remove('open');
}
$('folderBtn').addEventListener('click', () => ($('archive').classList.contains('open') ? closeArchive() : openArchive()));
$('archiveClose').addEventListener('click', closeArchive);
$('archive').addEventListener('click', (e) => { if (e.target === $('archive')) closeArchive(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.defaultPrevented && $('archive').classList.contains('open')) closeArchive();
});
$('board').addEventListener('pointerup', endDrag);
$('board').addEventListener('pointercancel', endDrag);

$('board').addEventListener('wheel', (e) => {
  if (!editing) return;
  const r = docFromEvent(e);
  if (!r || r.type === 'note') return;
  e.preventDefault();
  const dir = (e.deltaY || e.deltaX) > 0 ? 1 : -1;
  if (e.shiftKey) r.doc.w = Math.min(60, Math.max(4, Math.round((r.doc.w + dir * 0.5) * 10) / 10));
  else r.doc.rot = Math.min(45, Math.max(-45, Math.round((r.doc.rot + dir) * 10) / 10));
  placeDoc(r.el, r.doc);
  keepInside(r);
  saveLayout(r);
}, { passive: false });

// ---------- Post-its ----------
// Notas cortas que escribe cualquier jugador. Se pueden mover, editar,
// despegar y atar con hilo como cualquier pista.

const NOTE_W = 6.4; // ancho en % del tablero
let editingNote = null;

function buildNote(n) {
  const el = document.createElement('div');
  el.className = 'note';
  el.dataset.id = n.id;
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', 'Post-it: ' + (n.text || 'vacío'));
  placeDoc(el, { ...n, w: NOTE_W });
  el.innerHTML = '<span class="pin"></span><span class="note-text"></span><button class="note-del" type="button" title="Despegar post-it" aria-label="Despegar post-it">×</button>';
  el.querySelector('.note-text').textContent = n.text;
  return el;
}

// La letra se achica hasta que entre todo el texto en el post-it
function fitNoteText(el) {
  const t = el.querySelector('.note-input') || el.querySelector('.note-text');
  if (!t) return;
  t.style.fontSize = '';
  t.style.wordBreak = '';
  const cs = getComputedStyle(el);
  const avail = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const base = parseFloat(getComputedStyle(t).fontSize);
  const overflows = () => t.scrollHeight > avail + 1 || t.scrollWidth > t.clientWidth + 1;
  const shrink = (limit) => {
    let size = base;
    t.style.fontSize = '';
    while (overflows() && size > base * limit) {
      size *= 0.92;
      t.style.fontSize = size + 'px';
    }
  };
  shrink(0.55);
  if (overflows()) { // una palabra larguísima: se parte en renglones y se vuelve a ajustar
    t.style.wordBreak = 'break-word';
    shrink(0.35);
  }
}

function refitNotes() {
  notesMap.forEach((r) => fitNoteText(r.el));
}
let refitTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(refitNotes, 150);
});
if (document.fonts) document.fonts.ready.then(refitNotes); // la letra manuscrita cambia las medidas

function showNotes(list) {
  if (dragging) return;
  const board = $('board');
  const seen = new Set();
  for (const n of list) {
    seen.add(n.id);
    const sig = JSON.stringify(n);
    const prev = notesMap.get(n.id);
    if (prev && (prev.sig === sig || unsaved.has(n.id) || editingNote === prev)) continue;
    const el = buildNote(n);
    if (prev) prev.el.replaceWith(el);
    else board.appendChild(el);
    const entry = { el, sig, doc: { ...n, w: NOTE_W }, type: 'note' };
    notesMap.set(n.id, entry);
    fitNoteText(el);
    keepInside(entry);
  }
  for (const [id, r] of notesMap) {
    if (!seen.has(id) && editingNote !== r && !unsaved.has(id)) {
      r.el.remove();
      notesMap.delete(id);
    }
  }
}

async function noteRequest(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) throw new Error(data.error || 'No se pudo guardar el post-it');
  return data;
}

function editNote(r, isNew = false) {
  if (editingNote) return;
  editingNote = r;
  const textEl = r.el.querySelector('.note-text');
  const input = document.createElement('textarea');
  input.className = 'note-input';
  input.maxLength = 80;
  input.value = r.doc.text || '';
  input.placeholder = 'Escribí…';
  textEl.replaceWith(input);
  r.el.classList.add('editing');
  fitNoteText(r.el);
  input.addEventListener('input', () => fitNoteText(r.el));
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const text = input.value.replace(/\s+/g, ' ').trim();
    input.replaceWith(textEl);
    r.el.classList.remove('editing');
    fitNoteText(r.el);
    editingNote = null;
    if (save && !text && isNew) return removeNote(r, false);
    if (!save || text === r.doc.text || !text) return;
    textEl.textContent = text;
    fitNoteText(r.el);
    r.doc.text = text;
    r.sig = JSON.stringify({ ...r.doc, w: undefined });
    try {
      await noteRequest('PATCH', '/api/notes/' + r.doc.id, { text });
    } catch (e) {
      toast(e.message);
    }
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(!isNew ? false : true); }
  });
  input.addEventListener('blur', () => finish(true));
}

async function removeNote(r, ask = true) {
  if (ask && r.doc.text && !confirm('¿Despegar este post-it? Lo deja de ver todo el grupo.')) return;
  r.el.remove();
  notesMap.delete(r.doc.id);
  threads = threads.filter((t) => t.from !== r.doc.id && t.to !== r.doc.id);
  try {
    await noteRequest('DELETE', '/api/notes/' + r.doc.id);
  } catch (e) {
    toast(e.message);
  }
}

$('board').addEventListener('click', (e) => {
  const del = e.target.closest('.note-del');
  if (!del) return;
  e.stopPropagation();
  const r = notesMap.get(del.closest('.note').dataset.id);
  if (r) removeNote(r);
}, true);

$('notepad').addEventListener('click', async () => {
  setThreading(false);
  // Aparece en la zona del corcho que se está viendo, un poco al azar
  const board = corkBox();
  const cx = ((Math.min(window.innerWidth, board.right) + Math.max(0, board.left)) / 2 - board.left) / board.width * 100;
  const cy = ((Math.min(window.innerHeight, board.bottom) + Math.max(0, board.top)) / 2 - board.top) / board.height * 100;
  const x = cx + (Math.random() * 16 - 8);
  const y = cy + (Math.random() * 16 - 8);
  try {
    const { note } = await noteRequest('POST', '/api/notes', { x, y, z: maxZ() + 1, text: '' });
    const el = buildNote(note);
    $('board').appendChild(el);
    el.classList.add('appear');
    const entry = { el, sig: JSON.stringify(note), doc: { ...note, w: NOTE_W }, type: 'note' };
    notesMap.set(note.id, entry);
    keepInside(entry);
    editNote(entry, true);
  } catch (e) {
    toast(e.message);
  }
});

// ---------- Hilo rojo ----------

const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = $('threads');
let pointer = null; // posición del mouse en coordenadas del tablero
let lastSig = '';

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Centro de la chinche de cada documento, en píxeles del tablero
function pinPoint(id, boardRect) {
  const r = rendered.get(id) || notesMap.get(id);
  const pin = r && r.el.querySelector('.pin');
  if (!pin) return null;
  const p = pin.getBoundingClientRect();
  return { x: p.left + p.width / 2 - boardRect.left, y: p.top + p.height / 2 - boardRect.top };
}

function curve(a, b) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const sag = Math.min(60, dist * 0.06); // el hilo cuelga un poco
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2 + sag;
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}

function drawThreads() {
  const board = $('board');
  if ($('boardView').classList.contains('hidden')) return;
  const rect = corkBox();
  const lines = [];
  for (const t of threads) {
    const a = pinPoint(t.from, rect);
    const b = pinPoint(t.to, rect);
    if (a && b) lines.push({ id: t.id, d: curve(a, b), a, b });
  }
  let draft = null;
  if (threading && threadFrom && pointer) {
    const a = pinPoint(threadFrom, rect);
    if (a) draft = curve(a, pointer);
  }
  const sig = rect.width + '|' + lines.map((l) => l.d).join('|') + '|' + draft;
  if (sig === lastSig) return;
  lastSig = sig;

  const w = Math.max(1.6, rect.width / 520); // grosor proporcional al tablero
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  svg.replaceChildren();
  for (const l of lines) {
    const g = svgEl('g', { 'data-id': l.id });
    g.appendChild(svgEl('path', { d: l.d, class: 't-shadow', 'stroke-width': w * 1.4, transform: `translate(${w * 1.2} ${w * 2})` }));
    g.appendChild(svgEl('path', { d: l.d, class: 't-line', 'stroke-width': w }));
    g.appendChild(svgEl('path', { d: l.d, class: 't-hi', 'stroke-width': w * 0.35 }));
    g.appendChild(svgEl('path', { d: l.d, class: 't-hit', 'stroke-width': Math.max(14, w * 6) }));
    g.appendChild(svgEl('circle', { cx: l.a.x, cy: l.a.y, r: w * 0.9, class: 'knot' }));
    g.appendChild(svgEl('circle', { cx: l.b.x, cy: l.b.y, r: w * 0.9, class: 'knot' }));
    svg.appendChild(g);
  }
  if (draft) svg.appendChild(svgEl('path', { d: draft, class: 't-draft', 'stroke-width': w }));
}

// Redibuja cuando algo se mueve (hover, arrastre, imágenes que terminan de cargar)
(function frame() {
  drawThreads();
  requestAnimationFrame(frame);
})();

function threadHint(text) {
  $('threadHint').textContent = text;
  $('threadHint').classList.toggle('hidden', !text);
}

function setThreading(on) {
  threading = on;
  threadFrom = null;
  pointer = null;
  [...rendered.values(), ...notesMap.values()].forEach((r) => r.el.classList.remove('thread-from'));
  $('board').classList.toggle('threading', on);
  $('spool').classList.toggle('active', on);
  $('spool').setAttribute('aria-pressed', String(on));
  $('spoolLabel').textContent = on ? 'Guardar hilo' : 'Hilo rojo';
  threadHint(on ? 'Tocá la primera pista para atar el hilo · Esc para terminar' : '');
}

$('spool').addEventListener('click', () => {
  if (editing) $('editBtn').click();
  setThreading(!threading);
});

async function pickThreadEnd(r) {
  if (r.doc.pending && !r.doc.kind) return toast('Esa pista todavía no fue revelada…');
  if (!threadFrom) {
    threadFrom = r.doc.id;
    r.el.classList.add('thread-from');
    threadHint('Ahora tocá la pista que querés conectar · Esc para cancelar');
    return;
  }
  const from = threadFrom;
  if (from === r.doc.id) return;
  threadFrom = null;
  [...rendered.values(), ...notesMap.values()].forEach((x) => x.el.classList.remove('thread-from'));
  threadHint('Tocá la primera pista para atar el hilo · Esc para terminar');
  try {
    const res = await fetch('/api/threads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: r.doc.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    threads = data.threads;
  } catch (e) {
    toast(e.message || 'No se pudo guardar el hilo');
  }
}

$('board').addEventListener('pointermove', (e) => {
  if (!threading || !threadFrom) return;
  const rect = corkBox();
  pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !threading || lightbox.classList.contains('open')) return;
  if (threadFrom) setThreading(true); // cancela solo la punta suelta
  else setThreading(false);
});

// Cortar un hilo: click sobre el hilo
let threadToCut = null;
svg.addEventListener('click', (e) => {
  const g = e.target.closest('g[data-id]');
  if (!g) return;
  e.stopPropagation();
  threadToCut = g.dataset.id;
  const menu = $('threadMenu');
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.remove('hidden');
});
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#threadMenu') && !e.target.closest('.threads g')) $('threadMenu').classList.add('hidden');
});
$('cutThread').addEventListener('click', async () => {
  $('threadMenu').classList.add('hidden');
  if (!threadToCut) return;
  try {
    const res = await fetch('/api/threads/' + threadToCut, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    threads = data.threads;
  } catch (e) {
    toast(e.message || 'No se pudo cortar el hilo');
  }
  threadToCut = null;
});

load();
