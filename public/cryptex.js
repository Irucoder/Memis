// Cryptex: el cilindro de anillos con letras, como el de El código Da Vinci.
// Se dibuja en un canvas: cada anillo es una tira de latón con las letras grabadas que se
// "enrolla" sobre un cilindro, así las letras de arriba y de abajo se curvan y se achican.
// Encima van capas invisibles para el arrastre, la rueda, el teclado y el lector de pantalla.
//
//   const cx = Cryptex.mount(host, { rings, letters, open, label, onTry, onScroll });
//   cx.setOpen(true|false); cx.focus(); cx.destroy(); cx.el; cx.value (la palabra que se lee)
(() => {
  const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const FUENTE = '"Cinzel", "Trajan Pro", "Times New Roman", Georgia, serif';
  const FUENTE_CSS = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@700&display=swap';
  const MAX_W = 760;
  const PASO_ANG = (2 * Math.PI) / 20; // ángulo entre letras: un poco más que 360°/26, así se leen más grandes
  const LUZ = 0.62; // la luz viene de arriba (la lámpara): elevación en radianes
  const TAU = Math.PI * 2;
  // colores de frente (con luz plena)
  const LATON_PULIDO = '#d4b06a';
  const LATON_OSCURO = '#8f6c35';
  const LATON_REBORDE = '#b18c4b';
  const BRONCE = '#4b3720';

  const memo = new Map(); // cómo quedaron los anillos de cada cryptex (si se cierra el modal y se vuelve)
  let reserva = null; // las texturas ya dibujadas del último cryptex (para el mismo tamaño se reusan)
  let serie = 0;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));
  const mod = (a, n) => ((a % n) + n) % n;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

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

  // ---------- La fuente (Cinzel, mayúsculas romanas) ----------
  let fuente = null;
  let fuenteLista = false; // ya se puede dibujar con Cinzel
  function cargarFuente() {
    if (fuente) return fuente;
    fuente = new Promise((ok) => {
      if (!document.fonts || !document.fonts.load) return ok(false);
      const listo = () => document.fonts.load('700 40px Cinzel').then((f) => { fuenteLista = f.length > 0; ok(fuenteLista); }, () => ok(false));
      let link = document.querySelector('link[href*="family=Cinzel"]');
      if (link && link.sheet) return listo();
      if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = FUENTE_CSS;
        document.head.appendChild(link);
      }
      link.addEventListener('load', listo, { once: true });
      link.addEventListener('error', () => ok(false), { once: true });
      setTimeout(() => ok(false), 4000);
    });
    return fuente;
  }

  // ---------- Luz sobre un cilindro ----------
  // phi: ángulo desde el frente (0 = la línea de lectura), positivo hacia abajo
  function luzEn(phi) {
    const dif = (0.08 + 0.92 * Math.max(0, Math.cos(phi + LUZ * 0.55))) * (0.5 + 0.5 * Math.cos(phi) ** 0.7); // los bordes se oscurecen
    const esp = 0.42 * Math.max(0, Math.cos(phi + LUZ * 1.25)) ** 46 // brillo de la lámpara, bien arriba
      + 0.14 * Math.exp(-(((phi - 1.1) / 0.18) ** 2)); // reflejo cálido del escritorio, abajo
    return [dif, esp];
  }
  function iluminar(g, x, w, cy, r) {
    const m = g.createLinearGradient(0, cy - r, 0, cy + r);
    const s = g.createLinearGradient(0, cy - r, 0, cy + r);
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const [d, e] = luzEn(Math.asin(clamp(u * 2 - 1, -1, 1)));
      m.addColorStop(u, `rgb(${Math.round(255 * d)},${Math.round(241 * d)},${Math.round(216 * d)})`);
      s.addColorStop(u, `rgba(255,228,168,${e.toFixed(3)})`);
    }
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = m;
    g.fillRect(x, cy - r, w, 2 * r);
    g.globalCompositeOperation = 'screen';
    g.fillStyle = s;
    g.fillRect(x, cy - r, w, 2 * r);
    g.restore();
  }
  // Cada fila de la pantalla toma la fila de la tira que le toca sobre el cilindro (por eso se curva)
  function proyectar(g, tira, sw, dx, cy, R, off, C) {
    const top = cy - R;
    for (let j = 0; j < 2 * R; j++) {
      const s = (j + 0.5 - R) / R;
      let t = off + Math.asin(s) * R - 0.5;
      if (C) t = mod(t, C);
      const dt = Math.min(6, 1 / Math.max(0.05, Math.sqrt(1 - s * s)));
      g.drawImage(tira, 0, t, sw, dt, dx, top + j, sw, 1);
    }
  }

  // Grano del metal: puntitos y el cepillado alrededor (en la vista de frente, rayitas verticales)
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

  // ---------- El widget ----------
  function mount(host, opts = {}) {
    const id = ++serie;
    const letras = [...String(opts.letters || LETRAS).toUpperCase()].filter((ch, i, a) => ch.trim() && a.indexOf(ch) === i);
    if (letras.length < 2) letras.splice(0, letras.length, ...LETRAS);
    const nL = letras.length;
    const nA = clamp(Math.round(Number(opts.rings) || 5), 1, 12);
    const label = opts.label || 'Cryptex';
    const clave = opts.id || `${label}|${nA}|${letras.join('')}`;

    // ---------- DOM ----------
    const raiz = document.createElement('div');
    raiz.className = 'crx';
    raiz.setAttribute('role', 'group');
    raiz.setAttribute('aria-label', label);
    raiz.setAttribute('aria-describedby', `crx-ayuda-${id}`);
    raiz.innerHTML = `
      <div class="crx-escena">
        <canvas class="crx-lienzo" aria-hidden="true"></canvas>
        <div class="crx-tapa izq" aria-hidden="true"></div>
        <div class="crx-tapa der" aria-hidden="true"></div>
        <button class="crx-pergamino" type="button" aria-label="Pergamino enrollado: tocá para leerlo">${pergaminoSVG(id)}</button>
      </div>
      <div class="crx-pie">
        <button class="crx-abrir" type="button">Abrir</button>
        <p class="crx-msg" aria-live="polite"></p>
      </div>
      <p class="crx-sr" id="crx-ayuda-${id}">Girá cada anillo con las flechas arriba y abajo del teclado, arrastrándolo o con la rueda del mouse. Con izquierda y derecha pasás de anillo; también podés tipear la letra. Enter o el botón Abrir tiran de las tapas.</p>
      <p class="crx-sr" aria-live="polite" data-aviso></p>`;
    const escena = raiz.querySelector('.crx-escena');
    const canvas = raiz.querySelector('.crx-lienzo');
    const ctx = canvas.getContext('2d');
    const boton = raiz.querySelector('.crx-abrir');
    const msg = raiz.querySelector('.crx-msg');
    const aviso = raiz.querySelector('[data-aviso]');
    const pergamino = raiz.querySelector('.crx-pergamino');
    const tapasEl = [raiz.querySelector('.crx-tapa.izq'), raiz.querySelector('.crx-tapa.der')];

    const guardado = memo.get(clave);
    const rnd0 = azar((Date.now() ^ (id * 7919)) >>> 0);
    const anillos = Array.from({ length: nA }, (_, i) => {
      const p = guardado && Number.isInteger(guardado[i]) ? guardado[i] : Math.floor(rnd0() * nL);
      const el = document.createElement('div');
      el.className = 'crx-anillo';
      el.tabIndex = i === 0 ? 0 : -1;
      el.setAttribute('role', 'spinbutton');
      el.setAttribute('aria-label', `Anillo ${i + 1} de ${nA}`);
      el.setAttribute('aria-valuemin', '0');
      el.setAttribute('aria-valuemax', String(nL - 1));
      const arriba = flecha('arriba', `Anillo ${i + 1}: letra siguiente`);
      const abajo = flecha('abajo', `Anillo ${i + 1}: letra anterior`);
      escena.append(el, arriba, abajo);
      return { i, el, arriba, abajo, pos: p, target: p, v: 0, pintada: NaN, cache: null, g: null, tira: null, arrastre: null, rueda: 0, ruedaT: 0 };
    });
    function flecha(lado, nombre) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'crx-flecha ' + lado;
      b.tabIndex = -1;
      b.setAttribute('aria-hidden', 'true');
      b.title = nombre;
      b.innerHTML = lado === 'arriba'
        ? '<svg viewBox="0 0 24 14"><path d="M3 11.5 12 3l9 8.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : '<svg viewBox="0 0 24 14"><path d="M3 2.5 12 11l9-8.5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      return b;
    }
    // las flechas van antes que el pergamino en el orden de apilado
    escena.append(pergamino);
    host.appendChild(raiz);

    // ---------- Estado ----------
    let M = null; // medidas en px de CSS
    let K = null; // medidas en px del lienzo
    let cache = null; // tapas, alma y manguitos ya dibujados
    let conFuente = false; // las letras se dibujaron con Cinzel (si no, se redibujan cuando llegue)
    let iniciado = false;
    let granoC = null;
    const patrones = new WeakMap();
    const grano = (g) => { // el patrón de grano es de cada contexto
      if (!granoC) return null;
      let p = patrones.get(g);
      if (!p) { p = g.createPattern(granoC, 'repeat'); patrones.set(g, p); }
      return p;
    };
    let abierto = false, probando = false, destruido = false;
    let ultimo = 0; // último anillo con foco
    const tapas = { x: 0, v: 0, target: 0, k: 300, c: 20, arrastre: null };
    let sacudida = 0, brillo = 0, msgT = 0, raf = 0, tAnt = 0;

    const palabra = () => anillos.map((a) => letras[mod(Math.round(a.target), nL)]).join('');

    // ---------- Medidas ----------
    function medir() {
      const W = Math.min(MAX_W, escena.clientWidth || 0);
      if (W < 60) return false;
      const k = Math.min(2, window.devicePixelRatio || 1);
      const chico = W < 520;
      const P = chico
        ? { anillo: nA >= 8 ? 0.2 : 0.25, junta: 0.012, collar: 0.13, perilla: 0.07, abre: 0.085, aire: 0.012 }
        : { anillo: 0.28, junta: 0.014, collar: 0.25, perilla: 0.22, abre: 0.16, aire: 0.025 };
      const unidades = nA * P.anillo + (nA - 1) * P.junta + 2 * (P.collar + P.perilla + P.abre + P.aire);
      const vh = window.innerHeight || 800;
      const D = Math.min(W / unidades, clamp((vh - 240) / 1.35, 96, 250));
      const Dd = D * k;
      const aw = Math.max(8, Math.round(P.anillo * Dd));
      const junta = Math.max(1, Math.round(P.junta * Dd));
      const span = nA * aw + (nA - 1) * junta;
      const Wd = Math.round(W * k);
      const x0 = Math.round((Wd - span) / 2);
      const R = Math.round(Dd / 2);
      const Rr = Math.round(Dd * 0.5175);
      const Rc = Math.round(Dd * 0.55);
      const RcL = Math.round(Dd * 0.572);
      const paso = Math.max(6, Math.round(R * PASO_ANG));
      const borde = Math.max(2, Math.round(Dd * (chico ? 0.022 : 0.026)));
      const collarW = Math.round(P.collar * Dd), perillaW = Math.round(P.perilla * Dd);
      const tapaW = collarW + perillaW;
      const flechaH = clamp(D * 0.16, 26, 38);
      const cy = Math.round((8 + flechaH + 4) * k + Rr);
      const pw = Math.min(D * 1.55, W - 24), ph = pw / 3.4;
      const pTop = cy / k + D * 0.19;
      const H = Math.ceil(Math.max(cy / k + Rr / k + 4 + flechaH + 10, pTop + ph + 16, (cy + RcL) / k + D * 0.12));
      const nuevoK = {
        k, chico, D: Dd, W: Wd, H: Math.round(H * k), aw, junta, span, x0, R, Rr, Rc, RcL, paso, C: paso * nL,
        borde, collarW, perillaW, tapaW, cy, abre: Math.round(P.abre * Dd),
        xIzq: x0 - junta - tapaW, xDer: x0 + span + junta,
      };
      const cambio = !K || ['k', 'W', 'H', 'aw', 'junta', 'x0', 'R', 'paso', 'cy', 'tapaW', 'abre'].some((p) => K[p] !== nuevoK[p]);
      K = nuevoK;
      M = { W, H, D, flechaH, pw, ph, pTop };
      return cambio;
    }

    // ---------- Dibujo: piezas que no cambian ----------
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

    // Lo que comparten todos los anillos: el latón (cada uno usa otro pedazo) y las letras grabadas
    function texturasAnillos() {
      const bw = K.aw - 2 * K.borde, C = K.C, paso = K.paso, pad = 16;
      const fichas = Float32Array.from({ length: nL }, (_, i) => (azar(31 + i * 7)() - 0.5) * 0.08);
      const base = metal(bw, C, [190, 156, 100], 1009, { tono: (y) => fichas[Math.floor(mod(y + paso / 2, C) / paso) % nL] });
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
      const fpx = Math.round(paso * 0.74);
      mg.font = `700 ${fpx}px ${FUENTE}`;
      mg.textAlign = 'center';
      mg.textBaseline = 'alphabetic';
      mg.fillStyle = '#000';
      const alto = mg.measureText('H').actualBoundingBoxAscent || fpx * 0.7;
      const maxW = bw * 0.8;
      letras.forEach((ch, i) => {
        const ancho = mg.measureText(ch).width;
        const sx = ancho > maxW ? maxW / ancho : 1;
        for (const off of [-C, 0, C]) {
          const y = i * paso + off + alto / 2;
          if (y < -paso || y > C + pad + paso) continue;
          mg.save();
          mg.translate(bw / 2, y);
          mg.scale(sx, 1);
          mg.fillText(ch, 0, 0);
          mg.restore();
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

    // Tira del collar: bronce oscurecido con volutas y la plaquita con el triángulo que marca la línea de lectura
    function tiraCollar(bw, Rc) {
      const m = 8;
      const h = Math.ceil(Math.PI * Rc + 2 * m);
      const tc = Math.round(h / 2);
      const c = metal(bw, h, [78, 60, 38], 99, { periodo: TAU * Rc, sinBorde: true });
      const g = c.getContext('2d');
      // volutas arriba y abajo de la plaquita
      const placaH = Math.round(K.paso * 1.7);
      const s = Math.min(bw * 0.86, K.paso * 1.5);
      const sep = s * 1.02;
      for (let i = 0; tc - placaH / 2 - sep * (i + 0.5) > -sep; i++) {
        const dy = placaH / 2 + sep * (i + 0.55);
        voluta(g, bw / 2, tc - dy, s, i % 2 ? 1 : -1);
        voluta(g, bw / 2, tc + dy, s, i % 2 ? -1 : 1);
      }
      // plaquita de latón
      const px = Math.round(bw * 0.04), pw = bw - 2 * px, py = tc - placaH / 2;
      const placa = metal(pw, placaH, [196, 162, 104], 5, { sinBorde: true, periodo: placaH * 9 });
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

    function dibujarTapa() { // tapa izquierda: perilla afuera, collar adentro (pegado a los anillos)
      const w = K.tapaW, h = 2 * K.RcL + 4, cy = h / 2;
      const c = lienzo(w, h), g = c.getContext('2d');
      const D = K.D, pw = K.perillaW;
      // perilla: punta cónica, escalón, disco almenado y cuello
      // perilla escalonada, como la de la foto: punta, tres escalones, disco almenado y cuello
      const partes = [
        { w: 0.15, tipo: 'cono', rb: 0.14, rt: 0.035 },
        { w: 0.11, r: 0.2, color: LATON_OSCURO, bisel: true },
        { w: 0.13, r: 0.27, color: BRONCE, bisel: true },
        { w: 0.15, r: 0.345, color: LATON_OSCURO, bisel: true },
        { w: 0.27, r: 0.5, color: LATON_OSCURO, bisel: true, almenas: true },
        { w: 0.19, r: 0.45, color: BRONCE },
      ];
      let x = 0;
      for (const p of partes) {
        const pwp = Math.round(p.w * pw);
        if (p.tipo === 'cono') cono(g, x, pwp + 1, cy, p.rb * D, p.rt * D, LATON_OSCURO);
        else {
          tambor(g, x, pwp + (p.bisel ? 0 : 1), cy, p.r * D, p.color, { bisel: p.bisel, redondeo: p.bisel ? Math.min(pwp * 0.3, p.r * D * 0.2) : 0 });
          if (p.almenas) ranuras(g, x, pwp, cy, p.r * D);
        }
        x += pwp;
      }
      // collar: reborde, banda con volutas y plaquita, reborde
      x = pw;
      const lip = Math.max(2, Math.round(D * 0.032));
      const bw = K.collarW - 2 * lip;
      tambor(g, x, lip, cy, K.RcL, LATON_PULIDO, { bisel: true, redondeo: lip * 0.45 });
      const { c: tira, tc } = tiraCollar(bw, K.Rc);
      g.save();
      proyectar(g, tira, bw, x + lip, cy, K.Rc, tc, 0);
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

    function construir() {
      if (!K) return;
      conFuente = fuenteLista;
      granoC = granoC || hacerGrano();
      canvas.width = K.W;
      canvas.height = K.H;
      canvas.style.width = M.W + 'px';
      canvas.style.height = M.H + 'px';
      // lo pesado (tapas, alma, latón y letras) se guarda: al volver a abrir el modal sale al toque
      const firma = [K.k, K.D, K.aw, K.borde, K.junta, K.span, K.R, K.Rr, K.Rc, K.RcL, K.paso, K.collarW, K.perillaW, K.abre, letras.join(''), conFuente].join('|');
      if (!reserva || reserva.firma !== firma) {
        // tapas (la derecha es el espejo de la izquierda)
        const izq = dibujarTapa();
        const der = lienzo(izq.width, izq.height), dg = der.getContext('2d');
        dg.scale(-1, 1);
        dg.drawImage(izq, -izq.width, 0);
        // alma: lo que se ve entre anillo y anillo
        const ra = Math.round(K.D * 0.47);
        const alma = lienzo(K.span + 2 * K.junta, 2 * ra);
        tambor(alma.getContext('2d'), 0, alma.width, ra, ra, '#2e2113', { grano: 0.3 });
        // manguitos: el tubo de adentro, que aparece al separar las tapas
        const rm = Math.round(K.D * 0.41);
        const mang = lienzo(K.abre + K.junta + 4, 2 * rm), mgc = mang.getContext('2d');
        tambor(mgc, 0, mang.width, rm, rm, '#caa864', { grano: 0.5 });
        mgc.fillStyle = 'rgba(20,12,4,0.5)';
        for (const f of [0.3, 0.62]) mgc.fillRect(Math.round(mang.width * f), 0, Math.max(1, K.k), mang.height);
        reserva = { firma, izq, der, alma, mang, T: texturasAnillos(), tiras: [] };
      }
      cache = reserva;
      // anillos: cada uno con su pedazo de latón y su lienzo
      anillos.forEach((a, i) => {
        a.tira = reserva.tiras[i] || (reserva.tiras[i] = tiraAnillo(i, reserva.T));
        a.cache = lienzo(K.aw, 2 * K.Rr + 2);
        a.g = a.cache.getContext('2d');
        a.pintada = NaN;
        pintarAnillo(a);
      });
    }

    function pintarAnillo(a) {
      const g = a.g, w = K.aw, h = a.cache.height, cy = h / 2;
      const bx = K.borde, bw = w - 2 * K.borde;
      g.clearRect(0, 0, w, h);
      proyectar(g, a.tira, bw, bx, cy, K.R, mod(a.pos, nL) * K.paso, K.C);
      iluminar(g, bx, bw, cy, K.R);
      const s = g.createLinearGradient(bx, 0, bx + bw, 0); // sombra de los rebordes sobre la banda
      s.addColorStop(0, 'rgba(18,10,3,0.6)');
      s.addColorStop(0.12, 'rgba(18,10,3,0)');
      s.addColorStop(0.88, 'rgba(18,10,3,0)');
      s.addColorStop(1, 'rgba(18,10,3,0.6)');
      g.fillStyle = s;
      g.fillRect(bx, cy - K.R, bw, 2 * K.R);
      tambor(g, 0, K.borde, cy, K.Rr, LATON_REBORDE, { bisel: true, redondeo: K.borde * 0.45 });
      tambor(g, w - K.borde, K.borde, cy, K.Rr, LATON_REBORDE, { bisel: true, redondeo: K.borde * 0.45 });
      a.pintada = a.pos;
    }

    // ---------- Dibujo: cada cuadro ----------
    function componer(now) {
      const g = ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      let sx = 0;
      if (sacudida) {
        const u = (now - sacudida) / 520;
        if (u < 1) sx = 6 * K.k * (1 - u) ** 2 * Math.sin(u * Math.PI * 9);
      }
      g.translate(sx, 0);
      const ab = Math.max(0, tapas.x);
      const cy = K.cy;
      // sombra de apoyo
      const x0 = K.xIzq - ab, x1 = K.xDer + K.tapaW + ab;
      g.save();
      g.translate((x0 + x1) / 2, cy + K.RcL * 0.97);
      g.scale((x1 - x0) / 2 * 0.97, K.RcL * 0.16);
      const sg = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      sg.addColorStop(0, 'rgba(0,0,0,0.6)');
      sg.addColorStop(0.55, 'rgba(0,0,0,0.28)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sg;
      g.beginPath();
      g.arc(0, 0, 1, 0, TAU);
      g.fill();
      g.restore();
      // alma y manguitos
      g.drawImage(cache.alma, K.x0 - K.junta, cy - cache.alma.height / 2);
      if (ab > 0.5) {
        const m = cache.mang, w = Math.min(m.width, Math.ceil(ab + K.junta)), h = m.height;
        g.drawImage(m, 0, 0, w, h, K.x0 - w, cy - h / 2, w, h);
        g.drawImage(m, m.width - w, 0, w, h, K.x0 + K.span, cy - h / 2, w, h);
        // sombra de la tapa sobre el manguito
        for (const [xa, dir] of [[K.xIzq - ab + K.tapaW, 1], [K.xDer + ab, -1]]) {
          const sh = g.createLinearGradient(xa, 0, xa + dir * K.D * 0.08, 0);
          sh.addColorStop(0, 'rgba(0,0,0,0.55)');
          sh.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = sh;
          g.fillRect(Math.min(xa, xa + dir * K.D * 0.08), cy - h / 2, K.D * 0.08, h);
        }
      }
      // anillos y tapas
      anillos.forEach((a, i) => g.drawImage(a.cache, K.x0 + i * (K.aw + K.junta), cy - a.cache.height / 2));
      g.drawImage(cache.izq, K.xIzq - ab, cy - cache.izq.height / 2);
      g.drawImage(cache.der, K.xDer + ab, cy - cache.der.height / 2);
      // un brillo que recorre los anillos al abrirse
      if (brillo) {
        const u = (now - brillo) / 950;
        if (u > 0 && u < 1) {
          const xs = mix(K.x0 - K.D * 0.4, K.x0 + K.span + K.D * 0.4, easeInOut(u));
          const w = K.D * 0.32;
          const bg = g.createLinearGradient(xs - w, cy - K.R, xs + w, cy + K.R);
          bg.addColorStop(0, 'rgba(255,240,200,0)');
          bg.addColorStop(0.5, `rgba(255,240,200,${(0.55 * Math.sin(Math.PI * u)).toFixed(3)})`);
          bg.addColorStop(1, 'rgba(255,240,200,0)');
          g.save();
          g.beginPath();
          g.rect(K.x0, cy - K.Rr, K.span, 2 * K.Rr);
          g.clip();
          g.globalCompositeOperation = 'screen';
          g.fillStyle = bg;
          g.fillRect(K.x0, cy - K.Rr, K.span, 2 * K.Rr);
          g.restore();
        }
      }
    }

    // ---------- Capas de arriba (DOM) ----------
    function colocar() {
      const k = K.k, cy = K.cy / k;
      escena.style.height = M.H + 'px';
      const rr = K.Rr / k, aw = K.aw / k;
      anillos.forEach((a, i) => {
        const x = (K.x0 + i * (K.aw + K.junta)) / k;
        Object.assign(a.el.style, { left: x + 'px', top: cy - rr + 'px', width: aw + 'px', height: 2 * rr + 'px' });
        const fw = aw + K.junta / k;
        const fx = x - K.junta / k / 2;
        Object.assign(a.arriba.style, { left: fx + 'px', top: cy - rr - 4 - M.flechaH + 'px', width: fw + 'px', height: M.flechaH + 'px' });
        Object.assign(a.abajo.style, { left: fx + 'px', top: cy + rr + 4 + 'px', width: fw + 'px', height: M.flechaH + 'px' });
      });
      const rc = K.RcL / k, tw = K.tapaW / k;
      Object.assign(tapasEl[0].style, { left: K.xIzq / k + 'px', top: cy - rc + 'px', width: tw + 'px', height: 2 * rc + 'px' });
      Object.assign(tapasEl[1].style, { left: K.xDer / k + 'px', top: cy - rc + 'px', width: tw + 'px', height: 2 * rc + 'px' });
      const px = M.W / 2 - M.pw / 2;
      Object.assign(pergamino.style, { left: px + 'px', top: M.pTop + 'px', width: M.pw + 'px', height: M.ph + 'px' });
      // de dónde sale: del hueco de la derecha, entre los anillos y la tapa
      const gx = (K.x0 + K.span + K.junta + K.abre / 2) / k;
      pergamino.style.setProperty('--crx-dx', (gx - M.W / 2).toFixed(1) + 'px');
      pergamino.style.setProperty('--crx-dy', (cy - (M.pTop + M.ph / 2)).toFixed(1) + 'px');
    }

    function relayout() {
      if (destruido || !iniciado) return;
      const antes = K ? K.abre : 0;
      const cambio = medir();
      if (!K) return;
      if (cambio || !cache) construir();
      colocar();
      if (abierto && (cambio || !antes)) { // las tapas siguen separadas con la medida nueva
        const enCurso = tapas.x !== tapas.target;
        tapas.target = K.abre;
        if (!enCurso || !antes) { tapas.x = K.abre; tapas.v = 0; } else tapas.x *= K.abre / antes;
      }
      componer(performance.now());
      arrancar();
    }

    // ---------- Animación ----------
    function arrancar() {
      if (raf || destruido || !K) return;
      tAnt = performance.now();
      raf = requestAnimationFrame(tick);
    }
    function tick(now) {
      raf = 0;
      if (destruido || !K || !cache) return;
      const dt = clamp((now - tAnt) / 1000, 0.001, 0.034);
      tAnt = now;
      let mas = false;
      for (const a of anillos) {
        if (!a.arrastre && (a.pos !== a.target || a.v)) {
          if (reduced.matches) { a.pos = a.target; a.v = 0; }
          else {
            a.v += (260 * (a.target - a.pos) - 25 * a.v) * dt;
            a.pos += a.v * dt;
            if (Math.abs(a.target - a.pos) < 0.002 && Math.abs(a.v) < 0.03) { a.pos = a.target; a.v = 0; }
          }
          if (a.pos === a.target && !a.v) { a.target = a.pos = mod(a.target, nL); a.pintada = mod(a.pintada, nL); guardar(); }
          else mas = true;
        }
        if (a.pos !== a.pintada) pintarAnillo(a);
      }
      const T = tapas;
      if (!T.arrastre && (T.x !== T.target || T.v)) {
        if (reduced.matches) { T.x = T.target; T.v = 0; }
        else {
          T.v += (T.k * (T.target - T.x) - T.c * T.v) * dt;
          T.x += T.v * dt;
          if (Math.abs(T.target - T.x) < 0.05 && Math.abs(T.v) < 1) { T.x = T.target; T.v = 0; } else mas = true;
        }
      }
      if (sacudida) { if (now - sacudida < 520) mas = true; else sacudida = 0; }
      if (brillo) { if (now - brillo < 950) mas = true; else brillo = 0; }
      componer(now);
      if (mas) raf = requestAnimationFrame(tick);
    }
    const guardar = () => memo.set(clave, anillos.map((a) => mod(Math.round(a.target), nL)));

    // ---------- Girar ----------
    function aria(a) {
      const i = mod(Math.round(a.target), nL);
      a.el.setAttribute('aria-valuenow', String(i));
      a.el.setAttribute('aria-valuetext', letras[i]);
    }
    const quieto = () => abierto || probando || destruido;
    function mover(i, d) {
      const a = anillos[i];
      if (!a || quieto() || !d) return;
      a.target = Math.round(a.target) + d;
      aria(a);
      arrancar();
    }
    function poner(i, idx) {
      const a = anillos[i];
      if (!a || quieto()) return;
      const cur = Math.round(a.target);
      let d = mod(idx - cur, nL);
      if (d > nL / 2) d -= nL;
      mover(i, d);
    }
    function enfocar(i) {
      const a = anillos[clamp(i, 0, nA - 1)];
      a.el.focus({ preventScroll: true });
    }
    function letraDe(key) {
      if (!key || key.length !== 1) return -1;
      let ch = key.toUpperCase();
      let i = letras.indexOf(ch);
      if (i < 0) { ch = ch.normalize('NFD').replace(/[̀-ͯ]/g, ''); i = letras.indexOf(ch); }
      return i;
    }
    const escala = () => {
      const r = escena.getBoundingClientRect();
      return r.width / (escena.offsetWidth || r.width || 1) || 1;
    };

    anillos.forEach((a, i) => {
      aria(a);
      a.el.addEventListener('focus', () => {
        ultimo = i;
        anillos.forEach((b) => { b.el.tabIndex = b === a && !abierto ? 0 : -1; });
      });
      a.el.addEventListener('keydown', (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key;
        let hecho = true;
        if (k === 'ArrowUp') mover(i, 1);
        else if (k === 'ArrowDown') mover(i, -1);
        else if (k === 'ArrowRight') enfocar(i + 1);
        else if (k === 'ArrowLeft' || k === 'Backspace') enfocar(i - 1);
        else if (k === 'Home') poner(i, 0);
        else if (k === 'End') poner(i, nL - 1);
        else if (k === 'PageUp') mover(i, 5);
        else if (k === 'PageDown') mover(i, -5);
        else if (k === 'Enter') probar();
        else {
          const idx = letraDe(k);
          if (idx < 0) hecho = false;
          else { poner(i, idx); if (i < nA - 1) enfocar(i + 1); }
        }
        if (hecho) { e.preventDefault(); e.stopPropagation(); }
      });
      // arrastre vertical (mouse y dedo); un toque sin arrastrar trae la letra tocada a la línea
      a.el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        a.el.focus({ preventScroll: true });
        if (quieto()) return;
        try { a.el.setPointerCapture(e.pointerId); } catch {}
        a.arrastre = { id: e.pointerId, y0: e.clientY, pos0: a.pos, s: escala(), movido: false, muestras: [[e.timeStamp, e.clientY]] };
        a.v = 0;
        raiz.classList.add('arrastrando');
      });
      a.el.addEventListener('pointermove', (e) => {
        const d = a.arrastre;
        if (!d || d.id !== e.pointerId) return;
        const dy = (e.clientY - d.y0) / d.s;
        if (Math.abs(dy) > 4) d.movido = true;
        if (!d.movido) return;
        a.pos = d.pos0 - dy / (K.paso / K.k);
        d.muestras.push([e.timeStamp, e.clientY]);
        while (d.muestras.length > 2 && e.timeStamp - d.muestras[0][0] > 90) d.muestras.shift();
        if (a.pos !== a.pintada) { pintarAnillo(a); componer(performance.now()); }
      });
      const soltar = (e, cancelado) => {
        const d = a.arrastre;
        if (!d || d.id !== e.pointerId) return;
        a.arrastre = null;
        raiz.classList.remove('arrastrando');
        const pasoCss = K.paso / K.k;
        if (!d.movido) {
          if (cancelado) return;
          // toque: la letra tocada viene a la línea de lectura
          const r = a.el.getBoundingClientRect();
          const s = clamp((e.clientY - (r.top + r.height / 2)) / (r.height / 2), -0.97, 0.97);
          mover(i, Math.round(Math.asin(s) / PASO_ANG));
          return;
        }
        let vel = 0; // letras por segundo
        const m = d.muestras;
        if (!cancelado && m.length > 1) {
          const [t0, y0] = m[0], [t1, y1] = m[m.length - 1];
          if (t1 - t0 > 0 && e.timeStamp - t1 < 80) vel = -((y1 - y0) / d.s / (t1 - t0)) * 1000 / pasoCss;
        }
        vel = clamp(vel, -40, 40);
        const extra = clamp(Math.round(a.pos + vel * 0.11) - Math.round(a.pos), -nL, nL);
        a.target = Math.round(a.pos) + extra;
        a.v = reduced.matches ? 0 : vel;
        aria(a);
        arrancar();
      };
      a.el.addEventListener('pointerup', (e) => soltar(e, false));
      a.el.addEventListener('pointercancel', (e) => soltar(e, true));
      a.el.addEventListener('lostpointercapture', (e) => soltar(e, true));
      // rueda: un "clic" de la rueda = una letra; en el trackpad se va sumando
      a.el.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault();
        if (quieto()) return;
        const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 300 : 1);
        if (Math.abs(dy) >= 50) { a.rueda = 0; mover(i, Math.sign(dy)); return; }
        a.rueda += dy;
        clearTimeout(a.ruedaT);
        a.ruedaT = setTimeout(() => { a.rueda = 0; }, 260);
        if (Math.abs(a.rueda) >= 50) { mover(i, Math.sign(a.rueda)); a.rueda = 0; }
      }, { passive: false });
      // flechitas: un toque = una letra; mantenido, sigue girando
      for (const [b, d] of [[a.arriba, 1], [a.abajo, -1]]) {
        let rep = 0, tocada = 0;
        const parar = () => { clearTimeout(rep); rep = 0; };
        b.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.preventDefault();
          a.el.focus({ preventScroll: true });
          mover(i, d);
          const seguir = (ms) => { rep = setTimeout(() => { mover(i, d); seguir(110); }, ms); };
          parar();
          seguir(420);
        });
        b.addEventListener('pointerup', (e) => { parar(); tocada = e.timeStamp; });
        b.addEventListener('pointerleave', parar);
        b.addEventListener('pointercancel', parar);
        b.addEventListener('click', (e) => { // el clic que sigue al toque ya se contó; este es de teclado o lector
          if (tocada && e.timeStamp - tocada < 600) { tocada = 0; return; }
          mover(i, d);
        });
      }
    });

    // ---------- Abrir ----------
    function mensaje(texto) {
      msg.textContent = texto;
      msg.classList.add('visible');
      clearTimeout(msgT);
      msgT = setTimeout(() => msg.classList.remove('visible'), 2600);
    }
    function resorteTapas(target, k, zeta) {
      tapas.target = target;
      tapas.k = k;
      tapas.c = 2 * zeta * Math.sqrt(k);
      arrancar();
    }
    async function probar() {
      if (abierto || probando || destruido) return;
      probando = true;
      raiz.classList.add('probando');
      raiz.setAttribute('aria-busy', 'true');
      boton.disabled = true;
      msg.classList.remove('visible');
      if (K) resorteTapas(K.D * 0.035, 380, 0.5); // tira de las tapas mientras pregunta
      let ok = false;
      try { ok = !!(await (typeof opts.onTry === 'function' ? opts.onTry(palabra()) : false)); } catch { ok = false; }
      if (destruido) return;
      probando = false;
      raiz.classList.remove('probando');
      raiz.removeAttribute('aria-busy');
      boton.disabled = false;
      if (abierto) return; // mientras esperábamos ya llegó abierto (setOpen)
      if (ok) abrir(true);
      else noCede();
    }
    function noCede() {
      resorteTapas(0, 420, 0.35);
      if (!reduced.matches) { sacudida = performance.now(); tapas.v = -K.D * 0.6; }
      arrancar();
      mensaje('No cede.');
    }
    function abrir(animar) {
      abierto = true;
      const enFoco = raiz.contains(document.activeElement);
      raiz.classList.toggle('ya-abierto', !animar);
      raiz.classList.add('abierto');
      anillos.forEach((a) => { a.el.tabIndex = -1; a.el.setAttribute('aria-disabled', 'true'); });
      if (K) {
        if (!animar || reduced.matches) { tapas.x = tapas.target = K.abre; tapas.v = 0; }
        else { resorteTapas(K.abre, 55, 0.95); brillo = performance.now() + 120; }
      }
      aviso.textContent = 'Se abrió el cryptex: adentro hay un pergamino enrollado.';
      if (enFoco) setTimeout(() => { if (abierto && !destruido) pergamino.focus({ preventScroll: true }); }, animar ? 450 : 0);
      if (K && cache) arrancar();
    }
    function cerrar() {
      abierto = false;
      raiz.classList.remove('abierto', 'ya-abierto');
      anillos.forEach((a, i) => { a.el.tabIndex = i === ultimo ? 0 : -1; a.el.removeAttribute('aria-disabled'); });
      aviso.textContent = '';
      if (K) resorteTapas(0, 160, 0.9);
    }

    boton.addEventListener('click', probar);
    pergamino.addEventListener('click', () => {
      if (abierto && typeof opts.onScroll === 'function') opts.onScroll();
    });

    // tironear las tapas hacia afuera
    tapasEl.forEach((t, lado) => {
      const dir = lado ? 1 : -1;
      t.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        if (quieto() || !K) return;
        try { t.setPointerCapture(e.pointerId); } catch {}
        tapas.arrastre = { id: e.pointerId, x0: e.clientX, s: escala(), d: 0 };
      });
      t.addEventListener('pointermove', (e) => {
        const d = tapas.arrastre;
        if (!d || d.id !== e.pointerId) return;
        d.d = Math.max(0, ((e.clientX - d.x0) / d.s) * dir) * K.k; // px del lienzo, hacia afuera
        const tope = K.D * 0.07;
        tapas.x = tope * (1 - Math.exp(-d.d / tope)); // cede un poquito y nada más
        tapas.v = 0;
        componer(performance.now());
      });
      const soltar = (e, cancelado) => {
        const d = tapas.arrastre;
        if (!d || d.id !== e.pointerId) return;
        tapas.arrastre = null;
        if (cancelado) resorteTapas(0, 420, 0.45);
        else if (d.d > K.D * 0.12) probar();
        else if (d.d < 4 * K.k) { // un toque: un tironcito y la pista de cómo se abre
          tapas.v = K.D * 0.5;
          resorteTapas(0, 420, 0.35);
          mensaje('Tirá de las tapas hacia afuera, o tocá «Abrir».');
        } else resorteTapas(0, 420, 0.45);
      };
      t.addEventListener('pointerup', (e) => soltar(e, false));
      t.addEventListener('pointercancel', (e) => soltar(e, true));
      t.addEventListener('lostpointercapture', (e) => soltar(e, true));
    });

    // ---------- Arranque ----------
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => requestAnimationFrame(relayout)) : null;
    if (ro) ro.observe(escena);
    const alCambiar = () => relayout();
    window.addEventListener('resize', alCambiar);
    const alMovimiento = () => { if (reduced.matches) arrancar(); };
    if (reduced.addEventListener) reduced.addEventListener('change', alMovimiento);

    if (opts.open) abrir(false);
    // espera un ratito la fuente (Cinzel); si tarda, dibuja con la de reserva y redibuja al llegar
    Promise.race([cargarFuente(), new Promise((ok) => setTimeout(() => ok(null), 450))]).then(() => {
      if (destruido) return;
      iniciado = true;
      relayout();
      cargarFuente().then((llego) => { if (llego && !destruido && !conFuente) { cache = null; relayout(); } });
    });

    const api = {
      el: raiz,
      setOpen(v) {
        v = !!v;
        if (destruido || v === abierto) return;
        if (v) abrir(true); else cerrar();
      },
      focus() {
        // si el host lo llama mientras su modal todavía aparece (oculto), el foco no entra: se reintenta unos cuadros
        let n = 0;
        const intentar = () => {
          if (destruido || (n && raiz.contains(document.activeElement))) return;
          const el = abierto ? pergamino : anillos[clamp(ultimo, 0, nA - 1)].el;
          el.focus({ preventScroll: true });
          if (document.activeElement !== el && ++n < 40) requestAnimationFrame(intentar);
        };
        intentar();
      },
      destroy() {
        if (destruido) return;
        destruido = true;
        guardar();
        cancelAnimationFrame(raf);
        clearTimeout(msgT);
        anillos.forEach((a) => clearTimeout(a.ruedaT));
        if (ro) ro.disconnect();
        window.removeEventListener('resize', alCambiar);
        if (reduced.removeEventListener) reduced.removeEventListener('change', alMovimiento);
        raiz.remove();
      },
      get value() { return palabra(); },
    };
    return api;
  }

  // Pergamino enrollado, atado con una cinta y sellado con lacre
  function pergaminoSVG(n) {
    const i = (s) => `crx-${s}-${n}`;
    return `<svg viewBox="0 0 340 100" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="${i('cu')}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#7a5a31"/><stop offset=".09" stop-color="#cfb27c"/>
          <stop offset=".3" stop-color="#f8edcf"/><stop offset=".52" stop-color="#ead4a4"/>
          <stop offset=".8" stop-color="#bd9860"/><stop offset="1" stop-color="#5b3f1f"/>
        </linearGradient>
        <linearGradient id="${i('ho')}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f6e7c2"/><stop offset="1" stop-color="#c7a46c"/>
        </linearGradient>
        <linearGradient id="${i('ci')}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3f0805"/><stop offset=".22" stop-color="#9b1c15"/>
          <stop offset=".4" stop-color="#d63d30"/><stop offset=".7" stop-color="#9a1c15"/><stop offset="1" stop-color="#360604"/>
        </linearGradient>
        <radialGradient id="${i('se')}" cx=".38" cy=".34" r=".72">
          <stop offset="0" stop-color="#dc5546"/><stop offset=".55" stop-color="#951d14"/><stop offset="1" stop-color="#4a0905"/>
        </radialGradient>
        <radialGradient id="${i('pu')}" cx=".5" cy=".5" r=".55">
          <stop offset="0" stop-color="#e2cc9c"/><stop offset=".75" stop-color="#c29e66"/><stop offset="1" stop-color="#7c5c31"/>
        </radialGradient>
        <radialGradient id="${i('br')}" cx=".5" cy=".5" r=".5">
          <stop offset="0" stop-color="rgba(255,226,160,.9)"/><stop offset="1" stop-color="rgba(255,226,160,0)"/>
        </radialGradient>
        <filter id="${i('pa')}" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1 .22" numOctaves="2" seed="4"/>
          <feColorMatrix values="0 0 0 0 .36  0 0 0 0 .24  0 0 0 0 .1  0 0 0 .7 -.22"/>
        </filter>
        <clipPath id="${i('cl')}"><rect x="22" y="22" width="296" height="56" rx="6"/></clipPath>
      </defs>
      <ellipse class="crx-brillo" cx="170" cy="50" rx="175" ry="52" fill="url(#${i('br')})" opacity="0"/>
      <rect x="22" y="22" width="296" height="56" rx="6" fill="url(#${i('cu')})"/>
      <rect x="22" y="22" width="296" height="56" filter="url(#${i('pa')})" clip-path="url(#${i('cl')})"/>
      <path d="M28 63c60 5 150-4 286 2v9c-120-5-220 4-286-2z" fill="url(#${i('ho')})" opacity=".9"/>
      <path d="M28 63c60 5 150-4 286 2" fill="none" stroke="#8a6638" stroke-width="1.1" opacity=".75"/>
      <path d="M40 30c80-3 180 2 270-1" fill="none" stroke="#fffaf0" stroke-width="2" opacity=".35" stroke-linecap="round"/>
      <ellipse cx="22" cy="50" rx="7.5" ry="28" fill="url(#${i('pu')})" stroke="#7c5c31" stroke-width="1"/>
      <path d="M22 26a5.5 24 0 1 1 0 48a4.5 19 0 1 1 0-38a3.5 14 0 1 1 0 28a2.5 9 0 1 1 0-18" fill="none" stroke="#8d6b3b" stroke-width="1" opacity=".85"/>
      <ellipse cx="318" cy="50" rx="7.5" ry="28" fill="url(#${i('pu')})" stroke="#7c5c31" stroke-width="1"/>
      <path d="M318 26a5.5 24 0 1 0 0 48a4.5 19 0 1 0 0-38a3.5 14 0 1 0 0 28a2.5 9 0 1 0 0-18" fill="none" stroke="#8d6b3b" stroke-width="1" opacity=".85"/>
      <rect x="160" y="20" width="20" height="60" fill="url(#${i('ci')})"/>
      <path d="M170 60l-15 30 8-2 3 8zM170 60l13 31-8-2-4 7z" fill="#8c1912"/>
      <path d="M170 60l-15 30 8-2z" fill="#b2281f" opacity=".7"/>
      <circle cx="170" cy="60" r="12.5" fill="url(#${i('se')})"/>
      <circle cx="170" cy="60" r="8.6" fill="none" stroke="rgba(255,190,170,.35)" stroke-width="1.3"/>
      <text x="170" y="64.3" text-anchor="middle" font-family="Cinzel, 'Times New Roman', serif" font-weight="700" font-size="11" fill="rgba(70,6,3,.75)">M</text>
    </svg>`;
  }

  window.Cryptex = { mount };
})();
