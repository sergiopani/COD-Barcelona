// Hornea la fachada de la Casa Batlló (modelo de 1,9 M de triángulos, texturas 4K) a un "relieve" ligero:
//   · casa-batllo-0..3.webp : elevación frontal (color + alfa de silueta) en 4 paletas (giro de tono)
//   · casa-batllo-relief.json : mapa de profundidad en una rejilla gruesa (el juego genera de ahí la malla, ~7 k triángulos)
// La fachada del modelo mira a +X; se proyecta ortográficamente desde ahí.
// Uso: node scripts/bake-batllo.mjs [ancho_px=1024] [celdas_x=40]
import fs from "node:fs";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { flatten, join, weld } from "@gltf-transform/functions";

const W = Number(process.argv[2] ?? 1024);
const GX = Number(process.argv[3] ?? 40);
const outDir = "public/assets/buildings";
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read("assets-src/buildings/casa-batllo.glb");
await doc.transform(flatten(), join({ keepMeshes: false, keepNamed: false }), weld({ tolerance: 0 }));
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const idx = prim.getIndices().getArray(), P = prim.getAttribute("POSITION").getArray(), UV = prim.getAttribute("TEXCOORD_0").getArray();
const { data: tex, info } = await sharp(Buffer.from(prim.getMaterial().getBaseColorTexture().getImage()), { limitInputPixels: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const TW = info.width, TH = info.height;
const bil = (u, v, out) => {
  const x = ((u - Math.floor(u)) * TW) - 0.5, y = ((v - Math.floor(v)) * TH) - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const g = (xx, yy) => tex[((Math.min(TH - 1, Math.max(0, yy)) * TW) + Math.min(TW - 1, Math.max(0, xx))) * 3 + c];
    out[c] = (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
  }
};
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
const widthU = mx[2] - mn[2], heightU = mx[1] - mn[1], depthU = mx[0] - mn[0];
const H = Math.round((W * heightU) / widthU);
const sc = W / widthU;
console.log("modelo (unidades):", widthU.toFixed(3), "×", heightU.toFixed(3), "× prof.", depthU.toFixed(3), "→ imagen", W, "×", H);

const rgb = new Float32Array(W * H * 3), zb = new Float32Array(W * H).fill(-1e9), hit = new Uint8Array(W * H);
const tmp = [0, 0, 0];
for (let t = 0; t < idx.length; t += 3) {
  const v = [idx[t], idx[t + 1], idx[t + 2]];
  const px = v.map((i) => (mx[2] - P[i * 3 + 2]) * sc), py = v.map((i) => (mx[1] - P[i * 3 + 1]) * sc), pz = v.map((i) => P[i * 3]);
  // solo caras que miran a +X (o casi): descarta traseras para que no oculten
  const ax = px[1] - px[0], ay = py[1] - py[0], bx = px[2] - px[0], by = py[2] - py[0];
  const den = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2]);
  if (Math.abs(den) < 1e-9) continue;
  const x0 = Math.max(0, Math.floor(Math.min(...px))), x1 = Math.min(W - 1, Math.ceil(Math.max(...px)));
  const y0 = Math.max(0, Math.floor(Math.min(...py))), y1 = Math.min(H - 1, Math.ceil(Math.max(...py)));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const l0 = ((py[1] - py[2]) * (x + 0.5 - px[2]) + (px[2] - px[1]) * (y + 0.5 - py[2])) / den;
    const l1 = ((py[2] - py[0]) * (x + 0.5 - px[2]) + (px[0] - px[2]) * (y + 0.5 - py[2])) / den;
    const l2 = 1 - l0 - l1;
    if (l0 < -0.02 || l1 < -0.02 || l2 < -0.02) continue;
    const zz = l0 * pz[0] + l1 * pz[1] + l2 * pz[2];
    const o = y * W + x;
    if (zz <= zb[o]) continue;
    zb[o] = zz; hit[o] = 1;
    bil(l0 * UV[v[0] * 2] + l1 * UV[v[1] * 2] + l2 * UV[v[2] * 2], l0 * UV[v[0] * 2 + 1] + l1 * UV[v[1] * 2 + 1] + l2 * UV[v[2] * 2 + 1], tmp);
    rgb[o * 3] = tmp[0]; rgb[o * 3 + 1] = tmp[1]; rgb[o * 3 + 2] = tmp[2];
  }
}
// cierre morfológico: rellena huecos pequeños dentro de la silueta
for (let pass = 0; pass < 2; pass++) {
  const add = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const o = y * W + x;
    if (hit[o]) continue;
    let n = 0, r = 0, g = 0, b = 0, z = -1e9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const q = o + dy * W + dx; if (hit[q]) { n++; r += rgb[q * 3]; g += rgb[q * 3 + 1]; b += rgb[q * 3 + 2]; z = Math.max(z, zb[q]); } }
    if (n >= 5) add.push([o, r / n, g / n, b / n, z]);
  }
  for (const [o, r, g, b, z] of add) { hit[o] = 1; rgb[o * 3] = r; rgb[o * 3 + 1] = g; rgb[o * 3 + 2] = b; zb[o] = z; }
}
// huecos interiores (cristales de las ventanas sin geometría): fondo no alcanzable desde el borde → interior oscuro
{
  const outside = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => { const o = y * W + x; if (!hit[o] && !outside[o]) { outside[o] = 1; stack.push(o); } };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const o = stack.pop(), x = o % W, y = (o / W) | 0;
    if (x > 0) push(x - 1, y); if (x < W - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < H - 1) push(x, y + 1);
  }
  let holes = 0;
  for (let o = 0; o < W * H; o++) if (!hit[o] && !outside[o]) { hit[o] = 1; rgb[o * 3] = 34; rgb[o * 3 + 1] = 32; rgb[o * 3 + 2] = 30; zb[o] = -1e9; holes++; }
  // la profundidad de esos huecos = la del vecino más cercano con geometría, algo hundida
  let fixed = 0;
  for (let pass = 0; pass < 30 && fixed < holes; pass++) for (let o = 0; o < W * H; o++) if (zb[o] === -1e9 && hit[o]) {
    let z = -1e9; const x = o % W, y = (o / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && zb[ny * W + nx] > -1e8) z = Math.max(z, zb[ny * W + nx]); }
    if (z > -1e8) { zb[o] = z - 0.01; fixed++; }
  }
  console.log("huecos interiores rellenados:", holes);
}
// relleno de color en el fondo (evita halos oscuros con mipmaps)
const filled = new Float32Array(rgb);
const dist = new Int16Array(W * H).fill(-1);
let frontier = [];
for (let o = 0; o < W * H; o++) if (hit[o]) { dist[o] = 0; frontier.push(o); }
for (let d = 1; d <= 12 && frontier.length; d++) {
  const next = [];
  for (const o of frontier) {
    const x = o % W, y = (o / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = ny * W + nx;
      if (dist[q] !== -1) continue;
      dist[q] = d; filled[q * 3] = filled[o * 3]; filled[q * 3 + 1] = filled[o * 3 + 1]; filled[q * 3 + 2] = filled[o * 3 + 2]; next.push(q);
    }
  }
  frontier = next;
}
const rgba = Buffer.alloc(W * H * 4);
for (let o = 0; o < W * H; o++) { rgba[o * 4] = filled[o * 3]; rgba[o * 4 + 1] = filled[o * 3 + 1]; rgba[o * 4 + 2] = filled[o * 3 + 2]; rgba[o * 4 + 3] = hit[o] ? 255 : 0; }

