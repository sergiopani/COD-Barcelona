// Optimiza los GLB del juego: simplifica la malla (meshoptimizer), reduce las texturas y las pasa a WebP.
// Entrada: assets-src/<ruta>.glb (originales, fuera de git)  →  Salida: public/assets/<ruta>.glb
// Uso: node scripts/optimize-models.mjs [nombre...]   (sin argumentos: todos)
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { MeshoptSimplifier } from "meshoptimizer";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";

const JOBS = {
  // Alternativa (no se usa por defecto): maqueta de MiniWorld3D convertida con scripts/stl-to-glb.mjs.
  // La basílica activa es la fotogrametría del ICGC (npm run build:sagrada); este trabajo escribe en otro archivo para no pisarla.
  sagradaMiniworld: { file: "buildings/sagrada-familia.glb", out: "buildings/sagrada-familia-miniworld.glb", optional: true, ratio: 1, error: 0, tex: 1024, quality: 88 },
  rifle: { file: "weapons/m1a-springfield.glb", ratio: 0.2, error: 0.0008, tex: 2048, quality: 88 },
  cars: { file: "props/car-pack.glb", ratio: 1, error: 0, tex: 1024, quality: 85 },
  palm: { file: "props/palm-tree.glb", ratio: 1, error: 0, tex: 1024, quality: 88 },
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(JOBS).filter((k) => !JOBS[k].optional);
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const tris = (doc) => doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1);

for (const name of names) {
  const job = JOBS[name];
  if (!job) throw new Error(`Modelo desconocido: ${name} (${Object.keys(JOBS).join(", ")})`);
  const src = path.resolve("assets-src", job.file);
  const dst = path.resolve("public/assets", job.out ?? job.file);
  if (!fs.existsSync(src)) throw new Error(`Falta el original ${src}`);
  const doc = await io.read(src);
  const before = tris(doc);
  const steps = [weld(), dedup()];
  if (job.ratio < 1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio: job.ratio, error: job.error, lockBorder: false }));
  steps.push(
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [job.tex, job.tex], quality: job.quality, limitInputPixels: false }),
    prune(),
  );
  await doc.transform(...steps);
  await io.write(dst, doc);
  console.log(`${name.padEnd(8)} ${mb(src)} MB → ${mb(dst)} MB · ${Math.round(before).toLocaleString()} → ${Math.round(tris(doc)).toLocaleString()} triángulos`);
}
