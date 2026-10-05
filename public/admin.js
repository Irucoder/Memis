'use strict';

const $ = (id) => document.getElementById(id);
let state = null;
let clockOffset = 0;
let kind = 'file';
let filter = 'all';

const now = () => Date.now() + clockOffset;

function toast(msg) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) {
    location.replace('/?salida=' + ((await r.clone().json().catch(() => ({}))).reason || 'sesion'));
    return new Promise(() => {}); // la página se va: no seguir
  }
  if (r.status === 403) location.replace('/tablero');
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Error ' + r.status);
  return data;
}

// "2026-10-10T21:00" (hora local) <-> ISO
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null;
}
const fmt = (iso) => new Date(iso).toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function load() {
  state = await api('GET', '/api/admin/state');
  clockOffset = state.serverNow - Date.now();
  renderSettings();
  renderDocs();
}

// ---------- Apertura ----------

function renderSettings() {
  const { unlockAt, showPendingDefault } = state.settings;
  const el = $('unlockStatus');
  if (!unlockAt) {
    el.innerHTML = '<span class="dot" style="background:#c8443a"></span>Cerrado: los jugadores ven "acceso aún no habilitado".';
  } else if (new Date(unlockAt).getTime() > now()) {
    el.innerHTML = '<span class="dot" style="background:#f1e64a"></span>Cuenta regresiva activa: abre el ' + fmt(unlockAt) + ' hs.';
  } else {
    el.innerHTML = '<span class="dot" style="background:#5fc27e"></span>Abierto desde el ' + fmt(unlockAt) + ' hs.';
  }
  if (document.activeElement !== $('unlockInput')) $('unlockInput').value = toLocalInput(unlockAt);
  $('showPending').checked = !!showPendingDefault;
  const n = state.threadCount || 0;
  $('threadStatus').textContent = n === 0 ? 'Todavía no hay hilos.' : n === 1 ? 'Hay 1 hilo en el tablero.' : `Hay ${n} hilos en el tablero.`;
  $('clearThreads').disabled = n === 0;
  const m = state.noteCount || 0;
  $('noteStatus').textContent = m === 0 ? 'Todavía no hay post-its.' : m === 1 ? 'Hay 1 post-it en el tablero.' : `Hay ${m} post-its en el tablero.`;
  $('clearNotes').disabled = m === 0;
}

async function saveSettings(patch, msg) {
  try {
    const { settings } = await api('PUT', '/api/admin/settings', patch);
    state.settings = settings;
    renderSettings();
    toast(msg);
  } catch (e) {
    toast(e.message);
  }
}

$('saveUnlock').addEventListener('click', () => {
  const v = $('unlockInput').value;
  if (!v) return toast('Elegí una fecha y hora');
  saveSettings({ unlockAt: fromLocalInput(v) }, 'Fecha de apertura guardada');
});
$('openNow').addEventListener('click', () => saveSettings({ unlockAt: new Date(now()).toISOString() }, 'Sitio abierto'));
$('closeSite').addEventListener('click', () => {
  if (confirm('¿Cerrar el sitio para los jugadores sin fecha de apertura?')) saveSettings({ unlockAt: null }, 'Sitio cerrado');
});
$('clearNotes').addEventListener('click', async () => {
  if (!confirm('¿Borrar todos los post-its que escribieron los jugadores? No se puede deshacer.')) return;
  try {
    await api('DELETE', '/api/admin/notes');
    toast('Post-its borrados');
    await load();
  } catch (e) {
    toast(e.message);
  }
});
$('clearThreads').addEventListener('click', async () => {
  if (!confirm('¿Borrar todos los hilos que conectaron los jugadores? No se puede deshacer.')) return;
  try {
    await api('DELETE', '/api/admin/threads');
    toast('Hilos borrados');
    await load();
  } catch (e) {
    toast(e.message);
  }
});
$('showPending').addEventListener('change', (e) => saveSettings({ showPendingDefault: e.target.checked }, 'Configuración guardada'));