// cuatro paletas: el color del mosaico/tejado (píxeles saturados) cambia de tono; la piedra (poco saturada) solo se matiza
function recolor(src, hueDeg, stone) {
  const out = Buffer.from(src);
  for (let o = 0; o < W * H; o++) {
    let r = src[o * 4] / 255, g = src[o * 4 + 1] / 255, b = src[o * 4 + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const sat = mx === 0 ? 0 : d / mx;
    if (sat > 0.28 && hueDeg !== 0) {
      let h = d === 0 ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (((h * 60 + hueDeg) % 360) + 360) % 360;
      const c = mx * sat, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = mx - c;
      const [rr, gg, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
      r = rr + m; g = gg + m; b = bb + m;
    } else {
      // matiz suave de la piedra, tanto más fuerte cuanto menos saturado el píxel
      const k = 1 - Math.min(1, sat / 0.28);
      r *= 1 + (stone[0] - 1) * k; g *= 1 + (stone[1] - 1) * k; b *= 1 + (stone[2] - 1) * k;
    }
    out[o * 4] = Math.min(255, r * 255); out[o * 4 + 1] = Math.min(255, g * 255); out[o * 4 + 2] = Math.min(255, b * 255);
  }
  return out;
}
const variants = [
  { hue: 0, stone: [1, 1, 1] },          // original: mosaico azul-verde, piedra crema
  { hue: 150, stone: [1.06, 0.96, 0.84] }, // mosaico anaranjado/dorado, piedra cálida
  { hue: -95, stone: [0.9, 1.0, 0.92] },   // mosaico verde, piedra grisácea
  { hue: 95, stone: [1.05, 0.96, 0.96] },  // mosaico rosado, piedra rosada
];
for (let i = 0; i < variants.length; i++) {
  const buf = i === 0 ? rgba : recolor(rgba, variants[i].hue, variants[i].stone);
  await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 85, alphaQuality: 100 }).toFile(`${outDir}/casa-batllo-${i}.webp`);
}
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toFile("assets-src/buildings/casa-batllo-front.png");

