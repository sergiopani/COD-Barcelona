// Convierte el modelo fotogramétrico de Barcelona (assets-src/city/barcelona_espana.glb, ~1,4 × 1,4 km, 166 MB) en un DECORADO ligero para el juego:
//   · lo alinea con el mapa (la manzana de la Sagrada Família en el origen, calles paralelas a los ejes, suelo en y = 0)
//   · recorta un hueco cuadrado donde está el mapa jugable (allí manda el mapa procedural y la basílica)
//   · simplifica la malla (meshoptimizer, bordes de tesela bloqueados) y reduce las texturas a WebP
// Salida: public/assets/city/barcelona-backdrop.glb  (el juego la carga con rotación Y = 180°, ver CityBackdrop.ts)
// Uso: node scripts/build-city-backdrop.mjs [--hole 152] [--tex 512] [--ratio 0.35] [--rot 1.5] [--cx 167.5] [--cz 365] [--ground -46.5]
import fs from "node:fs";
import sharp from "sharp";
import { MeshoptSimplifier } from "meshoptimizer";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP, KHRMeshQuantization, KHRTextureTransform } from "@gltf-transform/extensions";
import { flatten, prune, quantize, simplify, textureCompress, weld } from "@gltf-transform/functions";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const HOLE = opt("hole", 152), TEX = opt("tex", 512), RATIO = opt("ratio", 1); // (la malla fotogramétrica no se deja simplificar: cada triángulo trae su propio UV)
const ROT = (opt("rot", 1.5) * Math.PI) / 180, CX = opt("cx", 167.5), CZ = opt("cz", 365), GROUND = opt("ground", -46.5);
const SRC = "assets-src/city/barcelona_espana.glb", OUT = "public/assets/city/barcelona-backdrop.glb";

await MeshoptSimplifier.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(SRC);
await doc.transform(flatten());
const c = Math.cos(ROT), s = Math.sin(ROT);
let before = 0, after = 0, hole = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const M = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const posA = prim.getAttribute("POSITION"), P = posA.getArray();
    // vértices a coordenadas del juego (frame glTF: x = este, z "hacia abajo" en la vista cenital; la rotación Y = 180° del cargador lo deja en X este / Z norte)
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      const wx = M[0] * x + M[4] * y + M[8] * z + M[12], wy = M[1] * x + M[5] * y + M[9] * z + M[13], wz = M[2] * x + M[6] * y + M[10] * z + M[14];
      const tx = wx - CX, tz = wz - CZ;
      P[i] = tx * c - tz * s;
      P[i + 1] = wy - GROUND;
      P[i + 2] = tx * s + tz * c;
    }
    posA.setArray(P);
    // triángulos fuera del hueco del mapa jugable
    const idxA = prim.getIndices();
    const idx = idxA.getArray(), keep = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, d = idx[t + 2] * 3;
      const mx = (P[a] + P[b] + P[d]) / 3, mz = (P[a + 2] + P[b + 2] + P[d + 2]) / 3;
      before++;
      if (Math.abs(mx) < HOLE && Math.abs(mz) < HOLE) { hole++; continue; }
      keep.push(idx[t], idx[t + 1], idx[t + 2]);
      after++;
    }
    idxA.setArray(new Uint32Array(keep));
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); // los vértices ya están en coordenadas globales
  }
}
// quita las mallas que se quedaron vacías (teselas enteras dentro del hueco)
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) if (prim.getIndices().getCount() === 0) prim.dispose();
console.log(`triángulos: ${before} → ${after} (${hole} en el hueco del mapa jugable)`);
// el decorado se dibuja SIN luz (la foto ya lleva la iluminación): las normales sobran
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) { const n = prim.getAttribute("NORMAL"); if (n) { prim.setAttribute("NORMAL", null); n.dispose(); } }
await doc.transform(
  prune(),
  weld({ tolerance: 0 }),
  ...(RATIO < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.02, lockBorder: true })] : []),
  quantize({ quantizePosition: 14, quantizeTexcoord: 12, quantizeNormal: 8 }),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [TEX, TEX], quality: 80, limitInputPixels: false }),
  prune(),
);
fs.mkdirSync("public/assets/city", { recursive: true });
const io = new NodeIO().registerExtensions([EXTTextureWebP, KHRMeshQuantization, KHRTextureTransform]);
await io.write(OUT, doc);
let tris = 0;
doc.getRoot().listMeshes().forEach((m) => m.listPrimitives().forEach((p) => (tris += p.getIndices().getCount() / 3)));
console.log(`${OUT}: ${Math.round(tris).toLocaleString()} triángulos · ${doc.getRoot().listTextures().length} texturas ${TEX}² · ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);
