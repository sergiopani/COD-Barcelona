// Genera una Sagrada Família PROCEDURAL (modelo propio) con las proporciones y la distribución reales de la basílica terminada:
// nave de cinco naves (45 m) con bóvedas de 45/30 m y claraboyas hiperboloides, transepto, ábside con capillas, fachadas del Nacimiento (este),
// la Pasión (oeste) y la Gloria (sur, con gran pórtico de columnas), 12 torres de apóstoles (4 por fachada), 4 evangelistas (135 m),
// la torre de María (138 m, estrella de 12 puntas) y la de Jesucristo (172,5 m, con cruz).
// Fuentes de las medidas: ver docs/SAGRADA.md. Salida en metros, ejes del juego (X este, Y arriba, Z norte) escritos como glTF (x, y, -z).
// Uso: node scripts/build-sagrada-procedural.mjs <salida.glb>
import fs from "node:fs";
import sharp from "sharp";
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTTextureWebP } from "@gltf-transform/extensions";

const out = process.argv[2] ?? "public/assets/buildings/sagrada-familia-procedural.glb";
const TILE = 3.2; // metros por repetición de la textura de arenisca

// ------------------------------------------------------------------ geometría
class Geo {
  constructor(name) { this.name = name; this.p = []; this.n = []; this.uv = []; this.i = []; }
  get count() { return this.p.length / 3; }
  vert(x, y, z, nx, ny, nz, u, v) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); return this.count - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
}
const mats = { stone: new Geo("stone"), dark: new Geo("dark"), orange: new Geo("ceramica_naranja"), teal: new Geo("ceramica_verde"), gold: new Geo("ceramica_dorada"), white: new Geo("cristal_blanco") };
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Quad plano con 4 esquinas (sentido antihorario visto desde la normal). UV proyectadas por el eje dominante. */
function quad(g, a, b, c, d, n) {
  n = n ?? norm(cross(sub(b, a), sub(c, a)));
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  const uvOf = (p) => (ay >= ax && ay >= az ? [p[0] / TILE, p[2] / TILE] : ax >= az ? [p[2] / TILE, -p[1] / TILE] : [p[0] / TILE, -p[1] / TILE]);
  const ids = [a, b, c, d].map((p) => { const t = uvOf(p); return g.vert(p[0], p[1], p[2], n[0], n[1], n[2], t[0], t[1]); });
  g.tri(ids[0], ids[1], ids[2]); g.tri(ids[0], ids[2], ids[3]);
}
/** Caja alineada con los ejes (caras planas). */
function box(g, cx, cy, cz, sx, sy, sz, skip = {}) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  if (!skip.up) quad(g, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]);
  if (!skip.down) quad(g, [x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0, -1, 0]);
  if (!skip.xp) quad(g, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
  if (!skip.xn) quad(g, [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]);
  if (!skip.zp) quad(g, [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1]);
  if (!skip.zn) quad(g, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]);
}
/** Superficie por anillos (cada anillo = lista de puntos con el mismo número de lados), normales suaves. */
function loft(g, rings, closeTop = false) {
  const n = rings[0].length, m = rings.length;
  const base = g.count;
  for (let j = 0; j < m; j++) {
    for (let k = 0; k < n; k++) {
      const p = rings[j][k], pn = rings[j][(k + 1) % n], pp = rings[j][(k + n - 1) % n];
      const up = rings[Math.min(m - 1, j + 1)][k], dn = rings[Math.max(0, j - 1)][k];
      let nr = norm(cross(sub(up, dn), sub(pn, pp)));
      // la normal debe apuntar hacia fuera del eje del anillo
      const cx = rings[j].reduce((s, q) => s + q[0], 0) / n, cz = rings[j].reduce((s, q) => s + q[2], 0) / n;
      if (nr[0] * (p[0] - cx) + nr[2] * (p[2] - cz) < 0) nr = [-nr[0], -nr[1], -nr[2]];
      g.vert(p[0], p[1], p[2], nr[0], nr[1], nr[2], (k / n) * ringLen(rings[j]) / TILE, p[1] / TILE);
    }
  }
  for (let j = 0; j < m - 1; j++) for (let k = 0; k < n; k++) {
    const a = base + j * n + k, b = base + j * n + ((k + 1) % n), c = base + (j + 1) * n + ((k + 1) % n), d = base + (j + 1) * n + k;
    g.tri(a, b, c); g.tri(a, c, d);
  }
  if (closeTop) {
    const top = rings[m - 1], cx = top.reduce((s, q) => s + q[0], 0) / n, cy = top[0][1], cz = top.reduce((s, q) => s + q[2], 0) / n;
    const c = g.vert(cx, cy, cz, 0, 1, 0, 0, 0);
    for (let k = 0; k < n; k++) { const a = g.vert(top[k][0], cy, top[k][2], 0, 1, 0, top[k][0] / TILE, top[k][2] / TILE), b = g.vert(top[(k + 1) % n][0], cy, top[(k + 1) % n][2], 0, 1, 0, top[(k + 1) % n][0] / TILE, top[(k + 1) % n][2] / TILE); g.tri(c, b, a); }
  }
}
const ringLen = (r) => { let s = 0; for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; s += Math.hypot(a[0] - b[0], a[2] - b[2]); } return s; };
/** Anillo superelíptico (|x|^p + |z|^p = r^p), con giro opcional. */
function ring(cx, cz, y, rx, rz, p, n = 20, rot = 0) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const e = 2 / p;
    const x = Math.sign(c) * Math.pow(Math.abs(c), e) * rx, z = Math.sign(s) * Math.pow(Math.abs(s), e) * rz;
    pts.push([cx + x * Math.cos(rot) - z * Math.sin(rot), y, cz + x * Math.sin(rot) + z * Math.cos(rot)]);
  }
  return pts;
}
/** Sólido de revolución a partir de un perfil [(radio, y)…]. */
function lathe(g, cx, cz, profile, n = 20, closeTop = false) { loft(g, profile.map(([r, y]) => ring(cx, cz, y, r, r, 2, n)), closeTop); }
function sphere(g, cx, cy, cz, r, n = 12) {
  const prof = [];
  for (let k = 0; k <= 8; k++) { const a = -Math.PI / 2 + (k / 8) * Math.PI; prof.push([Math.max(0.001, r * Math.cos(a)), cy + r * Math.sin(a)]); }
  lathe(g, cx, cz, prof, n);
}
/** Polígono plano (dark) sobre un plano definido por origen, ejes u,v y normal; ligeramente adelantado. */
function panel(g, o, u, v, poly, n) {
  const pts = poly.map(([a, b]) => [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b]);
  const base = g.count;
  for (const p of pts) g.vert(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0);
  for (let k = 1; k < pts.length - 1; k++) g.tri(base, base + k, base + k + 1);
}
/** Ventana/portal en arco: rectángulo + semicírculo, sobre una fachada. */
function arch(o, u, v, n, w, h, g = mats.dark) {
  const r = w / 2, hs = h - r;
  const poly = [[-w / 2, 0], [w / 2, 0], [w / 2, hs]];
  for (let k = 1; k < 8; k++) { const a = (k / 8) * Math.PI; poly.push([Math.cos(a) * r, hs + Math.sin(a) * r]); }
  poly.push([-w / 2, hs]);
  panel(g, o, u, v, poly, n);
}

