// Genera la textura de DETALLE de piedra (repetible) que el juego superpone al modelo de la basílica al acercarse:
//   R = variación de albedo (0,5 = neutro), G/B = normal X/Y (0,5 = plano), A = rugosidad. Formato del "detail map" de Babylon.js.
// Uso: node scripts/make-detail-map.mjs [salida.webp]
import sharp from "sharp";
const out = process.argv[2] ?? "public/assets/buildings/stone-detail.webp";
const N = 1024;
const lattice = (f, seed) => { const g = new Float32Array(f * f); let s = seed >>> 0; for (let i = 0; i < g.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; g[i] = s / 4294967296; } return g; };
const sm = (t) => t * t * (3 - 2 * t);
const vn = (x, y, f, g) => { const fx = x * f, fy = y * f, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0); const at = (i, j) => g[(((j % f) + f) % f) * f + (((i % f) + f) % f)]; const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1); return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty; };
const octs = [[8, 0.18], [16, 0.2], [32, 0.2], [64, 0.18], [128, 0.14], [256, 0.1]].map(([f, w], i) => ({ f, w, g: lattice(f, 4242 + i * 97) }));
const h = new Float32Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { let v = 0, ws = 0; for (const o of octs) { v += vn(i / N, j / N, o.f, o.g) * o.w; ws += o.w; } h[j * N + i] = v / ws; }
const buf = Buffer.alloc(N * N * 4);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
  const p = j * N + i, hv = h[p];
  const grain = vn(i / N, j / N, 256, octs[5].g), pit = grain > 0.88 ? -0.08 : 0;
  const L = h[j * N + ((i + N - 1) % N)], R = h[j * N + ((i + 1) % N)], U = h[((j + N - 1) % N) * N + i], D = h[((j + 1) % N) * N + i];
  const gx = (L - R) * 9, gy = (U - D) * 9, gl = Math.hypot(gx, gy, 1);
  buf[p * 4] = Math.max(0, Math.min(255, Math.round((0.5 + (hv - 0.5) * 0.7 + pit) * 255)));
  buf[p * 4 + 1] = Math.round((gx / gl * 0.5 + 0.5) * 255);
  buf[p * 4 + 2] = Math.round((gy / gl * 0.5 + 0.5) * 255);
  buf[p * 4 + 3] = Math.round((0.55 + (hv - 0.5) * 0.3) * 255);
}
await sharp(buf, { raw: { width: N, height: N, channels: 4 } }).webp({ quality: 92, alphaQuality: 90 }).toFile(out);
console.log("detalle de piedra →", out);
