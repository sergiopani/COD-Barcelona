// Prepara el panorama 360° aportado (assets-src/panorama/sf_0.jpeg, 6000×3000 equirectangular, orientación Sketchfab = volteado en vertical):
//   · public/assets/env/menu-panorama.webp  : franja con la basílica y el horizonte, para el fondo del menú (4096×1024)
//   · public/assets/env/sky-photo-{medium,high}.webp : cielo + horizonte de Barcelona sin la basílica (parche con el cielo/ciudad vecinos) y
//     desvanecido a color de niebla bajo el horizonte; para la cúpula de cielo del juego
//   · public/assets/env/sky-photo.json : metadatos (fila del horizonte, filas de la banda)
// Uso: node scripts/prepare-panorama.mjs
import fs from "node:fs";
import sharp from "sharp";

const SRC = "assets-src/panorama/sf_0.jpeg";
const OUT = "public/assets/env";
const W = 6000, H = 3000;
const HORIZON = 1417; // fila (imagen ya volteada) donde está el horizonte real (línea del mar / montañas)
const BELOW_ROWS = 220; // filas por debajo del horizonte incluidas en la cúpula
const BAND = HORIZON + BELOW_ROWS;
const FOG = [184, 201, 224]; // color de niebla del juego (Lighting.ts)
fs.mkdirSync(OUT, { recursive: true });

const flipped = await sharp(SRC, { limitInputPixels: false }).flip().raw().toBuffer({ resolveWithObject: true });
const ch = flipped.info.channels;
const px = flipped.data;

// ---- fondo del menú: franja con la basílica (filas 700-2100)
await sharp(px, { raw: { width: W, height: H, channels: ch } }).extract({ left: 0, top: 700, width: W, height: 1400 }).resize(4096, 956).webp({ quality: 80 }).toFile(`${OUT}/menu-panorama.webp`);

// ---- cielo: copia de la banda superior
const band = Buffer.from(px.subarray(0, BAND * W * ch));
// parche: la basílica ocupa x≈[0.40,0.60]; se sustituye por la zona [0.17,0.37] reflejada, con borde difuminado
const x0 = Math.round(0.405 * W), x1 = Math.round(0.585 * W), srcStart = 0, feather = 90;
for (let y = 0; y < BAND; y++) {
  // en el cielo el borde se difumina mucho (nubes suaves); en el skyline poco (para no tocar la torre Glòries)
  const fl = y < HORIZON - 30 ? 320 : 70, fr = y < HORIZON - 30 ? 320 : 40;
  for (let x = x0 - fl; x < x1 + fr; x++) {
    const wd = x1 - x0, m = (((x1 - 1 - x) % (2 * wd)) + 2 * wd) % (2 * wd), sx = srcStart + (m < wd ? m : 2 * wd - 1 - m); // reflejo continuo (también en el borde difuminado)
    const a = x < x0 ? 1 - (x0 - x) / fl : x >= x1 ? 1 - (x - x1 + 1) / fr : 1; // peso del parche
    const w = Math.max(0, Math.min(1, a));
    const o = (y * W + x) * ch, s = (y * W + sx) * ch;
    for (let c = 0; c < 3; c++) band[o + c] = Math.round(band[o + c] * (1 - w) + px[s + c] * w);
  }
}
// cielo despejado: el panorama original es de un día nublado. Se rehace el color del cielo conservando la forma de las nubes:
// las zonas luminosas (nubes) quedan blancas con su sombreado y el resto pasa a un azul de degradado (más profundo en el cénit, más pálido en el horizonte).
// Cerca del horizonte solo se tocan los píxeles claros (así el Tibidabo y los edificios no se tiñen de azul).
{
  const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const ZEN = [28, 98, 205], HOR = [128, 188, 240];
  const SAFE = 1235; // por encima de esta fila todo es cielo
  const lo = Number(process.env.CLOUD_LO ?? 0.7), hi = Number(process.env.CLOUD_HI ?? 0.97);
  for (let y = 0; y < HORIZON; y++) {
    const el = (HORIZON - y) / HORIZON; // 1 en el cénit, 0 en el horizonte
    const g = Math.pow(1 - el, 2.2);
    const sky = [ZEN[0] + (HOR[0] - ZEN[0]) * g, ZEN[1] + (HOR[1] - ZEN[1]) * g, ZEN[2] + (HOR[2] - ZEN[2]) * g];
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * ch;
      const r = band[o], gg = band[o + 1], b = band[o + 2];
      const Y = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
      const w = y < SAFE ? 1 : sstep(0.5, 0.7, Y);
      if (w <= 0) continue;
      const c = sstep(lo, hi, Y);
      const shade = Math.min(1, 0.80 + 0.22 * sstep(0.55, 1, Y));
      const cloud = [255 * shade, 255 * shade, 255 * Math.min(1, shade + 0.025)];
      for (let k = 0; k < 3; k++) band[o + k] = Math.round(band[o + k] * (1 - w) + (sky[k] * (1 - c) + cloud[k] * c) * w);
    }
  }
}
// desvanecido bajo el horizonte → niebla: de 6° sobre el horizonte hacia abajo, el suelo visto desde arriba no debe verse
const fadeStart = HORIZON + 10, fadeEnd = BAND - 4;
for (let y = fadeStart; y < BAND; y++) {
  const t = Math.min(1, Math.pow((y - fadeStart) / (fadeEnd - fadeStart), 1.4));
  for (let x = 0; x < W; x++) { const o = (y * W + x) * ch; for (let c = 0; c < 3; c++) band[o + c] = Math.round(band[o + c] * (1 - t) + FOG[c] * t); }
}
const base = sharp(band, { raw: { width: W, height: BAND, channels: ch } });
await base.clone().webp({ quality: 82 }).toFile(`${OUT}/sky-photo-high.webp`);
await base.clone().resize(4096, Math.round((BAND * 4096) / W)).webp({ quality: 80 }).toFile(`${OUT}/sky-photo-medium.webp`);
fs.writeFileSync(`${OUT}/sky-photo.json`, JSON.stringify({ width: W, bandRows: BAND, horizonRow: HORIZON, belowDeg: (BELOW_ROWS / H) * 180 }));
// vista previa para comprobar el parche
await sharp(band, { raw: { width: W, height: BAND, channels: ch } }).resize(1800).jpeg({ quality: 82 }).toFile("assets-src/panorama/sky-preview.jpg");
console.log("listo:", fs.readdirSync(OUT).filter((f) => /panorama|sky-photo/.test(f)).map((f) => `${f} ${(fs.statSync(`${OUT}/${f}`).size / 1024).toFixed(0)}KB`).join(", "));