// ------------------------------------------------------------------ ornamento
/** Caja en un sistema local (origen o, ejes u,v,n): rango [a0,a1]×[b0,b1]×[c0,c1]. */
function lbox(o, u, v, n, a0, a1, b0, b1, c0, c1) {
  const P = (a, b, c) => [o[0] + u[0] * a + v[0] * b + n[0] * c, o[1] + u[1] * a + v[1] * b + n[1] * c, o[2] + u[2] * a + v[2] * b + n[2] * c];
  const g = mats.stone;
  quad(g, P(a0, b0, c1), P(a1, b0, c1), P(a1, b1, c1), P(a0, b1, c1), n);                                  // frente
  quad(g, P(a0, b1, c0), P(a0, b1, c1), P(a1, b1, c1), P(a1, b1, c0), v);                                  // arriba
  quad(g, P(a1, b0, c0), P(a1, b0, c1), P(a1, b1, c1), P(a1, b1, c0), u);                                  // lado +u
  quad(g, P(a0, b1, c0), P(a0, b1, c1), P(a0, b0, c1), P(a0, b0, c0), [-u[0], -u[1], -u[2]]);               // lado -u
}
/** Marco en arco con grosor (archivolta): banda semicircular + jambas, delante de un portal. */
function archFrame(o, u, v, n, w, h, t = 0.9, d = 0.7) {
  const r = w / 2, hs = h - r, steps = 10;
  const P = (a, b, c) => [o[0] + u[0] * a + v[0] * b + n[0] * c, o[1] + u[1] * a + v[1] * b + n[1] * c, o[2] + u[2] * a + v[2] * b + n[2] * c];
  for (let k = 0; k < steps; k++) {
    const a0 = (k / steps) * Math.PI, a1 = ((k + 1) / steps) * Math.PI;
    const i0 = [Math.cos(a0) * r, hs + Math.sin(a0) * r], i1 = [Math.cos(a1) * r, hs + Math.sin(a1) * r];
    const o0 = [Math.cos(a0) * (r + t), hs + Math.sin(a0) * (r + t)], o1 = [Math.cos(a1) * (r + t), hs + Math.sin(a1) * (r + t)];
    quad(mats.stone, P(o0[0], o0[1], d), P(i0[0], i0[1], d), P(i1[0], i1[1], d), P(o1[0], o1[1], d), n);
  }
  lbox(o, u, v, n, -r - t, -r, 0, hs, 0, d);
  lbox(o, u, v, n, r, r + t, 0, hs, 0, d);
}
/** Cuadrícula de hornacinas oscuras (como los nichos de las fachadas). */
function niches(o, u, v, n, cols, rows, dx, dy, w, h) {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) arch([o[0] + u[0] * (c - (cols - 1) / 2) * dx + v[0] * r * dy, o[1] + u[1] * (c - (cols - 1) / 2) * dx + v[1] * r * dy, o[2] + u[2] * (c - (cols - 1) / 2) * dx + v[2] * r * dy], u, v, n, w, h);
}
/** Costillas verticales y cornisas horizontales: dan sombra y escala a un paramento liso. */
function ribs(cx, cy, cz, len, h, axis, side, step = 1.6, depth = 0.45) {
  const n = Math.floor(len / step);
  for (let k = 0; k <= n; k++) { const off = -len / 2 + k * step; if (axis === "z") box(mats.stone, cx + side * depth / 2, cy, cz + off, depth, h, 0.5); else box(mats.stone, cx + off, cy, cz + side * depth / 2, 0.5, h, depth); }
}
function cornice(cx, y, cz, sx, sz, proj = 0.9) { box(mats.stone, cx, y, cz, sx + proj * 2, 0.9, sz + proj * 2); box(mats.stone, cx, y - 0.7, cz, sx + proj, 0.5, sz + proj); }

