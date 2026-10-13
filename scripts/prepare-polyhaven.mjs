// Convierte los recursos de Poly Haven (CC0, https://polyhaven.com) descargados en assets-src/polyhaven a texturas WebP del juego:
//   asphalt_02 → asphalt_*, concrete_pavement_03 → pavement_*, beige_wall_001 → stucco_* (albedo neutro: el color lo da cada edificio)
//   *_albedo.webp (sRGB), *_normal.webp (OpenGL, como glTF), *_orm.webp (R = oclusión, G = rugosidad, B = metal 0)
//   circus_maximus_2_2k.hdr → public/assets/env/environment.hdr (iluminación basada en imagen)
// Uso: node scripts/prepare-polyhaven.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SRC = "assets-src/polyhaven";
const OUT = "public/assets/textures";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync("public/assets/env", { recursive: true });

async function gray(file, size) {
  return sharp(file).resize(size, size, { fit: "fill" }).greyscale().raw().toBuffer();
}

async function set(srcName, outName, size, { neutralAlbedo = false, targetMean = 0.88 } = {}) {
  const f = (m) => path.join(SRC, srcName, `${srcName}_${m}_2k.jpg`);
  // albedo
  let alb = sharp(f("diff")).resize(size, size, { fit: "fill" });
  if (neutralAlbedo) {
    // gris con media fija: el color de cada edificio llega por el color de vértice, la textura solo aporta relieve de luz
    const g = await alb.clone().greyscale().raw().toBuffer();
    let sum = 0;
    for (const v of g) sum += v;
    const k = (targetMean * 255) / (sum / g.length);
    const out = Buffer.alloc(g.length * 3);
    for (let i = 0; i < g.length; i++) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = Math.min(255, g[i] * k);
    await sharp(out, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 88 }).toFile(`${OUT}/${outName}_albedo.webp`);
  } else {
    // la acera del escaneo es marrón oscura: se desatura y se aclara hacia el gris claro de las aceras de Barcelona
    if (outName === "pavement") alb = alb.modulate({ saturation: 0.3, brightness: 1.6 });
    await alb.webp({ quality: 88 }).toFile(`${OUT}/${outName}_albedo.webp`);
  }
  // normal (OpenGL)
  await sharp(f("nor_gl")).resize(size, size, { fit: "fill" }).webp({ quality: 92 }).toFile(`${OUT}/${outName}_normal.webp`);
  // ORM = AO | rugosidad | metal 0
  // rugosidad y oclusión son datos suaves: la mitad de resolución (ahorra ~35 MB de VRAM por juego de texturas)
  const os = size >= 2048 ? size / 2 : size;
  const [ao, ro] = await Promise.all([gray(f("ao"), os), gray(f("rough"), os)]);
  const orm = Buffer.alloc(os * os * 3);
  for (let i = 0; i < os * os; i++) { orm[i * 3] = ao[i]; orm[i * 3 + 1] = ro[i]; orm[i * 3 + 2] = 0; }
  await sharp(orm, { raw: { width: os, height: os, channels: 3 } }).webp({ quality: 90 }).toFile(`${OUT}/${outName}_orm.webp`);
  console.log(`${outName}: ok (${size}²)`);
}

await set("asphalt_02", "asphalt", 2048);
await set("concrete_pavement_03", "pavement", 2048);
await set("beige_wall_001", "stucco", 1024, { neutralAlbedo: true });
// ---- HDRI: se recorta la luminancia máxima (el disco solar vale ~10^5): el sol del juego es la luz direccional; el HDRI solo aporta
//      cielo y entorno (si no, el sol se contaría dos veces y todo quedaría quemado). Se reescribe como RGBE sin comprimir.
function readHdr(file) {
  const b = fs.readFileSync(file);
  let p = 0, line = "";
  while (p < b.length) { const c = b[p++]; if (c === 10) { if (line === "") break; line = ""; } else line += String.fromCharCode(c); }
  let res = "";
  line = "";
  while (p < b.length) { const c = b[p++]; if (c === 10) { res = line; break; } line += String.fromCharCode(c); }
  const m = /-Y (\d+) \+X (\d+)/.exec(res);
  if (!m) throw new Error("cabecera HDR no admitida: " + res);
  const H = +m[1], W = +m[2], px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    if (b[p] === 2 && b[p + 1] === 2 && ((b[p + 2] << 8) | b[p + 3]) === W) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < W) {
          let n = b[p++];
          if (n > 128) { n -= 128; const v = b[p++]; while (n-- > 0) px[(y * W + x++) * 4 + c] = v; }
          else while (n-- > 0) px[(y * W + x++) * 4 + c] = b[p++];
        }
      }
    } else {
      for (let x = 0; x < W; x++) for (let c = 0; c < 4; c++) px[(y * W + x) * 4 + c] = b[p++];
    }
  }
  return { W, H, px };
}
{
  const { W, H, px } = readHdr(`${SRC}/hdri/circus_maximus_2_2k.hdr`);
  const CAP = Number(process.env.HDR_CAP ?? 6);
  let peak = 0, clipped = 0;
  const out = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const e = px[i * 4 + 3];
    let r = 0, g = 0, bl = 0;
    if (e > 0) { const f = Math.pow(2, e - 136); r = px[i * 4] * f; g = px[i * 4 + 1] * f; bl = px[i * 4 + 2] * f; }
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    peak = Math.max(peak, lum);
    if (lum > CAP) { const k = CAP / lum; r *= k; g *= k; bl *= k; clipped++; }
    const mx = Math.max(r, g, bl);
    if (mx < 1e-32) continue;
    const ex = Math.ceil(Math.log2(mx) + 1e-9), sc = Math.pow(2, 8 - ex);
    out[i * 4] = Math.min(255, Math.round(r * sc)); out[i * 4 + 1] = Math.min(255, Math.round(g * sc)); out[i * 4 + 2] = Math.min(255, Math.round(bl * sc)); out[i * 4 + 3] = ex + 128;
  }
  const head = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`);
  fs.writeFileSync("public/assets/env/environment.hdr", Buffer.concat([head, out]));
  console.log(`HDRI: ${W}×${H}, luminancia máxima original ${peak.toFixed(0)} → recortada a ${CAP} (${clipped} píxeles)`);
}
const sizes = fs.readdirSync(OUT).filter((f) => /^(asphalt|pavement|stucco)_/.test(f)).map((f) => `${f} ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0)}KB`);
console.log(sizes.join("\n"));
