// Cryptex de la portada: abajo a la izquierda, tirado sobre el paño junto a la carpeta. Al tocarlo,
// los anillos giran y se van frenando de izquierda a derecha en M, E, M, I, T, O; cuando cae el
// último, un brillo dorado recorre la fila y MEMITO queda iluminado (como "Memi" en el rompecabezas).
// Es el mismo cryptex del escritorio (cryptex.js), pero visto desde arriba, como todo en la foto:
// cada anillo es una tira de latón con las letras grabadas que se "enrolla" sobre un cilindro, así
// las letras de arriba y de abajo se curvan y se achican. Va todo acá: la portada no carga cryptex.js.
(() => {
  const stage = document.querySelector('.stage');
  const layer = document.getElementById('cripto');
  if (!stage || !layer) return;

  // Medidas en unidades de la portada (1 u = 1 px de fondo.webp, 1821 x 1025)
  const IMG_W = 1821;
  const D = 150;                    // diámetro de los anillos (el largo sale de las proporciones: ~408 u)
  const FOTO = { x: 300, y: 838 };  // centro del cryptex en la foto (zona libre: x 40–620, y 680–990)
  const ANG = -16, ANG_V = -8;      // grados: tirado medio de costado (en el celular, más derecho: ocupa menos)
  const TOPE_V = 0.36;              // en el celular, hasta esta parte del ancho (al medio va el rompecabezas)
  const HUECO = 132;                // px que le quedan al rompecabezas en el celular (centrado, entre el cryptex y la rosa)
  const ENTERO = 72;                // px de diámetro desde los que en el celular se muestra entero
  const MARGEN = 6;                 // al borde de la ventana
  // Lo que no hay que tapar en la foto: la carpeta con los papeles y la lupa (polígono convexo)
  const CARPETA = [[975, 118], [1019, 118], [1099, 178], [1265, 476], [1396, 768], [1389, 792], [1384, 798],
    [1189, 851], [799, 949], [728, 949], [714, 941], [541, 288], [532, 253], [548, 244], [615, 222]];

  const PALABRA = 'MEMITO';
  const REVUELTO = 'RJDXFK';        // así está: cerrado, ningún anillo en su letra
  const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nL = LETRAS.length, nA = PALABRA.length;
  const FINAL = [...PALABRA].map((ch) => LETRAS.indexOf(ch));
  const FUENTE = '"Cinzel", "Trajan Pro", "Times New Roman", Georgia, serif';
  // Proporciones en diámetros (las del cryptex del escritorio): anillo, junta entre anillos, collar con
  // las volutas y el triángulo, perilla escalonada. GRUESO es lo más ancho: los rebordes del collar.
  const ANILLO = 0.28, JUNTA = 0.014, COLLAR = 0.25, PERILLA = 0.22;
  const LARGO = nA * ANILLO + (nA + 1) * JUNTA + 2 * (COLLAR + PERILLA);
  const GRUESO = 2 * 0.572;
  const PAD = 0.45;                 // lugar para la sombra alrededor (en diámetros)
  // En la foto la luz viene de arriba, un poco de la derecha: las sombras caen abajo a la izquierda
  // (la carpeta y el mango de la lupa tienen la sombra de ese lado) y son suaves.
  const SOMBRA = [-0.45, 0.89];
  const TAU = Math.PI * 2;
  // colores (los del escritorio)
  const LATON_PULIDO = '#d4b06a';
  const LATON_OSCURO = '#8f6c35';
  const LATON_REBORDE = '#b18c4b';
  const BRONCE = '#4b3720';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const mod = (a, n) => ((a % n) + n) % n;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const portrait = matchMedia('(max-aspect-ratio: 1 / 1)');
  const onChange = (mq, fn) => (mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn));

  function azar(semilla) { // mulberry32: el mismo latón cada vez
    let s = semilla >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const lienzo = (w, h) => {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  };

  // ---------- Ubicación en pantalla ----------
  // En la compu va donde está en la foto (y se corre si la ventana recorta esa esquina); en el celular,
  // pegado a la esquina de abajo, debajo de la carpeta, angosto para que el rompecabezas entre al medio.
  // Se achica lo necesario para no pisar nada.
  const rect = (el) => {
    if (!el || !el.isConnected) return null;
    const b = el.getBoundingClientRect();
    return b.width && b.height ? [b.left, b.top, b.right, b.bottom] : null;
  };
  const polyOf = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const caja = (pts) => {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of pts) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
    return b;
  };

  // ¿se tocan dos polígonos convexos? (ejes separadores; el cryptex va girado, no alcanza con su recuadro)
  function chocan(A, B) {
    for (const poly of [A, B]) {
      for (let k = 0; k < poly.length; k++) {
        const [x1, y1] = poly[k], [x2, y2] = poly[(k + 1) % poly.length];
        const nx = y1 - y2, ny = x2 - x1;
        let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
        for (const [x, y] of A) { const v = x * nx + y * ny; aMin = Math.min(aMin, v); aMax = Math.max(aMax, v); }
        for (const [x, y] of B) { const v = x * nx + y * ny; bMin = Math.min(bMin, v); bMax = Math.max(bMax, v); }
        if (aMax < bMin || bMax < aMin) return false;
      }
    }
    return true;
  }

  // Esquinas del cryptex girado, centrado en (cx, cy), con g px por unidad. "desde": lo que no cuenta de
  // la punta izquierda (en el celular la perilla puede salirse de la pantalla); "mas": aire alrededor.
  function esquinas(cx, cy, g, ang, desde = 0, mas = 0) {
    const c = Math.cos(ang), s = Math.sin(ang);
    const x0 = (desde - LARGO / 2) * D * g - mas, x1 = (LARGO / 2) * D * g + mas, y1 = (GRUESO / 2) * D * g + mas;
    return [[x0, -y1], [x1, -y1], [x1, y1], [x0, y1]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  }

  // Lo que hay que esquivar, en px de la pantalla
  function obstaculos(r, s) {
    const out = [CARPETA.map(([x, y]) => [r.left + x * s, r.top + y * s])];
    for (const id of ['slot', 'denied']) {
      const b = rect(document.getElementById(id));
      if (b) out.push(polyOf(...b));
    }
    // el tintero y la zona de tinta (tinta.js), cuando ya se ven (el pincel, al ir y venir, se sale un poco)
    const tinta = document.getElementById('tinta');
    if (tinta && tinta.isConnected && !tinta.classList.contains('cargando')) {
      let u = null;
      for (const q of ['.t-tintero', '.t-lienzo']) {
        const b = rect(tinta.querySelector(q));
        if (b) u = u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b;
      }
      if (u) { const m = 14; out.push(polyOf(u[0] - m, u[1] - m, u[2] + m, u[3] + m)); }
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
    const vertical = portrait.matches;
    const ang = ((vertical ? ANG_V : ANG) * Math.PI) / 180;
    // la esquina de abajo a la izquierda de lo que ocupa en la foto (al achicarse queda fija ahí)
    const enFoto = caja(esquinas(r.left + FOTO.x * s, r.top + FOTO.y * s, s, ang));
    // En el celular, abajo al medio va el rompecabezas (centrado): para que le queden por lo menos
    // HUECO px, el cryptex no pasa de acá (ni de TOPE_V del ancho)
    const tope = Math.min(TOPE_V * vw, (vw - HUECO) / 2 - aire);
    const esquina = () => [MARGEN, vh - MARGEN];
    const cands = vertical
      ? [ // pegado a la esquina: entero si así se lee bien; si no, la punta izquierda (la perilla, o
        // la tapa entera) puede salirse por el borde de la pantalla, y los anillos quedan más grandes
        { w: 1, desde: 0, tope, at: esquina },
        { w: 1, desde: PERILLA, tope, at: esquina },
        { w: 1, desde: PERILLA + COLLAR, tope, at: esquina },
      ]
      : [ // (w: preferencia) donde está en la foto, o pegado a la esquina
        { w: 1, desde: 0, at: () => [Math.max(MARGEN, enFoto[0]), Math.min(vh - MARGEN, enFoto[3])] },
        { w: 0.97, desde: 0, at: esquina },
      ];
    const centro = (cand, g) => {
      const [ax, ay] = cand.at(g);
      const b = caja(esquinas(0, 0, g, ang, cand.desde));
      return [ax - b[0], ay - b[3]];
    };
    const entra = (cand, g) => {
      const [cx, cy] = centro(cand, g);
      const b = caja(esquinas(cx, cy, g, ang, cand.desde));
      if (b[0] < MARGEN - 0.5 || b[1] < MARGEN - 0.5 || b[2] > vw - MARGEN + 0.5 || b[3] > vh - MARGEN + 0.5) return false;
      if (cand.tope && b[2] > cand.tope + 0.5) return false;
      const P = esquinas(cx, cy, g, ang, 0, aire);
      return !obs.some((o) => chocan(P, o));
    };
    let best = null;
    for (const cand of cands) {
      let lo = 0, hi = s;
      if (entra(cand, hi)) lo = hi;
      else for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (entra(cand, mid)) lo = mid; else hi = mid; }
      const score = lo * cand.w;
      if (!best || score > best.score + 1e-9) best = { score, g: lo, cand };
      if (vertical && D * lo >= ENTERO) break; // entero y de buen tamaño: no hace falta cortarlo
    }
    // muy chiquito no se leerían las letras (ni se podría tocar): mejor no mostrarlo
    if (!best || D * best.g < 36) { L = null; return L; }
    const [cx, cy] = centro(best.cand, best.g);
    L = { g: best.g, cx, cy, ang };
    return L;
  }

  // ---------- Elementos ----------
  const el = (tag, cls, attrs = {}) => { const e = document.createElement(tag); e.className = cls; Object.assign(e, attrs); return e; };
  const vista = el('canvas', 'c-lienzo');
  vista.setAttribute('aria-hidden', 'true');
  const boton = el('button', 'c-boton', { type: 'button', title: 'Cryptex' });
  boton.setAttribute('aria-label', 'Cryptex: girar los anillos');
  boton.setAttribute('data-ocupa', ''); // el rompecabezas esquiva este lugar
  const aviso = el('span', 'sr-only');
  aviso.setAttribute('aria-live', 'polite');
  layer.append(vista, boton, aviso);
  layer.addEventListener('scroll', () => { layer.scrollLeft = 0; layer.scrollTop = 0; });
  let ctx = null;

  let V = null; // el recuadro del lienzo en la pantalla (el cryptex más el lugar de la sombra)
  function colocar() {
    // toggle con el segundo argumento no vuelve a escribir la clase si ya estaba así: el rompecabezas
    // se reubica cada vez que se escribe (aunque quede igual), y no hace falta molestarlo de gusto
    layer.classList.toggle('oculto', !L);
    if (!L) return;
    const g = L.g, w = LARGO * D * g, h = GRUESO * D * g;
    // el botón va girado como el cryptex: se toca el cilindro y no el paño de alrededor
    Object.assign(boton.style, {
      width: w + 'px', height: h + 'px',
      transform: `translate(${L.cx - w / 2}px, ${L.cy - h / 2}px) rotate(${L.ang}rad)`,
    });
    const b = caja(esquinas(L.cx, L.cy, g, L.ang)), pad = PAD * D * g;
    V = { x: b[0] - pad, y: b[1] - pad, w: b[2] - b[0] + 2 * pad, h: b[3] - b[1] + 2 * pad };
    Object.assign(vista.style, { transform: `translate(${V.x}px, ${V.y}px)`, width: V.w + 'px', height: V.h + 'px' });
  }

  // ---------- Luz ----------
  // phi: ángulo desde el frente (0 = la línea de lectura, que mira a la cámara), positivo hacia abajo.
  // Arriba le da la luz de la foto; los costados reflejan el paño verde (más el de abajo, a la sombra).
  function luzEn(phi) {
    const dif = (0.06 + 0.94 * Math.max(0, Math.cos(phi + 0.4))) * (0.42 + 0.58 * Math.cos(phi) ** 0.8);
    const esp = 0.5 * Math.max(0, Math.cos(phi + 0.62)) ** 26 + 0.08 * Math.max(0, Math.cos(phi + 0.5)) ** 4;
    const pano = 0.12 * Math.exp(-(((phi - 1.2) / 0.26) ** 2)) + 0.05 * Math.exp(-(((phi + 1.28) / 0.22) ** 2));
    return [dif, esp, pano];
  }
  // [lo que multiplica, lo que suma (en "screen")] a lo alto de un cilindro de radio r que empieza en y0
  function degradeLuz(g, y0, r) {
    const m = g.createLinearGradient(0, y0, 0, y0 + 2 * r);
    const s = g.createLinearGradient(0, y0, 0, y0 + 2 * r);
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const [d, e, p] = luzEn(Math.asin(clamp(u * 2 - 1, -1, 1)));
      const dd = Math.min(1, d), a = Math.min(1, e + p);
      m.addColorStop(u, `rgb(${Math.round(255 * dd)},${Math.round(243 * dd)},${Math.round(224 * dd)})`);
      const c = (x, y) => Math.round(a ? (e * x + p * y) / (e + p) : x);
      s.addColorStop(u, `rgba(${c(255, 60)},${c(230, 150)},${c(176, 105)},${a.toFixed(3)})`);
    }
    return [m, s];
  }
  function iluminar(g, x, w, cy, r) {
    const [m, s] = degradeLuz(g, cy - r, r);
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = m;
    g.fillRect(x, cy - r, w, 2 * r);
    g.globalCompositeOperation = 'screen';
    g.fillStyle = s;
    g.fillRect(x, cy - r, w, 2 * r);
    g.restore();
  }
  // Cada fila de la pantalla toma la fila de la tira que le toca sobre el cilindro (por eso se curva).
  // "off": la fila de la tira que queda en la línea de lectura
  function proyectar(g, tira, sw, dx, cy, R, off) {
    const top = cy - R;
    for (let j = 0; j < 2 * R; j++) {
      const s = (j + 0.5 - R) / R;
      const t = off + Math.asin(s) * R - 0.5;
      const dt = Math.min(6, 1 / Math.max(0.05, Math.sqrt(1 - s * s)));
      g.drawImage(tira, 0, t, sw, dt, dx, top + j, sw, 1);
    }
  }

  // ---------- Texturas (como en el escritorio) ----------
  let K = null;      // medidas en px del lienzo (las de lo que está armado: cache.K)
  let cache = null;  // tapas, alma, anillos, luces y la fila que brilla, ya dibujados
  let granoC = null;
  const patrones = new WeakMap();
  const grano = (g) => {
    if (!granoC) return null;
    let p = patrones.get(g);
    if (!p) { p = g.createPattern(granoC, 'repeat'); patrones.set(g, p); }
    return p;
  };

  // Grano del metal: puntitos y el cepillado alrededor
  function hacerGrano() {
    const n = 128, c = lienzo(n, n), g = c.getContext('2d');
    const img = g.createImageData(n, n), d = img.data, rnd = azar(7);
    const col = Array.from({ length: n }, () => (rnd() - 0.5) * 50);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = clamp(128 + col[x] + (rnd() - 0.5) * 70, 0, 255);
        const i = (y * n + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  function tambor(g, x, w, cy, r, color, o = {}) {
    // un tramo de cilindro liso (rebordes, cuello, perilla): color, grano, luz y bisel
    g.save();
    g.beginPath();
    if (o.redondeo && g.roundRect) g.roundRect(x, cy - r, w, 2 * r, o.redondeo);
    else g.rect(x, cy - r, w, 2 * r);
    g.clip();
    g.fillStyle = color;
    g.fillRect(x, cy - r, w, 2 * r);
    if (grano(g)) {
      g.globalAlpha = o.grano == null ? 0.4 : o.grano;
      g.globalCompositeOperation = 'overlay';
      g.fillStyle = grano(g);
      g.fillRect(x, cy - r, w, 2 * r);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    iluminar(g, x, w, cy, r);
    if (o.bisel) {
      const b = g.createLinearGradient(x, 0, x + w, 0);
      b.addColorStop(0, 'rgba(14,8,2,0.62)');
      b.addColorStop(0.22, 'rgba(255,238,195,0.16)');
      b.addColorStop(0.45, 'rgba(0,0,0,0)');
      b.addColorStop(0.78, 'rgba(0,0,0,0.12)');
      b.addColorStop(1, 'rgba(14,8,2,0.68)');
      g.fillStyle = b;
      g.fillRect(x, cy - r, w, 2 * r);
    }
    g.restore();
  }

  function cono(g, x, w, cy, rb, rt, color) { // punta a la izquierda, base a la derecha
    g.save();
    g.beginPath();
    g.moveTo(x + w, cy - rb);
    g.quadraticCurveTo(x + w * 0.5, cy - rb * 0.96, x + w * 0.06, cy - rt);
    g.quadraticCurveTo(x - w * 0.04, cy, x + w * 0.06, cy + rt);
    g.quadraticCurveTo(x + w * 0.5, cy + rb * 0.96, x + w, cy + rb);
    g.closePath();
    g.clip();
    g.fillStyle = color;
    g.fillRect(x - 2, cy - rb, w + 2, 2 * rb);
    if (grano(g)) {
      g.globalAlpha = 0.45;
      g.globalCompositeOperation = 'overlay';
      g.fillStyle = grano(g);
      g.fillRect(x - 2, cy - rb, w + 2, 2 * rb);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    iluminar(g, x - 2, w + 2, cy, rb);
    // la cara del cono mira hacia afuera: más oscura hacia la punta, con un filo de luz cerca de la base
    const h = g.createLinearGradient(x, 0, x + w, 0);
    h.addColorStop(0, 'rgba(10,6,2,0.55)');
    h.addColorStop(0.55, 'rgba(10,6,2,0.12)');
    h.addColorStop(0.9, 'rgba(255,236,190,0.2)');
    h.addColorStop(1, 'rgba(10,6,2,0.4)');
    g.fillStyle = h;
    g.fillRect(x - 2, cy - rb, w + 2, 2 * rb);
    g.restore();
  }

  function ranuras(g, x, w, cy, r) { // muescas del disco almenado (la de frente y las de los costados)
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const mw = w * 0.42, mx = x + (w - mw) / 2;
    g.fillRect(mx, cy - r - 1, mw, r * 0.07 + 1);
    g.fillRect(mx, cy + r - r * 0.07, mw, r * 0.07 + 1);
    g.globalCompositeOperation = 'source-over';
    for (const phi of [-0.95, 0, 0.95]) {
      const y = cy + r * Math.sin(phi), h = r * 0.2 * Math.cos(phi);
      g.fillStyle = 'rgba(16,10,3,0.88)';
      g.fillRect(mx, y - h / 2, mw, h);
      g.fillStyle = 'rgba(255,230,170,0.22)';
      g.fillRect(mx, y + h / 2 - Math.max(1, h * 0.12), mw, Math.max(1, h * 0.12));
    }
    g.restore();
  }

  function voluta(g, x, y, s, f) { // ornamento en S con espirales en las puntas (relieve)
    const espiral = (cx, cy, r, a0, sentido) => {
      for (let i = 0; i <= 36; i++) {
        const u = i / 36, a = a0 + sentido * u * TAU * 1.3, rr = r * (1 - u * 0.8);
        g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * f);
      }
    };
    const traza = () => {
      g.beginPath();
      g.moveTo(x - 0.06 * s, y - 0.44 * s * f);
      espiral(x - 0.2 * s, y - 0.3 * s * f, 0.17 * s, -0.6, -1);
      g.moveTo(x - 0.06 * s, y - 0.44 * s * f);
      g.bezierCurveTo(x + 0.34 * s, y - 0.3 * s * f, x - 0.34 * s, y + 0.3 * s * f, x + 0.06 * s, y + 0.44 * s * f);
      espiral(x + 0.2 * s, y + 0.3 * s * f, 0.17 * s, Math.PI - 0.6, -1);
      // hojitas
      g.moveTo(x + 0.02 * s, y - 0.02 * s * f);
      g.quadraticCurveTo(x + 0.3 * s, y - 0.12 * s * f, x + 0.34 * s, y - 0.34 * s * f);
      g.moveTo(x - 0.02 * s, y + 0.02 * s * f);
      g.quadraticCurveTo(x - 0.3 * s, y + 0.12 * s * f, x - 0.34 * s, y + 0.34 * s * f);
    };
    const lw = Math.max(1, s * 0.055);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.save();
    g.translate(0, lw * 0.7);
    traza();
    g.strokeStyle = 'rgba(0,0,0,0.65)';
    g.lineWidth = lw * 1.2;
    g.stroke();
    g.restore();
    traza();
    g.strokeStyle = '#b8914f';
    g.lineWidth = lw;
    g.stroke();
    g.save();
    g.translate(0, -lw * 0.3);
    traza();
    g.strokeStyle = 'rgba(255,232,175,0.45)';
    g.lineWidth = lw * 0.4;
    g.stroke();
    g.restore();
  }

  function metal(W, H, base, semilla, opt = {}) { // tira de metal con grano, cepillado y pátina (periódica en la vuelta)
    // en pantallas densas el grano se calcula a media resolución y se estira: no se nota y tarda la cuarta parte
    const e = K.k >= 1.5 ? 0.5 : 1;
    const bw = Math.max(2, Math.round(W * e)), h = Math.max(2, Math.round(H * e));
    const ey = h / H, ex = bw / W;
    const c = lienzo(bw, h), g = c.getContext('2d');
    const img = g.createImageData(bw, h), d = img.data, rnd = azar(semilla);
    const per = (opt.periodo || H) * ey;
    const ondas = Array.from({ length: 4 }, () => ({
      k: 1 + Math.floor(rnd() * 5), f: ((rnd() - 0.5) * 0.3 * (40 / Math.max(20, W))) / ex, ph: rnd() * TAU, a: 0.55 + rnd() * 0.6,
    }));
    const fs = ondas.map((o) => Float32Array.from({ length: h }, (_, y) => Math.sin(o.k * TAU * y / per + o.ph)));
    const fc = ondas.map((o) => Float32Array.from({ length: h }, (_, y) => Math.cos(o.k * TAU * y / per + o.ph)));
    const cs = ondas.map((o) => Float32Array.from({ length: bw }, (_, x) => Math.sin(o.f * x)));
    const cc = ondas.map((o) => Float32Array.from({ length: bw }, (_, x) => Math.cos(o.f * x)));
    const cep = Float32Array.from({ length: bw }, () => (rnd() - 0.5) * 12);
    const tono = opt.tono || (() => 0);
    for (let y = 0; y < h; y++) {
      const t = tono(y / ey);
      for (let x = 0; x < bw; x++) {
        let p = 0;
        for (let o = 0; o < 4; o++) p += ondas[o].a * (fs[o][y] * cc[o][x] + fc[o][y] * cs[o][x]);
        const pat = smooth(0.5, 1.9, p);
        const borde = Math.min(x + 0.5, bw - x - 0.5) / bw;
        const ao = opt.sinBorde ? 1 : 1 - 0.36 * Math.exp(-borde / 0.07);
        const gr = (rnd() - 0.5) * 16 + cep[x];
        const mota = rnd() < 0.006 ? 0.7 : 1; // puntitos de mugre de años
        const k = (1 + t) * ao * (1 - 0.4 * pat) * mota;
        const i = (y * bw + x) * 4;
        d[i] = base[0] * k + gr - pat * 14;
        d[i + 1] = base[1] * k + gr - pat * 9;
        d[i + 2] = base[2] * k + gr * 0.8 - pat * 2;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    if (e === 1) return c;
    const full = lienzo(W, H);
    full.getContext('2d').drawImage(c, 0, 0, W, H);
    return full;
  }

  function grabar(g, mascara, w, h, e) { // letras/marcas grabadas: fondo oscuro, pared de abajo con luz, filo
    const capa = lienzo(w, h), c = capa.getContext('2d');
    const pinta = (color, dy, quitarDy, alfa) => {
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, w, h);
      c.drawImage(mascara, 0, dy);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = color;
      c.fillRect(0, 0, w, h);
      if (quitarDy != null) {
        c.globalCompositeOperation = 'destination-out';
        c.drawImage(mascara, 0, quitarDy);
      }
      g.globalAlpha = alfa;
      g.drawImage(capa, 0, 0);
      g.globalAlpha = 1;
    };
    pinta('rgb(44,28,10)', 0, null, 1); // fondo del grabado, con la mugre de años
    pinta('rgb(146,112,58)', 0, -e, 0.85); // pared de abajo: le da la luz
    pinta('rgb(12,7,2)', 0, e, 0.9); // pared de arriba: sombra
    pinta('rgb(255,238,196)', e * 0.9, 0, 0.32); // filo de luz justo debajo
  }

  // Cómo se escriben las letras en la tira (lo usan el grabado y la fila que brilla, que tienen que coincidir)
  function letraEn(g, ch, x, y, maxW) {
    const sx = Math.min(1, maxW / (g.measureText(ch).width || 1));
    g.save();
    g.translate(x, y);
    g.scale(sx, 1);
    g.fillText(ch, 0, 0);
    g.restore();
  }
  function fuenteLetras(g) {
    const fpx = Math.round(K.paso * 0.74);
    g.font = `700 ${fpx}px ${FUENTE}`;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    const alto = g.measureText('H').actualBoundingBoxAscent || fpx * 0.7;
    return { fpx, alto, maxW: (K.aw - 2 * K.borde) * 0.84 };
  }

  // Lo que comparten todos los anillos: el latón (cada uno usa otro pedazo) y las letras grabadas.
  // Abajo de la vuelta se repite el principio, lo que mide una ventana: así cualquier ventana sale de un
  // solo pedazo de la tira, sin dar la vuelta (ver pintarAnillos)
  function* texturasAnillos() {
    const bw = K.aw - 2 * K.borde, C = K.C, paso = K.paso, pad = K.ventana;
    const fichas = Float32Array.from({ length: nL }, (_, i) => (azar(31 + i * 7)() - 0.5) * 0.08);
    const base = metal(bw, C, [192, 154, 92], 1009, { tono: (y) => fichas[Math.floor(mod(y + paso / 2, C) / paso) % nL] });
    yield;
    const c = lienzo(bw, C + pad), g = c.getContext('2d');
    // ranuras entre fichas
    const gw = Math.max(1.5, paso * 0.05);
    for (let i = 0; i < nL; i++) {
      const t = (i + 0.5) * paso;
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(0, t - gw / 2 - 1, bw, 1);
      g.fillStyle = 'rgba(30,18,6,0.92)';
      g.fillRect(0, t - gw / 2, bw, gw);
      g.fillStyle = 'rgba(255,232,180,0.3)';
      g.fillRect(0, t + gw / 2, bw, Math.max(1, K.k * 0.6));
    }
    // letras
    const masc = lienzo(bw, C + pad), mg = masc.getContext('2d');
    const { fpx, alto, maxW } = fuenteLetras(mg);
    mg.fillStyle = '#000';
    [...LETRAS].forEach((ch, i) => {
      for (const off of [-C, 0, C]) {
        const y = i * paso + off + alto / 2;
        if (y < -paso || y > C + pad + paso) continue;
        letraEn(mg, ch, bw / 2, y, maxW);
      }
    });
    grabar(g, masc, bw, C + pad, Math.max(1, fpx * 0.065));
    return { base, grabado: c, bw, C, pad };
  }

  // Tira de un anillo: su pedazo de latón (corrido unas fichas y a veces dado vuelta) + las letras
  function tiraAnillo(i, T) {
    const c = lienzo(T.bw, T.C + T.pad), g = c.getContext('2d');
    const off = mod(i * 11 + 3, nL) * K.paso;
    g.save();
    if (i % 2) { g.translate(T.bw, 0); g.scale(-1, 1); }
    g.drawImage(T.base, 0, -off);
    g.drawImage(T.base, 0, T.C - off);
    g.restore();
    g.drawImage(T.grabado, 0, 0);
    // la vuelta: las primeras filas se repiten al final (así no hay costura)
    g.drawImage(c, 0, 0, T.bw, T.pad, 0, T.C, T.bw, T.pad);
    return c;
  }

  // La misma tira corrida a lo largo de la vuelta (lo que se ve cuando el anillo gira rápido):
  // promedio de "largo" filas, dando la vuelta por el final
  let leer = null; // un lienzo para leer píxeles (en la CPU: leer de los demás es lento)
  function pixeles(tira, T) {
    const w = T.bw, C = T.C;
    if (!leer || leer.width < w || leer.height < C) leer = lienzo(Math.max(w, leer ? leer.width : 0), Math.max(C, leer ? leer.height : 0));
    const lg = leer.getContext('2d', { willReadFrequently: true });
    lg.clearRect(0, 0, w, C);
    lg.drawImage(tira, 0, 0, w, C, 0, 0, w, C);
    return lg.getImageData(0, 0, w, C).data;
  }
  function estelaDe(src, T, largo) {
    const w = T.bw, C = T.C, fila = w * 4;
    const out = lienzo(w, C + T.pad), og = out.getContext('2d');
    const img = og.createImageData(w, C), d = img.data;
    const n = Math.max(2, Math.round(largo)), a = n >> 1, b = n - a - 1;
    // de a filas enteras: la suma de las n filas de cada canal (también el alfa: queda opaco), y al
    // bajar una fila entra la de abajo y sale la de arriba. Sin funciones ni módulos por píxel: así
    // tarda unos pocos milisegundos (n es mucho menos que la vuelta: alcanza con sumar o restar C)
    const en = (y) => (y < 0 ? y + C : y >= C ? y - C : y) * fila;
    const suma = new Float32Array(fila);
    for (let j = -a; j <= b; j++) { const o = en(j); for (let i = 0; i < fila; i++) suma[i] += src[o + i]; }
    for (let y = 0; y < C; y++) {
      const o = y * fila, entra = en(y + b + 1), sale = en(y - a);
      for (let i = 0; i < fila; i++) {
        d[o + i] = suma[i] / n;
        suma[i] += src[entra + i] - src[sale + i];
      }
    }
    og.putImageData(img, 0, 0);
    og.drawImage(out, 0, 0, w, T.pad, 0, C, w, T.pad);
    return out;
  }

  // Tira del collar: bronce oscurecido con volutas y la plaquita con el triángulo que marca la línea de lectura
  function* tiraCollar(bw, Rc) {
    const m = 8;
    const h = Math.ceil(Math.PI * Rc + 2 * m);
    const tc = Math.round(h / 2);
    const c = metal(bw, h, [78, 60, 38], 99, { periodo: TAU * Rc, sinBorde: true });
    yield;
    const g = c.getContext('2d');
    const paso = K.pasoTapa;
    // volutas arriba y abajo de la plaquita
    const placaH = Math.round(paso * 1.7);
    const s = Math.min(bw * 0.86, paso * 1.5);
    const sep = s * 1.02;
    for (let i = 0; tc - placaH / 2 - sep * (i + 0.5) > -sep; i++) {
      const dy = placaH / 2 + sep * (i + 0.55);
      voluta(g, bw / 2, tc - dy, s, i % 2 ? 1 : -1);
      voluta(g, bw / 2, tc + dy, s, i % 2 ? -1 : 1);
    }
    // plaquita de latón
    const px = Math.round(bw * 0.04), pw = bw - 2 * px, py = tc - placaH / 2;
    const placa = metal(pw, placaH, [196, 162, 104], 5, { sinBorde: true, periodo: placaH * 9 });
    yield;
    g.drawImage(placa, px, py);
    g.fillStyle = 'rgba(255,238,196,0.55)';
    g.fillRect(px, py, pw, Math.max(1, K.k));
    g.fillStyle = 'rgba(20,12,4,0.75)';
    g.fillRect(px, py + placaH - Math.max(1, K.k * 1.2), pw, Math.max(1, K.k * 1.2));
    g.fillStyle = 'rgba(20,12,4,0.45)';
    g.fillRect(px, py, Math.max(1, K.k), placaH);
    g.fillRect(px + pw - Math.max(1, K.k), py, Math.max(1, K.k), placaH);
    // triángulo grabado: apunta a los anillos (a la derecha; la tapa derecha es el espejo)
    const masc = lienzo(bw, h), mg = masc.getContext('2d');
    const th = placaH * 0.42, tw = Math.min(pw * 0.42, th * 1.0);
    const tx = bw / 2 - tw / 2 + pw * 0.04;
    mg.beginPath();
    mg.moveTo(tx, tc - th / 2);
    mg.lineTo(tx + tw, tc);
    mg.lineTo(tx, tc + th / 2);
    mg.closePath();
    mg.lineJoin = 'round';
    mg.lineWidth = Math.max(1, K.k * 1.2);
    mg.fill();
    mg.stroke();
    grabar(g, masc, bw, h, Math.max(1, th * 0.08));
    return { c, tc };
  }

  // Perilla escalonada, como la de la foto: punta, tres escalones, disco almenado y cuello (en diámetros)
  const PARTES = [
    { w: 0.15, tipo: 'cono', rb: 0.14, rt: 0.035 },
    { w: 0.11, r: 0.2, color: LATON_OSCURO, bisel: true },
    { w: 0.13, r: 0.27, color: BRONCE, bisel: true },
    { w: 0.15, r: 0.345, color: LATON_OSCURO, bisel: true },
    { w: 0.27, r: 0.5, color: LATON_OSCURO, bisel: true, almenas: true },
    { w: 0.19, r: 0.45, color: BRONCE },
  ];

  function* dibujarTapa() { // tapa izquierda: perilla afuera, collar adentro (pegado a los anillos)
    const w = K.tapaW, h = 2 * K.RcL + 4, cy = h / 2;
    const c = lienzo(w, h), g = c.getContext('2d');
    const Dd = K.D, pw = K.perillaW;
    let x = 0;
    for (const p of PARTES) {
      const pwp = Math.round(p.w * pw);
      if (p.tipo === 'cono') cono(g, x, pwp + 1, cy, p.rb * Dd, p.rt * Dd, LATON_OSCURO);
      else {
        tambor(g, x, pwp + (p.bisel ? 0 : 1), cy, p.r * Dd, p.color, { bisel: p.bisel, redondeo: p.bisel ? Math.min(pwp * 0.3, p.r * Dd * 0.2) : 0 });
        if (p.almenas) ranuras(g, x, pwp, cy, p.r * Dd);
      }
      x += pwp;
    }
    // collar: reborde, banda con volutas y plaquita, reborde
    x = pw;
    const lip = Math.max(2, Math.round(Dd * 0.032));
    const bw = K.collarW - 2 * lip;
    tambor(g, x, lip, cy, K.RcL, LATON_PULIDO, { bisel: true, redondeo: lip * 0.45 });
    yield;
    const { c: tira, tc } = yield* tiraCollar(bw, K.Rc);
    g.save();
    proyectar(g, tira, bw, x + lip, cy, K.Rc, tc);
    iluminar(g, x + lip, bw, cy, K.Rc);
    const ao = g.createLinearGradient(x + lip, 0, x + lip + bw, 0);
    ao.addColorStop(0, 'rgba(12,7,2,0.6)');
    ao.addColorStop(0.14, 'rgba(12,7,2,0)');
    ao.addColorStop(0.86, 'rgba(12,7,2,0)');
    ao.addColorStop(1, 'rgba(12,7,2,0.6)');
    g.fillStyle = ao;
    g.fillRect(x + lip, cy - K.Rc, bw, 2 * K.Rc);
    g.restore();
    tambor(g, x + lip + bw, lip, cy, K.RcL, LATON_PULIDO, { bisel: true, redondeo: lip * 0.45 });
    return c;
  }

  // Lo fijo de los anillos: la luz sobre la banda de letras y los dos rebordes. Va a lo ancho de los
  // seis (con los huecos de las juntas transparentes): se aplica de una vez a todos
  function lucesAnillos() {
    const bw = K.aw - 2 * K.borde, R = K.R;
    const mul = lienzo(bw, 2 * R), scr = lienzo(bw, 2 * R);
    const gm = mul.getContext('2d'), gs = scr.getContext('2d');
    const [m] = degradeLuz(gm, 0, R), [, s] = degradeLuz(gs, 0, R);
    gm.fillStyle = m;
    gm.fillRect(0, 0, bw, 2 * R);
    gs.fillStyle = s;
    gs.fillRect(0, 0, bw, 2 * R);
    const w = K.aw, h = 2 * K.Rr + 2, cy = h / 2;
    const bordes = lienzo(w, h), g = bordes.getContext('2d');
    const sb = g.createLinearGradient(K.borde, 0, K.borde + bw, 0); // sombra de los rebordes sobre la banda
    sb.addColorStop(0, 'rgba(18,10,3,0.6)');
    sb.addColorStop(0.12, 'rgba(18,10,3,0)');
    sb.addColorStop(0.88, 'rgba(18,10,3,0)');
    sb.addColorStop(1, 'rgba(18,10,3,0.6)');
    g.fillStyle = sb;
    g.fillRect(K.borde, cy - R, bw, 2 * R);
    tambor(g, 0, K.borde, cy, K.Rr, LATON_REBORDE, { bisel: true, redondeo: K.borde * 0.45 });
    tambor(g, w - K.borde, K.borde, cy, K.Rr, LATON_REBORDE, { bisel: true, redondeo: K.borde * 0.45 });
    const seis = (c, dx) => {
      const f = lienzo(K.span, c.height), fg = f.getContext('2d');
      for (let i = 0; i < nA; i++) fg.drawImage(c, i * (K.aw + K.junta) + dx, 0);
      return f;
    };
    return { mul: seis(mul, K.borde), scr: seis(scr, K.borde), bordes: seis(bordes, 0) };
  }

  // La fila de lectura iluminada (MEMITO): luz cálida sobre cada ficha, con las letras recortadas
  // (quedan oscuras, grabadas: así se leen mejor sobre el latón iluminado)
  function filaQueBrilla() {
    const w = K.span, h = 2 * K.R, cy = K.R, bw = K.aw - 2 * K.borde;
    const c = lienzo(w, h), g = c.getContext('2d');
    for (let i = 0; i < nA; i++) {
      const x = i * (K.aw + K.junta) + K.aw / 2;
      g.save();
      g.translate(x, cy);
      g.scale(bw * 0.62, K.paso * 1.05);
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      rg.addColorStop(0, 'rgba(255,222,150,0.95)');
      rg.addColorStop(0.55, 'rgba(255,206,128,0.5)');
      rg.addColorStop(1, 'rgba(255,196,118,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(0, 0, 1, 0, TAU);
      g.fill();
      g.restore();
    }
    g.globalCompositeOperation = 'destination-out';
    const { alto, maxW } = fuenteLetras(g);
    g.fillStyle = '#000';
    for (let i = 0; i < nA; i++) letraEn(g, PALABRA[i], i * (K.aw + K.junta) + K.aw / 2, cy + alto / 2, maxW);
    // y el resto de los anillos, un poco en penumbra (se multiplica): la fila se despega de las otras letras
    const ph = 2 * K.R;
    const pen = lienzo(w, ph), pg = pen.getContext('2d');
    const gr = pg.createLinearGradient(0, 0, 0, ph);
    const u = (dy) => clamp(0.5 + dy / ph, 0, 1);
    gr.addColorStop(0, 'rgb(140,131,118)');
    gr.addColorStop(u(-K.paso * 1.7), 'rgb(162,152,138)');
    gr.addColorStop(u(-K.paso * 0.55), 'rgb(255,255,255)');
    gr.addColorStop(u(K.paso * 0.55), 'rgb(255,255,255)');
    gr.addColorStop(u(K.paso * 1.7), 'rgb(162,152,138)');
    gr.addColorStop(1, 'rgb(140,131,118)');
    pg.fillStyle = gr;
    pg.fillRect(0, 0, w, ph);
    return { luz: c, penumbra: pen };
  }

  // Contorno del cryptex visto desde arriba (para la sombra): perilla, collar, anillos y el espejo
  function silueta() {
    const Dd = K.D, pw = K.perillaW, tr = [];
    let x = 0;
    for (const p of PARTES) {
      const w = Math.round(p.w * pw);
      tr.push(p.tipo === 'cono' ? [x, x + w, p.rt * Dd, p.rb * Dd] : [x, x + w, p.r * Dd, p.r * Dd]);
      x += w;
    }
    tr.push([pw, K.tapaW, K.RcL, K.RcL]);
    const alma = Dd * 0.47;
    tr.push([K.tapaW, K.x0, alma, alma]);
    for (let i = 0; i < nA; i++) {
      const a = K.x0 + i * (K.aw + K.junta);
      tr.push([a, a + K.aw, K.Rr, K.Rr]);
      if (i < nA - 1) tr.push([a + K.aw, a + K.aw + K.junta, alma, alma]);
    }
    const izq = tr.slice(0, PARTES.length + 2); // perilla, collar y la junta: la derecha es el espejo
    const todo = [...tr, ...izq.reverse().map(([a, b, r0, r1]) => [K.largo - b, K.largo - a, r1, r0])];
    const p = new Path2D();
    p.moveTo(todo[0][0], -todo[0][2]);
    for (const [a, b, r0, r1] of todo) { p.lineTo(a, -r0); p.lineTo(b, -r1); }
    for (const [a, b, r0, r1] of todo.slice().reverse()) { p.lineTo(b, r1); p.lineTo(a, r0); }
    p.closePath();
    return p;
  }

  function medir() {
    // px del lienzo por px de la pantalla: los de la pantalla (hasta 3); en pantallas enormes y densas,
    // un poco menos (con anillos de más de ~360 px el detalle no cambia y cada cuadro pesa el doble)
    const k = Math.min(window.devicePixelRatio || 1, 3, Math.max(1, 360 / (D * L.g)));
    const Dd = D * L.g * k;
    const R = Math.max(8, Math.round(Dd / 2));
    const aw = Math.max(8, Math.round(ANILLO * Dd));
    const junta = Math.max(1, Math.round(JUNTA * Dd));
    const span = nA * aw + (nA - 1) * junta;
    const collarW = Math.round(COLLAR * Dd), perillaW = Math.round(PERILLA * Dd), tapaW = collarW + perillaW;
    // en chico, menos letras por vuelta (más grandes): si no, en el celular no se leerían
    const pasoAng = clamp((12.8 * k) / R, TAU / 20, 0.5);
    const paso = Math.max(6, Math.round(R * pasoAng));
    const x0 = tapaW + junta;
    // lo que se ve de la tira de un anillo, de arriba a abajo del cilindro (media vuelta y un resto):
    // "medio" es la fila de la ventana que queda en la línea de lectura
    const medio = Math.ceil((Math.PI / 2) * R) + 2;
    return {
      k, D: Dd, R, Rr: Math.round(Dd * 0.5175), Rc: Math.round(Dd * 0.55), RcL: Math.round(Dd * 0.572),
      aw, junta, span, collarW, perillaW, tapaW, paso, C: paso * nL, pasoTapa: Math.max(6, Math.round((R * TAU) / 20)),
      borde: Math.max(2, Math.round(Dd * 0.026)), x0, xDer: x0 + span + junta, largo: 2 * x0 + span,
      medio, ventana: 2 * medio + 6,
      // en qué momento del brillo pasa por cada anillo (de 0 a 1)
      pasa: Array.from({ length: nA }, (_, i) => (0.5 * Dd + (i + 0.5) * (aw + junta)) / (span + Dd)),
      fuente: hayCinzel(),
    };
  }
  // ¿Hace falta volver a armarlo? Si el tamaño cambió poco, lo que hay se dibuja un poco más grande o
  // más chico y no se nota; con otra densidad de pantalla o con la fuente que llegó tarde, sí
  const distinto = (a, b) => Math.abs(a.D / b.D - 1) > 0.05 || Math.abs(a.k / b.k - 1) > 0.05 || a.fuente !== b.fuente;

  // Todo lo que se dibuja una sola vez, de a pedazos: entre pedazo y pedazo el navegador respira (ver
  // trabajar). Primero lo que hace falta para verlo quieto; las tiras corridas, después (ver corridas)
  function* armado() {
    granoC = granoC || hacerGrano();
    yield;
    const izq = yield* dibujarTapa();
    yield;
    const der = lienzo(izq.width, izq.height), dg = der.getContext('2d');
    dg.scale(-1, 1);
    dg.drawImage(izq, -izq.width, 0);
    // alma: lo que se ve entre anillo y anillo
    const ra = Math.round(K.D * 0.47);
    const alma = lienzo(K.span + 2 * K.junta, 2 * ra);
    tambor(alma.getContext('2d'), 0, alma.width, ra, ra, '#2e2113', { grano: 0.3 });
    yield;
    const T = yield* texturasAnillos();
    yield;
    // cada anillo: la tira nítida y dos corridas (girando medio rápido y muy rápido); hasta que estén
    // las corridas, las tres son la nítida
    const tiras = [];
    for (let i = 0; i < nA; i++) {
      const t = tiraAnillo(i, T);
      tiras.push([t, t, t]);
      yield;
    }
    const luces = lucesAnillos();
    yield;
    const fila = filaQueBrilla();
    yield;
    const bandas = new Path2D(); // lo que es metal de los anillos (sin los huecos de los costados)
    for (let i = 0; i < nA; i++) bandas.rect(K.x0 + i * (K.aw + K.junta), -K.R, K.aw, 2 * K.R);
    // los seis anillos se pintan juntos: primero las ventanas de sus tiras, una al lado de la otra, y
    // después se enrollan todas a la vez sobre el cilindro (aros)
    const ventanas = lienzo(K.span, K.ventana), aros = lienzo(K.span, 2 * K.Rr + 2);
    return {
      K, izq, der, alma, tiras, T: { bw: T.bw, C: T.C, pad: T.pad }, luces, fila, silueta: silueta(), bandas,
      ventanas, vg: ventanas.getContext('2d'), aros, ag: aros.getContext('2d'),
    };
  }
  // Las tiras corridas, ya con el cryptex a la vista (solo hacen falta al girar; hasta que estén, gira
  // con la nítida)
  function* corridas(c) {
    for (const t of c.tiras) {
      if (t[2] !== t[0]) continue; // ya estaba
      const px = pixeles(t[0], c.T);
      yield;
      t[1] = estelaDe(px, c.T, c.K.paso * 0.55);
      yield;
      t[2] = estelaDe(px, c.T, c.K.paso * 1.5);
      yield;
    }
  }

  // ---------- Los anillos ----------
  const anillos = [...REVUELTO].map((ch) => {
    const p = LETRAS.indexOf(ch);
    return { pos: p, vel: 0, desde: p, hasta: p, dist: 0, dur: 1, delay: 0, pintada: NaN, pintadaE: 0 };
  });
  // cuánto corrida se ve la tira: la estela de un cuadro (letras por segundo / 50 ≈ letras que pasa en una toma)
  const estela = (a) => Math.round(clamp(Math.abs(a.vel) / 50, 0, 1.5) * 20) / 20;
  const sucio = (a) => a.pos !== a.pintada || estela(a) !== a.pintadaE;

  function pintarAnillos() {
    const vg = cache.vg, H = K.ventana, bw = K.aw - 2 * K.borde;
    vg.globalAlpha = 1;
    anillos.forEach((a, i) => {
      const [nitida, media, mucha] = cache.tiras[i];
      const e = estela(a);
      // la ventana de su tira que se ve (la tira tiene una ventana de más al final: no da la vuelta)
      const o = mod(a.pos * K.paso - K.medio, K.C), x = i * (K.aw + K.junta) + K.borde;
      // de nítida a corrida según la velocidad (mezcla de las dos más parecidas)
      const [t0, t1, f] = e <= 0.55 ? [nitida, media, e / 0.55] : [media, mucha, (e - 0.55) / 0.95];
      vg.drawImage(t0, 0, o, bw, H, x, 0, bw, H);
      if (f > 0.02) {
        vg.globalAlpha = Math.min(1, f);
        vg.drawImage(t1, 0, o, bw, H, x, 0, bw, H);
        vg.globalAlpha = 1;
      }
      a.pintada = a.pos;
      a.pintadaE = e;
    });
    // y se enrollan las seis a la vez: una fila por vez de la pantalla para todos los anillos juntos
    const g = cache.ag, h = cache.aros.height, cy = h / 2;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, K.span, h);
    proyectar(g, cache.ventanas, K.span, 0, cy, K.R, K.medio);
    g.globalCompositeOperation = 'multiply';
    g.drawImage(cache.luces.mul, 0, cy - K.R);
    g.globalCompositeOperation = 'screen';
    g.drawImage(cache.luces.scr, 0, cy - K.R);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(cache.luces.bordes, 0, 0);
  }

  // ---------- Dibujo: cada cuadro ----------
  let escala = 1; // px del lienzo por px de la pantalla
  let zoom = 1;   // lo armado, al tamaño de ahora (1, salvo que la ventana haya cambiado poco o se esté por rearmar)
  function aObjeto(g, dx, alza) {
    // del cryptex (x a lo largo del eje, desde la punta izquierda; y desde el eje) al lienzo
    g.setTransform(1, 0, 0, 1, dx, 0);
    g.translate((L.cx - V.x) * escala, (L.cy - V.y) * escala);
    g.rotate(L.ang);
    const sc = (1 + 0.025 * alza) * zoom;
    g.scale(sc, sc);
    g.translate(-K.largo / 2, 0);
  }

  // La sombra queda dibujada aparte: solo cambia al levantarse o si se mueve, y los tres desenfoques
  // grandes son lo que más cuesta de cada cuadro (mientras gira, sería rehacerlos 60 veces por segundo
  // para nada). Se dibujan dos, quieto y levantado, y al levantarse se pasa de una a la otra (de tan
  // poco que sube, no se nota la diferencia). Van del tamaño del lienzo: pegarlas así es lo más barato.
  // Todo en la sombra es proporcional al cryptex, y el lienzo también: si cambia el tamaño de la ventana,
  // mientras se está moviendo alcanza con estirar la que hay; se vuelve a hacer cuando se queda quieta
  // (o si se giró: el celular parado o acostado)
  const sombraC = [null, null];
  let sombraDe = '', sombraLista = [false, false], moviendo = false;
  function sombras(alza) {
    const w = vista.width, h = vista.height;
    if (L.ang !== sombraDe) { sombraDe = L.ang; sombraLista = [false, false]; }
    let otra = false;
    for (const [i, peso] of [[0, 1 - alza], [1, alza]]) {
      if (peso < 0.002) continue;
      // el lienzo está vacío: si van las dos, la segunda, con "lighter", se suma tal cual (mitad y mitad
      // no aclara la sombra)
      if (otra) ctx.globalCompositeOperation = 'lighter';
      otra = true;
      let c = sombraC[i];
      if (!sombraLista[i] || ((c.width !== w || c.height !== h) && (!moviendo || Math.abs(c.width / w - 1) > 0.15))) {
        c = sombraC[i] || (sombraC[i] = lienzo(w, h));
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        dibujarSombras(c.getContext('2d'), i);
        sombraLista[i] = true;
      }
      ctx.globalAlpha = Math.min(1, peso);
      ctx.imageSmoothingQuality = 'low'; // es toda difusa (y casi siempre va tal cual)
      ctx.drawImage(c, 0, 0, w, h);
      ctx.imageSmoothingQuality = 'high';
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  function dibujarSombras(g, alza) {
    // solo la sombra: el contorno se dibuja muy lejos y la sombra se corre hasta su lugar (así la
    // sombra va hacia donde caen las de la foto, aunque el cryptex esté girado)
    const Dd = K.D * zoom, LEJOS = 10000;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    const capas = [
      [0.04, 0.1, 0.85],                                    // pegada: el hueco entre el cilindro y el paño
      [0.2 + 0.2 * alza, 0.34 + 0.14 * alza, 0.6 - 0.15 * alza], // la sombra que proyecta
      [0.32 + 0.25 * alza, 0.8, 0.28],                      // la penumbra grande, muy suave
    ];
    for (const [d, blur, alfa] of capas) {
      aObjeto(g, -LEJOS, alza);
      g.shadowColor = `rgba(0,5,2,${alfa.toFixed(3)})`;
      g.shadowBlur = blur * Dd;
      g.shadowOffsetX = LEJOS + SOMBRA[0] * d * Dd;
      g.shadowOffsetY = SOMBRA[1] * d * Dd;
      g.fillStyle = '#000';
      g.fill(cache.silueta);
    }
    g.shadowColor = 'transparent';
    g.shadowBlur = g.shadowOffsetX = g.shadowOffsetY = 0;
  }

  function componer(now) {
    const g = ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, vista.width, vista.height);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    sombras(hover);
    aObjeto(g, 0, hover);
    const ra = cache.alma.height / 2;
    g.drawImage(cache.alma, K.x0 - K.junta, -ra);
    g.drawImage(cache.aros, K.x0, -cache.aros.height / 2);
    // movimiento reducido: los anillos de antes se funden en los de MEMITO
    if (fundido) {
      g.globalAlpha = 1 - smooth(0, 1, (now - t0) / T_FUNDIDO);
      g.drawImage(fundido, K.x0, -fundido.height / 2);
      g.globalAlpha = 1;
    }
    g.drawImage(cache.izq, 0, -cache.izq.height / 2);
    g.drawImage(cache.der, K.xDer, -cache.der.height / 2);
    // la fila de MEMITO, iluminada (cada ficha se enciende cuando le pasa el brillo por encima);
    // solo sobre las bandas de letras: "multiply" y "screen" pintarían también los huecos de alrededor
    g.save();
    g.clip(cache.bandas);
    const { luz, penumbra } = cache.fila;
    for (let i = 0; i < nA; i++) {
      const b = brilloDe(i, now);
      if (b < 0.004) continue;
      const x = i * (K.aw + K.junta);
      g.globalCompositeOperation = 'multiply';
      g.globalAlpha = Math.min(1, b * 1.3);
      g.drawImage(penumbra, x, 0, K.aw, penumbra.height, K.x0 + x, -penumbra.height / 2, K.aw, penumbra.height);
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = Math.min(1, b * 0.7);
      g.drawImage(luz, x, 0, K.aw, luz.height, K.x0 + x, -luz.height / 2, K.aw, luz.height);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    // el brillo que recorre la fila cuando cae el último anillo
    if (reflejo != null && !quieto) {
      const k = (now - reflejo) / T_REFLEJO;
      if (k > 0 && k < 1) {
        const xs = mix(K.x0 - K.D * 0.5, K.x0 + K.span + K.D * 0.5, k);
        const a = 0.8 * Math.sin(Math.PI * k) ** 0.6;
        g.save();
        g.translate(xs, -K.R * 0.08);
        g.rotate(0.28);
        g.scale(K.D * 0.2, K.R * 1.25);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
        rg.addColorStop(0, `rgba(255,240,200,${a.toFixed(3)})`);
        rg.addColorStop(0.4, `rgba(255,218,150,${(a * 0.5).toFixed(3)})`);
        rg.addColorStop(1, 'rgba(255,200,120,0)');
        g.fillStyle = rg;
        g.fillRect(-1, -1, 2, 2);
        g.restore();
      }
    }
    g.restore();
    g.globalCompositeOperation = 'source-over';
  }

  // ---------- Estado y animación ----------
  let estado = 'cerrado'; // cerrado | girando | abierto (dice MEMITO)
  let t0 = 0, raf = 0, hover = 0, hoverTarget = 0, tLlega = 0;
  let reflejo = null, quieto = false; // cuándo arrancó el brillo de la fila; si es sin movimiento
  let base = 0, apagando = null;      // la fila iluminada de siempre; cuándo se empezó a apagar (al volver a girar)
  let fundido = null;                 // movimiento reducido: los anillos de antes, que se funden
  const T_REFLEJO = 1000;             // lo que tarda el brillo en recorrer la fila
  const T_FUNDIDO = 700;
  const BRILLO_FINAL = 0.55;
  // primera vez: cada anillo con sus vueltas y su tiempo (se frenan de izquierda a derecha);
  // las siguientes, una vuelta rápida
  const VUELTAS = [1, 1, 2, 1, 2, 2];

  // Cómo se frena cada anillo: arranca rápido, se va frenando y llega con un resto de velocidad que
  // lo pasa apenas de la letra; el retén lo trae de vuelta (un rebote chiquito, como un clic)
  const PERFIL = (() => {
    const n = 240, v = new Float32Array(n + 1), m = new Float32Array(n + 1);
    for (let i = 0; i <= n; i++) { const u = i / n; v[i] = smooth(0, 0.14, u) * ((1 - u) ** 1.7 + 0.12); }
    for (let i = 1; i <= n; i++) m[i] = m[i - 1] + (v[i - 1] + v[i]) / (2 * n);
    const tot = m[n];
    for (let i = 0; i <= n; i++) { m[i] /= tot; v[i] /= tot; }
    return { n, m, v };
  })();
  const W_RETEN = TAU * 6.5, T_RETEN = 0.08;
  function trayecto(a, t) { // t: segundos desde el toque → [posición, letras por segundo, ya quieto]
    const u = (t - a.delay) / a.dur;
    if (u <= 0) return [a.desde, 0, false];
    if (u < 1) {
      const x = u * PERFIL.n, i = Math.floor(x), f = x - i;
      return [a.desde + a.dist * mix(PERFIL.m[i], PERFIL.m[i + 1], f), (a.dist * mix(PERFIL.v[i], PERFIL.v[i + 1], f)) / a.dur, false];
    }
    const tau = t - a.delay - a.dur;
    if (tau > 6 * T_RETEN) return [a.hasta, 0, true];
    const amp = Math.min(0.24, (a.dist * PERFIL.v[PERFIL.n]) / a.dur / W_RETEN);
    const e = Math.exp(-tau / T_RETEN), sn = Math.sin(W_RETEN * tau), cs = Math.cos(W_RETEN * tau);
    return [a.hasta + amp * sn * e, amp * e * (W_RETEN * cs - sn / T_RETEN), false];
  }

  function planear(primera) {
    anillos.forEach((a, i) => {
      a.desde = a.pos;
      a.dist = mod(FINAL[i] - a.pos, nL) + (primera ? VUELTAS[i] : 1) * nL;
      a.hasta = a.desde + a.dist;
      a.dur = primera ? 0.9 + 0.3 * i : 0.55 + 0.12 * i;
      a.delay = (primera ? 0.04 : 0.03) * i;
    });
    tLlega = Math.max(...anillos.map((a) => a.delay + a.dur));
  }

  function brilloDe(i, now) {
    let b = base;
    if (apagando != null) b *= 1 - clamp((now - apagando) / 220, 0, 1);
    if (reflejo != null) {
      // cuando le pasa el brillo, la ficha se enciende y después queda iluminada, más suave
      const d = now - (reflejo + (quieto ? 0 : T_REFLEJO * K.pasa[i]));
      if (d > 0) b = d < 140 ? mix(b, 1, smooth(0, 140, d)) : BRILLO_FINAL + (1 - BRILLO_FINAL) * Math.exp(-(d - 140) / 520);
    }
    return b;
  }

  function llegar(now, sinMovimiento) {
    reflejo = now;
    quieto = sinMovimiento;
    if (boton.getAttribute('aria-label') !== 'Cryptex: dice MEMITO') {
      boton.setAttribute('aria-label', 'Cryptex: dice MEMITO');
      aviso.textContent = 'El cryptex dice MEMITO';
    }
  }
  function terminar() {
    estado = 'abierto';
    layer.classList.remove('girando');
    anillos.forEach((a, i) => { a.pos = a.desde = a.hasta = FINAL[i]; a.vel = 0; });
  }

  function frame(now) {
    raf = 0;
    if (!L || !cache) return;
    try {
      let mas = false;
      if (estado === 'girando') {
        mas = true;
        if (modo === 'fundido') {
          if (now - t0 >= T_FUNDIDO || !fundido) { fundido = null; terminar(); llegar(now, true); }
        } else {
          const t = (now - t0) / 1000;
          let fin = true;
          for (const a of anillos) {
            const [p, v, q] = trayecto(a, t);
            a.pos = p;
            a.vel = v;
            if (!q) fin = false;
          }
          if (reflejo == null && t >= tLlega) llegar(now, false);
          if (fin) terminar();
        }
      }
      if (reflejo != null) {
        if (now - reflejo > T_REFLEJO + 1800) { reflejo = null; base = BRILLO_FINAL; apagando = null; } else mas = true;
      }
      if (apagando != null && now - apagando < 240) mas = true;
      hover = mix(hover, hoverTarget, 0.2);
      if (Math.abs(hover - hoverTarget) < 0.004) hover = hoverTarget; else mas = true;
      dibujar(now);
      if (mas) raf = requestAnimationFrame(frame);
    } catch (e) { falla(e); }
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  function dibujar(now) {
    if (anillos.some(sucio)) pintarAnillos();
    componer(now);
  }

  let modo = 'giro';
  boton.addEventListener('click', () => {
    if (!cache || !L || estado === 'girando') return;
    const now = performance.now();
    if (reduced.matches) {
      // sin movimiento: lo de antes se funde en MEMITO; si ya lo dice, solo vuelve a brillar
      if (estado === 'abierto') { reflejo = now; quieto = true; kick(); return; }
      fundido = lienzo(cache.aros.width, cache.aros.height);
      fundido.getContext('2d').drawImage(cache.aros, 0, 0);
      anillos.forEach((a, i) => { a.pos = FINAL[i]; a.vel = 0; });
      modo = 'fundido';
    } else {
      if (estado === 'abierto') { base = BRILLO_FINAL; apagando = now; reflejo = null; } // la fila se apaga mientras gira
      planear(estado === 'cerrado');
      modo = 'giro';
    }
    estado = 'girando';
    layer.classList.add('girando');
    t0 = now;
    kick();
  });
  const lift = (on) => { hoverTarget = on && !reduced.matches ? 1 : 0; kick(); };
  const focusVisible = () => { try { return boton.matches(':focus-visible'); } catch { return true; } };
  boton.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') lift(true); });
  boton.addEventListener('pointerleave', () => lift(false));
  boton.addEventListener('focus', () => { if (focusVisible()) lift(true); });
  boton.addEventListener('blur', () => lift(false));

  // ---------- Armar de a poco (sin trabar la página) ----------
  // seguir en la próxima vuelta del navegador (sin la demora mínima de setTimeout), como en la rosa
  const canal = typeof MessageChannel === 'function' ? new MessageChannel() : null;
  let pendiente = null;
  if (canal) canal.port1.onmessage = () => { const f = pendiente; pendiente = null; if (f) f(); };
  const seguir = (f) => { if (canal) { pendiente = f; canal.port2.postMessage(0); } else setTimeout(f, 0); };
  // Corre un generador de a ratitos de ~10 ms; un trabajo nuevo cancela el anterior. Las texturas leen
  // las medidas de K: mientras trabaja, K son las de la obra (entre ratito y ratito vuelven a ser las de
  // lo que se ve, que se sigue dibujando con lo que había)
  let obra = null;
  function trabajar(gen, k, nuevo, fin) {
    const yo = { k, nuevo };
    obra = yo;
    const paso = () => {
      if (obra !== yo || !listo) return; // hubo otro pedido (o se cayó)
      const antes = K, t = performance.now();
      let r;
      try {
        K = k;
        do r = gen.next(); while (!r.done && performance.now() - t < 10);
        K = antes;
        if (!r.done) { seguir(paso); return; }
        obra = null;
        fin(r.value);
      } catch (e) { K = antes; falla(e); }
    };
    seguir(paso); // también el primer ratito: no se suma a la tarea que lo pidió (la carga, un resize)
  }
  // las tiras corridas que falten (también si las cortó un armado que al final no hizo falta)
  const pulir = (c) => { if (c.tiras.some((t) => t[2] === t[0])) trabajar(corridas(c), c.K, false, () => {}); };
  function armar(k) {
    if (cache && !distinto(k, cache.K)) { // lo que hay alcanza (y si se estaba armando otro, ya no hace falta)
      if (obra && obra.nuevo) obra = null;
      if (!obra) pulir(cache);
      return;
    }
    if (obra && obra.nuevo && !distinto(k, obra.k)) return; // ya se está armando
    trabajar(armado(), k, true, (c) => {
      cache = c;
      K = c.K;
      fundido = null; // si se estaba fundiendo (movimiento reducido), los anillos viejos ya no sirven
      anillos.forEach((a) => { a.pintada = NaN; });
      if (L) { ajustarLienzo(); dibujar(performance.now()); }
      layer.classList.toggle('cargando', false);
      pulir(c);
    });
  }

  // ---------- Ubicar, medir y dibujar ----------
  let listo = false, esperaArmar = 0;
  function ajustarLienzo() { // el lienzo, a la resolución de lo armado
    const w = Math.max(1, Math.round(V.w * K.k)), h = Math.max(1, Math.round(V.h * K.k));
    if (vista.width !== w || vista.height !== h) { vista.width = w; vista.height = h; }
    escala = w / V.w;
    zoom = (D * L.g * escala) / K.D;
  }
  function relayout() {
    if (!listo) return;
    try {
      const antes = L && V ? [L.cx, L.cy, L.g, V.w].map((v) => v.toFixed(2)).join() : '';
      layout();
      colocar();
      clearTimeout(esperaArmar);
      if (L && !cache) armar(medir()); // la primera vez
      else if (L) {
        // cambió el tamaño de la ventana: se dibuja ya (en el cuadro que viene, una vez aunque lleguen
        // varios avisos juntos, como al girar el celular) con lo que hay, estirado o achicado, y si hace
        // falta se vuelve a armar cuando la ventana se queda quieta
        moviendo = true;
        ajustarLienzo();
        kick();
        esperaArmar = setTimeout(rearmar, 150);
      } else if (!cache) layer.classList.toggle('cargando', false); // no entra: que no lo esperen
      // el rompecabezas lee dónde quedó el botón cuando cambia la clase de la capa: si nos movimos
      // (al cambiar el tamaño de la ventana él se ubica antes que nosotros), se la "toca" para que se reubique
      const ahora = L && V ? [L.cx, L.cy, L.g, V.w].map((v) => v.toFixed(2)).join() : '';
      if (ahora !== antes && !layer.classList.contains('cargando')) layer.setAttribute('class', layer.getAttribute('class'));
    } catch (e) { falla(e); }
  }
  function rearmar() {
    moviendo = false; // la ventana se quedó quieta: la sombra, otra vez a su medida
    try { if (listo && L) { armar(medir()); kick(); } } catch (e) { falla(e); }
  }
  function falla(e) {
    // si algo sale mal, queda la portada tal cual
    if (window.console) console.warn('Cryptex de la portada:', e);
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(esperaArmar);
    obra = null;
    listo = false;
    cache = null;
    layer.remove();
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
  // el tintero aparece (o se cae, si no carga) cuando termina de cargar: recién ahí se sabe qué lugar ocupa
  const tinta = document.getElementById('tinta');
  if (tinta) new MutationObserver(relayout).observe(tinta, { attributes: true, attributeFilter: ['class'] });
  if (document.body && tinta) new MutationObserver(() => { if (!tinta.isConnected) relayout(); }).observe(document.body, { childList: true });

  // ---------- La fuente (Cinzel, mayúsculas romanas) ----------
  const hayCinzel = () => {
    try { for (const f of document.fonts) if (/cinzel/i.test(f.family) && f.status === 'loaded') return true; } catch {}
    return false;
  };
  // si llega después de haber dibujado con la de reserva, se vuelven a grabar las letras (de a poco:
  // mientras tanto se sigue viendo con la otra)
  const llegoFuente = () => { if (cache && !cache.K.fuente && hayCinzel()) rearmar(); };
  function esperarFuente() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const carga = document.fonts.load('700 1em Cinzel').then(llegoFuente, () => {});
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', llegoFuente);
    return Promise.race([carga, new Promise((ok) => setTimeout(ok, 2500))]);
  }

  // ---------- Carga (después de la portada, para no demorarla) ----------
  function start() {
    try { ctx = vista.getContext('2d'); } catch { ctx = null; }
    if (!ctx || typeof Path2D !== 'function') { layer.remove(); return; }
    esperarFuente().then(() => {
      if (!layer.isConnected) return;
      listo = true;
      relayout(); // se arma de a poco y, cuando está, se muestra (armar)
    });
  }
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });
})();