// ------------------------------------------------------------------ elementos
function lantern(cx, cz, y0, rw, h, capH, color = null) {
  // hiperboloide de una hoja (garganta estrecha) + cono con bola cerámica
  const prof = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8; prof.push([rw * Math.sqrt(1 + Math.pow((t - 0.5) * 3.2, 2)), y0 + t * h]); }
  lathe(mats.stone, cx, cz, prof, 16);
  const rt = prof[prof.length - 1][0];
  lathe(mats.stone, cx, cz, [[rt, y0 + h], [rt * 0.82, y0 + h + capH * 0.35], [rt * 0.5, y0 + h + capH * 0.75], [0.15 * rt, y0 + h + capH]], 16);
  if (color) sphere(mats[color], cx, y0 + h + capH + 0.25 * rt, cz, 0.28 * rt + 0.2, 8);
  // anillo oscuro (vidrio) en la garganta
  lathe(mats.dark, cx, cz, [[rw * 1.02, y0 + h * 0.4], [rw * 1.02, y0 + h * 0.6]], 16);
}

/** Torre parabólica. kind: sección base (p) y rotación. Devuelve la altura final de la cúspide. */
function tower(cx, cz, yBase, yTop, r0, opt = {}) {
  const { pBase = 2, rot = 0, bands = 9, color = "orange", slitRows = true, star = false, cross = false, taper = 0.9, squash = 1 } = opt;
  const H = yTop - yBase, tEnd = 0.9;
  const rAt = (t) => r0 * Math.pow(1 - taper * t, 0.72); // perfil parabólico: se afina de forma continua hacia la cúspide
  const rings = [];
  const steps = Math.max(14, Math.round(H / 3));
  for (let j = 0; j <= steps; j++) {
    const t = (j / steps) * tEnd, y = yBase + t * H;
    const p = pBase + (2 - pBase) * Math.min(1, t * 1.3);
    rings.push(ring(cx, cz, y, rAt(t), rAt(t) * squash, p, 20, rot));
  }
  loft(mats.stone, rings, true);
  // bandas horizontales (anillos algo más gruesos)
  for (let b = 1; b <= bands; b++) {
    const t = (b / (bands + 1)) * tEnd, y = yBase + t * H, r = rAt(t), p = pBase + (2 - pBase) * Math.min(1, t * 1.3);
    loft(mats.stone, [ring(cx, cz, y - 0.5, r * 1.04, r * 1.04 * squash, p, 20, rot), ring(cx, cz, y - 0.35, r * 1.1, r * 1.1 * squash, p, 20, rot), ring(cx, cz, y + 0.35, r * 1.1, r * 1.1 * squash, p, 20, rot), ring(cx, cz, y + 0.5, r * 1.04, r * 1.04 * squash, p, 20, rot)]);
  }
  // rendijas verticales oscuras (louvers) alrededor de la torre
  if (slitRows) {
    const rows = Math.max(3, Math.floor(H / 6.5));
    for (let rw = 0; rw < rows; rw++) {
      const t = ((rw + 0.6) / (rows + 0.4)) * tEnd * 0.95, y0 = yBase + t * H, hh = Math.min(5, H * 0.045);
      const sides = 6;
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2 + rot, r = rAt(t) * 1.02;
        const ux = -Math.sin(a), uz = Math.cos(a), nx = Math.cos(a), nz = Math.sin(a), w = Math.max(0.5, r * 0.28);
        panel(mats.dark, [cx + nx * r, y0, cz + nz * r], [ux, 0, uz], [0, 1, 0], [[-w / 2, 0], [w / 2, 0], [w / 2, hh], [-w / 2, hh]], [nx, 0, nz]);
      }
    }
  }
  // remate: bola cerámica + aguja
  const rEnd = rAt(tEnd), yE = yBase + tEnd * H;
  sphere(mats[color], cx, yE + rEnd * 0.9, cz, rEnd * 1.3, 12);
  lathe(mats.stone, cx, cz, [[rEnd * 0.35, yE + rEnd * 2], [rEnd * 0.15, yE + (yTop - yE) * 0.7], [0.05, yTop]], 8);
  if (cross) { // cruz de Jesucristo
    box(mats.stone, cx, yTop + 4, cz, 0.7, 8, 0.7); box(mats.stone, cx, yTop + 5.5, cz, 4.4, 0.7, 0.7); box(mats.stone, cx, yTop + 5.5, cz, 0.7, 0.7, 4.4);
  }
  if (star) { // estrella de María (12 puntas: 6 tablillas cruzadas)
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI; const w = 7, hh = 0.5; panel(mats.white, [cx - Math.cos(a) * w / 2, yTop + 3.5 - Math.sin(a) * w / 2 * 0, cz - Math.sin(a) * w / 2], [Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [[0, -0.2], [w, -0.2], [w, 0.2], [0, 0.2]], [-Math.sin(a), 0, Math.cos(a)]); }
    sphere(mats.white, cx, yTop + 3.5, cz, 1.3, 10);
  }
}

