// Hornea el buzón de Correos (escaneo fotogramétrico de 1 M de triángulos, textura 8192²) a un prop ligero:
// medidas del cuerpo/zócalo + atlas de color (4 caras laterales + tapa) en WebP; el juego construye la geometría (3 cajas).
// Entrada: assets-src/props/correos-letterbox.glb (el escaneo incluye un trozo de acera; se recorta alrededor del buzón).
// Salida: public/assets/props/mailbox.webp + mailbox.json
// Uso: node scripts/bake-letterbox.mjs
import fs from "node:fs";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { flatten, join, weld } from "@gltf-transform/functions";

const SRC = "assets-src/props/correos-letterbox.glb";
const OUT = "public/assets/props";
fs.mkdirSync(OUT, { recursive: true });
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(SRC);
await doc.transform(flatten(), join({ keepMeshes: false, keepNamed: false }), weld({ tolerance: 0 }));
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const idx = prim.getIndices().getArray(), P = prim.getAttribute("POSITION").getArray(), UV = prim.getAttribute("TEXCOORD_0").getArray();
const { data: tex, info } = await sharp(Buffer.from(prim.getMaterial().getBaseColorTexture().getImage()), { limitInputPixels: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const TW = info.width, TH = info.height;
const bil = (u, v, o) => {
  const x = ((u - Math.floor(u)) * TW) - 0.5, y = ((v - Math.floor(v)) * TH) - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  for (let c = 0; c < 3; c++) { const g = (xx, yy) => tex[((Math.min(TH - 1, Math.max(0, yy)) * TW) + Math.min(TW - 1, Math.max(0, xx))) * 3 + c]; o[c] = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy; }
};
// la caja del escaneo (eje vertical = z): región de recorte
const R = { x0: -0.34, x1: 0.36, y0: -0.32, y1: 0.37, z0: 0.2 };
const inR = (i) => P[i * 3] > R.x0 && P[i * 3] < R.x1 && P[i * 3 + 1] > R.y0 && P[i * 3 + 1] < R.y1 && P[i * 3 + 2] > R.z0;
const tris = [];
for (let t = 0; t < idx.length; t += 3) if (inR(idx[t]) && inR(idx[t + 1]) && inR(idx[t + 2])) tris.push(idx[t], idx[t + 1], idx[t + 2]);
// medidas robustas (percentiles) por banda de altura
const pct = (a, p) => { const s = Float32Array.from(a).sort(); return s[Math.floor(p * (s.length - 1))]; };
const verts = new Set(tris);
const zs = [...verts].map((i) => P[i * 3 + 2]);
const zTop = pct(zs, 0.999), zBase = pct(zs, 0.002);
const band = (za, zb) => { const xs = [], ys = []; for (const i of verts) { const z = P[i * 3 + 2]; if (z >= za && z <= zb) { xs.push(P[i * 3]); ys.push(P[i * 3 + 1]); } } return { x0: pct(xs, 0.02), x1: pct(xs, 0.98), y0: pct(ys, 0.02), y1: pct(ys, 0.98) }; };
const H = zTop - zBase;
const plinthTop = zBase + 0.26 * H;
const plinth = band(zBase + 0.02, plinthTop - 0.03), body = band(plinthTop + 0.05, zTop - 0.05);
console.log("altura", H.toFixed(3), "zócalo hasta", (plinthTop - zBase).toFixed(3), "\n zócalo", JSON.stringify(plinth, (k, v) => (typeof v === "number" ? +v.toFixed(3) : v)), "\n cuerpo", JSON.stringify(body, (k, v) => (typeof v === "number" ? +v.toFixed(3) : v)));

// ---- elevaciones ortográficas de las 4 caras + tapa
const PXM = 820; // píxeles por metro
const hx0 = Math.min(plinth.x0, body.x0) - 0.01, hx1 = Math.max(plinth.x1, body.x1) + 0.01, hy0 = Math.min(plinth.y0, body.y0) - 0.01, hy1 = Math.max(plinth.y1, body.y1) + 0.01;
const wX = Math.round((hx1 - hx0) * PXM), wY = Math.round((hy1 - hy0) * PXM), hh = Math.round(H * PXM);
// cara: nombre, eje de profundidad (0=x,1=y), signo, función horizontal h(x,y), ancho en px, rango horizontal
const faces = [
  { n: "px", ax: 0, s: 1, h: (x, y) => (y - hy0), w: wY },       // +X: derecha = +Y
  { n: "nx", ax: 0, s: -1, h: (x, y) => (hy1 - y), w: wY },      // -X: derecha = -Y
  { n: "py", ax: 1, s: 1, h: (x, y) => (hx1 - x), w: wX },       // +Y: derecha = -X
  { n: "ny", ax: 1, s: -1, h: (x, y) => (x - hx0), w: wX },      // -Y: derecha = +X
];
const ATLAS_W = faces.reduce((a, f) => a + f.w, 0), ATLAS_H = hh + Math.max(wX, wY);
const atlas = Buffer.alloc(ATLAS_W * ATLAS_H * 3, 128);
const hitMask = new Uint8Array(ATLAS_W * ATLAS_H);
const tmp = [0, 0, 0];
let offX = 0;
const rects = {};
function render(w, h, projX, projY, depthOf, ox, oy) {
  const zb = new Float32Array(w * h).fill(-1e9);
  for (let t = 0; t < tris.length; t += 3) {
    const v = [tris[t], tris[t + 1], tris[t + 2]];
    const px = v.map((i) => projX(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])), py = v.map((i) => projY(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])), pz = v.map((i) => depthOf(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    const den = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2]);
    if (Math.abs(den) < 1e-12) continue;
    const x0 = Math.max(0, Math.floor(Math.min(...px))), x1 = Math.min(w - 1, Math.ceil(Math.max(...px))), y0 = Math.max(0, Math.floor(Math.min(...py))), y1 = Math.min(h - 1, Math.ceil(Math.max(...py)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const l0 = ((py[1] - py[2]) * (x + 0.5 - px[2]) + (px[2] - px[1]) * (y + 0.5 - py[2])) / den, l1 = ((py[2] - py[0]) * (x + 0.5 - px[2]) + (px[0] - px[2]) * (y + 0.5 - py[2])) / den, l2 = 1 - l0 - l1;
      if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue;
      const zz = l0 * pz[0] + l1 * pz[1] + l2 * pz[2], o = y * w + x;
      if (zz <= zb[o]) continue;
      zb[o] = zz;
      bil(l0 * UV[v[0] * 2] + l1 * UV[v[1] * 2] + l2 * UV[v[2] * 2], l0 * UV[v[0] * 2 + 1] + l1 * UV[v[1] * 2 + 1] + l2 * UV[v[2] * 2 + 1], tmp);
      const a = ((oy + y) * ATLAS_W + ox + x) * 3;
      atlas[a] = tmp[0]; atlas[a + 1] = tmp[1]; atlas[a + 2] = tmp[2];
      hitMask[(oy + y) * ATLAS_W + ox + x] = 1;
    }
  }
}
for (const f of faces) {
  render(f.w, hh, (x, y) => f.h(x, y) * PXM, (x, y, z) => (zTop - z) * PXM, (x, y) => f.s * (f.ax === 0 ? x : y), offX, 0);
  rects[f.n] = { u0: offX / ATLAS_W, u1: (offX + f.w) / ATLAS_W, v0: 0, v1: hh / ATLAS_H };
  offX += f.w;
}
// tapa (vista desde arriba: derecha = +X, arriba de la imagen = +Y)
render(wX, wY, (x) => (x - hx0) * PXM, (x, y) => (hy1 - y) * PXM, (x, y, z) => z, 0, hh);
rects.top = { u0: 0, u1: wX / ATLAS_W, v0: hh / ATLAS_H, v1: (hh + wY) / ATLAS_H };
// píxeles sin geometría (esquinas redondeadas de la tapa, bordes): se rellenan con el color vecino para que no aparezca gris
{
  let frontier = [];
  for (let o = 0; o < hitMask.length; o++) if (hitMask[o]) frontier.push(o);
  for (let d = 0; d < 14 && frontier.length; d++) {
    const next = [];
    for (const o of frontier) {
      const x = o % ATLAS_W, y = (o / ATLAS_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= ATLAS_W || ny >= ATLAS_H) continue;
        const q = ny * ATLAS_W + nx;
        if (hitMask[q]) continue;
        hitMask[q] = 1; atlas[q * 3] = atlas[o * 3]; atlas[q * 3 + 1] = atlas[o * 3 + 1]; atlas[q * 3 + 2] = atlas[o * 3 + 2]; next.push(q);
      }
    }
    frontier = next;
  }
}
await sharp(atlas, { raw: { width: ATLAS_W, height: ATLAS_H, channels: 3 } }).webp({ quality: 86 }).toFile(`${OUT}/mailbox.webp`);
const meta = {
  height: +H.toFixed(3), plinthHeight: +(plinthTop - zBase).toFixed(3),
  // extensiones relativas al centro del cuerpo (metros), en el eje x/y del escaneo
  footprint: { x0: +hx0.toFixed(3), x1: +hx1.toFixed(3), y0: +hy0.toFixed(3), y1: +hy1.toFixed(3) },
  plinth: Object.fromEntries(Object.entries(plinth).map(([k, v]) => [k, +v.toFixed(3)])), body: Object.fromEntries(Object.entries(body).map(([k, v]) => [k, +v.toFixed(3)])),
  pxm: PXM, hh, atlas: { w: ATLAS_W, h: ATLAS_H }, rects,
};
fs.writeFileSync(`${OUT}/mailbox.json`, JSON.stringify(meta));
console.log("atlas", ATLAS_W, "×", ATLAS_H, "·", (fs.statSync(`${OUT}/mailbox.webp`).size / 1024).toFixed(0), "KB");
await sharp(atlas, { raw: { width: ATLAS_W, height: ATLAS_H, channels: 3 } }).resize({ width: 1400 }).jpeg({ quality: 82 }).toFile("assets-src/props/mailbox-atlas-preview.jpg");
