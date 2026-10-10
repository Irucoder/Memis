// Guiño del tintero: al tocar el pincel se levanta, se moja en el tintero y pasa
// tinta por el rincón; donde había óleo pastel blanco la tinta no pega y aparece "memi".
(() => {
  const stage = document.querySelector('.stage');
  const layer = document.getElementById('tinta');
  if (!stage || !layer) return;

  // Medidas en píxeles de la portada (fondo.webp, 1821 x 1025)
  const IMG_W = 1821;
  const ESQ = { x: 1500, y: 20, w: 321, h: 280 };      // recorte del tintero (tintero.webp / limpia.webp)
  const ZONA = { x: 1380, y: 280, w: 430, h: 250 };    // rincón donde se pinta (tinta-N.webp / memi-N.webp)
  const TEX = { w: 860, h: 500 };                      // resolución de esas texturas
  const PINCEL = { w: 403, h: 36, eje: 16.55 };        // pincel acostado, punta a la izquierda
  const REPOSO = { x: 1654.45, y: 265.27, ang: -46.69 }; // punta y ángulo del pincel en la foto
  const BOCA = { x: 1622.6, y: 125.8 };                // boca del tintero
  const TINTERO_ARRIBA = 54;                           // borde de arriba del frasco
  const LUPA_DER = 1285;                               // borde derecho de la lupa
  const CARPETA_ARRIBA = 115;                          // punto más alto de la carpeta
  // Pasadas del pincel (en proporción de la zona); las mismas con que se dibujó la tinta
  const PASADAS = [
    [[0.9, 0.191], [0.8347, 0.1893], [0.7695, 0.1887], [0.7042, 0.1891], [0.639, 0.1905], [0.5737, 0.193], [0.5085, 0.1965], [0.4432, 0.201], [0.378, 0.2066], [0.3127, 0.2132], [0.2475, 0.2208], [0.1822, 0.2295], [0.13, 0.2372]],
    [[0.09, 0.4296], [0.1612, 0.4322], [0.2324, 0.4334], [0.3036, 0.4335], [0.3747, 0.4322], [0.4459, 0.4297], [0.5171, 0.426], [0.5883, 0.4209], [0.6595, 0.4146], [0.7307, 0.4071], [0.8019, 0.3983], [0.8731, 0.3882], [0.93, 0.3792]],
    [[0.92, 0.5698], [0.8488, 0.5691], [0.7776, 0.5693], [0.7064, 0.5705], [0.6353, 0.5725], [0.5641, 0.5755], [0.4929, 0.5794], [0.4217, 0.5843], [0.3505, 0.59], [0.2793, 0.5967], [0.2081, 0.6042], [0.1369, 0.6127], [0.08, 0.6202]],
    [[0.11, 0.8084], [0.1761, 0.81], [0.2422, 0.8106], [0.3083, 0.8102], [0.3744, 0.8087], [0.4405, 0.8062], [0.5066, 0.8026], [0.5727, 0.798], [0.6388, 0.7924], [0.7049, 0.7857], [0.771, 0.778], [0.8371, 0.7693], [0.89, 0.7616]],
  ];
  const N = PASADAS.length;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const portrait = matchMedia('(max-aspect-ratio: 1 / 1)');
  const onChange = (mq, fn) => (mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn));

  // ---------- Ubicación en pantalla ----------
  // En la compu el tintero queda donde está en la foto. Si la ventana recorta esa esquina se corre
  // (y se achica si hace falta para no pisar la lupa). En el celular, donde solo se ve la carpeta,
  // el tintero va arriba a la derecha y la zona a su izquierda, sobre la carpeta.
  let L = null;
  function layout() {
    const r = stage.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const s = r.width / IMG_W;
    const libre = r.top + CARPETA_ARRIBA * s; // alto libre arriba de la carpeta
    let g, wx, wy, zx, zy, inPlace;
    if (!portrait.matches || libre < 90) {
      const ax0 = r.left + IMG_W * s, ay0 = r.top + ESQ.y * s;
      const ax = Math.min(vw, ax0);
      const groupW = IMG_W - ZONA.x, groupH = ZONA.y + ZONA.h - ESQ.y;
      g = clamp((ax - (r.left + LUPA_DER * s)) / groupW, s * 0.25, s);
      let ay = Math.max(ay0, 6 - (TINTERO_ARRIBA - ESQ.y) * g);
      if (ay + groupH * g > vh - 6) g = Math.max(g * 0.5, (vh - 6 - ay) / groupH);
      ay = Math.max(ay0, 6 - (TINTERO_ARRIBA - ESQ.y) * g);
      inPlace = Math.abs(ax - ax0) < 0.5 && Math.abs(ay - ay0) < 0.5 && Math.abs(g - s) < 1e-6;
      wx = ax - ESQ.w * g; wy = ay;
      zx = ax + (ZONA.x - IMG_W) * g; zy = ay + (ZONA.y - ESQ.y) * g;
    } else {
      g = Math.min(s, (vw - 12) / (ESQ.w + ZONA.w - 40), libre / (ZONA.h + 10));
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
  const aviso = el('span', 'sr-only'); // para lectores de pantalla
  aviso.setAttribute('aria-live', 'polite');
  wrap.append(pincelImg, boton);
  layer.append(limpiaImg, tinteroImg, lienzo, wrap, aviso);
  // la capa nunca se desplaza (un scrollIntoView del pincel destaparía la esquina original)
  layer.addEventListener('scroll', () => { layer.scrollLeft = 0; layer.scrollTop = 0; });
  const ctx = lienzo.getContext('2d');
  const canvas = () => document.createElement('canvas');
  const wcan = canvas(); // la palabra armada antes de apoyarla sobre la tinta
  const wctx = wcan.getContext('2d');

  // Máscaras de lo ya pintado (una por pasada, para la tinta y para la palabra), en px de la zona
  const MW = ZONA.w, MH = ZONA.h;
  const mk = () => { const c = canvas(); c.width = MW; c.height = MH; return c; };
  const masks = PASADAS.map(mk);
  const wordMasks = PASADAS.map(mk);
  // Sello: una pincelada ovalada, con el frente redondeado en la punta del pincel
  const DAB = { w: 64, h: 132 };
  const dab = canvas();
  dab.width = DAB.w; dab.height = DAB.h;
  {
    const x = dab.getContext('2d');
    x.setTransform(DAB.w / DAB.h, 0, 0, 1, DAB.w / 2, DAB.h / 2);
    const gr = x.createRadialGradient(0, 0, DAB.h * 0.3, 0, 0, DAB.h / 2);
    gr.addColorStop(0, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(-DAB.h / 2, -DAB.h / 2, DAB.h, DAB.h);
  }
  const stamp = (m, u, v, dir, alpha = 1) => {
    const c = m.getContext('2d');
    c.globalAlpha = alpha;
    c.drawImage(dab, u * MW - DAB.w / 2 - dir * DAB.w * 0.32, v * MH - DAB.h / 2);
    c.globalAlpha = 1;
  };
  const blob = (m, u, v, rad, alpha = 1) => {
    const c = m.getContext('2d');
    const x = u * MW, y = v * MH;
    const gr = c.createRadialGradient(x, y, rad * 0.55, x, y, rad);
    gr.addColorStop(0, `rgba(0,0,0,${alpha})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  const fillMask = (m) => { const c = m.getContext('2d'); c.fillStyle = '#000'; c.fillRect(0, 0, MW, MH); };

  // ---------- Recorrido de cada pasada ----------
  const paths = PASADAS.map((pts) => {
    const acc = [0];
    for (let i = 1; i < pts.length; i++) {
      const dx = (pts[i][0] - pts[i - 1][0]) * MW, dy = (pts[i][1] - pts[i - 1][1]) * MH;
      acc.push(acc[i - 1] + Math.hypot(dx, dy));
    }
    return { pts, acc, len: acc[acc.length - 1], dir: Math.sign(pts[pts.length - 1][0] - pts[0][0]) };
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
    for (let i = 0; i < N; i++) { sweepStart.push(t); t += T_SWEEP + T_TURN; }
  }
  const T_SWEEPS_END = sweepStart[N - 1] + T_SWEEP;
  const T_END = T_SWEEPS_END + T_UP + T_BACK + T_LAND;
  const T_DONE = Math.max(T_END, T_SWEEPS_END + T_FILL * 1.7);

  let liftH = 0; // si estaba levantado por el mouse, arranca desde ahí
  const POSE_REST = () => ({ p: L.W(REPOSO.x, REPOSO.y), ang: REPOSO.ang, fs: 1, h: 0 });
  const POSE_START = () => ({ ...POSE_REST(), h: liftH, ang: REPOSO.ang - 1.5 * liftH });
  const POSE_LIFT = () => ({ p: L.W(REPOSO.x - 12, REPOSO.y - 16), ang: -50, fs: 0.9, h: 1 });
  const POSE_INK = () => ({ p: L.W(BOCA.x + 3, BOCA.y + 1), ang: -60, fs: 0.56, h: 0.8 });
  const POSE_DIPPED = () => ({ p: L.W(BOCA.x, BOCA.y + 3), ang: -62, fs: 0.52, h: 0.06, dip: 1 });
  const POSE_SWEEP = (i, f) => {
    const [u, v] = along(paths[i], f);
    return { p: L.Z(u, v), ang: -50 + 9 * paths[i].dir, fs: 0.72, h: 0.12 };
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
    if (t <= 0) return POSE_START();
    let t0 = 0;
    if (t < (t0 += T_LIFT)) return between(POSE_START(), POSE_LIFT(), t / T_LIFT);
    if (t < t0 + T_TO_INK) return between(POSE_LIFT(), POSE_INK(), (t - t0) / T_TO_INK, -30);
    t0 += T_TO_INK;
    if (t < t0 + T_DIP * DIPS) {
      const k = ((t - t0) % T_DIP) / T_DIP;
      const pose = between(POSE_INK(), POSE_DIPPED(), Math.sin(Math.PI * k));
      pose.p[0] += Math.sin(k * Math.PI * 2) * 2 * L.g; // revolver apenas
      return pose;
    }
    t0 += T_DIP * DIPS;
    if (t < t0 + T_TO_ZONE) return between(POSE_INK(), POSE_SWEEP(0, 0), (t - t0) / T_TO_ZONE, 26);
    for (let i = 0; i < N; i++) {
      const ts = sweepStart[i];
      if (t < ts + T_SWEEP) {
        const k = (t - ts) / T_SWEEP;
        const pose = POSE_SWEEP(i, easeInOut(k));
        pose.h += 0.05 * Math.sin(k * Math.PI * 4); // presión que varía
        pose.ang += 4 * Math.sin(k * Math.PI);
        return pose;
      }
      if (i < N - 1 && t < ts + T_SWEEP + T_TURN) {
        const k = (t - ts - T_SWEEP) / T_TURN;
        const pose = between(POSE_SWEEP(i, 1), POSE_SWEEP(i + 1, 0), k);
        pose.h = 0.12 + 0.3 * Math.sin(Math.PI * k);
        return pose;
      }
    }
    t0 = T_SWEEPS_END;
    const last = POSE_SWEEP(N - 1, 1);
    const up = { ...last, h: 1, fs: 0.8 };
    if (t < t0 + T_UP) return between(last, up, (t - t0) / T_UP);
    t0 += T_UP;
    if (t < t0 + T_BACK) return between(up, POSE_LIFT(), (t - t0) / T_BACK, 24);
    t0 += T_BACK;
    if (t < t0 + T_LAND) return between(POSE_LIFT(), POSE_REST(), easeOut((t - t0) / T_LAND));
    return POSE_REST();
  }

  // ---------- Dibujo ----------
  // Cada pasada tiene su parte de la aguada y de la palabra (sus alfas sumados dan la imagen completa).
  // Se guarda cada capa ya enmascarada y solo se rehace la que cambió.
  let layers = null, words = null;
  const srcs = {};
  const used = PASADAS.map(() => false), wordUsed = PASADAS.map(() => false);
  const inkDirty = PASADAS.map(() => true), wordDirty = PASADAS.map(() => true);
  let inkC = [], wordC = [];
  let fillInk = 0, fillWord = 0; // fundido final hacia la imagen completa (0..1)

  function sizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // más que la resolución de las texturas no suma detalle
    const k = Math.min(1, TEX.w / (ZONA.w * L.g * dpr));
    const w = Math.max(1, Math.round(ZONA.w * L.g * dpr * k)), h = Math.max(1, Math.round(ZONA.h * L.g * dpr * k));
    if (lienzo.width === w && lienzo.height === h) return false;
    lienzo.width = wcan.width = w; lienzo.height = wcan.height = h;
    const sized = () => { const c = canvas(); c.width = w; c.height = h; return c; };
    inkC = PASADAS.map(sized); wordC = PASADAS.map(sized);
    inkDirty.fill(true); wordDirty.fill(true);
    return true;
  }

  const masked = (dst, src, mask) => {
    const c = dst.getContext('2d'), w = dst.width, h = dst.height;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, w, h);
    c.drawImage(src, 0, 0, w, h);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(mask, 0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
  };

  // suma (lighter) de las capas reveladas, fundiéndose hacia la imagen completa con `fill`
  function compose(c, srcList, cache, maskList, dirty, usedList, fill) {
    const w = c.canvas.width, h = c.canvas.height;
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, w, h);
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      if (fill < 1 && usedList[i]) {
        if (dirty[i]) { masked(cache[i], srcList[i], maskList[i]); dirty[i] = false; }
        c.globalAlpha = 1 - fill;
        c.drawImage(cache[i], 0, 0);
      }
      if (fill > 0) {
        c.globalAlpha = fill;
        c.drawImage(srcList[i], 0, 0, w, h);
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  function paint() {
    if (!layers) return;
    compose(ctx, layers, inkC, masks, inkDirty, used, fillInk);
    if (fillWord > 0 || wordUsed.some(Boolean)) {
      compose(wctx, words, wordC, wordMasks, wordDirty, wordUsed, fillWord);
      ctx.drawImage(wcan, 0, 0);
    }
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
  const sweepDone = PASADAS.map(() => -1); // -1: sin empezar; si no, hasta dónde se selló
  const wordQueue = [];

  // sella la pasada i hasta la fracción f, sin perder los avances chicos de cada cuadro
  function stampSweep(i, f, now) {
    const path = paths[i];
    const word = (u, v, isBlob) => { for (const d of WORD_DELAYS) wordQueue.push({ t: now + d, i, u, v, blob: isBlob }); };
    let changed = false;
    if (sweepDone[i] < 0) {
      // donde apoya el pincel queda la gota redonda del comienzo
      const [u, v] = along(path, 0);
      blob(masks[i], u, v, 46); used[i] = true; word(u, v, true);
      sweepDone[i] = 0; changed = true;
    }
    const step = 1.5 / path.len; // cada 1,5 px de la zona
    let k = sweepDone[i];
    while (k + step <= f) {
      k += step;
      const [u, v] = along(path, k);
      stamp(masks[i], u, v, path.dir); word(u, v, false);
      changed = true;
    }
    if (f >= 1 && k < 1) {
      // el final: las cerdas abiertas de la cola
      k = 1;
      const [u, v] = along(path, 1);
      stamp(masks[i], u, v, path.dir); blob(masks[i], u, v, 40); word(u, v, true);
      changed = true;
    }
    sweepDone[i] = k;
    if (changed) inkDirty[i] = true;
    return changed;
  }

  function flushWord(now) {
    let hit = false;
    for (let n = wordQueue.length - 1; n >= 0; n--) {
      const q = wordQueue[n];
      if (q.t > now) continue;
      if (q.blob) blob(wordMasks[q.i], q.u, q.v, 46, 0.3);
      else stamp(wordMasks[q.i], q.u, q.v, paths[q.i].dir, 0.025);
      wordUsed[q.i] = true; wordDirty[q.i] = true;
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
        // sin movimiento: la tinta y la palabra aparecen con un fundido
        fillInk = easeInOut(t / 900); fillWord = easeInOut((t - 300) / 900);
        dirty = true;
        if (t >= 1200) finish();
        pose = POSE_REST();
      } else {
        pose = poseAt(t);
        for (let i = 0; i < N; i++) {
          const k = (t - sweepStart[i]) / T_SWEEP;
          if (k > 0 && sweepDone[i] < 1 && stampSweep(i, easeInOut(Math.min(1, k)), t)) dirty = true;
        }
        if (flushWord(t)) dirty = true;
        // al terminar, la tinta termina de correr y completa lo que haya quedado
        if (t > T_SWEEPS_END) {
          const k = (t - T_SWEEPS_END) / T_FILL;
          fillInk = smooth(0, 1, k); fillWord = smooth(0.45, 1.6, k);
          dirty = true;
        }
        if (t >= T_DONE) finish();
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
    masks.forEach(fillMask); wordMasks.forEach(fillMask);
    used.fill(true); wordUsed.fill(true);
    fillInk = fillWord = 1; // desde ahora se dibujan las capas completas
    wordQueue.length = 0;
    state = 'done';
    hover = 0; // ya apoyado: si el mouse sigue encima, vuelve a levantarse suave
    layer.classList.remove('pintando');
    lienzo.setAttribute('role', 'img');
    lienzo.setAttribute('aria-label', 'memi');
    lienzo.removeAttribute('aria-hidden');
    aviso.textContent = 'Apareció la palabra memi';
    paint();
  }

  boton.addEventListener('click', () => {
    if (!layers || state === 'painting') return;
    if (state === 'done') {
      if (!hop && !reduced.matches) { hop = performance.now(); kick(); }
      return;
    }
    liftH = hover;
    state = 'painting';
    layer.classList.add('pintando');
    t0 = performance.now();
    kick();
  });
  const lift = (on) => { hoverTarget = on && !reduced.matches ? 0.2 : 0; kick(); };
  const focusVisible = () => { try { return boton.matches(':focus-visible'); } catch { return true; } };
  boton.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') lift(true); });
  boton.addEventListener('pointerleave', () => lift(false));
  boton.addEventListener('focus', () => { if (focusVisible()) lift(true); });
  boton.addEventListener('blur', () => lift(false));

  function relayout() {
    if (!layers) return;
    layout();
    placeStatic(); // si cambió la resolución del lienzo, ya lo vuelve a pintar
    kick();
  }
  addEventListener('resize', relayout);
  onChange(portrait, relayout);
  // pasar la ventana a una pantalla con otra densidad de píxeles no dispara 'resize'
  const watchDpr = () => {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const fn = () => {
      if (mq.removeEventListener) mq.removeEventListener('change', fn); else mq.removeListener(fn);
      relayout(); watchDpr();
    };
    onChange(mq, fn);
  };
  watchDpr();

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