/** Contrafuerte (pilar con remate) y arbotante simplificado. */
function pier(x, z, h, sx = 1.2, sz = 1.2) { box(mats.stone, x, h / 2, z, sx, h, sz); box(mats.stone, x, h + 0.6, z, sx * 0.7, 1.2, sz * 0.7); }

// ------------------------------------------------------------------ construcción
const Z_GLORY = -50, Z_NAVE0 = -38, Z_T0 = -11.25, Z_T1 = 11.25, APSE_Z = 22, APSE_R = 20;

// plataforma
box(mats.stone, 0, 0.3, -2, 92, 0.6, 104);

// NAVE (5 naves de 7,5 m): exteriores 28 m, interiores 32 m, central 40 m + claraboyas
const naveLen = Z_T0 - Z_NAVE0, naveZ = (Z_T0 + Z_NAVE0) / 2;
box(mats.stone, 0, 14, naveZ, 45, 28, naveLen);                     // naves exteriores
box(mats.stone, 0, 16, naveZ, 30, 32, naveLen);                     // naves interiores
box(mats.stone, 0, 20, naveZ, 15, 40, naveLen);                     // nave central
for (let k = 0; k < 4; k++) { // ventanales del claristorio (nave central y laterales)
  const z0 = Z_NAVE0 + 3.75 + k * 7.5;
  for (const s of [-1, 1]) {
    arch([s * 7.55, 30, z0 - 1.6], [0, 0, 1], [0, 1, 0], [s, 0, 0], 3.2, 7);
    arch([s * 15.05, 22, z0 - 1.6], [0, 0, 1], [0, 1, 0], [s, 0, 0], 3.2, 5);
    arch([s * 22.55, 14, z0 - 1.6], [0, 0, 1], [0, 1, 0], [s, 0, 0], 3.2, 6.5);
  }
}
for (let k = 0; k <= 4; k++) { const z = Z_NAVE0 + k * 7.5; for (const s of [-1, 1]) { pier(s * 22.9, z, 26); pier(s * 15.4, z, 31); } }
for (const s of [-1, 1]) { cornice(s * 22.5, 28.2, naveZ, 0.2, naveLen, 0.5); cornice(s * 15, 32.2, naveZ, 0.2, naveLen, 0.5); cornice(s * 7.5, 40.2, naveZ, 0.2, naveLen, 0.5); }
// arbotantes (rampas escalonadas entre el pilar exterior y la nave central)
for (let k = 0; k <= 4; k++) { const z = Z_NAVE0 + k * 7.5; for (const s of [-1, 1]) for (let q = 0; q < 5; q++) box(mats.stone, s * (22 - q * 1.8), 28 + q * 2.4, z, 1.8, 0.9, 0.9); }
// claraboyas hiperboloides: central (2×4) e interiores (1×4 por lado), exteriores bajas
for (let k = 0; k < 4; k++) {
  const z = Z_NAVE0 + 3.75 + k * 7.5;
  for (const x of [-3.75, 3.75]) lantern(x, z, 40, 2.4, 8, 5, k % 2 ? "teal" : "orange");
  for (const s of [-1, 1]) { lantern(s * 11.25, z, 32, 1.9, 5, 3.5, "gold"); lantern(s * 18.75, z, 28, 1.6, 3.5, 2.8, "orange"); }
}