// ---------- Carga ----------

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  kind = b.dataset.kind;
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  $('fileField').classList.toggle('hidden', kind !== 'file');
  $('textField').classList.toggle('hidden', kind !== 'text');
  $('linkField').classList.toggle('hidden', kind !== 'link');
}));

$('fLock').addEventListener('change', () => $('lockFields').classList.toggle('hidden', !$('fLock').checked));

document.querySelectorAll('input[name=when]').forEach((r) => r.addEventListener('change', () => {
  const later = document.querySelector('input[name=when]:checked').value === 'later';
  $('fPublishAt').disabled = !later;
  if (later && !$('fPublishAt').value) $('fPublishAt').value = toLocalInput(new Date(now() + 3600000).toISOString());
}));

// Fotos muy pesadas se achican antes de subirlas para entrar en el límite del hosting.
async function shrinkImage(file, limit) {
  if (file.size <= limit || !/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bitmap = await createImageBitmap(file);
  let maxSide = 3000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (blob && blob.size <= limit) {
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    }
    maxSide = Math.round(maxSide * 0.75);
  }
  return file;
}

async function uploadFile(file, meta) {
  const limit = state.maxUploadBytes || 6 * 1024 * 1024;
  const toSend = await shrinkImage(file, limit);
  if (toSend.size > limit) {
    const mb = (limit / 1024 / 1024).toFixed(1);
    if (file.type.startsWith('video/')) throw new Error(`"${file.name}" pesa más de ${mb} MB. Subilo a YouTube (oculto) o Google Drive y cargalo con "Video por link".`);
    throw new Error(`"${file.name}" pesa más de ${mb} MB. Comprimilo y volvé a intentar.`);
  }
  const r = await fetch('/api/admin/docs', {
    method: 'POST',
    headers: {
      'Content-Type': toSend.type || 'application/octet-stream',
      'X-Doc-Meta': encodeURIComponent(JSON.stringify({ ...meta, fileName: toSend.name })),
    },
    body: toSend,
  });
  if (r.status === 401) {
    location.replace('/?salida=' + ((await r.clone().json().catch(() => ({}))).reason || 'sesion'));
    return new Promise(() => {}); // la página se va: no seguir
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 413) throw new Error(`"${file.name}" es demasiado grande. Comprimilo y volvé a intentar.`);
  if (!r.ok) throw new Error(data.error || 'Error ' + r.status);
  return data;
}

$('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const later = document.querySelector('input[name=when]:checked').value === 'later';
  if (later && !$('fPublishAt').value) return toast('Elegí cuándo aparece');
  const common = {
    kind,
    caption: $('fCaption').value.trim(),
    preview: $('fPreview').value,
    place: $('fPlace').value,
    publishAt: later ? fromLocalInput($('fPublishAt').value) : null,
  };
  if ($('fStyle').value !== 'auto') common.style = $('fStyle').value;
  if ($('fLock').checked) {
    if (!$('fLockKey').value.trim()) return toast('Escribí la clave para desbloquear la pista');
    common.lockKey = $('fLockKey').value.trim();
    common.lockHint = $('fLockHint').value.trim();
  }
  const title = $('fTitle').value.trim();

  const jobs = [];
  if (kind === 'text') {
    if (!$('fText').value.trim()) return toast('Escribí el texto del documento');
    jobs.push({ ...common, title, text: $('fText').value });
  } else if (kind === 'link') {
    const url = $('fUrl').value.trim();
    if (!/^https:\/\//i.test(url)) return toast('Pegá el link completo del video (empieza con https://)');
    jobs.push({ ...common, title: title || 'Video', url });
  } else {
    const files = [...$('fFile').files];
    if (!files.length) return toast('Elegí al menos un archivo');
    for (const f of files) {
      jobs.push({ ...common, file: f, title: title || f.name.replace(/\.[^.]+$/, '') });
    }
  }

  const btn = $('uploadBtn');
  btn.disabled = true;
  try {
    for (let i = 0; i < jobs.length; i++) {
      const { file, ...body } = jobs[i];
      $('uploadProgress').textContent = jobs.length > 1 ? `Cargando ${i + 1} de ${jobs.length}…` : 'Cargando…';
      if (file) await uploadFile(file, body);
      else await api('POST', '/api/admin/docs', body);
    }
    toast(jobs.length > 1 ? `${jobs.length} documentos cargados` : 'Documento cargado');
    $('uploadForm').reset();
    $('lockFields').classList.add('hidden');
    $('fPublishAt').disabled = true;
    await load();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    $('uploadProgress').textContent = '';
  }
});

