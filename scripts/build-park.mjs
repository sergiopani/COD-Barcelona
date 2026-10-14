// Prepara el parque aportado (assets-src/park/park.glb, ~225 m de suelo, camino curvo de adoquín, farolas, bancos y ~160 árboles de cartulina)
// para el juego: public/assets/park/park.glb (+ park.json con colisiones y las texturas de césped).
//   · centra el contenido en la manzana del parque (--shiftx/--shiftz lo desplazan, en m del modelo) y lo gira --yaw grados
//   · escala los árboles (--trees 1.8: los del modelo miden 4,7 m) y descarta los que caen fuera del octógono del parque o sobre el camino
//   · funde la geometría por material (≈ 12 mallas), pone las cartulinas en alpha-test y reduce las texturas a WebP
//   · exporta cajas de colisión (farolas, bancos, bases, troncos) en coordenadas del parque (u = x − PARK_CX, v = z)
// Uso: node scripts/build-park.mjs [--trees 1.8] [--shiftx -6] [--shiftz -12] [--yaw 0] [--tex 1024]
import fs from "node:fs";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTTextureWebP } from "@gltf-transform/extensions";
import { flatten, prune, textureCompress } from "@gltf-transform/functions";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? Number(args[i + 1]) : d; };
const TREES = opt("trees", 1.8), SHX = opt("shiftx", -6), SHZ = opt("shiftz", -12), YAW = (opt("yaw", 0) * Math.PI) / 180, TEX = opt("tex", 1024);
const B = 56.5, C = 14, MARGIN = 4; // semilado de la manzana y chaflán (config.ts)
const SRC = "assets-src/park/park.glb", OUT = "public/assets/park";

const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(SRC);
await doc.transform(flatten());

// ---- lectura: una entrada por primitiva con vértices en coordenadas de mundo del modelo
const items = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const M = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute("POSITION"), N = prim.getAttribute("NORMAL"), UV = prim.getAttribute("TEXCOORD_0");
    const n = P.getCount(), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), e = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      P.getElement(i, e);
      pos[i * 3] = M[0] * e[0] + M[4] * e[1] + M[8] * e[2] + M[12];
      pos[i * 3 + 1] = M[1] * e[0] + M[5] * e[1] + M[9] * e[2] + M[13];
      pos[i * 3 + 2] = M[2] * e[0] + M[6] * e[1] + M[10] * e[2] + M[14];
      if (N) { N.getElement(i, e); const x = M[0] * e[0] + M[4] * e[1] + M[8] * e[2], y = M[1] * e[0] + M[5] * e[1] + M[9] * e[2], z = M[2] * e[0] + M[6] * e[1] + M[10] * e[2], l = Math.hypot(x, y, z) || 1; nor[i * 3] = x / l; nor[i * 3 + 1] = y / l; nor[i * 3 + 2] = z / l; } else nor[i * 3 + 1] = 1;
      if (UV) { UV.getElement(i, e); uv[i * 2] = e[0]; uv[i * 2 + 1] = e[1]; }
    }
    const idx = prim.getIndices() ? Uint32Array.from(prim.getIndices().getArray()) : Uint32Array.from({ length: n }, (_, i) => i);
    const mat = prim.getMaterial(), name = mat.getName();
    const kind = name === "Material.001" ? "ground" : name === "Material.002" ? "path" : name === "Material.003" ? "edge"
      : name === "Material.007" ? "base" : name === "Material.008" ? "pole" : name === "Material.009" ? "head"
      : /^(tn1_|trees-)/.test(name) ? "tree" : "bench";
    items.push({ kind, mat, pos, nor, uv, idx, group: node.getName().replace(/_\d+$/, "") });
  }
}

// ---- encaje: el centro del camino (más el desplazamiento pedido) pasa al centro del parque
const bb = { mn: [1e9, 1e9], mx: [-1e9, -1e9] };
for (const it of items) if (it.kind === "path" || it.kind === "edge") for (let i = 0; i < it.pos.length; i += 3) { bb.mn[0] = Math.min(bb.mn[0], it.pos[i]); bb.mx[0] = Math.max(bb.mx[0], it.pos[i]); bb.mn[1] = Math.min(bb.mn[1], it.pos[i + 2]); bb.mx[1] = Math.max(bb.mx[1], it.pos[i + 2]); }
const cx = (bb.mn[0] + bb.mx[0]) / 2 + SHX, cz = (bb.mn[1] + bb.mx[1]) / 2 + SHZ;
const cy = Math.cos(YAW), sy = Math.sin(YAW);
// juego (u, v) ← modelo (x, z); la salida conserva el convenio glTF (el cargador de Babylon invierte x): x_sal = −u, z_sal = v
const toGame = (x, z) => { const u0 = -(x - cx), v0 = z - cz; return [u0 * cy - v0 * sy, u0 * sy + v0 * cy]; };
const toOut = (u, v) => [-u, v];
const dirOut = (dx, dz) => { const [u, v] = toGame(dx + cx, dz + cz); const [u0, v0] = toGame(cx, cz); return toOut(u - u0, v - v0); };
for (const it of items) {
  for (let i = 0; i < it.pos.length; i += 3) { const [u, v] = toGame(it.pos[i], it.pos[i + 2]); [it.pos[i], it.pos[i + 2]] = toOut(u, v); }
  for (let i = 0; i < it.nor.length; i += 3) { const [x, z] = dirOut(it.nor[i], it.nor[i + 2]); it.nor[i] = x; it.nor[i + 2] = z; }
}
const gameXZ = (it, i) => [-it.pos[i * 3], it.pos[i * 3 + 2]]; // (u, v) de un vértice ya convertido