// TRANSEPTO (3 naves, 30 m de alto) y CRUCERO (60 m con gran claraboya)
box(mats.stone, 0, 17, 0, 60, 34, 22.5);
box(mats.stone, 0, 24, 0, 22.5, 48, 22.5);
for (const s of [-1, 1]) for (const zz of [-5.6, 5.6]) lantern(s * 20, zz, 34, 2.1, 6, 4, "teal");
lantern(0, 0, 48, 6.5, 14, 6, "gold");
for (const z of [-11.5, 11.5]) for (let k = -3; k <= 3; k++) { if (Math.abs(k) < 1.5) continue; pier(k * 7.5, z, 33); }

// ÁBSIDE: tramo recto + hemiciclo con capillas, bóveda de 75 m y torre de María
box(mats.stone, 0, 22, (Z_T1 + APSE_Z) / 2, 30, 44, APSE_Z - Z_T1);
const apseProfile = (r, h) => [[r, 0], [r, h]];
lathe(mats.stone, 0, APSE_Z, [[APSE_R, 0.6], [APSE_R, 34], [APSE_R * 0.92, 36]], 28);        // muro del ábside
lathe(mats.stone, 0, APSE_Z, [[14, 34], [14, 56], [11, 60]], 28);                              // cuerpo central del ábside
lathe(mats.stone, 0, APSE_Z, [[11, 60], [7.2, 68], [6.2, 75]], 24, true);                      // bóveda hiperboloide de 75 m
for (let k = 0; k < 7; k++) { // 7 capillas absidales
  const a = -Math.PI / 2 + ((k + 0.5) / 7) * Math.PI, cxk = Math.cos(a) * (APSE_R + 0.5) * 1, czk = APSE_Z + Math.sin(a) * (APSE_R + 0.5);
  lathe(mats.stone, cxk, czk, [[4.2, 0.6], [4.2, 20], [3.3, 22], [0.4, 27]], 14);
  sphere(mats.orange, cxk, 27.6, czk, 0.8, 8);
  arch([cxk + Math.cos(a) * 4.25, 6, czk + Math.sin(a) * 4.25], [-Math.sin(a), 0, Math.cos(a)], [0, 1, 0], [Math.cos(a), 0, Math.sin(a)], 2.4, 9);
}
// los cuatro evangelistas y las torres centrales
const evang = [[-11.25, -11.25, "orange"], [11.25, -11.25, "teal"], [-11.25, 11.25, "gold"], [11.25, 11.25, "orange"]];
for (const [x, z, c] of evang) tower(x, z, 40, 135, 4.8, { color: c, pBase: 2, bands: 11 });
tower(0, APSE_Z, 60, 138, 4.2, { color: "white", star: true, bands: 8, taper: 0.8 });
tower(0, 0, 44, 172.5, 8.6, { color: "gold", cross: true, bands: 13, taper: 0.82 });

