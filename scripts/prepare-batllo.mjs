// Prepara el modelo de la Casa Batlló (1,9 M de triángulos, texturas 4K) para usarlo como edificio repetido en el juego:
// aplana la jerarquía, une las mallas en una sola, simplifica, centra (base en y=0, huella en el origen) y comprime texturas.
// Uso: node scripts/prepare-batllo.mjs [triángulos objetivo=14000] [textura=2048]
import fs from "node:fs";
import sharp from "sharp";
import { MeshoptSimplifier } from "meshoptimizer";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, flatten, getBounds, join, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";

const target = Number(process.argv[2] ?? 14000);
const texSize = Number(process.argv[3] ?? 2048);
const src = "assets-src/buildings/casa-batllo.glb";
const dst = "public/assets/buildings/casa-batllo.glb";
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const tris = () => doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
const before = tris();
await doc.transform(flatten(), join({ keepMeshes: false, keepNamed: false }), weld({ tolerance: 0 }));
const afterJoin = tris();
await doc.transform(
  simplify({ simplifier: MeshoptSimplifier, ratio: target / afterJoin, error: Number(process.argv[4] ?? 0.1), lockBorder: false }),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: "webp", resize: [texSize, texSize], quality: 84, limitInputPixels: false }),
  prune(),
);
// base en y=0 y huella centrada en el origen
const scene = doc.getRoot().listScenes()[0];
const b = getBounds(scene);
for (const n of scene.listChildren()) {
  const t = n.getTranslation();
  n.setTranslation([t[0] - (b.min[0] + b.max[0]) / 2, t[1] - b.min[1], t[2] - (b.min[2] + b.max[2]) / 2]);
}
await io.write(dst, doc);
const b2 = getBounds(scene);
console.log(`Casa Batlló: ${Math.round(before).toLocaleString()} → ${Math.round(tris()).toLocaleString()} triángulos · ${(fs.statSync(dst).size / 1048576).toFixed(1)} MB · tamaño ${b2.max.map((v, i) => (v - b2.min[i]).toFixed(2)).join(" × ")}`);
