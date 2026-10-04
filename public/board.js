'use strict';

const $ = (id) => document.getElementById(id);
const POLL_MS = 15000;
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

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
    if (r.status === 401) return location.replace('/');
    s = await r.json();
  } catch {
    return; // sin conexión: se reintenta en el próximo ciclo
  }
  clockOffset = s.serverNow - Date.now();
  role = s.role;
  unlockAt = s.unlockAt ? new Date(s.unlockAt).getTime() : null;

  $('previewBadge').classList.toggle('hidden', role !== 'preview');
  $('editBtn').classList.toggle('hidden', role !== 'admin');
  $('adminLink').classList.toggle('hidden', role !== 'admin');

  $('spool').classList.toggle('hidden', s.locked);
  if (s.locked) {
    setThreading(false);
    showWait();
  } else {
    threads = s.threads || [];
    showBoard(s.docs);
  }
}

setInterval(load, POLL_MS);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
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
  $('caseId').textContent = 'Exp. 0417 · Acceso restringido';

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
  $('caseId').textContent = 'Exp. 0417 · Tablero de evidencias';
  if (dragging) return; // no pisar lo que el admin está moviendo

  const board = $('board');
  const seen = new Set();
  for (const d of docs) {
    seen.add(d.id);
    const sig = JSON.stringify(d);
    const prev = rendered.get(d.id);
    if (prev && prev.sig === sig) continue;
    const el = buildDoc(d);
    const becameVisible = !prev || (prev.doc.pending && !d.pending);
    if (!firstRender && becameVisible) el.classList.add('appear');
    if (prev) prev.el.replaceWith(el);
    else board.appendChild(el);
    rendered.set(d.id, { el, sig, doc: d });
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
  } else {
    body.appendChild(fileCard(d));
    if (isPdf(d)) renderPdfThumb(d.file, body);
  }

  if (d.style === 'polaroid' && d.kind !== 'text') {
    body.appendChild(Object.assign(document.createElement('div'), { className: 'doc-caption', textContent: d.caption || d.title || '' }));
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

async function renderPdfThumb(url, body) {
  try {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument(url).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 520 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    body.replaceChildren(canvas);
    body.classList.add('has-media');
  } catch {
    // se queda la tarjeta genérica
  }
}

// ---------- Visor ampliado ----------

const lightbox = $('lightbox');

function openLightbox(d) {
  const content = $('lbContent');
  content.replaceChildren();
  const dl = $('lbDownload');
  dl.classList.add('hidden');

  if (d.kind === 'text') {
    const paper = document.createElement('div');
    paper.className = 'lb-paper';
    if (d.title) paper.appendChild(Object.assign(document.createElement('div'), { className: 'doc-title', textContent: d.title }));
    paper.appendChild(Object.assign(document.createElement('div'), { className: 'doc-text', textContent: d.text }));
    content.appendChild(paper);
  } else if (isImage(d)) {
    content.appendChild(Object.assign(document.createElement('img'), { src: d.file, alt: d.title || '' }));
  } else if (isPdf(d)) {
    content.appendChild(Object.assign(document.createElement('iframe'), { src: d.file, title: d.title || 'Documento PDF' }));
    dl.href = d.file;
    dl.classList.remove('hidden');
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

function closeLightbox() {
  lightbox.classList.remove('open');
  $('lbContent').replaceChildren();
}

$('lbClose').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => {
  if (e.target === lightbox) closeLightbox();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && lightbox.classList.contains('open')) closeLightbox();
});

function docFromEvent(e) {
  const el = e.target.closest('.doc');
  return el && rendered.get(el.dataset.id);
}

$('board').addEventListener('click', (e) => {
  if (editing) return;
  const r = docFromEvent(e);
  if (threading) return r && pickThreadEnd(r);
  if (!r) return;
  if (r.doc.pending && !r.doc.kind) return toast('Este documento todavía no fue revelado…');
  openLightbox(r.doc);
});

$('board').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const r = docFromEvent(e);
  if (!r || editing) return;
  e.preventDefault();
  if (threading) return pickThreadEnd(r);
  if (r.doc.pending && !r.doc.kind) return toast('Este documento todavía no fue revelado…');
  openLightbox(r.doc);
});

// ---------- Modo acomodar (solo admin) ----------

$('editBtn').addEventListener('click', () => {
  setThreading(false);
  editing = !editing;
  $('board').classList.toggle('editing', editing);
  $('editBtn').textContent = editing ? 'Listo' : 'Acomodar';
  $('editHint').classList.toggle('hidden', !editing);
});

const saveTimers = new Map();
function saveLayout(r, fields) {
  Object.assign(r.doc, fields);
  r.sig = JSON.stringify(r.doc);
  clearTimeout(saveTimers.get(r.doc.id));
  saveTimers.set(r.doc.id, setTimeout(async () => {
    const res = await fetch('/api/admin/docs/' + r.doc.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: r.doc.x, y: r.doc.y, w: r.doc.w, rot: r.doc.rot, z: r.doc.z }),
    }).catch(() => null);
    if (!res || !res.ok) toast('No se pudo guardar la posición');
  }, 400));
}

const maxZ = () => Math.max(0, ...[...rendered.values()].map((r) => r.doc.z || 0));

$('board').addEventListener('pointerdown', (e) => {
  if (!editing) return;
  const r = docFromEvent(e);
  if (!r) return;
  e.preventDefault();
  const rect = $('board').getBoundingClientRect();
  dragging = {
    r,
    rect,
    startX: e.clientX,
    startY: e.clientY,
    x0: r.doc.x,
    y0: r.doc.y,
  };
  r.el.classList.add('dragging');
  r.el.setPointerCapture(e.pointerId);
});

$('board').addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const { r, rect, startX, startY, x0, y0 } = dragging;
  const x = Math.min(100, Math.max(0, x0 + ((e.clientX - startX) / rect.width) * 100));
  const y = Math.min(100, Math.max(0, y0 + ((e.clientY - startY) / rect.height) * 100));
  r.doc.x = Math.round(x * 100) / 100;
  r.doc.y = Math.round(y * 100) / 100;
  placeDoc(r.el, r.doc);
});

function endDrag() {
  if (!dragging) return;
  const { r } = dragging;
  r.el.classList.remove('dragging');
  r.doc.z = maxZ() + 1;
  placeDoc(r.el, r.doc);
  saveLayout(r, {});
  dragging = null;
}
$('board').addEventListener('pointerup', endDrag);
$('board').addEventListener('pointercancel', endDrag);

$('board').addEventListener('wheel', (e) => {
  if (!editing) return;
  const r = docFromEvent(e);
  if (!r) return;
  e.preventDefault();
  const dir = (e.deltaY || e.deltaX) > 0 ? 1 : -1;
  if (e.shiftKey) r.doc.w = Math.min(60, Math.max(4, Math.round((r.doc.w + dir * 0.5) * 10) / 10));
  else r.doc.rot = Math.min(45, Math.max(-45, Math.round((r.doc.rot + dir) * 10) / 10));
  placeDoc(r.el, r.doc);
  saveLayout(r, {});
}, { passive: false });

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
  const r = rendered.get(id);
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
  const rect = board.getBoundingClientRect();
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
  rendered.forEach((r) => r.el.classList.remove('thread-from'));
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
  rendered.forEach((x) => x.el.classList.remove('thread-from'));
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
  const rect = $('board').getBoundingClientRect();
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