// FACHADA DEL NACIMIENTO (este, +X): 3 pórticos, ciprés central y 4 torres
function facade(side, name) {
  const s = side, x0 = 30 * s;
  box(mats.stone, x0 + 4 * s, 20, 0, 8, 40, 32);
  const FN = [s, 0, 0]; // normal de la fachada
  const wallX = x0 + 8 * s;
  // ornamento común: cornisas, costillas verticales y filas de hornacinas sobre los pórticos
  for (const y of [24, 31, 38]) cornice(x0 + 4 * s, y, 0, 8, 32, 0.4);
  ribs(wallX, 31, 0, 30, 14, "z", s, 1.5, 0.5);
  for (const y0 of [25.5, 32.5]) niches([wallX + 0.02 * s, y0, 0], [0, 0, 1], [0, 1, 0], FN, 14, 1, 2.2, 7, 1.0, 4.2);
  if (name === "nac") {
    for (const [z, w, h] of [[-9.5, 6, 15], [9.5, 6, 15], [0, 8.5, 22]]) { arch([wallX + 0.05 * s, 0.6, z], [0, 0, 1], [0, 1, 0], FN, w, h); archFrame([wallX + 0.05 * s, 0.6, z], [0, 0, 1], [0, 1, 0], FN, w, h, 0.9, 0.9); }
    // ciprés (árbol de la vida) y pináculos escultóricos
    lathe(mats.stone, x0 + 8.3 * s, 0, [[1.9, 22], [1.4, 34], [0.8, 46], [0.12, 54]], 12);
    for (let k = -2; k <= 2; k++) box(mats.stone, x0 + 8.4 * s, 12, k * 6, 0.9, 24, 0.9);
    const tops = [104, 112, 112, 104];
    [-13.5, -4.5, 4.5, 13.5].forEach((z, i) => tower(x0 + 4.2 * s, z, 40, tops[i], 3.7, { color: ["orange", "teal", "gold", "orange"][i], pBase: 2.4, bands: 8 }));
  } else {
    // Pasión: 6 columnas inclinadas en forma de hueso, frontón piramidal y torres romboidales
    for (const z of [-9.5, 0, 9.5]) { arch([wallX + 0.05 * s, 0.6, z], [0, 0, 1], [0, 1, 0], FN, 5, 12); archFrame([wallX + 0.05 * s, 0.6, z], [0, 0, 1], [0, 1, 0], FN, 5, 12, 0.8, 0.8); }
    for (let k = 0; k < 6; k++) { const z = -13.75 + k * 5.5; loft(mats.stone, [ring(x0 + 9 * s, z, 0.6, 1.4, 1.4, 2, 10), ring(x0 + 8.4 * s, z, 12, 0.9, 0.9, 2, 10), ring(x0 + 7.6 * s, z, 24, 1.5, 1.5, 2, 10)], true); }
    box(mats.stone, x0 + 6.5 * s, 28, 0, 5, 3, 32);
    for (let k = -4; k <= 4; k++) loft(mats.stone, [ring(x0 + 5.2 * s, k * 3.4, 30, 0.45, 0.45, 2, 8), ring(x0 + 5.2 * s, k * 3.4, 40, 0.3, 0.3, 2, 8)], true);
    const gable = [[-16, 0], [16, 0], [0, 15]];
    panel(mats.stone, [x0 + 8.5 * s, 29.5, 0], [0, 0, 1], [0, 1, 0], gable.map(([a, b]) => [a, b]), [s, 0, 0]);
    const tops = [114, 118, 118, 114];
    [-13.5, -4.5, 4.5, 13.5].forEach((z, i) => tower(x0 + 4.2 * s, z, 40, tops[i], 3.7, { color: ["gold", "orange", "orange", "gold"][i], pBase: 4, rot: Math.PI / 4, bands: 8 }));
  }
}
facade(1, "nac");
facade(-1, "pas");