// ---- árboles: escala alrededor de la base de cada cartulina; fuera los que quedan fuera del parque o sobre el camino
const insidePark = (u, v, m) => Math.abs(u) <= B - m && Math.abs(v) <= B - m && Math.abs(u) + Math.abs(v) <= 2 * B - C - m * 1.414;
const pathSamples = [];
for (const it of items) if (it.kind === "path" || it.kind === "edge") for (let t = 0; t < it.idx.length; t += 3) {
  const a = [it.idx[t], it.idx[t + 1], it.idx[t + 2]].map((k) => gameXZ(it, k));
  pathSamples.push([(a[0][0] + a[1][0] + a[2][0]) / 3, (a[0][1] + a[1][1] + a[2][1]) / 3], ...a, ...[[0, 1], [1, 2], [2, 0]].map(([p, q]) => [(a[p][0] + a[q][0]) / 2, (a[p][1] + a[q][1]) / 2]));
}
const kept = [];
let treesIn = 0, treesOut = 0, treesPath = 0;
for (const it of items) {
  if (it.kind === "ground") continue;
  if (it.kind !== "tree") { kept.push(it); continue; }
  treesIn++;
  let bx = 0, bz = 0, by = 1e9;
  const n = it.pos.length / 3;
  for (let i = 0; i < n; i++) { bx += it.pos[i * 3]; bz += it.pos[i * 3 + 2]; by = Math.min(by, it.pos[i * 3 + 1]); }
  bx /= n; bz /= n;
  const u = -bx, v = bz;
  if (!insidePark(u, v, MARGIN + 1.5)) { treesOut++; continue; }
  if (pathSamples.some(([pu, pv]) => Math.hypot(pu - u, pv - v) < 2.4)) { treesPath++; continue; }
  for (let i = 0; i < n; i++) { it.pos[i * 3] = bx + (it.pos[i * 3] - bx) * TREES; it.pos[i * 3 + 2] = bz + (it.pos[i * 3 + 2] - bz) * TREES; it.pos[i * 3 + 1] = by + (it.pos[i * 3 + 1] - by) * TREES; it.nor[i * 3] = 0; it.nor[i * 3 + 1] = 1; it.nor[i * 3 + 2] = 0; }
  it.base = [u, v];
  kept.push(it);
}
console.log(`árboles: ${treesIn} → ${kept.filter((k) => k.kind === "tree").length} (fuera del parque: ${treesOut}, sobre el camino: ${treesPath})`);
// lo que no sea árbol y quede fuera del parque (camino, bancos…) se avisa
for (const it of kept) if (it.kind !== "tree") { let out = 0; for (let i = 0; i < it.pos.length / 3; i++) { const [u, v] = gameXZ(it, i); if (!insidePark(u, v, 0)) out++; } if (out) console.log(`aviso: ${it.kind} (${it.group}) tiene ${out} vértices fuera del octógono`); }