// ---------- Lista ----------

document.querySelectorAll('#filters button').forEach((b) => b.addEventListener('click', () => {
  filter = b.dataset.filter;
  document.querySelectorAll('#filters button').forEach((x) => {
    x.classList.toggle('dark', x === b);
    x.classList.toggle('ghost', x !== b);
  });
  renderDocs();
}));

function renderDocs() {
  const list = $('docList');
  list.replaceChildren();
  const docs = [...state.docs]
    .filter((d) => filter === 'all' || (filter === 'live' ? !d.pending : d.pending))
    .sort((a, b) => {
      const ta = a.publishAt ? new Date(a.publishAt).getTime() : new Date(a.createdAt).getTime();
      const tb = b.publishAt ? new Date(b.publishAt).getTime() : new Date(b.createdAt).getTime();
      return tb - ta;
    });
  if (!docs.length) {
    list.innerHTML = '<div class="empty">No hay documentos acá todavía.</div>';
    return;
  }
  for (const d of docs) list.appendChild(docItem(d));
}

function option(value, label, selected) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  o.selected = value === selected;
  return o;
}

function docItem(d) {
  const item = document.createElement('div');
  item.className = 'doc-item';
  item.innerHTML = `
    <div class="thumb"></div>
    <div>
      <div class="top">
        <input type="text" data-f="title" aria-label="Título">
        <span class="pill"></span>
      </div>
      <div class="controls">
        <div class="field"><label>Aparece</label><input type="datetime-local" data-f="publishAt"></div>
        <div class="field"><label>Antes de aparecer</label><select data-f="preview"></select></div>
        <div class="field"><label>Empieza en</label><select data-f="place"></select></div>
        <div class="field"><label>Estilo</label><select data-f="style"></select></div>
        <div class="field"><label>Tamaño (%)</label><input type="number" data-f="w" min="4" max="60" step="0.5"></div>
        <div class="field"><label>Rotación (°)</label><input type="number" data-f="rot" min="-45" max="45" step="0.5"></div>
      </div>
      <div class="field" style="margin-top:8px"><label>Epígrafe</label><input type="text" data-f="caption"></div>
      <div class="controls" style="margin-top:8px">
        <div class="field"><label>🔒 Clave (vacío = sin clave)</label><input type="text" data-f="lockKey" autocomplete="off"></div>
        <div class="field" style="grid-column: span 2"><label>Texto que ve el jugador</label><input type="text" data-f="lockHint"></div>
      </div>
      <div class="btns"></div>
    </div>`;

  const thumb = item.querySelector('.thumb');
  if (d.mime && d.mime.startsWith('image/')) thumb.appendChild(Object.assign(document.createElement('img'), { src: d.file, alt: '' }));
  else thumb.textContent = d.kind === 'text' ? 'TEXTO' : d.kind === 'link' || (d.mime && d.mime.startsWith('video/')) ? 'VIDEO' : (d.mime === 'application/pdf' ? 'PDF' : 'ARCHIVO');

  const q = (f) => item.querySelector(`[data-f="${f}"]`);
  q('title').value = d.title;
  q('caption').value = d.caption;
  q('lockKey').value = d.lockKey || '';
  q('lockHint').value = d.lockHint || '';
  q('publishAt').value = toLocalInput(d.publishAt);
  q('w').value = d.w;
  q('rot').value = d.rot;
  [['default', 'Según configuración general'], ['show', 'Mostrar silueta con ?'], ['hide', 'No mostrar nada']]
    .forEach(([v, l]) => q('preview').appendChild(option(v, l, d.preview)));
  [['board', 'El tablero'], ['folder', 'El archivo (carpeta)']]
    .forEach(([v, l]) => q('place').appendChild(option(v, l, d.place || 'board')));
  [['papel', 'Hoja de papel'], ['polaroid', 'Polaroid'], ['foto', 'Foto con chinche'], ['recorte', 'Recorte de diario'], ['nota', 'Nota adhesiva']]
    .forEach(([v, l]) => q('style').appendChild(option(v, l, d.style)));

  const pill = item.querySelector('.pill');
  if (d.pending) {
    pill.className = 'pill sched';
    pill.textContent = 'Programado · ' + fmt(d.publishAt);
  } else {
    pill.className = 'pill live';
    pill.textContent = d.folder ? 'Publicado · en el archivo' : 'Publicado · en el tablero';
  }
  if (d.hasLock) {
    const lockPill = document.createElement('span');
    lockPill.className = 'pill ' + (d.sealed ? 'sched' : 'live');
    lockPill.textContent = d.sealed ? '🔒 Bloqueada' : '🔓 Desbloqueada';
    pill.after(lockPill);
  }

  item.querySelectorAll('[data-f]').forEach((input) => input.addEventListener('change', () => {
    const f = input.dataset.f;
    let value = input.value;
    if (f === 'publishAt') value = fromLocalInput(value);
    if (f === 'w' || f === 'rot') value = Number(value);
    patch(d.id, { [f]: value });
  }));

  const btns = item.querySelector('.btns');
  if (d.kind === 'text') {
    const edit = Object.assign(document.createElement('button'), { className: 'btn small dark', type: 'button', textContent: 'Editar texto' });
    edit.addEventListener('click', () => {
      const area = document.createElement('textarea');
      area.value = d.text;
      const save = Object.assign(document.createElement('button'), { className: 'btn small', type: 'button', textContent: 'Guardar texto' });
      save.addEventListener('click', () => patch(d.id, { text: area.value }));
      btns.after(area, save);
      edit.remove();
    });
    btns.appendChild(edit);
  }
  if (d.hasLock && !d.sealed) {
    const relock = Object.assign(document.createElement('button'), { className: 'btn small dark', type: 'button', textContent: '🔒 Volver a bloquear' });
    relock.addEventListener('click', () => patch(d.id, { relock: true }));
    btns.appendChild(relock);
  }
  if (d.pending) {
    const pub = Object.assign(document.createElement('button'), { className: 'btn small', type: 'button', textContent: 'Publicar ya' });
    pub.addEventListener('click', () => patch(d.id, { publishAt: null }));
    btns.appendChild(pub);
  }
  if (d.file || d.url) {
    btns.appendChild(Object.assign(document.createElement('a'), { className: 'btn small ghost', href: d.file || d.url, target: '_blank', rel: 'noopener', textContent: d.url ? 'Ver video' : 'Ver archivo' }));
  }
  const del = Object.assign(document.createElement('button'), { className: 'btn small danger', type: 'button', textContent: 'Eliminar' });
  del.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar "${d.title || 'documento'}"? No se puede deshacer.`)) return;
    try {
      await api('DELETE', '/api/admin/docs/' + d.id);
      toast('Documento eliminado');
      await load();
    } catch (e) {
      toast(e.message);
    }
  });
  btns.appendChild(del);
  return item;
}

async function patch(id, fields) {
  try {
    await api('PATCH', '/api/admin/docs/' + id, fields);
    toast('Guardado');
    await load();
  } catch (e) {
    toast(e.message);
  }
}

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.replace('/');
});

// refresca estados (programado → publicado) sin pisar lo que se está editando
setInterval(() => {
  if (!document.activeElement || !document.activeElement.closest('.doc-item, .card')) load().catch(() => {});
}, 30000);

load().catch((e) => toast(e.message));