// FACHADA DE LA GLORIA (sur, -Z): pórtico de columnas, 7 puertas, 16 claraboyas y 4 torres
box(mats.stone, 0, 15, (Z_NAVE0 + Z_GLORY) / 2, 45, 30, Z_NAVE0 - Z_GLORY);
for (let k = 0; k < 7; k++) { arch([-15 + k * 5, 0.6, Z_GLORY - 0.05], [1, 0, 0], [0, 1, 0], [0, 0, -1], 3, 9); archFrame([-15 + k * 5, 0.6, Z_GLORY - 0.05], [1, 0, 0], [0, 1, 0], [0, 0, -1], 3, 9, 0.5, 0.6); }
ribs(0, 20, Z_GLORY, 44, 14, 'x', -1, 1.5, 0.5);
niches([0, 13, Z_GLORY - 0.03], [1, 0, 0], [0, 1, 0], [0, 0, -1], 18, 2, 2.4, 6, 1.1, 4);
cornice(0, 30.2, (Z_NAVE0 + Z_GLORY) / 2, 45, Z_NAVE0 - Z_GLORY, 0.5);
for (let k = 0; k < 6; k++) { const x = -18 + k * 7.2; loft(mats.stone, [ring(x, Z_GLORY - 1.6, 0.6, 2.0, 2.0, 2, 12), ring(x, Z_GLORY - 1.6, 14, 1.2, 1.2, 2, 12), ring(x, Z_GLORY - 1.6, 27, 1.9, 1.9, 2, 12)], true); }
box(mats.stone, 0, 28.5, Z_GLORY - 1.2, 46, 3, 5);
for (let k = 0; k < 9; k++) lantern(-16 + k * 4, Z_GLORY + 4, 30, 1.2, 4.5, 3, k % 2 ? "teal" : "orange");
for (let k = 0; k < 7; k++) lantern(-12 + k * 4, Z_GLORY + 9, 30, 1.3, 5, 3.4, k % 2 ? "gold" : "orange");
const gt = [114, 120, 120, 114];
[-16.5, -5.5, 5.5, 16.5].forEach((x, i) => tower(x, Z_GLORY + 6, 30, gt[i], 3.8, { color: ["teal", "orange", "orange", "teal"][i], pBase: 2.8, bands: 8 }));
// escalinata de acceso (3 peldaños)
for (let k = 0; k < 3; k++) box(mats.stone, 0, 0.6 + 0.6 * k, Z_GLORY - 1.2 - 1.2 * (2 - k), 48, 0.6, 2.4);

