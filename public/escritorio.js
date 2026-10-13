// Escritorio: al entrar se ve el tablero colgado en la pared y abajo el escritorio.
// Tocando uno u otro la cámara se acerca. Sobre el escritorio están el rompecabezas
// del poema y el cryptex; lo que hace cada jugador se guarda para todos.
(() => {
  const $ = (id) => document.getElementById(id);
  const B = window.memisBoard;
  if (!B) return;
  const body = document.body;
  const camara = $('camara');
  const desk = $('deskView');
  const plano = $('deskPlane');
  const area = $('deskArea');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  // El escritorio mide 1600 x 1000 "unidades"; todo lo de arriba se ubica en esas unidades
  const UNI = { w: 1600, h: 1000 };
  const TRAY = { x: 522, y: 80, w: 555, h: 840 };                                   // donde va armado
  const ZONES = [{ x: 40, y: 50, w: 440, h: 900 }, { x: 1120, y: 50, w: 440, h: 560 }]; // donde arrancan las piezas
  const norm = (r) => ({ x: r.x / UNI.w, y: r.y / UNI.h, w: r.w / UNI.w, h: r.h / UNI.h });
  const POEMA = { file: '/escritorio/poema.webp', title: 'Te encontré en los detalles' };
  const DEPTH_FRONT = 0.93; // en la vista general, el borde de adelante del escritorio queda a esta altura de la pantalla
  const TILT = 64;          // inclinación del escritorio en la vista general (grados)
  const MOVE_MS = 900;

  const VIEWS = ['escena', 'tablero', 'escritorio'];
  let view = null;
  let locked = true;
  let geo = null;
  let settleTimer = null;
  let puzzle = null;
  let cx = null;
  let cryptexDoc = null;
  const ringsOf = new Map(); // id -> anillos (el servidor los manda mientras está cerrado)
  let doneShown = false;

  // ---------- Medidas ----------
  function measure() {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const board = $('board');
    const sc = $('boardView');
    // offset* no cambian con los transform: son las medidas del tablero "de cerca"
    const bw = board.offsetWidth, bh = board.offsetHeight;
    const bl = sc.offsetLeft + board.offsetLeft;
    const bt = sc.offsetTop + board.offsetTop;
    const bottom = bt + bh;
    const k = Math.min(0.62, (vh * 0.5) / bottom, (vw * 0.94) / bw);
    const tx = vw / 2 - k * (bl + bw / 2);
    const ty = 0;
    const yd = ty + k * bottom + 2; // donde el escritorio toca la pared
    // Escritorio de frente: el área entra en la pantalla; en el celular se recorre de costado
    const top = 58;
    let s = Math.min((vw * 0.96) / UNI.w, ((vh - top) * 0.95) / UNI.h);
    let pw = vw;
    if (s < 0.5) {
      s = Math.min(0.5, ((vh - top) * 0.95) / UNI.h);
      pw = Math.max(vw, UNI.w * s + 32);
    }
    const aw = UNI.w * s, ah = UNI.h * s;
    const boardScr = { x: tx + k * bl, y: ty + k * bt, w: k * bw, h: k * bh };
    // Vista general: el escritorio, un poco más ancho que el tablero, en perspectiva.
    // Inclinación fija; se busca la profundidad para que su borde de adelante quede cerca del pie.
    const sx = Math.min((vw * 0.96) / pw, (boardScr.w * 1.42) / pw);
    const persp = vh * 1.25;
    const oy = boardScr.y + boardScr.h * 0.45;
    const tilt = TILT;
    const rad = (tilt * Math.PI) / 180;
    const nearY = (sy) => {
      const d = sy * vh, z = d * Math.sin(rad);
      return oy + (yd + d * Math.cos(rad) - oy) * persp / (persp - z);
    };
    const target = vh * DEPTH_FRONT;
    let lo = 0.05, hi = (persp * 0.9) / Math.sin(rad) / vh;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (nearY(mid) < target) lo = mid; else hi = mid; }
    const sy = lo;
    return {
      vw, vh, k, tx, ty, yd, s, pw, aw, ah, sx, sy, persp, oy, tilt,
      ax: (pw - aw) / 2,
      ay: top + (vh - top - ah) / 2,
      board: boardScr,
    };
  }

  function deskTransform(v) {
    const g = geo;
    if (v === 'escritorio') return 'translate3d(0px, 0px, 0px) rotateX(0deg) scale(1, 1)';
    const y = v === 'tablero' ? g.vh + 60 : g.yd;
    return `translate3d(${(g.vw - g.pw) / 2}px, ${y}px, 0px) rotateX(${g.tilt}deg) scale(${g.sx}, ${g.sy})`;
  }

  function place() {
    geo = measure();
    const g = geo;
    Object.assign(plano.style, { width: g.pw + 'px', height: g.vh + 'px' });
    Object.assign(area.style, { left: g.ax + 'px', top: g.ay + 'px', width: g.aw + 'px', height: g.ah + 'px' });
    area.style.setProperty('--u', g.s); // px por unidad, por si algo lo necesita
    desk.style.perspective = Math.round(g.persp) + 'px';
    desk.style.perspectiveOrigin = `50% ${Math.round(g.oy)}px`;
    Object.assign($('goBoard').style, { left: g.board.x + 'px', top: g.board.y + 'px', width: g.board.w + 'px', height: g.board.h + 'px' });
  }

  // ---------- Vistas ----------
  const viewFromHash = () => {
    const h = location.hash.slice(1);
    return VIEWS.includes(h) ? h : 'escena';
  };

  let boardScroll = null; // en pantallas angostas: hasta dónde se había recorrido el corcho
  function setView(next, { push = true, instant = false } = {}) {
    if (locked || next === view) return;
    const first = view === null;
    const sc = $('boardView');
    if (view === 'tablero') boardScroll = sc.scrollLeft;
    view = next;
    if (push) history.pushState({ vista: next }, '', next === 'escena' ? location.pathname + location.search : '#' + next);
    body.classList.remove('vista-escena', 'vista-tablero', 'vista-escritorio');
    body.classList.add('vista-' + next);
    if (next === 'tablero') sc.scrollLeft = boardScroll ?? (sc.scrollWidth - sc.clientWidth) / 2;
    apply(instant || first);
  }

  function apply(instant) {
    place();
    const anim = !instant && !reduced.matches;
    clearTimeout(settleTimer);
    camara.classList.toggle('moviendo', anim);
    desk.classList.toggle('moviendo', anim);
    desk.classList.remove('listo');
    const g = geo;
    camara.style.transform = view === 'tablero'
      ? (anim ? 'translate(0px, 0px) scale(1)' : '')
      : `translate(${g.tx}px, ${g.ty}px) scale(${g.k})`;
    plano.style.transform = deskTransform(view);
    plano.style.opacity = view === 'tablero' ? '0' : '1';
    $('goBoard').classList.toggle('hidden', view !== 'escena');
    $('sceneHint').classList.toggle('hidden', view !== 'escena');
    $('backBtn').classList.toggle('hidden', view === 'escena');
    $('goDesk').tabIndex = view === 'escena' ? 0 : -1;
    if (puzzle) puzzle.setInteractive(false); // se agarran recién con el escritorio quieto (settle)
    if (view !== 'escritorio') closeCryptex();
    settleTimer = setTimeout(settle, anim ? MOVE_MS : 0);
  }

  function settle() {
    camara.classList.remove('moviendo');
    desk.classList.remove('moviendo');
    // de cerca, el tablero queda exactamente como siempre (sin transform)
    if (view === 'tablero') camara.style.transform = '';
    if (view === 'escritorio') {
      desk.classList.add('listo');
      if (puzzle) puzzle.setInteractive(true);
      desk.scrollLeft = (desk.scrollWidth - desk.clientWidth) / 2;
    }
  }

  function back() {
    if (view === 'escena') return;
    if (history.state && history.state.vista) history.back();
    else {
      history.replaceState(null, '', location.pathname + location.search);
      setView('escena', { push: false });
    }
  }

  $('goBoard').addEventListener('click', () => setView('tablero'));
  $('editBtn').addEventListener('click', () => setView('tablero')); // acomodar se hace de cerca
  $('goDesk').addEventListener('click', () => setView('escritorio'));
  $('backBtn').addEventListener('click', back);
  addEventListener('popstate', () => { if (!locked) setView(viewFromHash(), { push: false }); });
  addEventListener('resize', () => {
    if (locked || view === null) return;
    place();
    const g = geo;
    if (view !== 'tablero') camara.style.transform = `translate(${g.tx}px, ${g.ty}px) scale(${g.k})`;
    plano.style.transform = deskTransform(view);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if ($('cxModal').classList.contains('open')) { e.preventDefault(); closeCryptex(); return; }
    if (view === 'escritorio' && !B.isOpen()) { e.preventDefault(); back(); }
  });

  // ---------- Rompecabezas del poema ----------
  async function sendPiece(i, p) {
    const res = await fetch('/api/desk/puzzle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ i, x: p.x, y: p.y, ok: !!p.ok }),
    }).catch(() => null);
    if (!res || !res.ok) B.toast('No se pudo guardar la pieza');
  }

  function syncPuzzle(d) {
    const visible = d.puzzleVisible !== false;
    $('puzzleHost').classList.toggle('hidden', !visible);
    if (!visible || !window.Rompecabezas) return;
    const st = d.puzzle || {};
    if (puzzle) { puzzle.update(st); return; }
    puzzle = window.Rompecabezas.mount($('puzzleHost'), {
      image: POEMA.file,
      cols: 4,
      rows: 5,
      tray: norm(TRAY),
      zones: ZONES.map(norm),
      seed: 'poema-1',
      state: st,
      interactive: view === 'escritorio' && desk.classList.contains('listo'),
      onMove: sendPiece,
      onDone: () => {
        if (!doneShown && view === 'escritorio') B.toast('¡Rompecabezas armado! Tocalo para leerlo.');
        doneShown = true;
      },
      onOpen: () => B.openLightbox({ kind: 'file', mime: 'image/webp', file: POEMA.file, title: POEMA.title, noMove: true }),
    });
    doneShown = puzzle.isDone();
  }

  // ---------- Cryptex ----------
  // abierto: ni cerrado con clave (al jugador le llega `locked`; al admin, completo con `sealed`) ni por venir
  const isOpen = (d) => !!d && !d.locked && !d.sealed && !d.pending;
  const isClosed = (d) => !!d && (d.locked || d.sealed) && !d.pending;
  let inside = [];      // pistas adentro del cryptex, en el orden del servidor
  let activeId = null;  // la pista para la que se abrió el cryptex de cerca
  const byId = (id) => inside.find((d) => d.id === id) || null;
  // la que espera en el escritorio: primero la que sigue cerrada (se abren de a una)
  const current = () => inside.find(isClosed) || inside.find(isOpen) || inside[0] || null;

  function syncCryptex(docs) {
    inside = docs.filter((d) => d.spot === 'cryptex');
    for (const d of inside) if (d.rings) ringsOf.set(d.id, d.rings);
    cryptexDoc = current();
    const d = cryptexDoc;
    const opened = inside.filter(isOpen);
    $('cryptexObj').classList.toggle('abierto', !inside.some(isClosed) && opened.length > 0);
    const tag = $('cryptexTag');
    const waiting = d && d.pending && !d.kind;
    tag.textContent = waiting ? 'Se activa el ' + B.whenText(d.publishAt) : '';
    tag.classList.toggle('hidden', !waiting);
    // lo que ya salió del cryptex queda al lado, enrollado: se toca y se lee
    const box = $('cryptexScrolls');
    const sig = opened.map((x) => x.id).join(',');
    if (box.dataset.sig !== sig) {
      box.dataset.sig = sig;
      box.replaceChildren(...opened.slice(0, 3).map((doc, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'esc-pergamino';
        b.style.setProperty('--i', i);
        b.setAttribute('aria-label', 'Pergamino del cryptex' + (doc.title ? ': ' + doc.title : ''));
        b.addEventListener('click', () => { if (view === 'escritorio') B.openLightbox(byId(doc.id) || doc); });
        return b;
      }));
    }
    if (cx && activeId && isOpen(byId(activeId))) cx.setOpen(true);
  }

  // si la foto del cryptex no carga, mejor no mostrar un ícono roto
  {
    const img = $('cryptexObj').querySelector('img');
    const show = () => $('cryptexObj').classList.remove('sin-foto');
    $('cryptexObj').classList.add('sin-foto');
    if (img.complete && img.naturalWidth) show();
    else img.addEventListener('load', show, { once: true });
  }

  $('cryptexObj').addEventListener('click', () => {
    if (view !== 'escritorio') return;
    const d = cryptexDoc;
    if (d && d.pending && !d.kind) return B.toast('El cryptex se activa el ' + B.whenText(d.publishAt));
    openCryptex();
  });

  function openCryptex() {
    if (!window.Cryptex) return B.toast('El cryptex todavía no está listo');
    closeCryptex(true);
    const d = current();
    activeId = d ? d.id : null;
    const open = isOpen(d);
    $('cxHint').textContent = open
      ? 'Está abierto: tocá el pergamino para leerlo.'
      : (d && d.hint) || 'Alineá las letras correctas y tirá de las tapas para abrirlo.';
    cx = window.Cryptex.mount($('cxHost'), {
      rings: (d && ringsOf.get(d.id)) || 5,
      open,
      label: 'Cryptex',
      onTry,
      onScroll: () => {
        const doc = byId(activeId);
        if (!isOpen(doc)) return;
        closeCryptex();
        B.openLightbox(doc);
      },
    });
    $('cxModal').classList.add('open');
    cx.focus();
  }

  async function onTry(word) {
    const d = byId(activeId);
    if (!d || d.pending) return false;
    if (isOpen(d)) return true;
    const res = await fetch('/api/unlock/' + d.id, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: word }),
    }).catch(() => null);
    if (!res) { B.toast('Sin conexión'); return false; }
    if (!res.ok) return false;
    await B.load(); // trae lo que hay adentro (ya desbloqueado para todos)
    $('cxHint').textContent = 'Está abierto: tocá el pergamino para leerlo.';
    return true;
  }

  function closeCryptex(now = false) {
    const m = $('cxModal');
    if (!m.classList.contains('open') && !cx) return;
    m.classList.remove('open');
    const old = cx;
    cx = null;
    activeId = null;
    if (old) setTimeout(() => old.destroy(), now ? 0 : 320);
  }
  $('cxClose').addEventListener('click', () => closeCryptex());
  $('cxModal').addEventListener('click', (e) => { if (e.target === $('cxModal')) closeCryptex(); });

  // ---------- Lo llama board.js con cada /api/state ----------
  function update(s) {
    const wasLocked = locked;
    locked = !!s.locked;
    if (locked) {
      desk.classList.add('hidden');
      body.classList.remove('vista-escena', 'vista-tablero', 'vista-escritorio');
      camara.style.transform = '';
      ['goBoard', 'backBtn', 'sceneHint'].forEach((id) => $(id).classList.add('hidden'));
      closeCryptex(true);
      view = null;
      return;
    }
    desk.classList.remove('hidden');
    if (wasLocked || view === null) setView(viewFromHash(), { push: false, instant: true });
    syncPuzzle(s.desk || {});
    syncCryptex(s.docs || []);
  }

  window.memisDesk = { update, setView: (v) => setView(v) };
})();