// rejilla de profundidad: media de las muestras con impacto en cada vértice (ventana de una celda)
const GY = Math.round((GX * H) / W);
const cw = W / GX, ch = H / GY;
const depth = new Float32Array((GX + 1) * (GY + 1)).fill(NaN);
const cover = new Float32Array(GX * GY);
for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) {
  const cx = i * cw, cy = j * ch;
  let s = 0, n = 0;
  for (let y = Math.max(0, Math.floor(cy - ch / 2)); y < Math.min(H, Math.ceil(cy + ch / 2)); y++) for (let x = Math.max(0, Math.floor(cx - cw / 2)); x < Math.min(W, Math.ceil(cx + cw / 2)); x++) { const o = y * W + x; if (hit[o]) { s += zb[o]; n++; } }
  if (n > 0) depth[j * (GX + 1) + i] = s / n;
}
for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
  let n = 0;
  for (let y = Math.floor(j * ch); y < Math.min(H, Math.ceil((j + 1) * ch)); y++) for (let x = Math.floor(i * cw); x < Math.min(W, Math.ceil((i + 1) * cw)); x++) n += hit[y * W + x];
  cover[j * GX + i] = n / (cw * ch);
}
// huecos: copia de vecinos
for (let pass = 0; pass < 40; pass++) {
  let changed = false;
  for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) {
    const o = j * (GX + 1) + i;
    if (!Number.isNaN(depth[o])) continue;
    const ns = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => (i + dx >= 0 && i + dx <= GX && j + dy >= 0 && j + dy <= GY ? depth[(j + dy) * (GX + 1) + i + dx] : NaN)).filter((v) => !Number.isNaN(v));
    if (ns.length) { depth[o] = Math.min(...ns); changed = true; }
  }
  if (!changed) break;
}
// plano de la pared de mosaico = mediana de las profundidades en la zona central de la fachada (v 0,3-0,8 desde arriba)
const samples = [];
for (let y = Math.floor(H * 0.3); y < H * 0.8; y += 3) for (let x = Math.floor(W * 0.2); x < W * 0.8; x += 3) if (hit[y * W + x]) samples.push(zb[y * W + x]);
samples.sort((p, q) => p - q);
const zwall = samples[Math.floor(samples.length / 2)];
// relieve relativo a ese plano, en unidades de ANCHO de fachada (se escala igual que u); recortado a [-0,16, 0,10]
const rel = Array.from(depth, (z) => Math.round(Math.max(-0.16, Math.min(0.1, (z - zwall) / widthU)) * 1000) / 1000);
const covQ = Array.from(cover, (c) => Math.round(c * 100) / 100);
const rowProfile = [];
for (let y = 0; y < H; y += Math.round(H / 48)) { let n = 0; for (let x = 0; x < W; x++) n += hit[y * W + x]; rowProfile.push(Math.round((n / W) * 100) / 100); }
fs.writeFileSync(`${outDir}/casa-batllo-relief.json`, JSON.stringify({ gx: GX, gy: GY, aspect: widthU / heightU, texW: W, texH: H, uMin: 0.035, uMax: 0.9, vGround: 0.845, vRoof: 0.27, depth: rel, cover: covQ }));
console.log("rejilla", GX, "×", GY, "→", 2 * GX * GY, "triángulos · profundidad máx. (en anchos):", Math.max(...rel).toFixed(3), "· ocupación por fila (de arriba abajo):", rowProfile.join(" "));
console.log("archivos:", fs.readdirSync(outDir).filter((f) => f.startsWith("casa-batllo")).map((f) => f + " " + (fs.statSync(`${outDir}/${f}`).size / 1024).toFixed(0) + "KB").join(", "));