// ---- colisiones (u, v, altura en m sobre el suelo)
const colliders = [];
const bounds = (list) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const it of list) for (let i = 0; i < it.pos.length / 3; i++) { const [u, v] = gameXZ(it, i), y = it.pos[i * 3 + 1]; mn[0] = Math.min(mn[0], u); mx[0] = Math.max(mx[0], u); mn[1] = Math.min(mn[1], y); mx[1] = Math.max(mx[1], y); mn[2] = Math.min(mn[2], v); mx[2] = Math.max(mx[2], v); } return { mn, mx }; };
const r = (x) => Math.round(x * 1000) / 1000;
for (const it of kept) {
  if (it.kind === "pole") { const b = bounds([it]); colliders.push({ tag: "prop", c: [(b.mn[0] + b.mx[0]) / 2, b.mx[1] / 2, (b.mn[2] + b.mx[2]) / 2].map(r), s: [Math.max(0.45, b.mx[0] - b.mn[0]), b.mx[1], Math.max(0.45, b.mx[2] - b.mn[2])].map(r), rot: 0 }); }
  if (it.kind === "base") { const b = bounds([it]); colliders.push({ tag: "prop", c: [(b.mn[0] + b.mx[0]) / 2, b.mx[1] / 2, (b.mn[2] + b.mx[2]) / 2].map(r), s: [Math.max(0.4, b.mx[0] - b.mn[0]), b.mx[1], Math.max(0.4, b.mx[2] - b.mn[2])].map(r), rot: 0 }); }
  if (it.kind === "tree") colliders.push({ tag: "prop", c: [it.base[0], 2, it.base[1]].map(r), s: [0.45, 4, 0.45], rot: 0 });
}
// bancos: un collider orientado por grupo (eje principal por covarianza)
const benchGroups = new Map();
for (const it of kept) if (it.kind === "bench") { if (!benchGroups.has(it.group)) benchGroups.set(it.group, []); benchGroups.get(it.group).push(it); }
for (const list of benchGroups.values()) {
  const pts = []; let top = 0;
  for (const it of list) for (let i = 0; i < it.pos.length / 3; i++) { pts.push(gameXZ(it, i)); top = Math.max(top, it.pos[i * 3 + 1]); }
  const mu = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of pts) { sxx += (p[0] - mu[0]) ** 2; szz += (p[1] - mu[1]) ** 2; sxz += (p[0] - mu[0]) * (p[1] - mu[1]); }
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz), dx = Math.cos(th), dz = Math.sin(th);
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
  for (const p of pts) { const a = (p[0] - mu[0]) * dx + (p[1] - mu[1]) * dz, b = -(p[0] - mu[0]) * dz + (p[1] - mu[1]) * dx; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  const mid = [mu[0] + dx * (a0 + a1) / 2 - dz * (b0 + b1) / 2, mu[1] + dz * (a0 + a1) / 2 + dx * (b0 + b1) / 2];
  colliders.push({ tag: "cover", c: [r(mid[0]), r(top / 2), r(mid[1])], s: [r(a1 - a0), r(Math.max(top, 0.9)), r(b1 - b0)], rot: r(Math.atan2(-dz, dx)) });
}
console.log(`colisiones: ${colliders.length} (${colliders.filter((c) => c.tag === "cover").length} bancos)`);

// ---- reconstrucción: una primitiva por material
const root = doc.getRoot();
const buffer = root.listBuffers()[0] ?? doc.createBuffer();
for (const n of root.listNodes()) n.dispose();
for (const m of root.listMeshes()) m.dispose();
const byMat = new Map();
for (const it of kept) { if (!byMat.has(it.mat)) byMat.set(it.mat, []); byMat.get(it.mat).push(it); }
const mesh = doc.createMesh("park");
for (const [mat, list] of byMat) {
  let nv = 0, ni = 0;
  for (const it of list) { nv += it.pos.length / 3; ni += it.idx.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const it of list) { pos.set(it.pos, ov * 3); nor.set(it.nor, ov * 3); uv.set(it.uv, ov * 2); for (let i = 0; i < it.idx.length; i++) idx[oi + i] = it.idx[i] + ov; ov += it.pos.length / 3; oi += it.idx.length; }
  const isTree = /^(tn1_|trees-)/.test(mat.getName());
  mat.setMetallicFactor(0).setRoughnessFactor(isTree ? 0.95 : mat.getRoughnessFactor() > 0.99 ? 0.85 : mat.getRoughnessFactor());
  if (isTree) mat.setAlphaMode("MASK").setAlphaCutoff(0.45).setDoubleSided(true);
  mesh.addPrimitive(doc.createPrimitive().setMaterial(mat)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buffer))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(nor).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(uv).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(idx).setBuffer(buffer)));
  console.log(`  ${mat.getName().slice(0, 30).padEnd(30)} ${nv} vértices, ${ni / 3} triángulos`);
}
const node = doc.createNode("park").setMesh(mesh);
const scene = root.listScenes()[0] ?? doc.createScene("s");
for (const c of scene.listChildren()) scene.removeChild(c);
scene.addChild(node);
for (const m of root.listMaterials()) if (!byMat.has(m)) m.dispose();
await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [TEX, TEX], quality: 85, limitInputPixels: false }));

fs.mkdirSync(OUT, { recursive: true });
await new NodeIO().registerExtensions([EXTTextureWebP]).write(`${OUT}/park.glb`, doc);
fs.writeFileSync(`${OUT}/park.json`, JSON.stringify({ colliders }));

// césped del suelo: la textura (256²) y su normal salen del modelo original
const src = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(SRC);
const grass = src.getRoot().listMaterials().find((m) => m.getName() === "Material.001");
await sharp(Buffer.from(grass.getBaseColorTexture().getImage())).webp({ quality: 92 }).toFile(`${OUT}/grass_albedo.webp`);
await sharp(Buffer.from(grass.getNormalTexture().getImage())).webp({ quality: 92 }).toFile(`${OUT}/grass_normal.webp`);
console.log(`${OUT}/park.glb: ${(fs.statSync(`${OUT}/park.glb`).size / 1048576).toFixed(2)} MB`);
