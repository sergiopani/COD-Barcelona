// Vista previa (proyección ortográfica con textura) del modelo de la Casa Batlló desde los 4 lados, para ver su orientación.
// Uso: node scripts/batllo-views.mjs <salida-prefijo>
import fs from "node:fs";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { flatten, join, weld } from "@gltf-transform/functions";

const out = process.argv[2];
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read("assets-src/buildings/casa-batllo.glb");
await doc.transform(flatten(), join({ keepMeshes: false, keepNamed: false }), weld({ tolerance: 0 }));
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const idx = prim.getIndices().getArray(), P = prim.getAttribute("POSITION").getArray(), UV = prim.getAttribute("TEXCOORD_0").getArray();
const tex = prim.getMaterial().getBaseColorTexture();
const img = sharp(Buffer.from(tex.getImage()), { limitInputPixels: false });
const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
const TW = info.width, TH = info.height;
const sample = (u, v) => {
  const x = Math.min(TW - 1, Math.max(0, Math.floor((u - Math.floor(u)) * TW)));
  const y = Math.min(TH - 1, Math.max(0, Math.floor((v - Math.floor(v)) * TH)));
  const o = (y * TW + x) * 3;
  return [data[o], data[o + 1], data[o + 2]];
};
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
console.log("bounds", mn.map((v) => v.toFixed(2)), mx.map((v) => v.toFixed(2)), "tex", TW, TH);
// vistas: [nombre, ejeU, ejeV, ejeProfundidad, signo (cámara en ese lado)]
const views = [["zpos", 0, 1, 2, 1], ["zneg", 0, 1, 2, -1], ["xpos", 2, 1, 0, 1], ["xneg", 2, 1, 0, -1]];
for (const [name, a, c, d, s] of views) {
  const sc = 150, W = Math.ceil((mx[a] - mn[a]) * sc) + 2, H = Math.ceil((mx[c] - mn[c]) * sc) + 2;
  const col = new Uint8Array(W * H * 3).fill(30), z = new Float32Array(W * H).fill(-1e9);
  const flipU = (s === 1) === (d === 2) ? false : true; // espejo para que se vea "desde fuera"
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    const px = v.map((i) => (flipU ? (mx[a] - P[i * 3 + a]) : (P[i * 3 + a] - mn[a])) * sc), py = v.map((i) => (mx[c] - P[i * 3 + c]) * sc), pz = v.map((i) => s * P[i * 3 + d]);
    const x0 = Math.max(0, Math.floor(Math.min(...px))), x1 = Math.min(W - 1, Math.ceil(Math.max(...px)));
    const y0 = Math.max(0, Math.floor(Math.min(...py))), y1 = Math.min(H - 1, Math.ceil(Math.max(...py)));
    const den = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2]);
    if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const l0 = ((py[1] - py[2]) * (x + 0.5 - px[2]) + (px[2] - px[1]) * (y + 0.5 - py[2])) / den;
      const l1 = ((py[2] - py[0]) * (x + 0.5 - px[2]) + (px[0] - px[2]) * (y + 0.5 - py[2])) / den;
      const l2 = 1 - l0 - l1;
      if (l0 < -0.01 || l1 < -0.01 || l2 < -0.01) continue;
      const zz = l0 * pz[0] + l1 * pz[1] + l2 * pz[2];
      const o = y * W + x;
      if (zz <= z[o]) continue;
      z[o] = zz;
      const u = l0 * UV[v[0] * 2] + l1 * UV[v[1] * 2] + l2 * UV[v[2] * 2], w = l0 * UV[v[0] * 2 + 1] + l1 * UV[v[1] * 2 + 1] + l2 * UV[v[2] * 2 + 1];
      const c3 = sample(u, w);
      col[o * 3] = c3[0]; col[o * 3 + 1] = c3[1]; col[o * 3 + 2] = c3[2];
    }
  }
  await sharp(Buffer.from(col), { raw: { width: W, height: H, channels: 3 } }).png().toFile(`${out}-${name}.png`);
  console.log(name, W, H);
}
