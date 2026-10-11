// Une las teselas de fotogrametría del ICGC (glTF 0.8 con buffer incrustado + JPG) en un único GLB en metros,
// con ejes del juego (X = este, Y = arriba, Z = norte tras el cargador de Babylon). Opcionalmente recorta por caja y altura.
// Uso: node scripts/icgc-to-glb.mjs <salida.glb> [--box minE,minN,maxE,maxN] [--ground y] [--above m] [--tex 1024] [--stats]
//   --box     recorta triángulos cuyo centro cae fuera de la caja (metros este/norte respecto al punto de referencia del CZML)
//   --ground  altura (m sobre el origen de alturas del CZML) del suelo de la zona; --above elimina triángulos que quedan por debajo de ground+above
// Datos: © ICGC (Institut Cartogràfic i Geològic de Catalunya) — citar la fuente.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTTextureWebP } from "@gltf-transform/extensions";

const args = process.argv.slice(2);
const out = args[0];
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const box = opt("box")?.split(",").map(Number);
const groundY = opt("ground") !== undefined ? Number(opt("ground")) : null;
const above = Number(opt("above") ?? 1.5);
const texSize = Number(opt("tex") ?? 1024);
const statsOnly = args.includes("--stats");
const rot = (Number(opt("rot") ?? 0) * Math.PI) / 180; // giro horizontal (grados, sentido horario visto desde arriba)
const bright = Number(opt("bright") ?? 1);
const minComp = Number(opt("mincomp") ?? 0); // elimina fragmentos sueltos con menos triángulos que esto
const dir = "assets-src/icgc/tiles";
const rows = JSON.parse(fs.readFileSync("assets-src/icgc/tiles.json", "utf8"));

const cEast = Number(opt("cx") ?? 0), cNorth = Number(opt("cz") ?? 0), cUp = Number(opt("cy") ?? 0); // origen de salida (en el sistema ya girado)
const doc = new Document();
doc.createExtension(EXTTextureWebP).setRequired(true);
const buffer = doc.createBuffer();
const mesh = doc.createMesh("sagrada_icgc");
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
const ys = []; // alturas de vértices para estadísticas
let tilesUsed = 0, trisIn = 0, trisOut = 0;

for (const r of rows) {
  const file = path.join(dir, path.basename(r.f));
  if (!fs.existsSync(file)) continue;
  const g = JSON.parse(fs.readFileSync(file, "utf8"));
  const bufInfo = Object.values(g.buffers)[0];
  const raw = Buffer.from(bufInfo.uri.split(",")[1], "base64");
  const prim = g.meshes.geometry.primitives[0];
  const acc = (id) => g.accessors[id];
  const view = (a) => g.bufferViews[acc(a).bufferView];
  const idxA = acc(prim.indices), posA = acc(prim.attributes.POSITION), uvA = acc(prim.attributes.TEXCOORD_0);
  const idxV = view(prim.indices), posV = view(prim.attributes.POSITION), uvV = view(prim.attributes.TEXCOORD_0);
  const idx = new Uint16Array(idxA.count);
  for (let i = 0; i < idxA.count; i++) idx[i] = raw.readUInt16LE(idxV.byteOffset + idxA.byteOffset + i * 2);
  const P = new Float32Array(posA.count * 3), U = new Float32Array(uvA.count * 2);
  for (let i = 0; i < posA.count; i++) for (let k = 0; k < 3; k++) P[i * 3 + k] = raw.readFloatLE(posV.byteOffset + posA.byteOffset + i * 12 + k * 4);
  for (let i = 0; i < uvA.count; i++) for (let k = 0; k < 2; k++) U[i * 2 + k] = raw.readFloatLE(uvV.byteOffset + uvA.byteOffset + i * 8 + k * 4);

  // Local (este, norte, arriba) → mundo: este = dx + x, norte = dz + y, arriba = h + z; salida glTF = (este, arriba, -norte)
  const W = (i) => {
    const e = r.dx + P[i * 3], n = r.dz + P[i * 3 + 1];
    // giro horario visto desde arriba: el norte pasa hacia el este
    const e2 = e * Math.cos(rot) + n * Math.sin(rot), n2 = -e * Math.sin(rot) + n * Math.cos(rot);
    return [e2 - (cEast), r.h + P[i * 3 + 2] - (cUp), -(n2 - cNorth)];
  };
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = W(idx[t]), b = W(idx[t + 1]), c = W(idx[t + 2]);
    const cx = (a[0] + b[0] + c[0]) / 3, cn = -(a[2] + b[2] + c[2]) / 3, cy = Math.max(a[1], b[1], c[1]);
    const inBox = !box || (cx >= box[0] && cx <= box[2] && cn >= box[1] && cn <= box[3]);
    const high = groundY === null || cy > groundY + above;
    if (inBox && high) { keep.push(idx[t], idx[t + 1], idx[t + 2]); trisIn++; } else trisOut++;
  }
  if (!keep.length) continue;
  // compactar vértices
  const remap = new Map(), pos = [], uv = [], ind = [];
  for (const v of keep) {
    let n = remap.get(v);
    if (n === undefined) { n = pos.length / 3; remap.set(v, n); const w = W(v); pos.push(...w); uv.push(U[v * 2], U[v * 2 + 1]); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); } ys.push(w[1]); }
    ind.push(n);
  }
  tilesUsed++;
  if (statsOnly) continue;
  const img = Object.values(g.images)[0].uri;
  const webp = await sharp(path.join(dir, img)).gamma(Number(opt("gamma") ?? 1)).modulate({ brightness: bright, saturation: 1.1 }).resize(texSize, texSize, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
  const tex = doc.createTexture(img).setImage(webp).setMimeType("image/webp");
  const mat = doc.createMaterial(path.basename(r.f)).setBaseColorTexture(tex).setRoughnessFactor(0.95).setMetallicFactor(0);
  const p = doc.createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(ind)).setBuffer(buffer))
    .setMaterial(mat);
  mesh.addPrimitive(p);
}
const hist = new Array(30).fill(0);
for (const y of ys) hist[Math.max(0, Math.min(29, Math.floor(((y - mn[1]) / (mx[1] - mn[1])) * 30)))]++;
console.log(`teselas usadas: ${tilesUsed} · triángulos: ${trisIn} (descartados ${trisOut})`);
console.log("min", mn.map((v) => v.toFixed(1)).join(","), "max", mx.map((v) => v.toFixed(1)).join(","), "tamaño", mx.map((v, i) => (v - mn[i]).toFixed(1)).join(" × "));
console.log("histograma de alturas (30 tramos desde el mínimo):", hist.join(" "));
if (!statsOnly) {
  doc.createScene("scene").addChild(doc.createNode("sagrada_icgc").setMesh(mesh));
  await new NodeIO().registerExtensions([EXTTextureWebP]).write(out, doc);
  console.log(`${out}: ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
}
