// Rosa blanca de la portada: abajo a la derecha hay una rosa blanca apoyada en el paño, como la
// carpeta, la lupa y el tintero. Al tocarla se le mueven los pétalos (una onda suave, como un
// soplido) y queda igual que antes. No hace nada más.
(() => {
  const stage = document.querySelector('.stage');
  const layer = document.getElementById('rosa');
  if (!stage || !layer) return;

  // Medidas en unidades de la portada (1 u = 1 px de fondo.webp, 1821 x 1025)
  const IMG_W = 1821;
  const FOTO = { x: 1578, y: 752 };  // centro de la flor en la foto (rincón libre: x 1420–1815, y 560–1020)
  const ESCALA = 1.22;               // el modelo se arma más chico; en la foto la flor mide ~250 u de ancho
  const GIRO_H = 48, GIRO_V = 72;    // hacia dónde sale el tallo (grados; 0 = a la derecha, 90 = abajo)
  const MARGEN = 6;                  // al borde de la ventana
  const ANCHO_V = 0.24;              // en el celular, a lo sumo este ancho (el rompecabezas va al medio)
  const K_MAX = 1.25;                // px del lienzo por unidad (la foto tiene 1: más no suma detalle)
  // Lo que no hay que tapar en la foto: la carpeta con los papeles y la lupa (polígono convexo)
  const CARPETA = [[975, 118], [1019, 118], [1099, 178], [1265, 476], [1396, 768], [1389, 792], [1384, 798],
    [1189, 851], [799, 949], [728, 949], [714, 941], [541, 288], [532, 253], [548, 244], [615, 222]];

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const rad = (d) => (d * Math.PI) / 180;
  const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const portrait = matchMedia('(max-aspect-ratio: 1 / 1)');
  const onChange = (mq, fn) => (mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn));

  // La luz de la foto viene de arriba y un poco de la derecha: la carpeta hace sombra abajo y a su
  // izquierda (arriba y a la derecha casi nada), y la lupa, del lado de abajo a la izquierda del
  // mango (igual que el cryptex). Está a unos 40° de altura, y es suave, de ventana grande
  const LUZ = unit([0.345, -0.683, 0.643]);
  const LH = Math.hypot(LUZ[0], LUZ[1]);
  const LX = LUZ[0] / LH, LY = LUZ[1] / LH, TAN_E = LUZ[2] / LH; // hacia la luz, en el plano; pendiente
  const MEDIO = unit([LUZ[0], LUZ[1], LUZ[2] + 1]);                // entre la luz y la cámara (brillos)

  // Azar con semilla (la rosa sale siempre igual) y un ruido suave para las texturas
  const azar = (semilla) => () => {
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hash = (x, y) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const ruido = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return mix(mix(hash(xi, yi), hash(xi + 1, yi), u), mix(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
  };

  // ---------- La rosa, en 3D (u; el centro de la flor en 0, 0; z para arriba) ----------
  // Cada pétalo es una lámina: sale del centro, sube y se abre (más los de afuera), se ahueca a lo
  // ancho, y cerca de la punta los bordes se enrollan hacia atrás. Los de adentro se envuelven
  // alrededor del centro. Se dibujan vistos desde arriba, como todo en la foto.
  const N_PET = 30;
  const elev = (d, s) => mix(d.a0, d.a1, smooth(0, 0.8, s)) - d.refl * smooth(0.5, 1.02, s) ** 1.4;
  function anchoPetalo(d, s) {
    if (s <= d.sm) return d.W * (0.14 + 0.86 * Math.sin((Math.PI / 2) * (s / d.sm)) ** 0.8);
    const q = (s - d.sm) / (1 - d.sm);
    // (los de afuera, con la punta más redonda: anchos como son, si no quedaban como un bloque)
    const af = smooth(0, 0.3, d.p);
    return d.W * Math.max(0, 1 - q ** mix(1.5, 2, af)) ** mix(0.95, 0.55, af);
  }
  function anchoSepalo(d, s, lado) {
    let w = d.W * (1 - s) ** 1.15 * (0.55 + 0.45 * smooth(0, 0.12, s));
    for (const [s0, l, a] of d.lobulos) if (l === lado) w += a * Math.exp(-(((s - s0) / 0.035) ** 2));
    return w;
  }

  function disenioPetalos() {
    const rnd = azar(11);
    const j = () => rnd() * 2 - 1;
    const out = [];
    for (let k = 0; k < N_PET; k++) {
      const p = k / (N_PET - 1); // 0: los de afuera .. 1: el centro
      out.push({
        tipo: 'petalo', k, p,
        // espiral (ángulo de oro), apenas desparejo; los del centro, más (si no, armaban un
        // triángulo prolijo, como una pirámide)
        th: 0.7 + k * 2.39996 + j() * (0.12 + 0.9 * smooth(0.8, 1, p)),
        len: mix(100, 30, p ** 0.85) * (1 + 0.1 * j()),
        W: mix(58, 22, p ** 0.8) * (1 + 0.1 * j()),
        rb: mix(12, 0.3, p ** 0.9),
        zb: mix(8, 16, p),
        a0: rad(mix(30, 88, p ** 0.55) + 5 * j()),
        a1: rad(mix(-12, 82, p ** 0.75) + 8 * j()),
        refl: rad(mix(34, 28, p ** 0.8) * (1 + 0.25 * j())),
        // los del centro, menos envueltos y más ahuecados: un pimpollo que se enrosca
        cup: mix(1.5, 0.7, p) * (1 + 0.2 * j()) * (1 + 1.2 * smooth(0.8, 1, p)),
        wrap: smooth(0.25, 0.8, p) - 0.3 * smooth(0.8, 1, p),
        roll: mix(1.45, 0.6, p ** 0.8) * (1 + 0.3 * j()),
        asim: 0.35 * j(),
        rw: mix(0.36, 0.3, p),
        ruf: mix(3.2, 0.8, p),
        fase: rnd() * 6.28,
        sm: mix(0.58, 0.7, p),
      });
    }
    return out;
  }

  // Lámina de pétalo o de sépalo: P (x, y, z) y ST (s a lo largo, t a lo ancho) de cada punto
  function lamina(d) {
    const ns = Math.round(clamp(d.len / 2, 16, 52)), h = Math.round(clamp(d.W / 2, 7, 22)), nt = 2 * h;
    const P = new Float32Array((ns + 1) * (nt + 1) * 3), ST = new Float32Array((ns + 1) * (nt + 1) * 2);
    const c = Math.cos(d.th), sn = Math.sin(d.th);
    let r = d.rb, z = d.zb;
    const ds = 1 / ns;
    for (let i = 0; i <= ns; i++) {
      const s = i * ds, a = elev(d, s), ca = Math.cos(a), sa = Math.sin(a);
      const mx = r * c, my = r * sn;
      const Nx = -sa * c, Ny = -sa * sn, Nz = ca; // hacia adentro / arriba (la cara de adentro)
      const kCup = d.cup / d.W;
      const kWrap = (d.wrap * sa) / Math.max(r, 2);
      let w = d.tipo === 'sepalo' ? 0 : anchoPetalo(d, s);
      // los del centro no pueden envolverse más de ~140° para cada lado (se cruzarían)
      if (kWrap * w > 2.5) w = 2.5 / kWrap;
      const roll = d.roll * (smooth(0.3, 0.95, s) + 0.35 * smooth(0.8, 1, s));
      // cerca de la punta se enrolla más del ancho: de ahí la punta aguzada de los pétalos
      const rw = Math.min(0.7, d.rw * (1 + 0.7 * smooth(0.6, 1, s)));
      for (const lado of [-1, 1]) {
        const wl = d.tipo === 'sepalo' ? anchoSepalo(d, s, lado) : w;
        // (más de ~115° no se ve: queda debajo, y de canto la malla haría dientes oscuros)
        const rollL = Math.min(0.64, roll * (1 + lado * d.asim));
        let phi = d.pliegue || 0, A = 0, B = 0;
        const dsig = wl / h;
        for (let jj = 0; jj <= h; jj++) {
          const q = jj / h;
          // el borde, ondulado
          const onda = d.ruf * (Math.sin(d.fase + lado * 1.7 + q * 5.5 + s * 4) + 0.6 * Math.sin(d.fase * 2 + lado + s * 9 + q * 2))
            * smooth(0.35, 1, s) * q * q;
          const idx = i * (nt + 1) + h + lado * jj;
          P[idx * 3] = mx + lado * A * -sn + (B + onda) * Nx;
          P[idx * 3 + 1] = my + lado * A * c + (B + onda) * Ny;
          P[idx * 3 + 2] = z + (B + onda) * Nz;
          ST[idx * 2] = s; ST[idx * 2 + 1] = lado * q;
          const m = smooth(1 - rw, 1 - rw * 0.25, (jj + 0.5) / h);
          const kap = (kWrap + kCup) * (1 - m) - (m * rollL * Math.PI) / (0.62 * rw * Math.max(wl, 1e-3));
          const pm = phi + 0.5 * kap * dsig;
          A += Math.cos(pm) * dsig; B += Math.sin(pm) * dsig;
          phi += kap * dsig;
        }
      }
      const a2 = elev(d, s + ds * 0.5);
      r += Math.cos(a2) * ds * d.len; z += Math.sin(a2) * ds * d.len;
    }
    return { ns, nt, P, ST, signo: 1, d };
  }

  // El tallo: un tubo acostado que sale de abajo de la flor (se ve la mitad de arriba)
  const TALLO = { largo: 400, r: 6, z0: 13 };
  const ejeTallo = (u) => [u, 7 * Math.sin(u / 95) - 0.015 * u, TALLO.r + (TALLO.z0 - TALLO.r) * (1 - smooth(15, 120, u))];
  function tubo(eje, u0, u1, radio, ns, d) {
    const nt = 14;
    const P = new Float32Array((ns + 1) * (nt + 1) * 3), ST = new Float32Array((ns + 1) * (nt + 1) * 2);
    for (let i = 0; i <= ns; i++) {
      const s = i / ns;
      const u = mix(u0, u1, s), a = eje(u), b = eje(u + 0.5);
      const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
      const sx = -ty / tl, sy = tx / tl; // de costado (horizontal)
      const R = radio(s);
      for (let j = 0; j <= nt; j++) {
        const f = -0.25 + (Math.PI + 0.5) * (j / nt); // la mitad de arriba (y un poco más)
        const q = (i * (nt + 1) + j) * 3;
        P[q] = a[0] + R * Math.cos(f) * sx;
        P[q + 1] = a[1] + R * Math.cos(f) * sy;
        P[q + 2] = a[2] + R * Math.sin(f);
        ST[(i * (nt + 1) + j) * 2] = s; ST[(i * (nt + 1) + j) * 2 + 1] = (j / nt) * 2 - 1;
      }
    }
    return { ns, nt, P, ST, signo: -1, d };
  }
  // Espina: un cono chato, apenas curvado hacia la punta del tallo
  function espina(u, lado) {
    const a = ejeTallo(u), b = ejeTallo(u + 0.5);
    const tl = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const tx = (b[0] - a[0]) / tl, ty = (b[1] - a[1]) / tl, sx = -ty * lado, sy = tx * lado;
    const D = unit([sx * 0.8 + tx * 0.55, sy * 0.8 + ty * 0.55, 0.15]);
    const base = [a[0] + sx * TALLO.r * 0.7, a[1] + sy * TALLO.r * 0.7, a[2] + 1.5];
    const E1 = unit([-D[1], D[0], 0]), E2 = [D[1] * E1[2] - D[2] * E1[1], D[2] * E1[0] - D[0] * E1[2], D[0] * E1[1] - D[1] * E1[0]];
    const ns = 10, nt = 14, P = new Float32Array((ns + 1) * (nt + 1) * 3), ST = new Float32Array((ns + 1) * (nt + 1) * 2);
    for (let i = 0; i <= ns; i++) {
      const s = i / ns, R = 3.4 * (1 - s) ** 1.4, L = 9 * s;
      for (let j = 0; j <= nt; j++) {
        const f = (j / nt) * Math.PI * 2, q = (i * (nt + 1) + j) * 3;
        P[q] = base[0] + D[0] * L + R * (Math.cos(f) * E1[0] + Math.sin(f) * E2[0]) + tx * 1.5 * s * s;
        P[q + 1] = base[1] + D[1] * L + R * (Math.cos(f) * E1[1] + Math.sin(f) * E2[1]) + ty * 1.5 * s * s;
        P[q + 2] = base[2] + D[2] * L + R * (Math.cos(f) * E1[2] + Math.sin(f) * E2[2]);
        ST[(i * (nt + 1) + j) * 2] = s; ST[(i * (nt + 1) + j) * 2 + 1] = j / nt;
      }
    }
    return { ns, nt, P, ST, signo: 0, d: { tipo: 'espina' } }; // signo 0: se orienta solo (hacia arriba)
  }
  // Hojita (folíolo) acostada sobre el paño: plegada en V por la nervadura, con dientes en el borde
  function hojita(x, y, z, ang, len, W, seed) {
    const rnd = azar(seed);
    const d = { tipo: 'hoja', fase: rnd() * 6.28, dientes: 13 + Math.round(rnd() * 4), curva: (rnd() - 0.5) * 0.35, seed };
    const ns = Math.round(clamp(len * 1.15, 40, 110)), h = 12, nt = 2 * h;
    const P = new Float32Array((ns + 1) * (nt + 1) * 3), ST = new Float32Array((ns + 1) * (nt + 1) * 2);
    let mx = x, my = y;
    for (let i = 0; i <= ns; i++) {
      const s = i / ns;
      const psi = ang + d.curva * (s - 0.3);
      const c = Math.cos(psi), sn = Math.sin(psi);
      const mz = z + 2.6 * Math.sin(Math.PI * s) * (1 - s * 0.5) - 1.2 * s * s;
      const forma = Math.sin(Math.PI * Math.min(1, s ** 0.78)) ** 0.75;
      for (const lado of [-1, 1]) {
        const dient = ((s * d.dientes + (lado > 0 ? 0 : 0.5) + d.fase) % 1) ** 2;
        const wl = W * forma * (1 - 0.09 * dient * smooth(0.06, 0.2, s));
        let phi = rad(13), A = 0, B = 0;
        const dsig = wl / h;
        for (let jj = 0; jj <= h; jj++) {
          const q = jj / h, idx = i * (nt + 1) + h + lado * jj;
          const onda = 0.9 * Math.sin(d.fase + s * 9 + lado) * q * q;
          P[idx * 3] = mx + lado * A * -sn;
          P[idx * 3 + 1] = my + lado * A * c;
          P[idx * 3 + 2] = Math.max(0.6, mz + B + onda);
          ST[idx * 2] = s; ST[idx * 2 + 1] = lado * q;
          const kap = -0.9 / W * smooth(0.4, 1, q);
          const pm = phi + 0.5 * kap * dsig;
          A += Math.cos(pm) * dsig; B += Math.sin(pm) * dsig; phi += kap * dsig;
        }
      }
      mx += c * len / ns; my += sn * len / ns;
    }
    return { ns, nt, P, ST, signo: 1, d };
  }
  // Una hoja de rosa: el cabito (raquis) y tres folíolos
  function hoja(uNodo, lado, angRel, raq, fol, seed) {
    const a = ejeTallo(uNodo), b = ejeTallo(uNodo + 0.5);
    const t0 = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const ang = t0 + lado * rad(angRel);
    const ox = a[0] - Math.sin(t0) * TALLO.r * 0.6 * lado, oy = a[1] + Math.cos(t0) * TALLO.r * 0.6 * lado;
    const eje = (u) => {
      const t = ang + lado * u * 0.004; // (apenas curvo) y baja del tallo hasta el paño
      return [ox + Math.cos(t) * u, oy + Math.sin(t) * u, 1.6 + (a[2] - 1.6) * (1 - smooth(0, 18, u))];
    };
    const out = [tubo(eje, 0, raq, (s) => 1.7 - 0.5 * s, 16, { tipo: 'raquis' })];
    for (const [pos, rel, len, W] of fol) {
      const p = eje(pos);
      out.push(hojita(p[0], p[1], 2.1, ang + lado * rad(rel), len, W, seed++));
    }
    return out;
  }

  // Los sépalos: asoman apenas entre los pétalos de afuera
  function disenioSepalos() {
    const out = [];
    const rnd = azar(5);
    for (let i = 0; i < 5; i++) {
      const th = 0.7 + 1.2 + i * 1.2566 + (rnd() - 0.5) * 0.25;
      out.push(lamina({
        tipo: 'sepalo', th, len: 98 + rnd() * 10, W: 13, rb: 9, zb: 7,
        a0: rad(-4), a1: rad(-16), refl: rad(10), cup: 0.4, wrap: 0, roll: 0.25, asim: 0, rw: 0.4,
        ruf: 0.6, fase: rnd() * 6, sm: 0.5,
        lobulos: i % 2 ? [[0.62, 1, 5], [0.74, -1, 4], [0.84, 1, 3]] : [[0.7, -1, 4.5], [0.82, 1, 3.5]],
      }));
    }
    return out;
  }
  // La flor está apenas recostada (la cara mira un poco hacia el lado contrario al tallo, como
  // cuando una rosa se apoya en la mesa): se la inclina y se la sube hasta que toque el paño
  const INCLINA = rad(9);
  function inclinar(sups) {
    const c = Math.cos(INCLINA), sn = Math.sin(INCLINA), zc = 8;
    let min = Infinity;
    for (const S of sups) {
      for (let q = 0; q < S.P.length; q += 3) {
        const x = S.P[q], z = S.P[q + 2] - zc;
        S.P[q] = x * c - z * sn; S.P[q + 2] = x * sn + z * c + zc;
        min = Math.min(min, S.P[q + 2]);
      }
    }
    const sube = Math.max(0, 1.5 - min);
    for (const S of sups) for (let q = 2; q < S.P.length; q += 3) S.P[q] += sube;
    return zc + sube; // a qué altura queda el cáliz (de ahí sale el tallo)
  }
  // Lo que no se mueve, además de los sépalos: el tallo, las espinas y las hojas
  function disenioQuieto() {
    const out = [];
    out.push(tubo(ejeTallo, 18, TALLO.largo, (s) => TALLO.r * (1 + 0.08 * s), 70, { tipo: 'tallo' }));
    out.push(espina(168, 1), espina(232, -1), espina(305, 1));
    out.push(...hoja(170, 1, 52, 66, [[24, -58, 52, 19], [24, 52, 50, 18], [66, 4, 70, 25]], 21));
    out.push(...hoja(262, -1, 44, 50, [[18, -55, 40, 15], [18, 50, 38, 14], [50, 6, 54, 19]], 41));
    return out;
  }

  // Copia girada y a escala de cada superficie (y su caja)
  function preparar(S0, giro) {
    const c = Math.cos(giro) * ESCALA, sn = Math.sin(giro) * ESCALA;
    const P = new Float32Array(S0.P.length);
    const caja = [Infinity, Infinity, -Infinity, -Infinity];
    for (let q = 0; q < P.length; q += 3) {
      const x = S0.P[q], y = S0.P[q + 1];
      P[q] = x * c - y * sn; P[q + 1] = x * sn + y * c; P[q + 2] = S0.P[q + 2] * ESCALA;
      if (P[q] < caja[0]) caja[0] = P[q];
      if (P[q] > caja[2]) caja[2] = P[q];
      if (P[q + 1] < caja[1]) caja[1] = P[q + 1];
      if (P[q + 1] > caja[3]) caja[3] = P[q + 1];
    }
    return { ...S0, P, caja };
  }
  // Sus normales y sus triángulos (recién al pintar: para ubicarla alcanza con la caja)
  function completar(S) {
    if (S.T) return;
    const { ns, nt, P } = S, w = nt + 1;
    const N = new Float32Array(P.length);
    let orient = S.signo;
    for (let i = 0; i <= ns; i++) {
      for (let j = 0; j <= nt; j++) {
        const q = (i * w + j) * 3;
        const a = (Math.min(ns, i + 1) * w + j) * 3, b = (Math.max(0, i - 1) * w + j) * 3;
        const e = (i * w + Math.min(nt, j + 1)) * 3, f = (i * w + Math.max(0, j - 1)) * 3;
        const ux = P[a] - P[b], uy = P[a + 1] - P[b + 1], uz = P[a + 2] - P[b + 2];
        const vx = P[e] - P[f], vy = P[e + 1] - P[f + 1], vz = P[e + 2] - P[f + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-7) {
          if (i > 0) { nx = N[q - w * 3]; ny = N[q - w * 3 + 1]; nz = N[q - w * 3 + 2]; } else { nx = 0; ny = 0; nz = 1; }
        } else {
          if (!orient) orient = nz >= 0 ? 1 : -1; // (las espinas: que mire para arriba)
          nx *= orient / l; ny *= orient / l; nz *= orient / l;
        }
        N[q] = nx; N[q + 1] = ny; N[q + 2] = nz;
      }
    }
    S.N = N;
    // triángulos y la caja de cada uno
    const nTri = ns * nt * 2;
    const T = new Uint32Array(nTri * 3), C = new Float32Array(nTri * 4);
    let t = 0;
    for (let i = 0; i < ns; i++) {
      for (let j = 0; j < nt; j++) {
        const a = i * w + j, b = a + w, cc = b + 1, dd = a + 1;
        for (const [p, q, r] of [[a, b, cc], [a, cc, dd]]) {
          T[t * 3] = p; T[t * 3 + 1] = q; T[t * 3 + 2] = r;
          const x0 = Math.min(P[p * 3], P[q * 3], P[r * 3]), x1 = Math.max(P[p * 3], P[q * 3], P[r * 3]);
          const y0 = Math.min(P[p * 3 + 1], P[q * 3 + 1], P[r * 3 + 1]), y1 = Math.max(P[p * 3 + 1], P[q * 3 + 1], P[r * 3 + 1]);
          C[t * 4] = x0; C[t * 4 + 1] = y0; C[t * 4 + 2] = x1; C[t * 4 + 3] = y1;
          t++;
        }
      }
    }
    S.T = T; S.C = C;
  }

  // la caja que encierra a varias superficies
  const unir = (sups) => sups.reduce((c, S) => [Math.min(c[0], S.caja[0]), Math.min(c[1], S.caja[1]),
    Math.max(c[2], S.caja[2]), Math.max(c[3], S.caja[3])], [Infinity, Infinity, -Infinity, -Infinity]);

  // La rosa armada para un giro dado (se guarda: girar el teléfono vuelve a usarla)
  const geos = new Map();
  let modelo = null;
  function* modelar() {
    const petalos = [];
    for (const d of disenioPetalos()) { petalos.push(lamina(d)); yield; }
    const sepalos = disenioSepalos();
    TALLO.z0 = inclinar([...petalos, ...sepalos]) + 2;
    yield;
    modelo = { petalos, quieto: [...sepalos, ...disenioQuieto()] };
    // girada para la compu y para el celular (para ubicarla hace falta saber cuánto ocupa)
    yield* girada(GIRO_H);
    yield* girada(GIRO_V);
  }
  const geometria = (giroGrados) => {
    if (!geos.has(giroGrados)) { const it = girada(giroGrados); while (!it.next().done); }
    return geos.get(giroGrados);
  };
  function* girada(giroGrados) {
    if (geos.has(giroGrados)) return;
    const g = rad(giroGrados);
    const petalos = [], quieto = [];
    for (const S of modelo.petalos) { petalos.push(preparar(S, g)); yield; }
    for (const S of modelo.quieto) { quieto.push(preparar(S, g)); yield; }
    const todas = [...petalos, ...quieto];
    const caja = unir(todas);
    let flor = 0, alto = 0;
    for (const S of petalos) {
      const P = S.P;
      for (let q = 0; q < P.length; q += 3) {
        const r2 = P[q] * P[q] + P[q + 1] * P[q + 1];
        if (r2 > flor) flor = r2;
        if (P[q + 2] > alto) alto = P[q + 2];
      }
    }
    flor = Math.sqrt(flor);
    // el lienzo: la rosa y su sombra (cae del lado contrario a la luz: abajo y un poco a la izquierda)
    const largo = alto / TAN_E + 20, sx = -largo * LX, sy = -largo * LY;
    const lienzo = { x: caja[0] - 4 + Math.min(0, sx), y: caja[1] - 4 + Math.min(0, sy),
      w: caja[2] - caja[0] + 8 + Math.abs(sx), h: caja[3] - caja[1] + 8 + Math.abs(sy) };
    // cada pétalo gira alrededor de su base (donde empieza su nervadura) y se acorta hacia ella
    for (const S of petalos) {
      const h = S.nt / 2, b0 = h * 3, b1 = (S.ns * (S.nt + 1) + h) * 3;
      S.base = [S.P[b0], S.P[b0 + 1]];
      const dx = S.P[b1] - S.base[0], dy = S.P[b1 + 1] - S.base[1], dl = Math.hypot(dx, dy) || 1;
      S.dir = [dx / dl, dy / dl];
      S.radio = Math.hypot(S.caja[0] + S.caja[2], S.caja[1] + S.caja[3]) / 2;
      // la luz como la ve el pétalo cuando se levanta (se cierra hacia el centro)
      const e = [-S.dir[1], S.dir[0], 0], b = rad(16), cb = Math.cos(b), sb = Math.sin(b);
      const ev = e[0] * LUZ[0] + e[1] * LUZ[1];
      const x = [e[1] * LUZ[2] - e[2] * LUZ[1], e[2] * LUZ[0] - e[0] * LUZ[2], e[0] * LUZ[1] - e[1] * LUZ[0]];
      S.luz2 = unit([0, 1, 2].map((k) => LUZ[k] * cb + x[k] * sb + e[k] * ev * (1 - cb)));
    }
    geos.set(giroGrados, { giro: giroGrados, petalos, quieto, todas, caja, flor, lienzo });
  }

  // ---------- Luz y sombra ----------
  // Mapas de alturas (vista desde arriba): de ahí salen la sombra que cae sobre cada cosa (y sobre
  // el paño) y la penumbra entre los pétalos. Un mapa: { A, W, H, x0, y0, hk } (A[y * W + x], en u).
  //
  // La altura de una superficie en la grilla del mapa M (solo en su caja; -Infinity donde no está)
  function alturaDe(S, M) {
    const hk = M.hk;
    const gx0 = Math.max(0, Math.floor((S.caja[0] - M.x0) * hk) - 1), gy0 = Math.max(0, Math.floor((S.caja[1] - M.y0) * hk) - 1);
    const gx1 = Math.min(M.W - 1, Math.ceil((S.caja[2] - M.x0) * hk) + 1), gy1 = Math.min(M.H - 1, Math.ceil((S.caja[3] - M.y0) * hk) + 1);
    const W = Math.max(1, gx1 - gx0 + 1), H = Math.max(1, gy1 - gy0 + 1);
    const A = new Float32Array(W * H).fill(-Infinity);
    const ox = M.x0 + gx0 / hk, oy = M.y0 + gy0 / hk;
    const { P, T } = S;
    for (let t = 0; t < T.length; t += 3) {
      const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
      const ax = (P[a] - ox) * hk, ay = (P[a + 1] - oy) * hk, bx = (P[b] - ox) * hk, by = (P[b + 1] - oy) * hk;
      const cx = (P[c] - ox) * hk, cy = (P[c + 1] - oy) * hk;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      const inv = 1 / area;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
          const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
          const z = w0 * P[a + 2] + w1 * P[b + 2] + w2 * P[c + 2];
          if (z > A[y * W + x]) A[y * W + x] = z;
        }
      }
    }
    // los pétalos parados se ven de canto (finitos): que no se pierdan. Solo con los puntos de
    // adentro (los del contorno engordarían el borde y harían puntitos de sombra)
    for (let i = 1; i < S.ns; i++) {
      for (let j = 1; j < S.nt; j++) {
        const q = (i * (S.nt + 1) + j) * 3;
        const x = Math.floor((P[q] - ox) * hk), y = Math.floor((P[q + 1] - oy) * hk);
        if (x >= 0 && y >= 0 && x < W && y < H && A[y * W + x] === -Infinity) A[y * W + x] = P[q + 2];
      }
    }
    return { A, W, H, gx0, gy0, x0: ox, y0: oy, hk };
  }
  const ENCIMA = 2.5; // lo que queda separado un pétalo del de abajo (u)
  // suaviza un mapa (así la penumbra no copia los escalones de la grilla)
  function suavizar(A, W, H) {
    const B = new Float32Array(A.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      B[i] = (2 * A[i] + (x > 0 ? A[i - 1] : A[i]) + (x < W - 1 ? A[i + 1] : A[i])) / 4;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      A[i] = (2 * B[i] + (y > 0 ? B[i - W] : B[i]) + (y < H - 1 ? B[i + W] : B[i])) / 4;
    }
  }
  // Los pétalos se dibujan uno encima del otro (de afuera hacia adentro). Donde dos se cruzan, el
  // que va encima se toma como más alto, así la luz y la sombra coinciden con lo que se ve.
  // Devuelve el mapa de todo (para el tallo, las hojas y el paño) y, por pétalo, su altura tal
  // cual (para su propia luz) y levantada sobre los de abajo (para la sombra que les hace a esos).
  function* mapas(G, hk) {
    const R = G.lienzo, W = Math.ceil(R.w * hk) + 2, H = Math.ceil(R.h * hk) + 2;
    const F = new Float32Array(W * H);
    const M = { A: F, W, H, x0: R.x, y0: R.y, hk };
    const sumar = (a, levantar) => {
      for (let y = 0; y < a.H; y++) {
        for (let x = 0; x < a.W; x++) {
          const i = y * a.W + x, g = (a.gy0 + y) * W + a.gx0 + x;
          if (a.A[i] === -Infinity) continue;
          if (levantar) a.A[i] = Math.max(a.A[i], F[g] + ENCIMA);
          if (a.A[i] > F[g]) F[g] = a.A[i];
        }
      }
    };
    for (const S of G.quieto) { sumar(alturaDe(S, M), false); yield; }
    const listo = (a) => {
      for (let i = 0; i < a.A.length; i++) if (a.A[i] === -Infinity) a.A[i] = 0;
      return a;
    };
    const tal = [], levantadas = [];
    for (const S of G.petalos) {
      const a = alturaDe(S, M);
      tal.push(listo({ ...a, A: a.A.slice() }));
      sumar(a, true);
      levantadas.push(listo(a));
      yield;
    }
    suavizar(F, W, H);
    return { M, tal, levantadas };
  }
  const altoEn = (M, x, y, A = M.A) => {
    const fx = (x - M.x0) * M.hk - 0.5, fy = (y - M.y0) * M.hk - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    if (ix < 0 || iy < 0 || ix >= M.W - 1 || iy >= M.H - 1) return 0;
    const tx = fx - ix, ty = fy - iy, q = iy * M.W + ix;
    return (A[q] * (1 - tx) + A[q + 1] * tx) * (1 - ty) + (A[q + M.W] * (1 - tx) + A[q + M.W + 1] * tx) * ty;
  };
  // Penumbra: cuánto tapan las cosas de alrededor (0 nada .. 1 en un pozo)
  const AO = [];
  let AO_W = 0;
  [[3.5, 0.6], [8.5, 1], [19, 0.9]].forEach(([d, w], k) => {
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 + k * 0.52; AO.push(Math.cos(a) * d, Math.sin(a) * d, 1 / d, w); AO_W += w; }
  });
  function oclusion(M, x, y, z) {
    const A = M.A, W = M.W, hk = M.hk, mx = M.W - 1, my = M.H - 1;
    const bx = (x - M.x0) * hk - 0.5, by = (y - M.y0) * hk - 0.5;
    let o = 0;
    for (let i = 0; i < AO.length; i += 4) {
      const fx = bx + AO[i] * hk, fy = by + AO[i + 1] * hk;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      if (ix < 0 || iy < 0 || ix >= mx || iy >= my) continue;
      const tx = fx - ix, ty = fy - iy, q = iy * W + ix;
      const h = (A[q] * (1 - tx) + A[q + 1] * tx) * (1 - ty) + (A[q + W] * (1 - tx) + A[q + W + 1] * tx) * ty;
      const v = (h - z - 0.5) * AO[i + 2];
      if (v > 0) o += AO[i + 3] * (v < 1 ? v : 1);
    }
    return o / AO_W;
  }
  // Sombra: se recorre el mapa desde el lado de la luz (de arriba hacia abajo) arrastrando la
  // altura del rayo de luz más bajo que pasa sin chocar (S) y desde qué distancia viene (D). Queda
  // continua (sin escalones) y con una penumbra que se abre con la distancia, como en la foto.
  // V y E: el rayo que llega a cada punto (aunque ya pase por debajo), para la penumbra.
  function sombras(M, x0 = 0, y0 = 0, x1 = M.W, y1 = M.H) {
    if (!M.S) for (const k of ['S', 'D', 'V', 'E']) M[k] = new Float32Array(M.A.length);
    const { A, S, D, V, E, W } = M;
    const paso = 1 / M.hk / -LY, corre = LX / -LY, baja = paso * TAN_E;
    // (se puede rehacer solo una parte: lo que queda arriba, o del lado de la luz, no cambia)
    for (let y = y0; y < y1; y++) {
      const j = (y - 1) * W;
      for (let x = x0; x < x1; x++) {
        const i = y * W + x;
        let s = -1e4, d = 0;
        if (y > 0) {
          const xs = x + corre, f = Math.floor(xs), t = xs - f;
          const a = j + clamp(f, 0, W - 1), b = j + clamp(f + 1, 0, W - 1);
          s = S[a] * (1 - t) + S[b] * t - baja;
          d = D[a] * (1 - t) + D[b] * t + paso;
        }
        V[i] = s; E[i] = d;
        if (A[i] >= s) { S[i] = A[i]; D[i] = 0; } else { S[i] = s; D[i] = d; }
      }
    }
  }
  function sombra(M, x, y, z) {
    const w = 0.9 + 0.2 * altoEn(M, x, y, M.E); // penumbra
    return smooth(-w, w, altoEn(M, x, y, M.V) - z - 0.7);
  }

  // ---------- Materiales ----------
  function material(S, s, t, atras, o) {
    const d = S.d, at = Math.abs(t);
    o.spec = 0.03; o.exp = 10; o.trans = 0; o.brillo = 0; o.alfa = 1; o.fino = 0;
    if (d.tipo === 'petalo') {
      const p = d.p;
      let r, g, b;
      if (!atras) {
        // crema en el fondo (amarillento), blanco hacia la punta
        const kb = smooth(0.0, 0.45, s), kt = smooth(0.55, 1, s);
        r = mix(0.93, 0.965, kb); g = mix(0.85, 0.94, kb); b = mix(0.58, 0.865, kb);
        r = mix(r, 0.972, kt); g = mix(g, 0.958, kt); b = mix(b, 0.91, kt);
        const cal = 0.6 * smooth(0.45, 1, p) * (1 - kt); // el centro, más crema
        r = mix(r, 0.955, cal); g = mix(g, 0.905, cal); b = mix(b, 0.74, cal);
      } else {
        const kb = smooth(0, 0.35, s);
        r = mix(0.82, 0.955, kb); g = mix(0.85, 0.95, kb); b = mix(0.64, 0.9, kb);
      }
      // nervaduras finitas que se abren en abanico, y manchitas
      const vena = Math.abs(Math.sin((t * 8.5 + 0.35 * Math.sin(s * 5 + d.fase) + 0.25 * ruido(s * 6, t * 3 + d.k)) * Math.PI));
      const v = (1 - vena) ** 8 * smooth(0.1, 0.5, s) * (1 - smooth(0.85, 1, s)) * 0.03;
      const m = 1 - v + (ruido(s * 9 + d.fase * 3, t * 6 + d.k) - 0.5) * 0.035;
      // los bordes de los de afuera, apenas tostados
      const tost = 0.35 * (1 - p) * smooth(0.86, 1, at) * smooth(0.55, 1, s) * ruido(s * 14 + d.fase, d.k);
      o.r = mix(r, 0.86, tost) * m; o.g = mix(g, 0.79, tost) * m; o.b = mix(b, 0.6, tost) * m;
      // el borde es más finito: deja ver un poco lo de abajo y se ve apenas más frío
      const fino = Math.max(smooth(0.8, 1, at) * smooth(0.25, 0.8, s), smooth(0.88, 1, s));
      o.r = mix(o.r, 0.88, 0.18 * fino); o.g = mix(o.g, 0.9, 0.18 * fino); o.b = mix(o.b, 0.89, 0.18 * fino);
      o.alfa = 1 - 0.16 * fino; o.fino = fino;
      o.trans = atras ? 0.2 : 0.34; o.brillo = 0.08;
    } else if (d.tipo === 'sepalo') {
      // verde, con el borde blancuzco (tienen pelusa)
      const k = smooth(0.55, 1, at) * 0.8 + 0.25 * smooth(0.6, 1, s);
      o.r = mix(0.2, 0.46, k); o.g = mix(0.32, 0.52, k); o.b = mix(0.14, 0.36, k);
      o.spec = 0.06; o.exp = 12;
    } else if (d.tipo === 'hoja') {
      // verde oscuro, con la nervadura del medio y las de los costados más claras
      const mid = 1 - smooth(0.025, 0.08, at);
      const lat = (1 - Math.abs(Math.sin((s * 8 - at * 1.3) * Math.PI))) ** 10 * smooth(0.08, 0.2, at) * (1 - smooth(0.8, 0.97, at));
      const k = Math.max(mid * 0.85, lat * 0.3);
      const n = (ruido(s * 12 + d.seed, t * 4) - 0.5) * 0.12;
      o.r = mix(0.07, 0.22, k) * (1 + n); o.g = mix(0.155, 0.3, k) * (1 + n); o.b = mix(0.075, 0.13, k) * (1 + n);
      if (atras) { o.r *= 1.3; o.g *= 1.25; o.b *= 1.25; }
      o.spec = 0.3; o.exp = 22;
    } else if (d.tipo === 'tallo' || d.tipo === 'raquis') {
      // verde con vetas, algo rojizo en partes
      const n = (ruido(s * 60, t * 3) - 0.5) * 0.18, roj = 0.45 * ruido(s * 7 + 3, 0.5);
      o.r = mix(0.13, 0.27, roj) * (1 + n); o.g = mix(0.235, 0.2, roj) * (1 + n); o.b = mix(0.085, 0.08, roj) * (1 + n);
      o.spec = 0.25; o.exp = 30;
    } else if (d.tipo === 'espina') {
      o.r = mix(0.32, 0.58, s); o.g = mix(0.15, 0.4, s); o.b = mix(0.08, 0.25, s);
      o.spec = 0.3; o.exp = 40;
    }
  }

  const tono = (c) => (c < 0.8 ? c : 0.8 + 0.2 * (1 - Math.exp(-(c - 0.8) / 0.2)));
  // Color de un punto: luz directa (con su sombra), la del cuarto, la que rebota entre los pétalos
  // (en los huecos se vuelve más crema), el verde que rebota del paño, la que pasa a través del
  // pétalo (son finitos) y un brillo suave
  const C_LUZ = [1, 0.975, 0.91], C_CIELO = [0.86, 0.92, 0.94], C_PAÑO = [0.25, 0.75, 0.5], C_TRANS = [1, 0.93, 0.74];
  function iluminar(L, nx, ny, nz, o, ao, sh, out, k) {
    const ndl = nx * L[0] + ny * L[1] + nz * L[2];
    // (los pétalos son finitos y la luz los atraviesa: el lado que no mira a la luz no se apaga
    // tanto, y les llega menos verde del paño; si no, parecen de porcelana)
    const wr = o.trans ? 0.8 : 0.45;
    const dif = 0.8 * Math.max(0, (ndl + wr) / (1 + wr)) * (1 - 0.88 * sh);
    const cielo = 0.42 * (0.55 + 0.45 * nz) * (1 - 0.9 * ao);
    const rebote = 0.3 * ao * (1 - 0.5 * sh);
    const paño = (o.trans ? 0.035 : 0.07) * (1 - nz) * (1 - 0.6 * ao);
    const tr = o.trans * Math.max(0, -ndl) * (1 - 0.6 * sh) * (1 - 0.5 * ao);
    const nh = Math.max(0, nx * MEDIO[0] + ny * MEDIO[1] + nz * MEDIO[2]);
    const extra = o.spec * nh ** o.exp * (1 - sh) + o.brillo * (1 - nz) ** 3 * (1 - 0.5 * sh);
    out[k] = tono(o.r * (dif * C_LUZ[0] + cielo * C_CIELO[0] + rebote * o.r + paño * C_PAÑO[0] + tr * C_TRANS[0]) + extra);
    out[k + 1] = tono(o.g * (dif * C_LUZ[1] + cielo * C_CIELO[1] + rebote * o.g + paño * C_PAÑO[1] + tr * C_TRANS[1]) + extra);
    out[k + 2] = tono(o.b * (dif * C_LUZ[2] + cielo * C_CIELO[2] + rebote * o.b + paño * C_PAÑO[2] + tr * C_TRANS[2]) + extra);
  }

  // ---------- Pintar (vista desde arriba) ----------
  // Pinta las superficies en una imagen (región R en u, k px por u), con 2 x 2 muestras por px para
  // que los bordes queden suaves (la luz se calcula una vez por px, salvo en los bordes). Es un
  // generador: cede el paso entre tandas, así no traba la página.
  const SS = 2, TANDA = 48;
  // Los triángulos de una tanda, con su altura: queda lo de más arriba (z), su normal y su (s, t)
  function rasterizar(lista, sups, ux, uy, KS, TS, zb, ib, nb, sb) {
    for (let n = 0; n < lista.length; n += 2) {
      const si = lista[n], t = lista[n + 1], S = sups[si];
      const { P, N, ST, T } = S;
      const a = T[t], b = T[t + 1], c = T[t + 2];
      const ax = (P[a * 3] - ux) * KS, ay = (P[a * 3 + 1] - uy) * KS;
      const bx = (P[b * 3] - ux) * KS, by = (P[b * 3 + 1] - uy) * KS;
      const cx = (P[c * 3] - ux) * KS, cy = (P[c * 3 + 1] - uy) * KS;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      const inv = 1 / area;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(TS - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(TS - 1, Math.ceil(Math.max(ay, by, cy)));
      const az = P[a * 3 + 2], bz = P[b * 3 + 2], cz = P[c * 3 + 2];
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) * inv;
          const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
          const z = w0 * az + w1 * bz + w2 * cz;
          const q = y * TS + x;
          if (z <= zb[q]) continue;
          zb[q] = z; ib[q] = si;
          nb[q * 3] = w0 * N[a * 3] + w1 * N[b * 3] + w2 * N[c * 3];
          nb[q * 3 + 1] = w0 * N[a * 3 + 1] + w1 * N[b * 3 + 1] + w2 * N[c * 3 + 1];
          nb[q * 3 + 2] = w0 * N[a * 3 + 2] + w1 * N[b * 3 + 2] + w2 * N[c * 3 + 2];
          sb[q * 2] = w0 * ST[a * 2] + w1 * ST[b * 2] + w2 * ST[c * 2];
          sb[q * 2 + 1] = w0 * ST[a * 2 + 1] + w1 * ST[b * 2 + 1] + w2 * ST[c * 2 + 1];
        }
      }
    }
  }

  // (T: lo que ya tapan los pétalos pintados, que van encima; ver cobertura())
  function* pintar(sups, R, k, luces, M, T = null) {
    const W = Math.max(1, Math.ceil(R.w * k)), H = Math.max(1, Math.ceil(R.h * k));
    const nl = luces.length;
    const datos = luces.map(() => new Uint8ClampedArray(W * H * 4));
    const TS = TANDA * SS, KS = k * SS;
    const zb = new Float32Array(TS * TS), nb = new Float32Array(TS * TS * 3), sb = new Float32Array(TS * TS * 2);
    const ib = new Int16Array(TS * TS);
    const o = {}, col = new Float32Array(nl * 3), ref = new Float32Array(nl * 3), acc = new Float32Array(nl * 3);
    // qué triángulos caen en cada tanda (se reparten una sola vez)
    const nx0 = Math.ceil(W / TANDA), ny0 = Math.ceil(H / TANDA);
    const listas = Array.from({ length: nx0 * ny0 }, () => []);
    const f = k / TANDA;
    sups.forEach((S, si) => {
      const C = S.C;
      for (let t = 0, tc = 0; t < S.T.length; t += 3, tc += 4) {
        const a0 = Math.max(0, Math.floor((C[tc] - R.x) * f)), a1 = Math.min(nx0 - 1, Math.floor((C[tc + 2] - R.x) * f));
        const b0 = Math.max(0, Math.floor((C[tc + 1] - R.y) * f)), b1 = Math.min(ny0 - 1, Math.floor((C[tc + 3] - R.y) * f));
        for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) listas[b * nx0 + a].push(si, t);
      }
    });
    // la luz de una muestra (deja el color en col, y devuelve su opacidad)
    const sombrear = (q, wx, wy) => {
      const si = ib[q], z = zb[q];
      let nx = nb[q * 3], ny = nb[q * 3 + 1], nz = nb[q * 3 + 2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const atras = nz < 0;
      if (atras) { nx = -nx; ny = -ny; nz = -nz; }
      material(sups[si], sb[q * 2], sb[q * 2 + 1], atras, o);
      // los pétalos no son lisos: apenas ondulados (pegado a cada pétalo, se mueve con él)
      if (o.trans) {
        const sv = sb[q * 2] * 11, tv = sb[q * 2 + 1] * 4 + si * 3.7;
        nx += (ruido(sv, tv) - 0.5) * 0.18; ny += (ruido(sv + 17.3, tv + 5.1) - 0.5) * 0.18;
        const l1 = Math.hypot(nx, ny, nz);
        nx /= l1; ny /= l1; nz /= l1;
      }
      // los bordes que se ven de canto son finitos y dejan pasar la luz: no se oscurecen tanto
      // (si no, el borde enrollado de cada pétalo quedaba como una costura oscura). Y en el borde
      // fino (ver material()), aunque esté enrollado, la luz le da casi como al resto del pétalo:
      // si no, desde arriba la cresta del rollo, que ocupa menos de un px, salía como una raya
      // oscura cortada
      if (o.trans && nz < 0.4) {
        nz += (0.4 - nz) * 0.8;
        const l2 = Math.hypot(nx, ny, nz);
        nx /= l2; ny /= l2; nz /= l2;
      }
      if (o.fino > 0) {
        const f = 0.85 * o.fino;
        nx *= 1 - f; ny *= 1 - f; nz += (1 - nz) * f;
        const l3 = Math.hypot(nx, ny, nz);
        nx /= l3; ny /= l3; nz /= l3;
      }
      // lo que queda bien tapado por otra cosa no se ve (salvo apenas, cuando se mueven los
      // pétalos): va oscuro, sin hacer las cuentas de la luz. Se mira lo que de verdad tapan los
      // pétalos ya pintados, no el mapa de alturas: ese es más grueso y se pasaba del borde (y no
      // ve las rendijas finitas entre dos pétalos), y ahí quedaba una costura oscura a escalones
      if (T && cubierto(T, wx, wy) && cubierto(T, wx + 5, wy) && cubierto(T, wx - 5, wy)
        && cubierto(T, wx, wy + 5) && cubierto(T, wx, wy - 5)) {
        for (let li = 0; li < nl; li++) { col[li * 3] = o.r * 0.42; col[li * 3 + 1] = o.g * 0.44; col[li * 3 + 2] = o.b * 0.42; }
        return o.alfa;
      }
      // la sombra y la penumbra se miden desde un poquito afuera de la superficie (si no, en
      // las paredes empinadas el mapa, que es más grueso, la haría sombrearse a sí misma)
      const ex = wx + nx * 1.3, ey = wy + ny * 1.3, ez = z + nz * 1.3;
      const ao = oclusion(M, ex, ey, ez), sh = sombra(M, ex, ey, ez);
      // una textura muy fina (como la de la foto), pegada a la superficie
      const gr = 1 + (hash(Math.floor(wx * 2.5) + si * 7919, Math.floor(wy * 2.5)) - 0.5) * 0.035;
      o.r *= gr; o.g *= gr; o.b *= gr;
      for (let li = 0; li < nl; li++) iluminar(luces[li], nx, ny, nz, o, ao, sh, col, li * 3);
      return o.alfa;
    };
    const promediar = (ty, tx, ux, uy) => {
      // cada px: el promedio de sus muestras. La primera se calcula; las otras, si son de la misma
      // superficie y están a la misma altura, valen lo mismo (solo en los bordes se recalcula)
      for (let y = 0; y < TANDA && ty + y < H; y++) {
        for (let x = 0; x < TANDA && tx + x < W; x++) {
          let n = 0, rq = -1, ra = 0;
          for (let sy = 0; sy < SS; sy++) {
            for (let sx = 0; sx < SS; sx++) {
              const q = (y * SS + sy) * TS + x * SS + sx;
              if (ib[q] < 0) continue;
              if (rq >= 0 && ib[q] === ib[rq] && Math.abs(zb[q] - zb[rq]) < 1.2) {
                for (let c = 0; c < nl * 3; c++) acc[c] += ref[c] * ra;
                n += ra;
                continue;
              }
              const al = sombrear(q, ux + (x * SS + sx + 0.5) / KS, uy + (y * SS + sy + 0.5) / KS);
              if (rq < 0) { rq = q; ra = al; ref.set(col); for (let c = 0; c < nl * 3; c++) acc[c] = col[c] * al; }
              else for (let c = 0; c < nl * 3; c++) acc[c] += col[c] * al;
              n += al;
            }
          }
          if (n < 1e-3) continue;
          const p = ((ty + y) * W + tx + x) * 4;
          for (let li = 0; li < nl; li++) {
            const D = datos[li];
            D[p] = (acc[li * 3] / n) * 255; D[p + 1] = (acc[li * 3 + 1] / n) * 255; D[p + 2] = (acc[li * 3 + 2] / n) * 255;
            D[p + 3] = (n / (SS * SS)) * 255;
          }
        }
      }
    };
    for (let ty = 0, tn = 0; ty < H; ty += TANDA) {
      for (let tx = 0; tx < W; tx += TANDA, tn++) {
        const lista = listas[tn];
        if (!lista.length) continue;
        const ux = R.x + tx / k, uy = R.y + ty / k;
        zb.fill(-1e9); ib.fill(-1);
        rasterizar(lista, sups, ux, uy, KS, TS, zb, ib, nb, sb);
        promediar(ty, tx, ux, uy);
        yield;
      }
    }
    return datos.map((D) => {
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      cv.getContext('2d').putImageData(new ImageData(D, W, H), 0, 0);
      return { cv, x: R.x, y: R.y, w: W / k, h: H / k, D, W, H }; // (D: para cobertura(), después se suelta)
    });
  }

  // Lo que tapan los pétalos ya pintados: el alfa de sus imágenes (en px, sobre la zona de la flor)
  function cobertura(zona, k) {
    const x0 = zona[0] - 2, y0 = zona[1] - 2, W = Math.ceil((zona[2] - x0 + 2) * k), H = Math.ceil((zona[3] - y0 + 2) * k);
    return { A: new Uint8Array(W * H), W, H, x0, y0, k };
  }
  function cubrir(C, im) {
    const ox = Math.round((im.x - C.x0) * C.k), oy = Math.round((im.y - C.y0) * C.k);
    for (let y = Math.max(0, -oy); y < im.H && oy + y < C.H; y++) {
      for (let x = Math.max(0, -ox); x < im.W && ox + x < C.W; x++) {
        const a = im.D[(y * im.W + x) * 4 + 3], g = (oy + y) * C.W + ox + x;
        if (a > C.A[g]) C.A[g] = a;
      }
    }
    im.D = null;
  }
  const cubierto = (C, x, y) => {
    const cx = Math.floor((x - C.x0) * C.k), cy = Math.floor((y - C.y0) * C.k);
    return cx >= 0 && cy >= 0 && cx < C.W && cy < C.H && C.A[cy * C.W + cx] > 245;
  };

  // La sombra sobre el paño (oscurece el verde): la que proyecta la rosa y la de contacto
  function* sombraPaño(G, M) {
    const hk = 0.5, R = G.lienzo;
    const W = Math.ceil(R.w * hk), H = Math.ceil(R.h * hk);
    const D = new Uint8ClampedArray(W * H * 4);
    // dónde hay algo cerca (en bloques de ~10 u): lejos de todo no hace falta medir la penumbra
    const bs = Math.max(1, Math.round(10 * M.hk)), BW = Math.ceil(M.W / bs), BH = Math.ceil(M.H / bs);
    const B = new Uint8Array(BW * BH);
    for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) if (M.A[y * M.W + x] > 0.8) B[((y / bs) | 0) * BW + ((x / bs) | 0)] = 1;
    const cerca = (wx, wy) => {
      const bx = Math.floor((wx - M.x0) * M.hk / bs), by = Math.floor((wy - M.y0) * M.hk / bs);
      for (let j = Math.max(0, by - 2); j <= Math.min(BH - 1, by + 2); j++) {
        for (let i = Math.max(0, bx - 2); i <= Math.min(BW - 1, bx + 2); i++) if (B[j * BW + i]) return true;
      }
      return false;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const wx = R.x + (x + 0.5) / hk, wy = R.y + (y + 0.5) / hk;
        const sh = sombra(M, wx, wy, 0.3), ao = cerca(wx, wy) ? oclusion(M, wx, wy, 0.3) : 0;
        const a = clamp(0.52 * sh + 0.7 * ao, 0, 0.84);
        const p = (y * W + x) * 4;
        D[p] = 1; D[p + 1] = 9; D[p + 2] = 5; D[p + 3] = a * 255;
      }
      if (y % 24 === 23) yield;
    }
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    cv.getContext('2d').putImageData(new ImageData(D, W, H), 0, 0);
    return cv;
  }

  // Todo lo que hay que pintar para un giro y una resolución
  function* horno(G, k) {
    for (const S of G.todas) { completar(S); yield; }
    // (los mapas no necesitan tanto detalle: la sombra y la penumbra son suaves)
    const { M, tal, levantadas } = yield* mapas(G, clamp(k * 0.75, 0.8, 1.2));
    sombras(M);
    yield;
    const piso = yield* sombraPaño(G, M);
    // cada pétalo, con la sombra de los que tiene encima (de adentro hacia afuera)
    const H = { ...M, A: new Float32Array(M.A.length), S: null };
    const petalos = [];
    const sumar = (a) => {
      for (let y = 0; y < a.H; y++) {
        for (let x = 0; x < a.W; x++) {
          const z = a.A[y * a.W + x], g = (a.gy0 + y) * H.W + a.gx0 + x;
          if (z > H.A[g]) H.A[g] = z;
        }
      }
    };
    // (la sombra se recalcula solo donde está la flor)
    const zona = unir(G.petalos);
    const zx0 = Math.max(0, Math.floor((zona[0] - H.x0) * H.hk) - 2), zy0 = Math.max(0, Math.floor((zona[1] - H.y0) * H.hk) - 2);
    const zx1 = Math.min(H.W, Math.ceil((zona[2] - H.x0) * H.hk) + 3), zy1 = Math.min(H.H, Math.ceil((zona[3] - H.y0) * H.hk) + 3);
    const tapan = cobertura(zona, k);
    for (let i = G.petalos.length - 1; i >= 0; i--) {
      const S = G.petalos[i];
      const a = tal[i];
      sumar(a);
      // (solo cambia lo que está abajo de este pétalo y del lado contrario a la luz)
      const x0 = LX > 0 ? zx0 : Math.max(zx0, a.gx0 - 1), x1 = LX > 0 ? Math.min(zx1, a.gx0 + a.W + 1) : zx1;
      sombras(H, x0, Math.max(zy0, a.gy0), x1, zy1);
      const m = 1.5 / k;
      const R2 = { x: S.caja[0] - m, y: S.caja[1] - m, w: S.caja[2] - S.caja[0] + 2 * m, h: S.caja[3] - S.caja[1] + 2 * m };
      const [luz, luz2] = yield* pintar([S], R2, k, [LUZ, S.luz2], H, tapan);
      cubrir(tapan, luz); luz2.D = null;
      petalos[i] = { S, luz, luz2 };
      sumar(levantadas[i]);
    }
    // el tallo, las hojas, los sépalos (lo que tapan todos los pétalos, oscuro) y la sombra, en un
    // solo dibujo (no se mueven)
    const [quieto] = yield* pintar(G.quieto, G.lienzo, k, [LUZ], M, tapan);
    const R = G.lienzo;
    const base = document.createElement('canvas');
    base.width = Math.ceil(R.w * k); base.height = Math.ceil(R.h * k);
    const bx = base.getContext('2d');
    bx.imageSmoothingQuality = 'high';
    bx.drawImage(piso, 0, 0, base.width, base.height);
    bx.drawImage(quieto.cv, 0, 0);
    return { G, k, base: { cv: base, x: R.x, y: R.y, w: base.width / k, h: base.height / k }, petalos };
  }

  // ---------- Ubicación en pantalla ----------
  // En la compu va donde está en la foto (y se corre si la ventana recorta esa esquina). En el
  // celular va pegada a la esquina de abajo a la derecha, debajo de la carpeta, angosta (al medio va
  // el rompecabezas). Se achica lo necesario para no pisar nada. La flor se ve siempre entera; el
  // tallo y las hojas pueden salirse de la pantalla.
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
  const tinta = document.getElementById('tinta');
  function obstaculos(r, s) {
    const out = [CARPETA.map(([x, y]) => [r.left + x * s, r.top + y * s])];
    for (const id of ['slot', 'denied']) {
      const b = rect(document.getElementById(id));
      if (b) out.push(polyOf(...b));
    }
    // el tintero y la zona de tinta (tinta.js), cuando ya se ven; el pincel queda adentro
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
    const vert = portrait.matches;
    const cands = [];
    if (!vert) {
      const G = geometria(GIRO_H);
      const en = (v, f, max) => clamp(v, MARGEN + f, max - MARGEN - f);
      cands.push({ G, w: 1, at: (g) => [en(r.left + FOTO.x * s, G.flor * g, vw), en(r.top + FOTO.y * s, G.flor * g, vh)] });
      cands.push({ G, w: 0.85, at: (g) => [vw - MARGEN - G.flor * g, vh - MARGEN - G.flor * g] });
    } else {
      // pegada abajo a la derecha; si hay lugar, se ve también un poco de tallo y las hojas
      for (const [giro, wg] of [[GIRO_V, 1], [GIRO_H, 0.96]]) {
        const G = geometria(giro);
        for (const extra of [0, 0.5, 1, 1.5]) {
          cands.push({ G, w: wg * (1 + 0.05 * extra), at: (g) => [vw - MARGEN - G.flor * g, vh - MARGEN - (1 + extra) * G.flor * g] });
        }
      }
    }
    const caja = (c, g) => {
      const [cx, cy] = c.at(g), C = c.G.caja;
      return { cx, cy, b: [Math.max(0, cx + C[0] * g), Math.max(0, cy + C[1] * g), Math.min(vw, cx + C[2] * g), Math.min(vh, cy + C[3] * g)] };
    };
    const entra = (c, g) => {
      const { cx, cy, b } = caja(c, g), f = c.G.flor * g;
      if (cx - f < MARGEN - 0.5 || cy - f < MARGEN - 0.5 || cx + f > vw - MARGEN + 0.5 || cy + f > vh - MARGEN + 0.5) return false;
      if (vert && b[2] - b[0] > ANCHO_V * vw) return false;
      const R = [b[0] - aire, b[1] - aire, b[2] + aire, b[3] + aire];
      return !obs.some((p) => choca(R, p));
    };
    let best = null;
    for (const c of cands) {
      let lo = 0, hi = s;
      if (entra(c, hi)) lo = hi;
      else for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (entra(c, mid)) lo = mid; else hi = mid; }
      const score = lo * c.w;
      if (!best || score > best.score + 1e-9) best = { score, g: lo, c };
    }
    // muy chiquita no tiene gracia (y no se podría tocar): mejor no mostrarla
    if (!best || 2 * best.c.G.flor * best.g < 44) { L = null; return L; }
    const g = best.g, { cx, cy, b } = caja(best.c, g);
    L = { g, cx, cy, b, G: best.c.G };
    return L;
  }

  // ---------- Elementos ----------
  const el = (tag, cls, attrs = {}) => { const e = document.createElement(tag); e.className = cls; Object.assign(e, attrs); return e; };
  const lienzo = el('canvas', 'r-lienzo');
  lienzo.setAttribute('aria-hidden', 'true');
  // lo que ocupa la rosa entera (con el tallo y las hojas): el rompecabezas esquiva este recuadro
  const ocupa = el('div', 'r-ocupa');
  ocupa.setAttribute('aria-hidden', 'true');
  ocupa.setAttribute('data-ocupa', '');
  // el botón es solo la flor (tocar el paño de al lado, entre el tallo y las hojas, no hace nada)
  const boton = el('button', 'r-boton', { type: 'button', title: 'Rosa blanca' });
  boton.setAttribute('aria-label', 'Rosa blanca');
  layer.append(lienzo, ocupa, boton);
  layer.addEventListener('scroll', () => { layer.scrollLeft = 0; layer.scrollTop = 0; });
  const ctx = lienzo.getContext('2d');

  // Lo ya pintado, por giro (para una resolución): girar el teléfono, o que se abra el teclado,
  // vuelve a usarlo sin esperar
  const sprites = new Map();
  // lo que se muestra: lo pintado para este giro o, mientras se pinta, lo del otro (girado)
  const aMostrar = () => (L && (sprites.get(L.G.giro) || sprites.values().next().value)) || null;
  let kLienzo = 1;  // px del lienzo por unidad
  // (en pantallas muy densas, un poco menos: no se nota y se pinta bastante más rápido)
  const kDeseado = () => { const d = window.devicePixelRatio || 1; return Math.min(L.g * (d > 2 ? d * 0.8 : d), K_MAX); };
  const ubicar = (e, x, y, w, h) => Object.assign(e.style, { transform: `translate(${x}px, ${y}px)`, width: w + 'px', height: h + 'px' });

  function placeStatic() {
    if (!L) { layer.classList.add('oculto'); return; }
    layer.classList.remove('oculto');
    const g = L.g, R = L.G.lienzo;
    kLienzo = kDeseado();
    const w = Math.max(1, Math.round(R.w * kLienzo)), h = Math.max(1, Math.round(R.h * kLienzo));
    if (lienzo.width !== w || lienzo.height !== h) { lienzo.width = w; lienzo.height = h; }
    ubicar(lienzo, L.cx + R.x * g, L.cy + R.y * g, R.w * g, R.h * g);
    const b = L.b, f = L.G.flor * g;
    ubicar(ocupa, b[0], b[1], b[2] - b[0], b[3] - b[1]);
    ubicar(boton, L.cx - f, L.cy - f, 2 * f, 2 * f);
    // (si todavía no hay nada pintado, no se ve ni se puede tocar: es un rato, al principio)
    layer.classList.toggle('horneando', !aMostrar());
  }

  // ---------- Dibujo ----------
  // Cada pétalo es una imagen ya iluminada; en cada cuadro solo se la ubica (girada alrededor de
  // su base y acortada si se levanta). Al levantarse se funde con la misma imagen iluminada desde
  // otro ángulo (la luz le da distinto).
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, lienzo.width, lienzo.height);
    const spr = aMostrar();
    if (!spr) return;
    const R = L.G.lienzo, k = kLienzo;
    // si es lo pintado para el otro giro se lo gira (es la misma rosa girada: solo la luz no es
    // la justa), hasta que esté lo de este
    const giro = L.G.giro - spr.G.giro, cg = Math.cos(rad(giro)) * k, sg = Math.sin(rad(giro)) * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(cg, sg, -sg, cg, -R.x * k, -R.y * k);
    const B = spr.base;
    ctx.drawImage(B.cv, B.x, B.y, B.w, B.h);
    // la flor entera se mece apenas (gira un poquito y se corre): F (2 x 2) y su corrimiento
    const ca = Math.cos(rad(meceX0[0] + giro)) * k, sa = Math.sin(rad(meceX0[0] + giro)) * k;
    const fx = (meceX0[1] - R.x) * k, fy = (meceX0[2] - R.y) * k;
    for (let i = 0; i < spr.petalos.length; i++) {
      const { S, luz, luz2 } = spr.petalos[i];
      const lev = lx[i] + 0.08 * hover;
      // cada pétalo gira alrededor de su base y, al levantarse, se ve más corto (a lo largo)
      const e = -0.12 * lev * (1 - S.d.p) ** 0.6, dx = S.dir[0], dy = S.dir[1];
      const s00 = 1 + e * dx * dx, s01 = e * dx * dy, s11 = 1 + e * dy * dy;
      const c = Math.cos(rad(gx[i])), sn = Math.sin(rad(gx[i]));
      const a00 = c * s00 - sn * s01, a01 = c * s01 - sn * s11, a10 = sn * s00 + c * s01, a11 = sn * s01 + c * s11;
      const bx = S.base[0], by = S.base[1];
      const tx = bx - a00 * bx - a01 * by, ty = by - a10 * bx - a11 * by;
      ctx.setTransform(ca * a00 - sa * a10, sa * a00 + ca * a10, ca * a01 - sa * a11, sa * a01 + ca * a11,
        ca * tx - sa * ty + fx, sa * tx + ca * ty + fy);
      ctx.drawImage(luz.cv, luz.x, luz.y, luz.w, luz.h);
      if (lev > 0.01) {
        ctx.globalAlpha = Math.min(1, lev);
        ctx.drawImage(luz2.cv, luz2.x, luz2.y, luz2.w, luz2.h);
        ctx.globalAlpha = 1;
      }
    }
  }

  // ---------- Animación ----------
  // Cada pétalo tiene dos resortes: cuánto gira alrededor de su base (grados) y cuánto se levanta.
  // Tocarla les da un empujón (primero a los del centro, después hacia afuera); los resortes los
  // traen de vuelta solos. Si se la toca de nuevo, se suma al movimiento que ya tenían.
  const gx = new Float32Array(N_PET), gv = new Float32Array(N_PET);
  const lx = new Float32Array(N_PET), lv = new Float32Array(N_PET);
  let pendientes = [];
  let raf = 0, tPrev = 0, hover = 0, hoverTarget = 0;
  const RES_G = { w: 2 * Math.PI * 1.35, z: 0.32 }, RES_L = { w: 2 * Math.PI * 1.05, z: 0.45 };
  const RES_M = { w: 2 * Math.PI * 1.1, z: 0.3 };
  const RED_G = { ...RES_G, z: 0.6 }, RED_L = { ...RES_L, z: 0.75 }; // sin tanto movimiento: se frenan antes
  // un paso de cada resorte (posición X[i], velocidad V[i])
  const resortes = (X, V, n, R, dt) => {
    const kx = R.w * R.w, kv = 2 * R.z * R.w;
    for (let i = 0; i < n; i++) { V[i] -= (kx * X[i] + kv * V[i]) * dt; X[i] += V[i] * dt; }
  };
  const meceX0 = new Float32Array(3), meceV0 = new Float32Array(3); // la flor entera: giro, x, y
  const MECE_MAX = [1.5, 3, 3]; // (grados, u, u)

  function avanzar(now) {
    let dt = Math.min(0.05, (now - tPrev) / 1000);
    tPrev = now;
    const red = reduced.matches;
    while (dt > 1e-6) {
      const h = Math.min(dt, 1 / 240);
      dt -= h;
      resortes(gx, gv, N_PET, red ? RED_G : RES_G, h);
      resortes(lx, lv, N_PET, red ? RED_L : RES_L, h);
      resortes(meceX0, meceV0, 3, RES_M, h);
      // la flor no se puede correr mucho: la sombra y los sépalos de abajo están pintados quietos
      for (let i = 0; i < 3; i++) {
        const m = MECE_MAX[i];
        if (Math.abs(meceX0[i]) > m) { meceX0[i] = Math.sign(meceX0[i]) * m; if (meceV0[i] * meceX0[i] > 0) meceV0[i] = 0; }
      }
    }
    // los empujones que ya tocan
    pendientes = pendientes.filter((p) => {
      if (p.t > now) return true;
      gv[p.i] += p.dg; lv[p.i] += p.dl;
      return false;
    });
    // (cuando lo que falta ya no se ve: menos de una décima de px)
    let quieto = !pendientes.length;
    const eps = (x, v, m) => Math.abs(x) < m && Math.abs(v) < 10 * m;
    for (let i = 0; i < N_PET && quieto; i++) if (!eps(gx[i], gv[i], 0.04) || !eps(lx[i], lv[i], 0.004)) quieto = false;
    for (let i = 0; i < 3 && quieto; i++) if (!eps(meceX0[i], meceV0[i], 0.03)) quieto = false;
    if (quieto) { // en reposo exacto, como antes
      for (const A of [gx, gv, lx, lv, meceX0, meceV0]) A.fill(0);
    }
    return !quieto;
  }

  function frame() {
    raf = 0;
    if (!aMostrar()) return;
    const now = performance.now();
    let more = avanzar(now);
    hover = mix(hover, hoverTarget, 0.18);
    if (Math.abs(hover - hoverTarget) < 0.004) hover = hoverTarget; else more = true;
    draw();
    if (more) raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) { tPrev = performance.now(); raf = requestAnimationFrame(frame); } };

  // Un soplido desde donde se tocó (hacia el centro de la flor)
  function soplar(x, y) {
    const spr = aMostrar();
    if (!spr) return;
    const now = performance.now();
    const amp = reduced.matches ? 0.3 : 1;
    let wx = L.cx - x, wy = L.cy - y;
    const d = Math.hypot(wx, wy);
    if (x == null || d < L.G.flor * L.g * 0.15) { wx = -LX; wy = -LY; } else { wx /= d; wy /= d; }
    // si ya se estaba moviendo, se calma un poco antes del nuevo empujón (que no se acumule): lo
    // que se mueve, la flor entera y los empujones que todavía no llegaron
    for (let i = 0; i < N_PET; i++) { gv[i] *= 0.5; lv[i] *= 0.5; }
    for (let i = 0; i < 3; i++) meceV0[i] *= 0.5;
    for (const p of pendientes) { p.dg *= 0.5; p.dl *= 0.5; }
    const rnd = azar(Math.floor(now));
    // (el soplido, visto desde lo pintado: si es lo del otro giro, está girado)
    const gd = rad(spr.G.giro - L.G.giro), pwx = wx * Math.cos(gd) - wy * Math.sin(gd), pwy = wx * Math.sin(gd) + wy * Math.cos(gd);
    spr.petalos.forEach(({ S }, i) => {
      const rr = clamp(S.radio / L.G.flor, 0, 1);
      const [rx, ry] = S.dir;
      const lat = -ry * pwx + rx * pwy; // de costado respecto del soplido
      const peso = mix(0.55, 1, rr);
      pendientes.push({
        t: now + (reduced.matches ? 0 : 30 + 300 * rr + 50 * rnd()),
        i,
        dg: amp * peso * (lat * 5.2 + (rnd() - 0.5) * 2.8) * RES_G.w / 0.75,
        dl: amp * mix(0.6, 0.45, rr) * (0.85 + 0.3 * rnd()) * RES_L.w / 0.75,
      });
    });
    if (!reduced.matches) {
      meceV0[0] += (rnd() < 0.5 ? -1 : 1) * 1.1 * RES_M.w;
      meceV0[1] += wx * 1.6 * RES_M.w; meceV0[2] += wy * 1.6 * RES_M.w;
    }
    kick();
  }
  boton.addEventListener('click', (e) => {
    // con el teclado (Enter / espacio) no hay dónde se tocó: sopla desde la luz
    soplar(e.detail ? e.clientX : null, e.detail ? e.clientY : null);
  });
  const lift = (on) => { hoverTarget = on && !reduced.matches ? 1 : 0; kick(); };
  const focusVisible = () => { try { return boton.matches(':focus-visible'); } catch { return true; } };
  boton.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') lift(true); });
  boton.addEventListener('pointerleave', () => lift(false));
  boton.addEventListener('focus', () => { if (focusVisible()) lift(true); });
  boton.addEventListener('blur', () => lift(false));

  // ---------- Pintar de a poco (sin trabar la página) ----------
  let trabajo = null, esperaHorno = 0;
  // seguir en la próxima vuelta del navegador (sin la demora mínima de setTimeout)
  const canal = typeof MessageChannel === 'function' ? new MessageChannel() : null;
  let pendiente = null;
  if (canal) canal.port1.onmessage = () => { const f = pendiente; pendiente = null; if (f) f(); };
  const seguir = (f) => { if (canal) { pendiente = f; canal.port2.postMessage(0); } else setTimeout(f, 0); };
  // (lo que no corre prisa, cuando el navegador no tiene otra cosa que hacer)
  const despues = (f) => (window.requestIdleCallback ? requestIdleCallback(() => f(), { timeout: 600 }) : setTimeout(f, 40));
  // corre un generador de a ratitos de 12 ms (6 si es lento: lo que no corre prisa); un trabajo
  // nuevo cancela el anterior
  function correr(gen, fin, datos = {}) {
    const yo = datos;
    trabajo = yo;
    const paso = () => {
      if (trabajo !== yo) return; // hubo otro pedido
      const t = performance.now(), ms = yo.lento ? 6 : 12;
      try {
        for (;;) {
          const r = gen.next();
          if (r.done) { trabajo = null; fin(r.value); return; }
          if (performance.now() - t > ms) break;
        }
      } catch (err) {
        fallar(err);
        return;
      }
      if (yo.lento) despues(paso); else seguir(paso);
    };
    yo.paso = paso;
    if (yo.lento) despues(paso); else paso();
  }
  function fallar(err) {
    console.error('Rosa:', err);
    trabajo = null;
    layer.remove(); // si algo falla, queda la portada tal cual
  }
  const alcanza = (v, G, k) => v && v.G === G && Math.abs(v.k / k - 1) < 0.15;
  function hornear() {
    if (!L || !layer.isConnected) return;
    const G = L.G, k = kDeseado();
    if (alcanza(sprites.get(G.giro), G, k)) { prehornear(); return; } // lo que hay alcanza
    if (alcanza(trabajo, G, k)) { // ya se está pintando (si era sin prisa, ahora sí la tiene)
      if (trabajo.lento) { trabajo.lento = false; seguir(trabajo.paso); }
      return;
    }
    correr(horno(G, k), guardar, { G, k });
  }
  // Con la rosa ya a la vista se pinta, sin apuro, la del otro giro: al girar el teléfono (o si al
  // abrirse el teclado cambia) ya está. Si después hace falta más resolución, mientras tanto se ve esa
  function prehornear() {
    if (trabajo || !L) return;
    const otro = [GIRO_V, GIRO_H].find((gr) => !sprites.has(gr));
    if (otro === undefined) return;
    const G = geometria(otro), k = kDeseado();
    correr(horno(G, k), guardar, { G, k, lento: true });
  }
  function guardar(v) {
    sprites.set(v.G.giro, v);
    listo();
    hornear(); // por si mientras tanto cambió la ventana (y si no, sigue con el otro giro)
  }
  function listo() {
    if (!layer.isConnected) return;
    layer.classList.remove('cargando');
    layer.classList.toggle('horneando', !aMostrar());
    kick();
  }

  // El rompecabezas mira la clase de esta capa para saber cuándo volver a acomodarse: si la rosa
  // cambió de lugar se le avisa (volver a poner la misma clase alcanza)
  let cajaAntes = '';
  function avisar() {
    const b = L ? L.b.map((v) => Math.round(v)).join() : 'no';
    if (b === cajaAntes) return;
    cajaAntes = b;
    if (!layer.classList.contains('cargando')) layer.className = layer.className;
  }

  let iniciado = false;
  function relayout() {
    if (!iniciado || !layer.isConnected) return;
    layout();
    placeStatic();
    avisar();
    if (!L) {
      // no entra: si todavía no se mostró nunca, que no la esperen
      if (!sprites.size) layer.classList.remove('cargando');
      return;
    }
    clearTimeout(esperaHorno);
    // al cambiar el tamaño de la ventana se espera a que se quede quieta para volver a pintar
    // (mientras tanto se ve lo que ya hay, estirado o girado)
    if (aMostrar()) esperaHorno = setTimeout(hornear, 150); else hornear();
    // (cambiarle el tamaño al lienzo lo borra: se dibuja ya, sin esperar al próximo cuadro)
    if (aMostrar()) draw();
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
  // el tintero aparece (o se cae) cuando termina de cargar: recién ahí se sabe qué lugar ocupa
  if (tinta) new MutationObserver(relayout).observe(tinta, { attributes: true, attributeFilter: ['class'] });
  if (document.body) new MutationObserver(() => { if (tinta && !tinta.isConnected) relayout(); }).observe(document.body, { childList: true });

  // ---------- Arranque (después de la portada, para no demorarla) ----------
  // primero se arma la rosa (de a poco), después se ubica y se pinta
  function start() {
    correr(modelar(), () => {
      try {
        iniciado = true;
        relayout();
      } catch (err) {
        fallar(err);
      }
    });
  }
  if (document.readyState === 'complete') start();
  else addEventListener('load', start, { once: true });
})();
