// Convierte un STL binario (maqueta de impresión 3D, sin colores ni UV) en un GLB listo para el juego.
//   · suelda vértices, descarta triángulos degenerados
//   · normales suavizadas con ángulo de pliegue (los bordes duros se conservan)
//   · UV por proyección plana según el eje dominante de cada cara (1 repetición cada `--tile` metros)
//   · material de arenisca con textura de albedo y normal procedurales (WebP, repetibles)
//   · escala a metros: `--scale` = metros por unidad del STL
// Uso: node scripts/stl-to-glb.mjs <entrada.stl> <salida.glb> [--scale 10] [--crease 38] [--tile 2.2]
// El STL se trata solo como datos (no se ejecuta nada de su carpeta).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { Document, NodeIO } from "@gltf-transform/core";
import { EXTTextureWebP } from "@gltf-transform/extensions";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const [input, output] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!input || !output) throw new Error("Uso: node scripts/stl-to-glb.mjs <entrada.stl> <salida.glb> [--scale 10] [--crease 38] [--tile 2.2]");
const SCALE = opt("scale", 10);
const CREASE = (opt("crease", 38) * Math.PI) / 180;
const TILE = opt("tile", 2.2);

// ------------------------------------------------------------------ lectura del STL
const buf = fs.readFileSync(input);
const nTri = buf.readUInt32LE(80);
if (84 + nTri * 50 !== buf.length) throw new Error("Solo se admite STL binario");
const q = 1e5; // soldadura a 1e-5 unidades STL
const vmap = new Map();
const pos = []; // x,y,z por vértice soldado
const tri = []; // 3 índices por triángulo
let degenerate = 0;
for (let i = 0; i < nTri; i++) {
  const o = 84 + i * 50 + 12;
  const ids = [];
  for (let v = 0; v < 3; v++) {
    const x = buf.readFloatLE(o + v * 12);
    const y = buf.readFloatLE(o + v * 12 + 4);
    const z = buf.readFloatLE(o + v * 12 + 8);
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let id = vmap.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      vmap.set(key, id);
      pos.push(x * SCALE, y * SCALE, z * SCALE);
    }
    ids.push(id);
  }
  if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) degenerate++;
  else tri.push(...ids);
}
vmap.clear();
const T = tri.length / 3;
const V = pos.length / 3;

// ------------------------------------------------------------------ normales de cara y adyacencia
const fn = new Float32Array(T * 3); // normal unitaria
const fa = new Float32Array(T); // área
const adjCount = new Uint32Array(V + 1);
for (let t = 0; t < T; t++) {
  const a = tri[t * 3] * 3, b = tri[t * 3 + 1] * 3, c = tri[t * 3 + 2] * 3;
  const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
  const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  fa[t] = l / 2;
  if (l > 0) { nx /= l; ny /= l; nz /= l; }
  fn[t * 3] = nx; fn[t * 3 + 1] = ny; fn[t * 3 + 2] = nz;
  for (let k = 0; k < 3; k++) adjCount[tri[t * 3 + k] + 1]++;
}
for (let i = 0; i < V; i++) adjCount[i + 1] += adjCount[i];
const adjStart = adjCount;
const adj = new Uint32Array(T * 3);
const fill = new Uint32Array(V);
for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) { const v = tri[t * 3 + k]; adj[adjStart[v] + fill[v]++] = t; }

// ------------------------------------------------------------------ vértices de salida (posición + normal suave + eje UV)
const cosC = Math.cos(CREASE);
const outPos = [], outNrm = [], outUv = [], outIdx = [];
const omap = new Map();
for (let t = 0; t < T; t++) {
  const nxf = fn[t * 3], nyf = fn[t * 3 + 1], nzf = fn[t * 3 + 2];
  const ax = Math.abs(nxf), ay = Math.abs(nyf), az = Math.abs(nzf);
  const axis = ay >= ax && ay >= az ? 1 : ax >= az ? 0 : 2;
  for (let k = 0; k < 3; k++) {
    const v = tri[t * 3 + k];
    let sx = 0, sy = 0, sz = 0;
    for (let j = adjStart[v]; j < adjStart[v + 1]; j++) {
      const g = adj[j];
      const d = nxf * fn[g * 3] + nyf * fn[g * 3 + 1] + nzf * fn[g * 3 + 2];
      if (d >= cosC) { sx += fn[g * 3] * fa[g]; sy += fn[g * 3 + 1] * fa[g]; sz += fn[g * 3 + 2] * fa[g]; }
    }
    let l = Math.hypot(sx, sy, sz);
    if (l === 0) { sx = nxf; sy = nyf; sz = nzf; l = 1; }
    sx /= l; sy /= l; sz /= l;
    const key = `${v}|${axis}|${Math.round(sx * 60)}|${Math.round(sy * 60)}|${Math.round(sz * 60)}`;
    let id = omap.get(key);
    if (id === undefined) {
      id = outPos.length / 3;
      omap.set(key, id);
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      outPos.push(x, y, z);
      outNrm.push(sx, sy, sz);
      if (axis === 1) outUv.push(x / TILE, z / TILE);
      else if (axis === 0) outUv.push(z / TILE, -y / TILE);
      else outUv.push(x / TILE, -y / TILE);
    }
    outIdx.push(id);
  }
}
omap.clear();

