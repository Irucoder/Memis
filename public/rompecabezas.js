// Rompecabezas del escritorio: las piezas de una imagen desparramadas sobre la madera.
// Se arrastran con el mouse o con el dedo; si se sueltan cerca de su lugar encastran y quedan
// fijas. Dónde está cada pieza lo guarda el servidor y es lo mismo para todos los jugadores.
//
//   const pz = Rompecabezas.mount(host, { image, cols, rows, tray, zones, seed, state,
//                                         interactive, onMove, onDone, onOpen, label });
//   pz.update(state); pz.setInteractive(bool); pz.isDone(); pz.destroy();
//
// Todo se mide en proporción del host (0..1): `x, y` de cada pieza es la esquina de arriba a la
// izquierda de su cuerpo (sin las pestañas). Adentro se trabaja en "unidades": 1000 = alto del host.
(() => {
  const S = 1000;           // unidades por alto del host
  const TAB = 0.1;          // tamaño de la pestaña (en proporción del lado chico de la pieza)
  const JIT = 0.04;         // cuánto varía cada pestaña (para que no sean todas iguales)
  const MARGEN = 0.46;      // alrededor del cuerpo: lugar para las pestañas y la sombra (idem)
  const SNAP = 0.03;        // encastra si se suelta a menos de esto (en proporción del ancho del host)
  const RECIEN = 2000;      // ms en que lo que llega del servidor no pisa una pieza movida acá
  const TECLA_MS = 800;     // con el teclado: se "suelta" al rato de dejar de moverla
  const Z_SUELTA = 10;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const round4 = (v) => Math.round(v * 1e4) / 1e4;

  // ---------- Azar con semilla (el mismo desorden para todos) ----------
  function rng(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    let a = (h ^= h >>> 16) >>> 0;
    return () => { // mulberry32
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Forma de las piezas ----------
  // Cada borde interno es una curva con la pestaña clásica (cuello angosto y cabeza redonda);
  // sale para un lado o para el otro al azar. Es la forma del generador de Draradech, pero con la
  // pestaña medida sobre el lado chico de la pieza para que salgan todas redondas.
  function edge(rand, x0, y0, x1, y1, u) {
    const L = Math.hypot(x1 - x0, y1 - y0);
    const ax = (x1 - x0) / L, ay = (y1 - y0) / L;
    const flip = rand() < 0.5 ? 1 : -1;
    const nx = -ay * flip * u, ny = ax * flip * u;
    const j = () => (rand() * 2 - 1) * JIT;
    const t = TAB * (0.92 + rand() * 0.16);
    const a = j(), b = j(), c = j(), d = j(), e = j();
    const C = L * (0.5 + b);
    const P = (along, perp) => [x0 + ax * along + nx * perp, y0 + ay * along + ny * perp];
    return [
      P(0, 0),
      P(0.2 * L, a), P(C + d * u, -t + c), P(C - t * u, t + c),
      P(C - (2 * t + d) * u, 3 * t + c), P(C + (2 * t - d) * u, 3 * t + c), P(C + t * u, t + c),
      P(C + d * u, -t + c), P(0.8 * L, e), P(L, 0),
    ];
  }

  function trace(path, pts, rev, ox, oy, end) {
    if (!pts) { path.lineTo(end[0] - ox, end[1] - oy); return; } // borde de afuera: recto
    const q = rev ? pts.slice().reverse() : pts;
    for (let k = 1; k < 10; k += 3) {
      path.bezierCurveTo(q[k][0] - ox, q[k][1] - oy, q[k + 1][0] - ox, q[k + 1][1] - oy, q[k + 2][0] - ox, q[k + 2][1] - oy);
    }
  }

  function mount(host, opts = {}) {
    const cols = Math.max(1, opts.cols | 0 || 4);
    const rows = Math.max(1, opts.rows | 0 || 5);
    const N = cols * rows;
    const tray = opts.tray || { x: 0.3, y: 0.1, w: 0.4, h: 0.8 };
    const zones = (opts.zones || []).filter((z) => z && z.w > 0 && z.h > 0);
    const seed = String(opts.seed || 'rompecabezas');
    const label = opts.label || 'Rompecabezas';
    const noop = () => {};
    const onMove = opts.onMove || noop;
    const onDone = opts.onDone || noop;
    const onOpen = opts.onOpen || noop;

    let interactive = opts.interactive !== false;
    let done = false;
    let drag = null;
    let teclado = null; // { p, timer } mientras se mueve una pieza con las flechas
    let zTop = Z_SUELTA;
    let G = null;       // medidas (dependen de la proporción del host)
    let pxu = 0;        // píxeles de la imagen de cada pieza por unidad
    let img = null, cover = null;
    let destroyed = false;
    let hoverRaf = 0, hoverPt = null;

    // ---------- Elementos ----------
    host.classList.add('rz-host');
    const root = document.createElement('div');
    root.className = 'rz';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', label);
    const marco = Object.assign(document.createElement('div'), { className: 'rz-marco' });
    const fondo = Object.assign(document.createElement('div'), { className: 'rz-fondo' });
    if (opts.image) fondo.appendChild(Object.assign(document.createElement('img'), { className: 'rz-guia', src: opts.image, alt: '', draggable: false }));
    const ver = Object.assign(document.createElement('button'), { className: 'rz-ver', type: 'button', tabIndex: -1 });
    ver.setAttribute('aria-label', label + ' armado: ver la imagen');
    const brillo = Object.assign(document.createElement('div'), { className: 'rz-brillo' });
    const estado = Object.assign(document.createElement('span'), { className: 'rz-oculto' });
    estado.setAttribute('aria-live', 'polite');
    const ayudaId = 'rz-ayuda-' + Math.random().toString(36).slice(2, 8);
    const ayuda = Object.assign(document.createElement('span'), { className: 'rz-oculto', id: ayudaId,
      textContent: 'Movela con las flechas (con Mayúsculas, más rápido) y soltala con Enter cerca de su lugar.' });
    root.append(marco, fondo);

    // Cada pieza se dibuja en un lienzo aparte y se le pasa ya hecha a su canvas ("bitmaprenderer").
    // Con 20 canvas 2D comunes a la vista, el navegador los vuelve a copiar en cada cuadro mientras
    // se arrastra y traba; así no. Si el navegador no tiene OffscreenCanvas, cada una se dibuja en
    // su propio canvas 2D.
    let lienzo = null, lctx = null;
    try {
      lienzo = new OffscreenCanvas(1, 1);
      lctx = lienzo.getContext('2d');
      if (!lctx || !lienzo.transferToImageBitmap) lienzo = lctx = null;
    } catch { lienzo = lctx = null; }
    const hitCtx = document.createElement('canvas').getContext('2d');
    const P = [];
    const byEl = new Map();
    for (let i = 0; i < N; i++) {
      const el = document.createElement('canvas');
      el.className = 'rz-pieza';
      el.setAttribute('role', 'img');
      el.setAttribute('aria-describedby', ayudaId);
      const br = lctx && el.getContext('bitmaprenderer');
      const p = { i, c: i % cols, r: (i / cols) | 0, el, br, ctx: br ? null : el.getContext('2d'), x: 0, y: 0, ok: false, z: 0, movedAt: 0, anim: null, painted: null };
      P.push(p);
      byEl.set(el, p);
      root.appendChild(el);
    }
    root.append(ver, brillo, estado, ayuda);
    host.appendChild(root);

    // ---------- Medidas ----------
    function aspect() {
      const w = host.offsetWidth, h = host.offsetHeight;
      return w > 0 && h > 0 ? w / h : 1.6;
    }

    function geometry(A) {
      const UW = A * S, UH = S;
      const tx = tray.x * UW, ty = tray.y * UH, tw = tray.w * UW, th = tray.h * UH;
      const cw = tw / cols, ch = th / rows, u = Math.min(cw, ch);
      const M = Math.ceil(u * MARGEN);
      const g = { A, UW, UH, tx, ty, tw, th, cw, ch, u, M, FW: cw + 2 * M, FH: ch + 2 * M };
      g.cwN = cw / UW; g.chN = ch / UH; g.mxN = M / UW; g.myN = M / UH; g.fwN = g.FW / UW; g.fhN = g.FH / UH;

      // bordes (en unidades, con el origen en la esquina del lugar donde va armado)
      const rand = rng(seed + '|bordes');
      const H = [], V = [];
      for (let r = 1; r < rows; r++) {
        H[r] = [];
        for (let c = 0; c < cols; c++) H[r][c] = edge(rand, c * cw, r * ch, (c + 1) * cw, r * ch, u);
      }
      for (let r = 0; r < rows; r++) {
        V[r] = [];
        for (let c = 1; c < cols; c++) V[r][c] = edge(rand, c * cw, r * ch, c * cw, (r + 1) * ch, u);
      }
      g.paths = [];
      g.rings = [];
      for (let i = 0; i < N; i++) {
        const c = i % cols, r = (i / cols) | 0;
        const ox = c * cw - M, oy = r * ch - M;
        const x0 = c * cw, y0 = r * ch, x1 = x0 + cw, y1 = y0 + ch;
        const path = new Path2D();
        path.moveTo(x0 - ox, y0 - oy);
        trace(path, r > 0 && H[r][c], false, ox, oy, [x1, y0]);               // arriba →
        trace(path, c < cols - 1 && V[r][c + 1], false, ox, oy, [x1, y1]);    // derecha ↓
        trace(path, r < rows - 1 && H[r + 1][c], true, ox, oy, [x0, y1]);     // abajo ←
        trace(path, c > 0 && V[r][c], true, ox, oy, [x0, y0]);                // izquierda ↑
        path.closePath();
        const ring = new Path2D(); // todo lo de afuera de la pieza (para el relieve de adentro)
        ring.rect(-g.FW, -g.FH, g.FW * 3, g.FH * 3);
        ring.addPath(path);
        g.paths.push(path);
        g.rings.push(ring);
      }
      g.home = P.map((p) => ({ x: (tx + p.c * cw) / UW, y: (ty + p.r * ch) / UH }));
      g.scatter = scatter(g);
      return g;
    }

    // Posición inicial: cada zona se divide en casilleros del tamaño de una pieza; las piezas van a
    // casilleros al azar (sobran algunos: quedan huecos) y se corren un poco dentro del suyo.
    // Si hay más piezas que casilleros, se repiten casilleros y quedan encimadas.
    function scatter(g) {
      const rand = rng(seed + '|desorden');
      const asoma = 3.4 * TAB * g.u; // lo que sobresale una pestaña
      const slots = [];
      const casilleros = (zx, zy, zw, zh) => {
        const nx = Math.max(1, Math.floor(zw / g.cw)), ny = Math.max(1, Math.floor(zh / g.ch));
        const sw = zw / nx, sh = zh / ny;
        for (let a = 0; a < ny; a++) {
          for (let b = 0; b < nx; b++) slots.push({ x: zx + b * sw, y: zy + a * sh, w: sw, h: sh, zx, zy, zw, zh });
        }
      };
      for (const z of zones) casilleros(z.x * g.UW, z.y * g.UH, z.w * g.UW, z.h * g.UH);
      if (!slots.length) casilleros(0, 0, g.UW, g.UH);
      const shuffle = (arr) => {
        for (let k = arr.length - 1; k > 0; k--) {
          const j = Math.floor(rand() * (k + 1));
          [arr[k], arr[j]] = [arr[j], arr[k]];
        }
        return arr;
      };
      shuffle(slots);
      const order = shuffle(P.map((p) => p.i));
      const out = [];
      order.forEach((i, k) => {
        const s = slots[k % slots.length];
        const extra = k >= slots.length ? 0.35 : 0.1; // repetido: más corrido para que se vea
        const jx = Math.max(0, s.w - g.cw) / 2 + extra * g.cw, jy = Math.max(0, s.h - g.ch) / 2 + extra * g.ch;
        let x = s.x + (s.w - g.cw) / 2 + (rand() * 2 - 1) * jx;
        let y = s.y + (s.h - g.ch) / 2 + (rand() * 2 - 1) * jy;
        // el cuerpo dentro de su zona y las pestañas dentro del host
        x = clamp(clamp(x, s.zx, s.zx + s.zw - g.cw), asoma, g.UW - g.cw - asoma);
        y = clamp(clamp(y, s.zy, s.zy + s.zh - g.ch), asoma, g.UH - g.ch - asoma);
        out[i] = { x: round4(x / g.UW), y: round4(y / g.UH), z: k + 1 };
      });
      return out;
    }

    const clampX = (x) => clamp(x, 0, 1 - G.cwN);
    const clampY = (y) => clamp(y, 0, 1 - G.chN);

    function layoutStatic() {
      const g = G;
      const pad = g.u * 0.1;
      const pct = (v) => v * 100 + '%';
      Object.assign(marco.style, { left: pct((g.tx - pad) / g.UW), top: pct((g.ty - pad) / g.UH), width: pct((g.tw + 2 * pad) / g.UW), height: pct((g.th + 2 * pad) / g.UH) });
      for (const el of [fondo, ver, brillo]) {
        Object.assign(el.style, { left: pct(g.tx / g.UW), top: pct(g.ty / g.UH), width: pct(g.tw / g.UW), height: pct(g.th / g.UH) });
      }
      for (const p of P) {
        p.el.style.width = pct(g.fwN);
        p.el.style.height = pct(g.fhN);
        put(p);
      }
    }

    function put(p) {
      p.el.style.left = (p.x - G.mxN) * 100 + '%';
      p.el.style.top = (p.y - G.myN) * 100 + '%';
      p.el.style.zIndex = p.ok ? 2 : p.z;
      p.el.classList.toggle('rz-ok', p.ok); // en su lugar ya no se toca: deja pasar el dedo
      p.el.tabIndex = interactive && !p.ok && !done ? 0 : -1;
      p.el.setAttribute('aria-label', `Pieza ${p.i + 1} de ${N}` + (p.ok ? ', en su lugar' : ''));
    }

    // ---------- Dibujo ----------
    function scaleNow() {
      const h = host.offsetHeight;
      if (!h) return 0;
      const eff = host.getBoundingClientRect().height / h; // si un ancestro lo agranda, más definición
      return (h / S) * Math.min(2, (window.devicePixelRatio || 1) * Math.max(1, eff || 1));
    }

    function paint(p) {
      if (!pxu) return;
      const g = G, k = pxu, u = g.u;
      const cv = p.br ? lienzo : p.el, ctx = p.br ? lctx : p.ctx;
      const W = Math.max(1, Math.round(g.FW * k)), H = Math.max(1, Math.round(g.FH * k));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(W / g.FW, 0, 0, H / g.FH, 0, 0);
      const path = g.paths[p.i];
      // sombra sobre la madera (las que están en su lugar no la llevan: quedan al ras)
      if (!p.ok) {
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
        ctx.shadowBlur = u * 0.07 * k;
        ctx.shadowOffsetX = u * 0.012 * k;
        ctx.shadowOffsetY = u * 0.035 * k;
        ctx.fillStyle = '#16100b';
        ctx.fill(path);
        ctx.restore();
      }
      ctx.save();
      ctx.clip(path);
      const ox = p.c * g.cw - g.M, oy = p.r * g.ch - g.M;
      if (img && cover) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, cover.x - ox, cover.y - oy, cover.w, cover.h);
      } else {
        ctx.fillStyle = '#3a2d22'; // cartón, mientras carga la imagen
        ctx.fillRect(0, 0, g.FW, g.FH);
      }
      // un poco de brillo de cartulina impresa
      const lg = ctx.createLinearGradient(0, 0, g.FW, g.FH);
      lg.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
      lg.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
      lg.addColorStop(1, 'rgba(0, 0, 0, 0.14)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, 0, g.FW, g.FH);
      // relieve: luz en el borde de arriba a la izquierda, sombra en el de abajo a la derecha
      const ring = g.rings[p.i];
      const inner = (color, d, blur) => {
        ctx.shadowColor = color;
        ctx.shadowOffsetX = d * k;
        ctx.shadowOffsetY = d * k;
        ctx.shadowBlur = blur * k;
        ctx.fillStyle = '#000';
        ctx.fill(ring, 'evenodd');
      };
      // (las que están en su lugar, más suave: que se lea la imagen armada)
      inner(`rgba(255, 246, 225, ${p.ok ? 0.3 : 0.6})`, u * 0.016, u * 0.03);
      inner(`rgba(0, 0, 0, ${p.ok ? 0.42 : 0.7})`, -u * 0.02, u * 0.035);
      ctx.restore();
      // el corte
      ctx.save();
      ctx.clip(path);
      ctx.lineWidth = (p.ok ? 1.6 : 2.2) / k;
      ctx.strokeStyle = 'rgba(25, 15, 8, 0.55)';
      ctx.stroke(path);
      ctx.restore();
      if (p.br) {
        if (p.el.width !== W || p.el.height !== H) { p.el.width = W; p.el.height = H; }
        p.br.transferFromImageBitmap(lienzo.transferToImageBitmap());
      }
      p.painted = { k, ok: p.ok, img: !!cover };
    }

    function paintAll(force) {
      pxu = scaleNow();
      root.style.setProperty('--rz-u', (host.offsetHeight / S) || 0.5);
      for (const p of P) {
        const q = p.painted;
        if (force || !q || q.ok !== p.ok || q.img !== !!cover || Math.abs(q.k - pxu) / pxu > 0.08) paint(p);
      }
    }

    function loadImage() {
      if (!opts.image) return;
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => {
        if (destroyed) return;
        img = im;
        const iw = im.naturalWidth, ih = im.naturalHeight;
        const s = Math.max(G.tw / iw, G.th / ih); // cubre el lugar (si la proporción no coincide, recorta al centro)
        cover = { w: iw * s, h: ih * s, x: (G.tw - iw * s) / 2, y: (G.th - ih * s) / 2 };
        paintAll(true);
      };
      im.onerror = () => { if (!destroyed && !img) paintAll(true); }; // sin imagen: piezas de cartón
      im.src = opts.image;
    }

    function rebuild() {
      G = geometry(aspect());
      if (img) {
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const s = Math.max(G.tw / iw, G.th / ih);
        cover = { w: iw * s, h: ih * s, x: (G.tw - iw * s) / 2, y: (G.th - ih * s) / 2 };
      }
    }

    // ---------- Estado ----------
    function target(s, p) {
      if (s && s.ok) return { x: G.home[p.i].x, y: G.home[p.i].y, ok: true };
      if (s && Number.isFinite(+s.x) && Number.isFinite(+s.y)) return { x: clampX(+s.x), y: clampY(+s.y), ok: false };
      return { x: G.scatter[p.i].x, y: G.scatter[p.i].y, ok: false }; // sin estado: desparramada
    }

    // Lo que llega del servidor (otros jugadores): no pisa la pieza que se está moviendo acá
    // ni una recién soltada (todavía puede no estar guardada). El cambio se anima.
    function apply(state) {
      const now = Date.now();
      state = state || {};
      for (const p of P) {
        if (drag && drag.p === p) continue;
        if (teclado && teclado.p === p) continue;
        if (now - p.movedAt < RECIEN) continue;
        const t = target(state[p.i] || state[String(p.i)], p);
        if (t.ok === p.ok && Math.abs(t.x - p.x) < 1e-4 && Math.abs(t.y - p.y) < 1e-4) continue;
        const fx = p.x, fy = p.y;
        const okChanged = t.ok !== p.ok;
        p.x = t.x;
        p.y = t.y;
        p.ok = t.ok;
        if (!p.ok) p.z = ++zTop; // la movió alguien: queda arriba de las otras sueltas
        put(p);
        if (okChanged) paint(p);
        glide(p, fx, fy, 550);
      }
      checkDone(false);
    }

    // Anima desde donde estaba hasta su lugar nuevo (solo con transformaciones: no traba)
    function glide(p, fromX, fromY, ms) {
      if (p.anim) { p.anim.cancel(); p.anim = null; }
      if (reduced.matches || !ms || !p.el.animate) return;
      const tx = ((fromX - p.x) / G.fwN) * 100, ty = ((fromY - p.y) / G.fhN) * 100;
      if (Math.abs(tx) < 0.05 && Math.abs(ty) < 0.05) return;
      p.anim = p.el.animate([{ translate: `${tx}% ${ty}%` }, { translate: '0% 0%' }],
        { duration: ms, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
      const a = p.anim;
      a.onfinish = a.oncancel = () => { if (p.anim === a) p.anim = null; };
    }

    function checkDone(initial) {
      const all = P.every((p) => p.ok);
      if (all === done) return;
      done = all;
      root.classList.toggle('rz-hecho', done);
      ver.tabIndex = done && interactive ? 0 : -1;
      P.forEach(put);
      if (done) {
        if (!initial && !reduced.matches) {
          root.classList.remove('rz-brilla');
          void root.offsetWidth;
          root.classList.add('rz-brilla');
        }
        estado.textContent = '¡' + label + ' completo!';
        if (initial) queueMicrotask(() => { if (!destroyed && done) onDone(); });
        else onDone();
      } else {
        root.classList.remove('rz-brilla');
      }
    }

    const placedCount = () => P.filter((p) => p.ok).length;
    const isNear = (p, x, y) => Math.hypot((x - G.home[p.i].x) * G.UW, (y - G.home[p.i].y) * G.UH) < SNAP * G.UW;

    // Suelta la pieza en (x, y): si está cerca de su lugar encastra; avisa al host
    function drop(p, x, y, fromX, fromY) {
      const near = isNear(p, x, y);
      if (near) {
        p.ok = true;
        p.x = G.home[p.i].x;
        p.y = G.home[p.i].y;
      } else {
        p.x = round4(clampX(x));
        p.y = round4(clampY(y));
      }
      p.movedAt = Date.now();
      put(p);
      if (near) {
        paint(p);
        glide(p, fromX, fromY, 200);
        if (!reduced.matches && p.el.animate) {
          p.el.animate([{ filter: 'brightness(1.35)' }, { filter: 'brightness(1)' }], { duration: 420, delay: 160, easing: 'ease-out' });
        }
        estado.textContent = `Pieza en su lugar: ${placedCount()} de ${N}.`;
      }
      onMove(p.i, { x: round4(p.x), y: round4(p.y), ok: p.ok });
      if (near) checkDone(false);
    }

    // ---------- Arrastrar ----------
    // Qué pieza está de verdad debajo del dedo (el canvas es más grande que la pieza: tiene el
    // lugar de las pestañas y la sombra, así que se mira la forma).
    function pieceAt(cx, cy) {
      for (const el of document.elementsFromPoint(cx, cy)) {
        const p = byEl.get(el);
        if (!p || p.ok) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const lx = ((cx - r.left) / r.width) * G.FW, ly = ((cy - r.top) / r.height) * G.FH;
        if (hitCtx.isPointInPath(G.paths[p.i], lx, ly)) return p;
      }
      return null;
    }

    function pointerIn(e) {
      const r = host.getBoundingClientRect(); // se mide cada vez: puede estar escalado o haberse corrido
      return { x: (e.clientX - r.left) / (r.width || 1), y: (e.clientY - r.top) / (r.height || 1) };
    }

    // Un clic en el borde transparente de una pieza (sin pieza debajo) es para lo que hay abajo
    // (el cryptex, un pergamino): se le pasa.
    root.addEventListener('click', (e) => {
      if (panMoved) { panMoved = false; e.stopPropagation(); return; } // el clic de un desplazamiento no abre nada
      if (!byEl.has(e.target) || pieceAt(e.clientX, e.clientY)) return;
      const below = document.elementsFromPoint(e.clientX, e.clientY).find((el) => !root.contains(el) && el !== host);
      if (below && typeof below.click === 'function') { e.stopPropagation(); below.click(); }
    });

    root.addEventListener('pointerdown', (e) => {
      panMoved = false; // si después de desplazar no llegó el clic, que no se coma el próximo
      if (!interactive || done || drag || e.button > 0 || !e.isPrimary) return;
      const p = pieceAt(e.clientX, e.clientY);
      if (!p) { if (e.pointerType !== 'mouse') startPan(e); return; }
      e.preventDefault();
      if (teclado) soltarTeclado();
      if (p.anim) { p.anim.cancel(); p.anim = null; }
      const q = pointerIn(e);
      drag = { p, id: e.pointerId, gx: q.x - p.x, gy: q.y - p.y, x: p.x, y: p.y, sx: e.clientX, sy: e.clientY, moved: false };
      p.z = ++zTop;
      p.el.style.zIndex = p.z;
      p.el.classList.add('rz-arrastrando');
      root.classList.add('rz-moviendo');
      try { p.el.setPointerCapture(e.pointerId); } catch {}
    });

    // Con el dedo, las piezas no dejan desplazar lo que las contiene (touch-action: none en todo
    // el canvas, también en el borde transparente): si se apoya ahí, se desplaza a mano.
    let pan = null, panMoved = false;
    function scrollerOf(el) {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const x = /auto|scroll/.test(cs.overflowX) && n.scrollWidth > n.clientWidth;
        const y = /auto|scroll/.test(cs.overflowY) && n.scrollHeight > n.clientHeight;
        if (x || y) return { n, x, y };
      }
      const d = document.scrollingElement;
      return d ? { n: d, x: d.scrollWidth > d.clientWidth, y: d.scrollHeight > d.clientHeight } : null;
    }
    function startPan(e) {
      const sc = scrollerOf(host);
      if (!sc) return;
      pan = { ...sc, el: e.target, id: e.pointerId, sx: e.clientX, sy: e.clientY, sl: sc.n.scrollLeft, st: sc.n.scrollTop };
      panMoved = false;
      try { e.target.setPointerCapture(e.pointerId); } catch {}
    }
    function movePan(e) {
      if (!pan || e.pointerId !== pan.id) return;
      const dx = e.clientX - pan.sx, dy = e.clientY - pan.sy;
      if (!panMoved && Math.hypot(dx, dy) < 6) return;
      panMoved = true;
      if (pan.x) pan.n.scrollLeft = pan.sl - dx;
      if (pan.y) pan.n.scrollTop = pan.st - dy;
    }
    function endPan(e) {
      if (!pan || (e && e.pointerId !== pan.id)) return;
      try { pan.el.releasePointerCapture(pan.id); } catch {}
      pan = null;
    }

    function moveDrag(e) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag, p = d.p;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
      d.moved = true;
      const q = pointerIn(e);
      d.x = clampX(q.x - d.gx);
      d.y = clampY(q.y - d.gy);
      p.el.style.translate = `${((d.x - p.x) / G.fwN) * 100}% ${((d.y - p.y) / G.fhN) * 100}%`;
      const near = isNear(p, d.x, d.y);
      if (near !== d.near) { d.near = near; p.el.classList.toggle('rz-cerca', near); }
    }

    function endDrag(e, cancel) {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const d = drag, p = d.p;
      drag = null;
      p.el.classList.remove('rz-arrastrando', 'rz-cerca');
      root.classList.remove('rz-moviendo');
      p.el.style.translate = '';
      try { p.el.releasePointerCapture(d.id); } catch {}
      if (cancel || !d.moved) {
        put(p);
        if (cancel) glide(p, d.x, d.y, 200);
        return;
      }
      drop(p, d.x, d.y, d.x, d.y);
    }

    root.addEventListener('pointermove', (e) => {
      if (pan) return movePan(e);
      if (drag) return moveDrag(e);
      if (e.pointerType !== 'mouse' || !interactive || done) return;
      // el cursor de "agarrar" solo sobre la forma de una pieza
      hoverPt = [e.clientX, e.clientY];
      if (!hoverRaf) {
        hoverRaf = requestAnimationFrame(() => {
          hoverRaf = 0;
          if (!hoverPt || drag || destroyed) return;
          root.classList.toggle('rz-agarra', !!pieceAt(hoverPt[0], hoverPt[1]));
        });
      }
    });
    root.addEventListener('pointerleave', () => { hoverPt = null; root.classList.remove('rz-agarra'); });
    root.addEventListener('pointerup', (e) => { endPan(e); endDrag(e); });
    root.addEventListener('pointercancel', (e) => { endPan(e); endDrag(e); });
    root.addEventListener('lostpointercapture', (e) => { endPan(e); endDrag(e); });
    root.addEventListener('contextmenu', (e) => { if (byEl.has(e.target)) e.preventDefault(); });

    // Escape mientras se arrastra: vuelve a donde estaba (y no cierra la vista del escritorio)
    const onKeyCapture = (e) => {
      if (e.key === 'Escape' && drag) { e.preventDefault(); e.stopPropagation(); endDrag(null, true); }
    };
    window.addEventListener('keydown', onKeyCapture, true);

    // ---------- Teclado ----------
    const FLECHAS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    function soltarTeclado() {
      const t = teclado;
      if (!t) return;
      teclado = null;
      clearTimeout(t.timer);
      t.p.el.classList.remove('rz-cerca');
      drop(t.p, t.p.x, t.p.y, t.p.x, t.p.y);
    }
    root.addEventListener('keydown', (e) => {
      if (e.target === ver && (e.key === 'Enter' || e.key === ' ')) return; // el botón ya hace clic
      const p = byEl.get(e.target);
      if (!p || p.ok || !interactive || done || drag) return;
      const dir = FLECHAS[e.key];
      if (dir) {
        e.preventDefault();
        if (teclado && teclado.p !== p) soltarTeclado();
        if (!teclado) { teclado = { p, timer: 0 }; p.z = ++zTop; }
        const step = e.shiftKey ? 0.03 : 0.005;
        p.x = clampX(p.x + dir[0] * step);
        p.y = clampY(p.y + dir[1] * step * G.A);
        p.movedAt = Date.now();
        put(p);
        p.el.classList.toggle('rz-cerca', isNear(p, p.x, p.y));
        clearTimeout(teclado.timer);
        teclado.timer = setTimeout(soltarTeclado, TECLA_MS);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (teclado && teclado.p === p) soltarTeclado();
      }
    });
    root.addEventListener('focusout', (e) => { if (teclado && e.target === teclado.p.el) soltarTeclado(); });

    ver.addEventListener('click', () => { if (done && interactive) onOpen(); });

    // ---------- Tamaño ----------
    let resizeTimer = 0;
    function onResize() {
      if (destroyed) return;
      if (drag) { resizeTimer = setTimeout(onResize, 200); return; } // después de soltarla
      if (Math.abs(aspect() - G.A) / G.A > 0.005) { // cambió la proporción: se rehacen las formas
        rebuild();
        layoutStatic();
        for (const p of P) if (p.ok) { p.x = G.home[p.i].x; p.y = G.home[p.i].y; put(p); }
        paintAll(true);
      } else {
        paintAll(false);
      }
    }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(onResize, 120);
    }) : null;

    // ---------- Arranque ----------
    rebuild();
    for (const p of P) p.z = Z_SUELTA + G.scatter[p.i].z;
    const st = opts.state || {};
    for (const p of P) {
      const t = target(st[p.i] || st[String(p.i)], p);
      p.x = t.x; p.y = t.y; p.ok = t.ok;
    }
    zTop = Math.max(...P.map((p) => p.z));
    root.classList.toggle('rz-quieto', !interactive);
    layoutStatic();
    if (!opts.image) paintAll(true); // con imagen se pinta una sola vez, cuando llega
    loadImage();
    if (ro) ro.observe(host);
    checkDone(true);

    return {
      el: root,
      update(state) { if (!destroyed) apply(state); },
      setInteractive(on) {
        on = !!on;
        if (on === interactive) return;
        if (!on) { endDrag(null, false); soltarTeclado(); }
        interactive = on;
        root.classList.toggle('rz-quieto', !on);
        root.classList.remove('rz-agarra');
        ver.tabIndex = done && on ? 0 : -1;
        P.forEach(put);
      },
      isDone: () => done,
      destroy() {
        if (destroyed) return;
        if (drag) endDrag(null, true);
        if (teclado) { clearTimeout(teclado.timer); teclado = null; }
        destroyed = true;
        clearTimeout(resizeTimer);
        cancelAnimationFrame(hoverRaf);
        if (ro) ro.disconnect();
        window.removeEventListener('keydown', onKeyCapture, true);
        root.remove();
        host.classList.remove('rz-host');
      },
    };
  }

  window.Rompecabezas = { mount };
})();