// ------------------------------------------------------------------ texturas de arenisca
const N = 1024;
const lattice = (freq, seed) => { const g = new Float32Array(freq * freq); let s = seed >>> 0; for (let i = 0; i < g.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; g[i] = s / 4294967296; } return g; };
const sm = (t) => t * t * (3 - 2 * t);
const vn = (x, y, f, g) => { const fx = x * f, fy = y * f, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0); const at = (i, j) => g[(((j % f) + f) % f) * f + (((i % f) + f) % f)]; const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1); return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty; };
const octs = [[4, 0.34], [8, 0.26], [16, 0.18], [32, 0.12], [64, 0.07], [128, 0.05], [256, 0.035]].map(([f, w], i) => ({ f, w, g: lattice(f, 7000 + i * 31) }));
const hmap = new Float32Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let v = 0, ws = 0; for (const o of octs) { v += vn(i / N, j / N, o.f, o.g) * o.w; ws += o.w; } hmap[j * N + i] = v / ws; }
const rgb = Buffer.alloc(N * N * 3), nrm = Buffer.alloc(N * N * 3);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const p = j * N + i, hv = hmap[p], grain = vn(i / N, j / N, 256, octs[6].g), pit = grain > 0.86 ? 0.88 : 1, k = (0.82 + (hv - 0.5) * 0.9) * pit;
  rgb[p * 3] = Math.min(255, 214 * k); rgb[p * 3 + 1] = Math.min(255, 198 * k); rgb[p * 3 + 2] = Math.min(255, 172 * k);
  const L = hmap[j * N + ((i + N - 1) % N)], R = hmap[j * N + ((i + 1) % N)], U = hmap[((j + N - 1) % N) * N + i], D = hmap[((j + 1) % N) * N + i];
  const gx = (L - R) * 5.5, gy = (U - D) * 5.5, gl = Math.hypot(gx, gy, 1);
  nrm[p * 3] = Math.round((gx / gl * 0.5 + 0.5) * 255); nrm[p * 3 + 1] = Math.round((gy / gl * 0.5 + 0.5) * 255); nrm[p * 3 + 2] = Math.round((1 / gl * 0.5 + 0.5) * 255);
}
const albedoWebp = await sharp(rgb, { raw: { width: N, height: N, channels: 3 } }).webp({ quality: 86 }).toBuffer();
const normalWebp = await sharp(nrm, { raw: { width: N, height: N, channels: 3 } }).webp({ quality: 90 }).toBuffer();

// ------------------------------------------------------------------ GLB
const doc = new Document();
doc.createExtension(EXTTextureWebP).setRequired(true);
const buffer = doc.createBuffer();
const stoneMat = doc.createMaterial("arenisca").setBaseColorTexture(doc.createTexture("albedo").setImage(albedoWebp).setMimeType("image/webp")).setNormalTexture(doc.createTexture("normal").setImage(normalWebp).setMimeType("image/webp")).setRoughnessFactor(0.92).setMetallicFactor(0);
const plain = (name, c, rough, metal = 0) => doc.createMaterial(name).setBaseColorFactor([...c, 1]).setRoughnessFactor(rough).setMetallicFactor(metal);
const materials = { stone: stoneMat, dark: plain("vidrio_oscuro", [0.025, 0.03, 0.035], 0.25), orange: plain("ceramica_naranja", [0.85, 0.38, 0.1], 0.35), teal: plain("ceramica_verde", [0.1, 0.5, 0.45], 0.35), gold: plain("ceramica_dorada", [0.9, 0.7, 0.2], 0.3, 0.2), white: plain("cristal_blanco", [0.95, 0.95, 0.9], 0.2) };
const mesh = doc.createMesh("sagrada_procedural");
let tris = 0;
for (const [key, g] of Object.entries(mats)) {
  if (!g.i.length) continue;
  // a espacio glTF (x, y, -z); el sentido de las caras se corrige con la normal
  const P = new Float32Array(g.p.length), Nn = new Float32Array(g.n.length);
  for (let k = 0; k < g.p.length; k += 3) { P[k] = g.p[k]; P[k + 1] = g.p[k + 1]; P[k + 2] = -g.p[k + 2]; Nn[k] = g.n[k]; Nn[k + 1] = g.n[k + 1]; Nn[k + 2] = -g.n[k + 2]; }
  const I = new Uint32Array(g.i);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const cr = cross(e1, e2), nn = [(Nn[a] + Nn[b] + Nn[c]) / 3, (Nn[a + 1] + Nn[b + 1] + Nn[c + 1]) / 3, (Nn[a + 2] + Nn[b + 2] + Nn[c + 2]) / 3];
    if (cr[0] * nn[0] + cr[1] * nn[1] + cr[2] * nn[2] < 0) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
  }
  tris += I.length / 3;
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(P).setBuffer(buffer))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(Nn).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(g.uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(I).setBuffer(buffer))
    .setMaterial(materials[key]);
  mesh.addPrimitive(prim);
}
doc.createScene("scene").addChild(doc.createNode("sagrada_procedural").setMesh(mesh));
await new NodeIO().registerExtensions([EXTTextureWebP]).write(out, doc);
console.log(`${out}: ${tris.toLocaleString()} triángulos · ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
