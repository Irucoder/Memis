// Rompecabezas de la portada: en el rincón de arriba a la izquierda hay unas piezas medio
// desarmadas; al tocarlas se arman solas y se lee "Memi" (con un brillo, como la tinta del tintero).
(() => {
  const stage = document.querySelector('.stage');
  const layer = document.getElementById('puzzle');
  if (!stage || !layer) return;

  // Medidas en unidades de la portada (1 u = 1 px de fondo.webp, 1821 x 1025)
  const IMG_W = 1821;
  const P = 70, M = 24, K = 2, COLS = 4, ROWS = 3; // lado de la pieza, margen de la celda, px por unidad (piezas.webp)
  const CELL = (P + 2 * M) * K;                    // celda de cada pieza en piezas.webp
  const CAJA = { w: 412, h: 334 };                 // lugar que ocupan las piezas desparramadas (con su sombra)
  const ARMADO = { x: 14, y: 14, w: COLS * P, h: ROWS * P }; // dónde queda armado dentro de la caja
  const FOTO = { x: 46, y: 46 };                   // esquina de la caja en la foto (zona libre: x 40–480, y 40–420)
  const MARGEN = 6;                                // al borde de la ventana
  // Lo que no hay que tapar en la foto: la carpeta con los papeles y la lupa (polígono convexo)
  const CARPETA = [[975, 118], [1019, 118], [1099, 178], [1265, 476], [1396, 768], [1389, 792], [1384, 798],
    [1189, 851], [799, 949], [728, 949], [714, 941], [541, 288], [532, 253], [548, 244], [615, 222]];
  // Cómo quedaron tiradas: centro de cada pieza en la caja y giro (grados). Algunas casi en su lugar.
  // (la fila de arriba y la columna de la izquierda casi armadas; las otras sueltas, sin pisarse)
  const REPOSO = [
    [48, 48, 0], [120, 47, 0.6], [196, 45, 3], [348, 58, 24],
    [47, 121, -0.8], [138, 144, -31], [352, 167, -38], [340, 268, 104],
    [43, 198, -3.5], [152, 264, 168], [234, 162, 57], [246, 270, -76],
  ];
  const N = COLS * ROWS;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const easeOut = (t) => 1 - (1 - clamp(t, 0, 1)) ** 3;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const portrait = matchMedia('(max-aspect-ratio: 1 / 1)');
  const onChange = (mq, fn) => (mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn));

  // Cada pieza: dónde va armada (centro) y dónde está tirada
  const piezas = REPOSO.map(([x, y, a], i) => {
    const c = i % COLS, r = (i / COLS) | 0;
    const hx = ARMADO.x + c * P + P / 2, hy = ARMADO.y + r * P + P / 2;
    // giro hasta su lugar por el camino más corto
    const a0 = ((a + 540) % 360) - 180;
    // el arquito del vuelo va hacia adentro de la caja (si no, se cortaría en el borde)
    const d = Math.hypot(hx - x, hy - y) || 1, nx = -(hy - y) / d, ny = (hx - x) / d;
    const arco = nx * (CAJA.w / 2 - (x + hx) / 2) + ny * (CAJA.h / 2 - (y + hy) / 2) < 0 ? -1 : 1;
    return { i, c, r, hx, hy, x0: x, y0: y, a0, dist: Math.hypot(x - hx, y - hy), arco };
  });

  // ---------- Ubicación en pantalla ----------
  // En la compu va donde está en la foto (y se corre si la ventana recorta esa esquina). Si no entra
  // ahí (celular vertical, donde arriba ya está el tintero; ventanas casi cuadradas) busca otro
  // rincón libre: abajo de la carpeta o en una esquina. Se achica lo necesario para no pisar nada.
  const rect = (el) => {
    if (!el || !el.isConnected) return null;
    const b = el.getBoundingClientRect();
    return b.width && b.height ? [b.left, b.top, b.right, b.bottom] : null;
  };
  const polyOf = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

  // ¿el rectángulo [x0, y0, x1, y1] toca el polígono convexo? (ejes separadores)
  function choca(R, poly) {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, y] of poly) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); }
    if (b < R[0] || a > R[2] || d < R[1] || c > R[3]) return false;
    const corners = polyOf(...R);
    for (let k = 0; k < poly.length; k++) {
      const [x1, y1] = poly[k], [x2, y2] = poly[(k + 1) % poly.length];
      const nx = y1 - y2, ny = x2 - x1;
      let pMin = Infinity, pMax = -Infinity, rMin = Infinity, rMax = -Infinity;
      for (const [x, y] of poly) { const v = x * nx + y * ny; pMin = Math.min(pMin, v); pMax = Math.max(pMax, v); }
      for (const [x, y] of corners) { const v = x * nx + y * ny; rMin = Math.min(rMin, v); rMax = Math.max(rMax, v); }
      if (rMax < pMin || rMin > pMax) return false;
    }
    return true;
  }

  // Lo que hay que esquivar, en px de la pantalla
  function obstaculos(r, s) {
    const out = [CARPETA.map(([x, y]) => [r.left + x * s, r.top + y * s])];
    for (const id of ['slot', 'denied']) {
      const b = rect(document.getElementById(id));
      if (b) out.push(polyOf(...b));
    }
    // el tintero y la zona de tinta (tinta.js), cuando ya se ven; el pincel queda adentro de
    // ese recuadro (no se cuenta aparte: al pintar se mueve y el rompecabezas saltaría)
    const tinta = document.getElementById('tinta');
    if (tinta && tinta.isConnected && !tinta.classList.contains('cargando')) {
      let u = null;
      for (const q of ['.t-tintero', '.t-lienzo']) {
        const b = rect(tinta.querySelector(q));
        if (b) u = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b;
      }
      // el pincel, al ir y venir, se sale un poco de ese recuadro
      if (u) { const m = 14; out.push(polyOf(u[0] - m, u[1] - m, u[2] + m, u[3] + m)); }
    }
    // el cryptex y la rosa (abajo, en las esquinas): marcan con data-ocupa el lugar que ocupan
    // (apenas lo saben, aunque todavía se estén pintando; antes de eso, data-ocupa no tiene tamaño)
    for (const capa of vecinas) {
      if (!capa.isConnected || capa.classList.contains('oculto')) continue;
      for (const o of capa.querySelectorAll('[data-ocupa]')) {
        const b = rect(o);
        if (b) out.push(polyOf(...b));
      }
    }
    return out;
  }

  let L = null;
  function layout() {
    const r = stage.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const s = r.width / IMG_W;
    const obs = obstaculos(r, s);
    const aire = Math.max(8, 16 * s); // distancia mínima a lo que no hay que tapar
    const gMax = Math.min(s, (vw - 2 * MARGEN) * 0.62 / CAJA.w, (vh - 2 * MARGEN) * 0.5 / CAJA.h);
    const cands = [
      // (w: preferencia; en la compu, arriba a la izquierda salvo que ahí quede muy chiquito)
      { w: portrait.matches ? 0.9 : 1, at: () => [Math.max(MARGEN, r.left + FOTO.x * s), Math.max(MARGEN, r.top + FOTO.y * s)] },
      { w: portrait.matches ? 0.88 : 0.97, at: () => [MARGEN, MARGEN] },                              // pegado a la esquina
      { w: portrait.matches ? 1 : 0.6, at: (g) => [(vw - CAJA.w * g) / 2, vh - MARGEN - CAJA.h * g] }, // abajo, al medio
      { w: portrait.matches ? 0.96 : 0.6, at: (g) => [MARGEN, vh - MARGEN - CAJA.h * g] },          // abajo a la izquierda
      { w: portrait.matches ? 0.96 : 0.55, at: (g) => [vw - MARGEN - CAJA.w * g, vh - MARGEN - CAJA.h * g] }, // abajo a la derecha
    ];
    if (portrait.matches) {
      // abajo, entre el cryptex y la rosa: el hueco no siempre queda al medio (el borde de la
      // carpeta baja en diagonal), así que se prueba a lo largo del borde, del medio a los costados
      for (let k = 1; k <= 18; k++) {
        const f = 0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.05;
        cands.push({ w: 0.99, at: (g) => [MARGEN + (vw - 2 * MARGEN - CAJA.w * g) * f, vh - MARGEN - CAJA.h * g] });
      }
      // y si abajo no hay lugar (ventanas casi cuadradas: la carpeta llega al borde de abajo y el
      // rincón libre ya lo tiene el cryptex), a un costado de la carpeta, más arriba
      for (let f = 0.1; f < 0.95; f += 0.1) {
        cands.push({ w: 0.85, at: (g) => [MARGEN, vh - MARGEN - CAJA.h * g - (vh - 2 * MARGEN - CAJA.h * g) * f] });
        cands.push({ w: 0.85, at: (g) => [vw - MARGEN - CAJA.w * g, vh - MARGEN - CAJA.h * g - (vh - 2 * MARGEN - CAJA.h * g) * f] });
      }
    }
    const entra = (cand, g) => {
      const [x, y] = cand.at(g), w = CAJA.w * g, h = CAJA.h * g;
      if (x < MARGEN - 0.5 || y < MARGEN - 0.5 || x + w > vw - MARGEN + 0.5 || y + h > vh - MARGEN + 0.5) return false;
      const R = [x - aire, y - aire, x + w + aire, y + h + aire];
      return !obs.some((p) => choca(R, p));
    };
    let best = null;
    for (const cand of cands) {
      let lo = 0, hi = gMax;
      if (entra(cand, hi)) lo = hi;
      else for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (entra(cand, mid)) lo = mid; else hi = mid; }
      const score = lo * cand.w;
      if (!best || score > best.score + 1e-9) best = { score, g: lo, cand };
    }
    // muy chiquito no tiene gracia (y no se podría tocar): mejor no mostrarlo. En el celular se le
    // tiene más paciencia: abajo comparte el lugar con el cryptex y la rosa, y se lo mira de cerca
    if (!best || CAJA.w * best.g < (portrait.matches ? 100 : 120)) { L = null; return L; }
    const g = best.g;
    const [x, y] = best.cand.at(g);
    L = { g, x, y };
    return L;
  }

  const vecinas = ['cripto', 'rosa'].map((id) => document.getElementById(id)).filter(Boolean);

  // ---------- Elementos ----------
  const el = (tag, cls, attrs = {}) => { const e = document.createElement(tag); e.className = cls; Object.assign(e, attrs); return e; };
  const lienzo = el('canvas', 'p-lienzo');
  lienzo.setAttribute('aria-hidden', 'true');
  const boton = el('button', 'p-boton', { type: 'button', title: 'Rompecabezas' });
  boton.setAttribute('aria-label', 'Rompecabezas desarmado: armarlo');
  const aviso = el('span', 'sr-only');
  aviso.setAttribute('aria-live', 'polite');
  layer.append(lienzo, boton, aviso);
  layer.addEventListener('scroll', () => { layer.scrollLeft = 0; layer.scrollTop = 0; });
  const ctx = lienzo.getContext('2d');
  let sprite = null, brillo = null;

  function sizeCanvas() {
    // más que la resolución de las piezas no suma detalle
    const k = Math.min(L.g * (window.devicePixelRatio || 1), K);
    const w = Math.max(1, Math.round(CAJA.w * k)), h = Math.max(1, Math.round(CAJA.h * k));
    if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h; }
    return k;
  }

  function placeStatic() {
    if (!L) { layer.classList.add('oculto'); return; }
    layer.classList.remove('oculto');
    const g = L.g;
    Object.assign(lienzo.style, { transform: `translate(${L.x}px, ${L.y}px)`, width: CAJA.w * g + 'px', height: CAJA.h * g + 'px' });
    // antes de armarlo se toca cualquier pieza; armado, solo el cuadro
    const b = state === 'idle'
      ? { x: 0, y: 0, w: CAJA.w, h: CAJA.h }
      : { x: ARMADO.x - 4, y: ARMADO.y - 4, w: ARMADO.w + 8, h: ARMADO.h + 8 };
    Object.assign(boton.style, {
      transform: `translate(${L.x + b.x * g}px, ${L.y + b.y * g}px)`, width: b.w * g + 'px', height: b.h * g + 'px',
    });
  }

  // ---------- Dibujo ----------
  // pose: { x, y (centro, u), a (grados), h (0 apoyada .. 1 en el aire) }
  let escala = 1; // px del lienzo por unidad

  function sombra(p, pose, fuerte) {
    // solo la sombra: la pieza se dibuja muy lejos y la sombra se corre hasta su lugar
    const h = pose.h, LEJOS = 4000;
    const off = fuerte ? [0.5 + 6 * h, 1 + 9 * h] : [1.6 + 9 * h, 2.6 + 13 * h];
    ctx.shadowColor = `rgba(0, 0, 0, ${(fuerte ? 0.55 - 0.3 * h : 0.32 - 0.1 * h).toFixed(3)})`;
    ctx.shadowBlur = (fuerte ? 1.2 + 6 * h : 5 + 12 * h) * escala;
    ctx.shadowOffsetX = (off[0] + LEJOS) * escala;
    ctx.shadowOffsetY = off[1] * escala;
    figura(p, pose, -LEJOS);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
  }

  function figura(p, pose, dx = 0) {
    const sc = 1 + 0.07 * pose.h;
    ctx.save();
    ctx.translate(pose.x + dx, pose.y);
    ctx.rotate((pose.a * Math.PI) / 180);
    ctx.scale(sc, sc);
    ctx.drawImage(sprite, p.c * CELL, p.r * CELL, CELL, CELL, -P / 2 - M, -P / 2 - M, P + 2 * M, P + 2 * M);
    ctx.restore();
  }

  function draw(poses, extra, encima = false) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (!encima) ctx.clearRect(0, 0, lienzo.width, lienzo.height);
    ctx.setTransform(escala, 0, 0, escala, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    const alpha = extra.alpha == null ? 1 : extra.alpha;
    ctx.globalAlpha = alpha;
    // primero las apoyadas: las sombras de todas y después las piezas (así no se oscurecen entre ellas)
    const flat = [], up = [];
    piezas.forEach((p) => (poses[p.i].h > 0.004 ? up : flat).push(p));
    for (const p of flat) { sombra(p, poses[p.i], false); sombra(p, poses[p.i], true); }
    for (const p of flat) figura(p, poses[p.i]);
    // las que van por el aire, de la más baja a la más alta, cada una con su sombra
    up.sort((a, b) => poses[a.i].h - poses[b.i].h);
    for (const p of up) { sombra(p, poses[p.i], false); sombra(p, poses[p.i], true); figura(p, poses[p.i]); }
    // armado: un reflejo que cruza la lámina y "Memi" que brilla
    if (extra.reflejo > 0 && extra.reflejo < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ARMADO.x, ARMADO.y, ARMADO.w, ARMADO.h);
      ctx.clip();
      const cx = mix(ARMADO.x - 120, ARMADO.x + ARMADO.w + 120, extra.reflejo);
      const gr = ctx.createLinearGradient(cx - 70, ARMADO.y, cx + 70, ARMADO.y + ARMADO.h * 0.35);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0.22)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gr;
      ctx.fillRect(ARMADO.x, ARMADO.y, ARMADO.w, ARMADO.h);
      ctx.restore();
    }
    if (extra.brillo > 0.003) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = alpha * clamp(extra.brillo, 0, 1);
      ctx.drawImage(brillo, ARMADO.x, ARMADO.y, ARMADO.w, ARMADO.h);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = 1;
  }

  // ---------- Estado y animación ----------
  let state = 'idle'; // idle | armando | armado
  let t0 = 0, raf = 0, hover = 0, hoverTarget = 0, pulso = null;
  const T_PASO = 78, T_VUELO = 640; // entre una pieza y la siguiente; lo que tarda cada una
  const T_BRILLO = 1500;            // el destello del final
  const BRILLO_FINAL = 0.3;
  // se arman de izquierda a derecha, así "Memi" aparece como si se escribiera
  const orden = piezas.slice().sort((a, b) => a.c - b.c || a.r - b.r);
  orden.forEach((p, k) => { p.delay = k * T_PASO; });
  const T_ARMADO = (N - 1) * T_PASO + T_VUELO;

  const enReposo = (p) => ({ x: p.x0, y: p.y0, a: p.a0, h: 0 });
  const enSuLugar = (p) => ({ x: p.hx, y: p.hy, a: 0, h: 0 });

  function vuelo(p, k) {
    if (k <= 0) return enReposo(p);
    if (k >= 1) return enSuLugar(p);
    const e = easeInOut(k);
    const amp = clamp(p.dist / 90, 0.2, 1); // las que están cerca apenas se levantan
    let x = mix(p.x0, p.hx, e), y = mix(p.y0, p.hy, e);
    // un arquito al trasladarse
    const dx = p.hx - p.x0, dy = p.hy - p.y0, d = Math.hypot(dx, dy) || 1;
    const bump = Math.sin(Math.PI * e) * Math.min(18, d * 0.15) * p.arco;
    x += (-dy / d) * bump; y += (dx / d) * bump;
    return { x, y, a: p.a0 * (1 - easeOut(k * 1.15)), h: amp * Math.sin(Math.PI * clamp(k * 1.05, 0, 1)) };
  }

  function frame() {
    raf = 0;
    if (!L || !sprite) return;
    const now = performance.now();
    let more = false;
    let poses, extra = { brillo: 0, reflejo: 0 };
    if (state === 'armando' && reduced.matches) {
      // sin movimiento: lo desarmado se funde en lo armado
      const k = easeInOut((now - t0) / 700);
      draw(piezas.map(enReposo), { alpha: 1 - k });
      draw(piezas.map(enSuLugar), { alpha: k, brillo: BRILLO_FINAL }, true);
      if (k >= 1) finish();
      raf = requestAnimationFrame(frame);
      return;
    }
    if (state === 'armando') {
      const t = now - t0;
      poses = piezas.map((p) => vuelo(p, (t - p.delay) / T_VUELO));
      if (t >= T_ARMADO) {
        finish();
        pulso = now; // y "Memi" brilla
        extra.brillo = BRILLO_FINAL;
      }
      more = true;
    } else if (state === 'armado') {
      poses = piezas.map(enSuLugar);
      extra.brillo = BRILLO_FINAL;
      if (pulso != null) {
        const k = (now - pulso) / T_BRILLO;
        if (k >= 1) pulso = null;
        else {
          // sube rápido, se queda un ratito y baja hasta el brillo de siempre
          const sube = easeOut(k / 0.22), baja = easeInOut((k - 0.35) / 0.65);
          extra.brillo = k < 0.35 ? mix(BRILLO_FINAL, 1, sube) : mix(1, BRILLO_FINAL, baja);
          extra.reflejo = clamp((k - 0.08) / 0.62, 0, 1);
          more = true;
        }
      }
    } else {
      // desarmado: al pasar el mouse, las sueltas se levantan apenas (invitan a tocarlas)
      hover = mix(hover, hoverTarget, 0.22);
      if (Math.abs(hover - hoverTarget) < 0.004) hover = hoverTarget; else more = true;
      poses = piezas.map((p) => ({ ...enReposo(p), h: p.dist > 12 ? hover * 0.22 : 0 }));
    }
    draw(poses, extra);
    if (more) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function finish() {
    state = 'armado';
    layer.classList.remove('armando');
    layer.classList.add('armado');
    boton.setAttribute('aria-label', 'Rompecabezas armado: dice Memi');
    aviso.textContent = 'Se armó el rompecabezas: dice Memi';
    placeStatic(); // el botón pasa a cubrir solo el cuadro armado
  }

  boton.addEventListener('click', () => {
    if (!sprite || state === 'armando') return;
    if (state === 'armado') {
      // tocarlo de nuevo: vuelve a brillar
      if (!reduced.matches) { pulso = performance.now(); kick(); }
      return;
    }
    state = 'armando';
    layer.classList.add('armando');
    t0 = performance.now();
    kick();
  });
  const lift = (on) => { hoverTarget = on && !reduced.matches ? 1 : 0; kick(); };
  const focusVisible = () => { try { return boton.matches(':focus-visible'); } catch { return true; } };
  boton.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') lift(true); });
  boton.addEventListener('pointerleave', () => lift(false));
  boton.addEventListener('focus', () => { if (focusVisible()) lift(true); });
  boton.addEventListener('blur', () => lift(false));

  function relayout() {
    if (!sprite) return;
    layout();
    placeStatic();
    if (!L) return;
    escala = sizeCanvas();
    // se vuelve a dibujar en el próximo cuadro (si estaba en medio de la animación, sigue)
    kick();
  }
  addEventListener('resize', relayout);
  onChange(portrait, relayout);
  const watchDpr = () => {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const fn = () => {
      if (mq.removeEventListener) mq.removeEventListener('change', fn); else mq.removeListener(fn);
      relayout(); watchDpr();
    };
    onChange(mq, fn);
  };
  watchDpr();
  // El tintero, el cryptex y la rosa aparecen (o se caen, si no cargan) cuando terminan de cargar:
  // recién ahí se sabe qué lugar ocupan. Se los espera un rato antes de mostrar el rompecabezas,
  // para que no salte de lugar. Del cryptex y la rosa alcanza con que sepan dónde van (data-ocupa
  // ya ubicado): pintarse les lleva un rato más. Una capa vacía es que su script no llegó a correr
  // (no cargó): no se la espera (cuando se empieza, después del load, ya corrieron todos)
  const tinta = document.getElementById('tinta');
  const otras = [tinta, ...vecinas].filter(Boolean);
  const ubicada = (c) => vecinas.includes(c) && [...c.querySelectorAll('[data-ocupa]')].some((o) => rect(o));
  const tintaLista = () => otras.every((c) => !c.isConnected || !c.firstElementChild || !c.classList.contains('cargando') || ubicada(c));
  let esperando = false;
  function mostrar() {
    esperando = false;
    relayout();
    layer.classList.remove('cargando');
  }
  const alCambiarTinta = () => { if (esperando) { if (tintaLista()) mostrar(); } else relayout(); };
  const mira = new MutationObserver(alCambiarTinta);
  for (const c of otras) mira.observe(c, { attributes: true, attributeFilter: ['class'] });
  // y cuando el cryptex o la rosa se ubican (o se mueven) mientras se pintan, que no avisan con la clase
  const mirarOcupa = () => {
    for (const c of vecinas) for (const o of c.querySelectorAll('[data-ocupa]')) mira.observe(o, { attributes: true, attributeFilter: ['style'] });
  };
  if (document.body) new MutationObserver(() => { if (otras.some((c) => !c.isConnected)) alCambiarTinta(); }).observe(document.body, { childList: true });

  // ---------- Carga (después de la portada, para no demorarla) ----------
  const load = (name) => new Promise((ok, fail) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => ok(im));
    im.onerror = fail;
    im.src = '/portada-puzzle/' + name + '.webp';
  });
  function start() {
    mirarOcupa(); // (sus scripts van después de este: recién ahora están)
    Promise.all([load('piezas'), load('brillo')]).then(([pz, br]) => {
      sprite = pz; brillo = br;
      if (tintaLista()) { mostrar(); return; }
      esperando = true;
      setTimeout(() => { if (esperando) mostrar(); }, 4000);
    }).catch(() => layer.remove()); // si algo no carga, queda la portada tal cual
  }
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });
})();
