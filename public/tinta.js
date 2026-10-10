// Guiño del tintero: al tocar el pincel se levanta, se moja en el tintero y pasa
// tinta por el rincón; donde había óleo pastel blanco la tinta no pega y aparece "memi".
(() => {
  const stage = document.querySelector('.stage');
  const layer = document.getElementById('tinta');
  if (!stage || !layer) return;

  // Medidas en píxeles de la portada (fondo.webp, 1821 x 1025)
  const IMG_W = 1821;
  const ESQ = { x: 1500, y: 20, w: 321, h: 280 };      // recorte del tintero (tintero.webp / limpia.webp)
  const ZONA = { x: 1380, y: 280, w: 430, h: 250 };    // rincón donde se pinta (tinta-N.webp / memi.webp)
  const PINCEL = { w: 403, h: 36, eje: 16.55 };        // pincel acostado, punta a la izquierda
  const REPOSO = { x: 1654.45, y: 265.27, ang: -46.69 }; // punta y ángulo del pincel en la foto
  const BOCA = { x: 1622.6, y: 125.8 };                // boca del tintero
  const TINTERO_ARRIBA = 54;                           // borde de arriba del frasco
  const LUPA_DER = 1285;                               // borde derecho de la lupa
  // Pasadas del pincel (en proporción de la zona); las mismas con que se dibujó la tinta
  const PASADAS = [
    [[0.9, 0.191], [0.8347, 0.1893], [0.7695, 0.1887], [0.7042, 0.1891], [0.639, 0.1905], [0.5737, 0.193], [0.5085, 0.1965], [0.4432, 0.201], [0.378, 0.2066], [0.3127, 0.2132], [0.2475, 0.2208], [0.1822, 0.2295], [0.13, 0.2372]],
    [[0.09, 0.4296], [0.1612, 0.4322], [0.2324, 0.4334], [0.3036, 0.4335], [0.3747, 0.4322], [0.4459, 0.4297], [0.5171, 0.426], [0.5883, 0.4209], [0.6595, 0.4146], [0.7307, 0.4071], [0.8019, 0.3983], [0.8731, 0.3882], [0.93, 0.3792]],
    [[0.92, 0.5698], [0.8488, 0.5691], [0.7776, 0.5693], [0.7064, 0.5705], [0.6353, 0.5725], [0.5641, 0.5755], [0.4929, 0.5794], [0.4217, 0.5843], [0.3505, 0.59], [0.2793, 0.5967], [0.2081, 0.6042], [0.1369, 0.6127], [0.08, 0.6202]],
    [[0.11, 0.8084], [0.1761, 0.81], [0.2422, 0.8106], [0.3083, 0.8102], [0.3744, 0.8087], [0.4405, 0.8062], [0.5066, 0.8026], [0.5727, 0.798], [0.6388, 0.7924], [0.7049, 0.7857], [0.771, 0.778], [0.8371, 0.7693], [0.89, 0.7616]],
  ];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const portrait = matchMedia('(max-aspect-ratio: 1 / 1)');

  // ---------- Ubicación en pantalla ----------
  // En la compu el tintero queda donde está en la foto. Si la ventana recorta esa esquina
  // (o en el celular, donde solo se ve la carpeta), se arma el rincón en la esquina de la pantalla.
  let L = null;
  function layout() {
    const r = stage.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const s = r.width / IMG_W;
    let g, wx, wy, zx, zy, inPlace;
    if (!portrait.matches) {
      const ax0 = r.left + IMG_W * s, ay0 = r.top + ESQ.y * s;
      const ax = Math.min(vw, ax0);
      const groupW = IMG_W - ZONA.x, groupH = ZONA.y + ZONA.h - ESQ.y;
      // si hay que correrlo a la izquierda, que no pise la lupa: se achica
      g = clamp((ax - (r.left + LUPA_DER * s)) / groupW, s * 0.25, s);
      let ay = Math.max(ay0, 6 - (TINTERO_ARRIBA - ESQ.y) * g);
      if (ay + groupH * g > vh - 6) g = Math.max(g * 0.5, (vh - 6 - ay) / groupH);
      ay = Math.max(ay0, 6 - (TINTERO_ARRIBA - ESQ.y) * g);
      inPlace = Math.abs(ax - ax0) < 0.5 && Math.abs(ay - ay0) < 0.5 && Math.abs(g - s) < 1e-6;
      wx = ax - ESQ.w * g; wy = ay;
      zx = ax + (ZONA.x - IMG_W) * g; zy = ay + (ZONA.y - ESQ.y) * g;
    } else {
      // celular: tintero arriba a la derecha y la zona a su izquierda, sobre la carpeta
      const libre = r.top + 115 * s; // hasta donde empieza la carpeta
      g = Math.min(s, (vw - 12) / (ESQ.w + ZONA.w - 40), Math.max(libre, 90) / (ZONA.h + 10));
      wx = vw - ESQ.w * g;
      zx = wx + 40 * g - ZONA.w * g;
      zy = Math.max(6, (libre - ZONA.h * g) / 2);
      wy = zy - 40 * g;
      const top = wy + (TINTERO_ARRIBA - ESQ.y) * g;
      if (top < 4) { zy += 4 - top; wy += 4 - top; }
      inPlace = false;
    }
    L = {
      g, inPlace, wx, wy, zx, zy,
      limpia: inPlace ? null : { x: r.left + ESQ.x * s, y: r.top + ESQ.y * s, s },
      W: (x, y) => [wx + (x - ESQ.x) * g, wy + (y - ESQ.y) * g],
      Z: (u, v) => [zx + u * ZONA.w * g, zy + v * ZONA.h * g],
    };
    return L;
  }

  // ---------- Elementos ----------
  const el = (tag, cls, attrs = {}) => { const e = document.createElement(tag); e.className = cls; Object.assign(e, attrs); return e; };
  const limpiaImg = el('img', 't-limpia', { alt: '' });
  const tinteroImg = el('img', 't-tintero', { alt: '' });
  const lienzo = el('canvas', 't-lienzo');
  lienzo.setAttribute('aria-hidden', 'true');
  const wrap = el('div', 't-pincel-wrap');
  const pincelImg = el('img', 't-pincel', { alt: '', draggable: false });
  const boton = el('button', 't-boton', { type: 'button', title: 'Pincel' });
  boton.setAttribute('aria-label', 'Pincel: pasar tinta por el rincón');
  wrap.append(pincelImg, boton);
  layer.append(limpiaImg, tinteroImg, lienzo, wrap);
  const ctx = lienzo.getContext('2d');
  const tmp = document.createElement('canvas');
  const tctx = tmp.getContext('2d');
  const wcan = document.createElement('canvas'); // la palabra armada antes de apoyarla sobre la tinta
  const wctx = wcan.getContext('2d');

  // Máscaras de lo ya pintado (una por pasada) y de la palabra, en px de la zona
  const MW = ZONA.w, MH = ZONA.h;
  const mk = () => { const c = document.createElement('canvas'); c.width = MW; c.height = MH; return c; };
  const masks = PASADAS.map(mk);
  const wordMasks = PASADAS.map(mk);
  // Sello: una franja vertical suave (el ancho de las cerdas), arrastrada a lo largo de la pasada.
  // La de la tinta es generosa (cada capa solo tiene su pasada); la de la palabra cubre solo
  // el ancho de la pasada, para que no asome sobre el fondo antes de que llegue la tinta.
  const makeSello = (h, fade) => {
    const c = document.createElement('canvas');
    c.width = 14; c.height = h;
    const x = c.getContext('2d');
    const gx = x.createLinearGradient(0, 0, 14, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.5, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gx; x.fillRect(0, 0, 14, h);
    x.globalCompositeOperation = 'destination-in';
    const gy = x.createLinearGradient(0, 0, 0, h);
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(fade, 'rgba(0,0,0,1)'); gy.addColorStop(1 - fade, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gy; x.fillRect(0, 0, 14, h);
    return c;
  };
  const SELLO_TINTA = makeSello(132, 0.14);
  const SELLO_PALABRA = makeSello(Math.round(ZONA.h * 0.135 * 2 + 12), 0.16);
  const stamp = (m, u, v, alpha = 1, sello = SELLO_TINTA) => {
    const c = m.getContext('2d');
    c.globalAlpha = alpha;
    c.drawImage(sello, u * MW - 7, v * MH - sello.height / 2);
    c.globalAlpha = 1;
  };
  const blob = (m, u, v, rad) => {
    const c = m.getContext('2d');
    const x = u * MW, y = v * MH;
    const gr = c.createRadialGradient(x, y, rad * 0.55, x, y, rad);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  const fillTo = (m, alpha) => {
    m.getContext('2d').clearRect(0, 0, MW, MH);
    fillMask(m, alpha);
  };
  const fillMask = (m, alpha) => {
    const c = m.getContext('2d');
    c.globalAlpha = alpha; c.fillStyle = '#000'; c.fillRect(0, 0, MW, MH); c.globalAlpha = 1;
  };

  // ---------- Recorrido de cada pasada ----------
  const paths = PASADAS.map((pts) => {
    const acc = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = (pts[i][0] - pts[i - 1][0]) * MW, dy = (pts[i][1] - pts[i - 1][1]) * MH;
      acc.push(acc[i - 1] + Math.hypot(dx, dy));
    }
    return { pts, acc, len: acc[acc.length - 1] };
  });
  const along = (path, f) => {
    const d = clamp(f, 0, 1) * path.len;
    let i = 1;
    while (i < path.acc.length - 1 && path.acc[i] < d) i++;
    const k = (d - path.acc[i - 1]) / (path.acc[i] - path.acc[i - 1] || 1);
    return [mix(path.pts[i - 1][0], path.pts[i][0], k), mix(path.pts[i - 1][1], path.pts[i][1], k)];
  };

  // ---------- Línea de tiempo ----------
  const T_LIFT = 280, T_TO_INK = 520, T_DIP = 330, DIPS = 2, T_TO_ZONE = 520, T_SWEEP = 620, T_TURN = 200,
    T_UP = 300, T_BACK = 640, T_LAND = 280, T_FILL = 650;
  const WORD_DELAYS = [170, 300, 440, 600]; // la tinta resbala de la cera y la palabra asoma de a poco
  const sweepStart = [];
  {
    let t = T_LIFT + T_TO_INK + T_DIP * DIPS + T_TO_ZONE;
    for (let i = 0; i < PASADAS.length; i++) { sweepStart.push(t); t += T_SWEEP + T_TURN; }
  }
  const T_SWEEPS_END = sweepStart[sweepStart.length - 1] + T_SWEEP;
  const T_END = T_SWEEPS_END + T_UP + T_BACK + T_LAND;

  const POSE_REST = () => ({ p: L.W(REPOSO.x, REPOSO.y), ang: REPOSO.ang, fs: 1, h: 0 });
  const POSE_LIFT = () => ({ p: L.W(REPOSO.x - 12, REPOSO.y - 16), ang: -50, fs: 0.9, h: 1 });
  const POSE_INK = () => ({ p: L.W(BOCA.x + 3, BOCA.y + 1), ang: -60, fs: 0.56, h: 0.8 });
  const POSE_DIPPED = () => ({ p: L.W(BOCA.x, BOCA.y + 3), ang: -62, fs: 0.52, h: 0.06, dip: 1 });
  const zoneAng = (dir) => -50 + 9 * dir;
  const POSE_SWEEP = (i, f) => {
    const path = paths[i];
    const [u, v] = along(path, f);
    const dir = Math.sign(path.pts[path.pts.length - 1][0] - path.pts[0][0]);
    return { p: L.Z(u, v), ang: zoneAng(dir), fs: 0.72, h: 0.12 };
  };
  const between = (a, b, k, arc = 0) => {
    const e = easeInOut(k);
    let x = mix(a.p[0], b.p[0], e), y = mix(a.p[1], b.p[1], e);
    if (arc) { // un pequeño arco al trasladarse
      const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], d = Math.hypot(dx, dy) || 1;
      const bump = Math.sin(Math.PI * e) * arc * L.g;
      x += (-dy / d) * bump; y += (dx / d) * bump;
    }
    return { p: [x, y], ang: mix(a.ang, b.ang, e), fs: mix(a.fs, b.fs, e), h: mix(a.h, b.h, e), dip: mix(a.dip || 0, b.dip || 0, e) };
  };

  function poseAt(t) {
    if (t <= 0) return POSE_REST();
    let t0 = 0;
    if (t < (t0 += T_LIFT)) return between(POSE_REST(), POSE_LIFT(), t / T_LIFT);
    if (t < t0 + T_TO_INK) return between(POSE_LIFT(), POSE_INK(), (t - t0) / T_TO_INK, -30);
    t0 += T_TO_INK;
    if (t < t0 + T_DIP * DIPS) {
      const k = ((t - t0) % T_DIP) / T_DIP;
      const pose = between(POSE_INK(), POSE_DIPPED(), Math.sin(Math.PI * k));
      // revolver apenas
      pose.p[0] += Math.sin(k * Math.PI * 2) * 2 * L.g;
      return pose;
    }
    t0 += T_DIP * DIPS;
    const first = POSE_SWEEP(0, 0);
    if (t < t0 + T_TO_ZONE) return between(POSE_INK(), first, (t - t0) / T_TO_ZONE, 26);
    for (let i = 0; i < PASADAS.length; i++) {
      const ts = sweepStart[i];
      if (t < ts + T_SWEEP) {
        const k = (t - ts) / T_SWEEP;
        const pose = POSE_SWEEP(i, easeInOut(k));
        pose.h += 0.05 * Math.sin(k * Math.PI * 4); // presión que varía
        pose.ang += 4 * Math.sin(k * Math.PI);
        return pose;
      }
      if (i < PASADAS.length - 1 && t < ts + T_SWEEP + T_TURN) {
        const a = POSE_SWEEP(i, 1), b = POSE_SWEEP(i + 1, 0);
        const k = (t - ts - T_SWEEP) / T_TURN;
        const pose = between(a, b, k);
        pose.h = 0.12 + 0.3 * Math.sin(Math.PI * k);
        return pose;
      }
    }
    t0 = T_SWEEPS_END;
    const last = POSE_SWEEP(PASADAS.length - 1, 1);
    if (t < t0 + T_UP) return between(last, { ...last, h: 1, fs: 0.8 }, (t - t0) / T_UP);
    t0 += T_UP;
    if (t < t0 + T_BACK) return between({ ...last, h: 1, fs: 0.8 }, POSE_LIFT(), (t - t0) / T_BACK, 24);
    t0 += T_BACK;
    if (t < t0 + T_LAND) {
      const k = (t - t0) / T_LAND;
      const pose = between(POSE_LIFT(), POSE_REST(), easeOut(k));
      return pose;
    }
    return POSE_REST();
  }

  // ---------- Dibujo ----------
  let layers = null, words = null;
  const srcs = {};
  let used = PASADAS.map(() => false), wordUsed = PASADAS.map(() => false);

  function sizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(ZONA.w * L.g * dpr)), h = Math.max(1, Math.round(ZONA.h * L.g * dpr));
    if (lienzo.width !== w || lienzo.height !== h) {
      lienzo.width = tmp.width = wcan.width = w; lienzo.height = tmp.height = wcan.height = h;
      return true;
    }
    return false;
  }

  function paint() {
    if (!layers) return;
    const w = lienzo.width, h = lienzo.height;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    // cada pasada suma su parte de la aguada (las capas se reparten el alfa: sumadas dan la tinta completa)
    for (let i = 0; i < layers.length; i++) {
      if (!used[i]) continue;
      tctx.globalCompositeOperation = 'source-over';
      tctx.clearRect(0, 0, w, h);
      tctx.drawImage(layers[i], 0, 0, w, h);
      tctx.globalCompositeOperation = 'destination-in';
      tctx.drawImage(masks[i], 0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(tmp, 0, 0);
    }
    // la palabra, también por pasada (asoma donde ya llegó la tinta de esa pasada), encima de la tinta
    if (wordUsed.some(Boolean)) {
      wctx.globalCompositeOperation = 'source-over';
      wctx.clearRect(0, 0, w, h);
      for (let i = 0; i < words.length; i++) {
        if (!wordUsed[i]) continue;
        tctx.globalCompositeOperation = 'source-over';
        tctx.clearRect(0, 0, w, h);
        tctx.drawImage(words[i], 0, 0, w, h);
        tctx.globalCompositeOperation = 'destination-in';
        tctx.drawImage(wordMasks[i], 0, 0, w, h);
        wctx.globalCompositeOperation = 'lighter';
        wctx.drawImage(tmp, 0, 0);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(wcan, 0, 0);
    }
    tctx.globalCompositeOperation = 'source-over';
  }

  function placeStatic() {
    const g = L.g;
    Object.assign(tinteroImg.style, { transform: `translate(${L.wx}px, ${L.wy}px)`, width: ESQ.w * g + 'px', height: ESQ.h * g + 'px' });
    // fuera de su lugar en la foto va el frasco solo (recortado), sin el verde de alrededor
    const src = L.inPlace ? srcs.tintero : srcs.solo;
    if (tinteroImg.getAttribute('src') !== src) tinteroImg.src = src;
    Object.assign(lienzo.style, { transform: `translate(${L.zx}px, ${L.zy}px)`, width: ZONA.w * g + 'px', height: ZONA.h * g + 'px' });
    if (L.limpia) {
      const { x, y, s } = L.limpia;
      Object.assign(limpiaImg.style, { display: '', transform: `translate(${x}px, ${y}px)`, width: ESQ.w * s + 'px', height: ESQ.h * s + 'px' });
    } else limpiaImg.style.display = 'none';
    const pw = PINCEL.w * g, ph = PINCEL.h * g, eje = PINCEL.eje * g, pad = 8;
    Object.assign(pincelImg.style, { width: pw + 'px', height: ph + 'px', top: -eje + 'px', transformOrigin: `0 ${eje}px` });
    Object.assign(boton.style, { width: pw + 2 * pad + 'px', height: ph + 2 * pad + 'px', left: -pad + 'px', top: -eje - pad + 'px', transformOrigin: `${pad}px ${eje + pad}px` });
    if (sizeCanvas()) paint();
  }

  function drawBrush(pose) {
    const g = L.g;
    wrap.style.transform = `translate(${pose.p[0]}px, ${pose.p[1]}px)`;
    const sc = 1 + 0.09 * pose.h;
    const tr = `rotate(${pose.ang}deg) scale(${sc * pose.fs}, ${sc})`;
    pincelImg.style.transform = tr;
    boton.style.transform = tr;
    const a = 0.42 * smooth(0, 0.3, pose.h);
    wrap.style.filter = a > 0.01
      ? `drop-shadow(${(1.5 + 13 * pose.h) * g}px ${(2.5 + 17 * pose.h) * g}px ${(1.5 + 9 * pose.h) * g}px rgba(0,0,0,${a.toFixed(3)}))`
      : 'none';
    // al mojarlo, la punta queda dentro de la tinta
    const dip = pose.dip || 0;
    if (dip > 0.02) {
      const x = 30 * dip * g;
      const m = `linear-gradient(to right, transparent ${x - 6}px, #000 ${x + 4}px)`;
      pincelImg.style.webkitMaskImage = m; pincelImg.style.maskImage = m;
    } else if (pincelImg.style.maskImage || pincelImg.style.webkitMaskImage) {
      pincelImg.style.webkitMaskImage = ''; pincelImg.style.maskImage = '';
    }
  }

  // ---------- Estado y animación ----------
  let state = 'idle'; // idle | painting | done
  let t0 = 0, hover = 0, hoverTarget = 0, hop = null, raf = 0;
  const sweepDone = PASADAS.map(() => 0);
  const wordQueue = [];
  let fillDone = false;

  function stampSweep(i, f, now) {
    const path = paths[i];
    const from = sweepDone[i];
    if (f <= from) return;
    if (from === 0) {
      // donde apoya el pincel queda la gota redonda del comienzo
      const [u, v] = along(path, 0);
      blob(masks[i], u, v, 46); used[i] = true;
      WORD_DELAYS.forEach((d) => wordQueue.push({ t: now + d, i, u, v, blob: true }));
    }
    const step = 1.5 / path.len; // cada 1,5 px de la zona
    for (let k = Math.max(from, 0) + step; k <= f + 1e-9; k += step) {
      const [u, v] = along(path, k);
      stamp(masks[i], u, v);
      for (const d of WORD_DELAYS) wordQueue.push({ t: now + d, i, u, v });
    }
    sweepDone[i] = f;
  }

  function flushWord(now) {
    let hit = false;
    for (let n = wordQueue.length - 1; n >= 0; n--) {
      const q = wordQueue[n];
      if (q.t > now) continue;
      if (q.blob) blob(wordMasks[q.i], q.u, q.v, 46);
      else stamp(wordMasks[q.i], q.u, q.v, 0.08);
      wordUsed[q.i] = true;
      wordQueue.splice(n, 1);
      hit = true;
    }
    return hit;
  }

  function frame() {
    raf = 0;
    if (!L) return;
    const now = performance.now();
    let pose, dirty = false, more = false;
    if (state === 'painting') {
      const t = now - t0;
      if (reduced.matches) {
        // sin movimiento: la tinta y la palabra aparecen solas
        const k = easeInOut(t / 900), kw = easeInOut((t - 300) / 900);
        masks.forEach((m) => fillTo(m, k)); used = used.map(() => true);
        if (kw > 0) { wordMasks.forEach((m) => fillTo(m, kw)); wordUsed = wordUsed.map(() => true); }
        dirty = true;
        if (kw >= 1 && k >= 1) finish();
        pose = POSE_REST();
      } else {
        pose = poseAt(t);
        for (let i = 0; i < PASADAS.length; i++) {
          const k = (t - sweepStart[i]) / T_SWEEP;
          if (k > 0) { stampSweep(i, easeInOut(Math.min(1, k)), t); dirty = true; }
        }
        if (flushWord(t)) dirty = true;
        // al terminar, la tinta termina de correr y completa lo que haya quedado
        if (t > T_SWEEPS_END) {
          const k = (t - T_SWEEPS_END) / T_FILL;
          masks.forEach((m) => fillMask(m, 0.1)); used = used.map(() => true);
          if (k > 0.45) { wordMasks.forEach((m) => fillMask(m, 0.1)); wordUsed = wordUsed.map(() => true); }
          dirty = true;
        }
        if (t >= T_END && t >= T_SWEEPS_END + T_FILL + 600) finish();
      }
      more = state === 'painting';
    }
    if (state !== 'painting') {
      hover = mix(hover, hoverTarget, 0.25);
      if (Math.abs(hover - hoverTarget) < 0.005) hover = hoverTarget; else more = true;
      pose = POSE_REST();
      pose.h = hover;
      pose.ang += -1.5 * hover;
      if (hop) {
        const k = (now - hop) / 520;
        if (k >= 1) hop = null;
        else { pose.h += 0.7 * Math.sin(Math.PI * k); pose.ang += 3 * Math.sin(k * Math.PI * 3) * (1 - k); more = true; }
      }
    }
    drawBrush(pose);
    if (dirty) paint();
    if (more) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function finish() {
    masks.forEach((m) => fillMask(m, 1)); used = used.map(() => true);
    wordMasks.forEach((m) => fillMask(m, 1)); wordUsed = wordUsed.map(() => true); wordQueue.length = 0;
    state = 'done';
    layer.classList.remove('pintando');
    lienzo.setAttribute('role', 'img');
    lienzo.setAttribute('aria-label', 'memi');
    lienzo.removeAttribute('aria-hidden');
    paint();
  }

  boton.addEventListener('click', () => {
    if (!layers || state === 'painting') return;
    if (state === 'done') { hop = performance.now(); kick(); return; }
    state = 'painting';
    layer.classList.add('pintando');
    t0 = performance.now();
    kick();
  });
  boton.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hoverTarget = 0.2; kick(); } });
  boton.addEventListener('pointerleave', () => { hoverTarget = 0; kick(); });
  const focusVisible = () => { try { return boton.matches(':focus-visible'); } catch { return true; } };
  boton.addEventListener('focus', () => { if (focusVisible()) { hoverTarget = 0.2; kick(); } });
  boton.addEventListener('blur', () => { hoverTarget = 0; kick(); });

  function relayout() {
    if (!layers) return;
    layout();
    placeStatic();
    paint();
    kick();
  }
  addEventListener('resize', relayout);
  portrait.addEventListener?.('change', relayout);

  // ---------- Carga (después de la portada, para no demorarla) ----------
  const load = (name) => new Promise((ok, fail) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => ok(im));
    im.onerror = fail;
    im.src = '/tinta/' + name + '.webp';
  });
  function start() {
    Promise.all([
      load('tintero'), load('limpia'), load('pincel'), load('tintero-solo'),
      Promise.all([1, 2, 3, 4].map((n) => load('tinta-' + n))),
      Promise.all([1, 2, 3, 4].map((n) => load('memi-' + n))),
    ]).then(([tin, lim, pin, solo, capas, palabra]) => {
      srcs.tintero = tin.src; srcs.solo = solo.src;
      limpiaImg.src = lim.src; pincelImg.src = pin.src;
      layers = capas; words = palabra;
      layout();
      placeStatic();
      drawBrush(POSE_REST());
      layer.classList.remove('cargando');
    }).catch(() => layer.remove()); // si algo no carga, queda la portada tal cual
  }
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });
})();