// ------------------------------------------------------------------ texturas de arenisca (repetibles)
const N = 1024;
function lattice(freq, seed) {
  const g = new Float32Array(freq * freq);
  let s = seed >>> 0;
  for (let i = 0; i < g.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; g[i] = s / 4294967296; }
  return g;
}
const smooth = (t) => t * t * (3 - 2 * t);
function vnoise(x, y, freq, g) {
  const fx = x * freq, fy = y * freq;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smooth(fx - x0), ty = smooth(fy - y0);
  const at = (i, j) => g[(((j % freq) + freq) % freq) * freq + (((i % freq) + freq) % freq)];
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
const octs = [[4, 0.34], [8, 0.26], [16, 0.18], [32, 0.12], [64, 0.07], [128, 0.05], [256, 0.035]].map(([f, w], i) => ({ f, w, g: lattice(f, 7000 + i * 31) }));
const h = new Float32Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    let v = 0, wsum = 0;
    for (const o of octs) { v += vnoise(i / N, j / N, o.f, o.g) * o.w; wsum += o.w; }
    h[j * N + i] = v / wsum;
  }
}
const rgb = Buffer.alloc(N * N * 3);
const nrm = Buffer.alloc(N * N * 3);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const p = j * N + i;
    const hv = h[p];
    const grain = vnoise(i / N, j / N, 256, octs[6].g);
    const pit = grain > 0.86 ? 0.88 : 1; // pequeñas oquedades
    const k = (0.82 + (hv - 0.5) * 0.9) * pit;
    rgb[p * 3] = Math.max(0, Math.min(255, 212 * k)); // arenisca de Montjuïc: beige cálido, algo grisáceo
    rgb[p * 3 + 1] = Math.max(0, Math.min(255, 199 * k));
    rgb[p * 3 + 2] = Math.max(0, Math.min(255, 176 * k));
    const L = h[j * N + ((i + N - 1) % N)], R = h[j * N + ((i + 1) % N)], U = h[((j + N - 1) % N) * N + i], D = h[((j + 1) % N) * N + i];
    let gx = (L - R) * 5.5, gy = (U - D) * 5.5, gz = 1;
    const gl = Math.hypot(gx, gy, gz);
    nrm[p * 3] = Math.round((gx / gl * 0.5 + 0.5) * 255);
    nrm[p * 3 + 1] = Math.round((gy / gl * 0.5 + 0.5) * 255);
    nrm[p * 3 + 2] = Math.round((gz / gl * 0.5 + 0.5) * 255);
  }
}
const albedoWebp = await sharp(rgb, { raw: { width: N, height: N, channels: 3 } }).webp({ quality: 88 }).toBuffer();
const normalWebp = await sharp(nrm, { raw: { width: N, height: N, channels: 3 } }).webp({ quality: 92 }).toBuffer();

// ------------------------------------------------------------------ GLB
const doc = new Document();
doc.createExtension(EXTTextureWebP).setRequired(true);
const buffer = doc.createBuffer();
const accP = doc.createAccessor("POSITION").setType("VEC3").setArray(new Float32Array(outPos)).setBuffer(buffer);
const accN = doc.createAccessor("NORMAL").setType("VEC3").setArray(new Float32Array(outNrm)).setBuffer(buffer);
const accU = doc.createAccessor("TEXCOORD_0").setType("VEC2").setArray(new Float32Array(outUv)).setBuffer(buffer);
const accI = doc.createAccessor("indices").setType("SCALAR").setArray(new Uint32Array(outIdx)).setBuffer(buffer);
const albedo = doc.createTexture("arenisca_albedo").setImage(albedoWebp).setMimeType("image/webp");
const normal = doc.createTexture("arenisca_normal").setImage(normalWebp).setMimeType("image/webp");
const mat = doc
  .createMaterial("arenisca")
  .setBaseColorTexture(albedo)
  .setNormalTexture(normal)
  .setNormalScale(0.8)
  .setRoughnessFactor(0.92)
  .setMetallicFactor(0)
  .setDoubleSided(false);
const prim = doc.createPrimitive().setAttribute("POSITION", accP).setAttribute("NORMAL", accN).setAttribute("TEXCOORD_0", accU).setIndices(accI).setMaterial(mat);
const mesh = doc.createMesh("sagrada_familia").addPrimitive(prim);
const node = doc.createNode("sagrada_familia").setMesh(mesh);
doc.createScene("scene").addChild(node);
fs.mkdirSync(path.dirname(output), { recursive: true });
await new NodeIO().registerExtensions([EXTTextureWebP]).write(output, doc);

let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < outPos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], outPos[i + k]); mx[k] = Math.max(mx[k], outPos[i + k]); }
console.log(
  `${path.basename(input)} → ${output}\n` +
    `  triángulos: ${nTri.toLocaleString()} (${degenerate} degenerados descartados) · vértices soldados: ${V.toLocaleString()} · vértices finales: ${(outPos.length / 3).toLocaleString()}\n` +
    `  tamaño (m): ${mx.map((v, i) => (v - mn[i]).toFixed(1)).join(" × ")} · archivo: ${(fs.statSync(output).size / 1048576).toFixed(1)} MB`,
);
