import { Color3, DynamicTexture, PBRMaterial, Scene, Texture } from "@babylonjs/core";
import { BATLLO_TEXTURES, BATLLO_VARIANTS, batlloKey } from "./BatlloFacade";
import { MAILBOX_TEXTURE } from "./Mailbox";
import { assetUrl } from "../assets";

/**
 * Materiales PBR con texturas 100 % procedurales (sin descargas externas).
 * Cada textura genera mapa de color + mapa de normales derivado de un campo de alturas.
 */
export type MatKey =
  | "stucco"
  | "wall"
  | "stone"
  | "concrete"
  | "railing"
  | "shutter"
  | "roller"
  | "glass"
  | "iron"
  | "dark"
  | "paint"
  | "awning"
  | "plain"
  | "signText"
  | "numText"
  | "marking"
  | "garden"
  | "foliage"
  | "trunk"
  | "batllo0"
  | "batllo1"
  | "batllo2"
  | "batllo3"
  | "mailbox";

/** Nombres de comercios y números de portal del atlas de rótulos (la disposición debe coincidir con FacadeModules). */
export const SIGN_NAMES = [
  "FARMÀCIA", "PANADERIA", "BAR LA SAGRADA", "ESTANC", "FRUITES", "PERRUQUERIA", "CAFETERIA", "LLIBRERIA",
  "ÒPTICA", "SUPERMERCAT", "FERRETERIA", "RESTAURANT", "TINTORERIA", "CAL PEPE", "BODEGA", "PASTISSERIA",
];
export const SIGN_ATLAS = { cols: 2, rows: 8 };
export const NUM_ATLAS = { cols: 8, rows: 4 };

function makeTextAtlas(scene: Scene, name: string, cols: number, rows: number, cw: number, ch: number, labels: string[], font: string): DynamicTexture {
  const tex = new DynamicTexture(name, { width: cols * cw, height: rows * ch }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, cols * cw, rows * ch);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  labels.forEach((text, i) => {
    const cx = (i % cols) * cw + cw / 2;
    const cy = Math.floor(i / cols) * ch + ch / 2;
    let size = ch * 0.62;
    ctx.font = `${font.replace("{s}", String(size))}`;
    while (ctx.measureText(text).width > cw * 0.92 && size > 8) {
      size -= 2;
      ctx.font = font.replace("{s}", String(size));
    }
    ctx.fillText(text, cx, cy + 2);
  });
  tex.hasAlpha = true;
  tex.anisotropicFilteringLevel = 8;
  tex.update(true);
  return tex;
}

export interface MaterialSet {
  mat: Record<MatKey, PBRMaterial>;
  /** Metros de mundo por repetición de textura de cada material (para UV de MeshBatch). */
  tile: Record<MatKey, number>;
  panot: PBRMaterial;
  asphalt: PBRMaterial;
  curbStone: PBRMaterial;
  dispose(): void;
}

// ---------------------------------------------------------------- ruido periódico

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ruido de valor periódico, x,y ∈ [0,1) y `period` celdas por unidad. */
function vnoise(x: number, y: number, period: number, seed: number): number {
  const fx = x * period;
  const fy = y * period;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, basePeriod: number, octaves: number, seed: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x, y, p, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

interface Texel {
  r: number;
  g: number;
  b: number;
  a?: number;
  /** Altura 0..1 para el mapa de normales. */
  h: number;
  /** Rugosidad 0..1 y oclusión ambiental 0..1 (si algún texel las define se genera textura ORM). */
  rough?: number;
  ao?: number;
}

function bake(
  scene: Scene,
  name: string,
  size: number,
  shade: (u: number, v: number) => Texel,
  normalStrength = 2,
  hasAlpha = false,
): { albedo: DynamicTexture; normal: DynamicTexture | null; orm: DynamicTexture | null } {
  const albedo = new DynamicTexture(name + "_a", { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctxA = albedo.getContext() as CanvasRenderingContext2D;
  const img = ctxA.createImageData(size, size);
  const height = new Float32Array(size * size);
  let rough: Float32Array | null = null;
  let aoMap: Float32Array | null = null;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = shade(x / size, y / size);
      if (t.rough !== undefined) {
        rough ??= new Float32Array(size * size).fill(1);
        aoMap ??= new Float32Array(size * size).fill(1);
        rough[y * size + x] = t.rough;
        aoMap[y * size + x] = t.ao ?? 1;
      }
      const i = (y * size + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, t.r * 255));
      img.data[i + 1] = Math.max(0, Math.min(255, t.g * 255));
      img.data[i + 2] = Math.max(0, Math.min(255, t.b * 255));
      img.data[i + 3] = (t.a ?? 1) * 255;
      height[y * size + x] = t.h;
    }
  }
  ctxA.putImageData(img, 0, 0);
  albedo.hasAlpha = hasAlpha;
  albedo.wrapU = albedo.wrapV = Texture.WRAP_ADDRESSMODE;
  albedo.anisotropicFilteringLevel = 8;
  albedo.update(false);

  let normal: DynamicTexture | null = null;
  if (normalStrength > 0) {
    normal = new DynamicTexture(name + "_n", { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const ctxN = normal.getContext() as CanvasRenderingContext2D;
    const nImg = ctxN.createImageData(size, size);
    const H = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * normalStrength;
        const dy = (H(x, y + 1) - H(x, y - 1)) * normalStrength;
        const l = Math.hypot(dx, dy, 1);
        const i = (y * size + x) * 4;
        nImg.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
        nImg.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
        nImg.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
        nImg.data[i + 3] = 255;
      }
    }
    ctxN.putImageData(nImg, 0, 0);
    normal.wrapU = normal.wrapV = Texture.WRAP_ADDRESSMODE;
    normal.anisotropicFilteringLevel = 8;
    normal.update(false);
  }
  // ORM: R = oclusión ambiental, G = rugosidad, B = metalicidad (0 en materiales no metálicos)
  let orm: DynamicTexture | null = null;
  if (rough && aoMap) {
    orm = new DynamicTexture(name + "_orm", { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    const ctxO = orm.getContext() as CanvasRenderingContext2D;
    const oImg = ctxO.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      oImg.data[i * 4] = aoMap[i] * 255;
      oImg.data[i * 4 + 1] = rough[i] * 255;
      oImg.data[i * 4 + 2] = 0;
      oImg.data[i * 4 + 3] = 255;
    }
    ctxO.putImageData(oImg, 0, 0);
    orm.wrapU = orm.wrapV = Texture.WRAP_ADDRESSMODE;
    orm.anisotropicFilteringLevel = 8;
    orm.update(false);
  }
  return { albedo, normal, orm };
}

function pbr(scene: Scene, name: string, opts: {
  tex?: { albedo: DynamicTexture; normal: DynamicTexture | null; orm: DynamicTexture | null };
  color?: [number, number, number];
  metallic?: number;
  roughness?: number;
  alphaTest?: boolean;
  double?: boolean;
}): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = opts.color ? new Color3(...opts.color) : Color3.White();
  m.metallic = opts.metallic ?? 0;
  m.roughness = opts.roughness ?? 0.9;
  if (opts.tex) {
    m.albedoTexture = opts.tex.albedo;
    if (opts.tex.normal) {
      m.bumpTexture = opts.tex.normal;
      m.bumpTexture.level = 1;
    }
  }
  if (opts.tex?.orm) {
    m.metallicTexture = opts.tex.orm;
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = true;
    m.useAmbientOcclusionFromMetallicTextureRed = true;
    m.metallic = 1; // multiplicadores: los valores reales vienen de la textura ORM
    m.roughness = 1;
  }
  if (opts.alphaTest) {
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    m.alphaCutOff = 0.5;
  }
  if (opts.double) {
    m.backFaceCulling = false;
    m.twoSidedLighting = true;
  }
  m.environmentIntensity = 1;
  return m;
}

/**
 * Sustituye albedo / normal / ORM procedurales de un material por el juego de texturas fotográficas `assets/textures/<base>_*.webp`
 * (ver scripts/prepare-polyhaven.mjs). Si alguna falla al cargar, se conservan las procedurales.
 */
function photoTextures(scene: Scene, mat: PBRMaterial, base: string, normalLevel: number, aoStrength: number): void {
  const keys = ["albedo", "normal", "orm"] as const;
  const tex: Record<(typeof keys)[number], Texture | null> = { albedo: null, normal: null, orm: null };
  let loaded = 0;
  let failed = false;
  for (const k of keys) {
    const t = new Texture(assetUrl(`assets/textures/${base}_${k}.webp`), scene, false, true, Texture.TRILINEAR_SAMPLINGMODE, () => {
      loaded++;
      if (loaded === keys.length && !failed) {
        mat.albedoTexture = tex.albedo;
        mat.bumpTexture = tex.normal;
        if (mat.bumpTexture) mat.bumpTexture.level = normalLevel;
        mat.metallicTexture = tex.orm;
        mat.ambientTextureStrength = aoStrength; // la oclusión del escaneo oscurece mucho: se atenúa
      }
    }, () => {
      failed = true;
      console.warn(`[Texturas] No se pudo cargar ${base}_${k}.webp: se conserva la textura procedural.`);
      tex.albedo?.dispose();
      tex.normal?.dispose();
      tex.orm?.dispose();
    });
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 8;
    tex[k] = t;
  }
}

export function createMaterials(scene: Scene): MaterialSet {
  const S = 512;

  // Estuco: blanco roto con manchas suaves; el color lo aporta el color de vértice de cada edificio.
  const stuccoTex = bake(scene, "stucco", S, (u, v) => {
    const n = fbm(u, v, 4, 5, 1);
    const g = vnoise(u, v, 128, 5);
    const stain = fbm(u, v * 0.5, 3, 3, 9);
    const k = 0.88 + (n - 0.5) * 0.18 + (g - 0.5) * 0.05 - stain * 0.04;
    return { r: k, g: k, b: k, h: n * 0.35 + g * 0.65, rough: 0.86 + (g - 0.5) * 0.12 + stain * 0.06, ao: 0.82 + n * 0.18 };
  }, 1.4);

  // Piedra arenisca con sillares.
  const stoneTex = bake(scene, "stone", S, (u, v) => {
    const rows = 8;
    const row = Math.floor(v * rows);
    const off = (row % 2) * 0.5;
    const cols = 4;
    const cu = (u * cols + off) % 1;
    const col = Math.floor(u * cols + off);
    const lv = (v * rows) % 1;
    const mortar = lv < 0.035 || lv > 0.975 || cu < 0.015 || cu > 0.99 ? 1 : 0;
    const shade = 0.9 + hash2(col, row, 3) * 0.16 + (fbm(u, v, 6, 4, 4) - 0.5) * 0.14;
    const k = mortar ? 0.74 : shade;
    return { r: 0.92 * k, g: 0.84 * k, b: 0.7 * k, h: mortar ? 0 : 0.5 + (fbm(u, v, 16, 3, 5) - 0.5) * 0.5, rough: mortar ? 1 : 0.8 + hash2(col, row, 11) * 0.12, ao: mortar ? 0.45 : 0.9 + hash2(col, row, 12) * 0.1 };
  }, 2.2);

  const concreteTex = bake(scene, "concrete", S, (u, v) => {
    const n = fbm(u, v, 6, 5, 21);
    const pores = vnoise(u, v, 96, 31) > 0.86 ? 0.82 : 1;
    const k = (0.56 + (n - 0.5) * 0.22) * pores;
    return { r: k, g: k, b: k * 0.98, h: n * 0.5 + (pores < 1 ? 0 : 0.5), rough: 0.88 + (n - 0.5) * 0.1, ao: pores < 1 ? 0.6 : 0.9 + n * 0.1 };
  }, 1.8);

  // Panot de Barcelona: baldosa gris con relieve circular.
  const panotTex = bake(scene, "panot", S, (u, v) => {
    const cells = 8;
    const cx = (u * cells) % 1;
    const cy = (v * cells) % 1;
    const ix = Math.floor(u * cells);
    const iy = Math.floor(v * cells);
    const grout = cx < 0.04 || cx > 0.96 || cy < 0.04 || cy > 0.96;
    const d = Math.hypot(cx - 0.5, cy - 0.5);
    const ring = Math.abs(d - 0.3) < 0.035 || Math.abs(d - 0.12) < 0.03 ? 1 : 0;
    const tint = 0.5 + hash2(ix, iy, 8) * 0.09 + (fbm(u, v, 16, 3, 7) - 0.5) * 0.06;
    const k = grout ? 0.3 : tint - ring * 0.05;
    return { r: k, g: k, b: k * 0.97, h: grout ? 0 : 0.6 + ring * 0.4, rough: grout ? 1 : 0.78 + ring * 0.08 + hash2(ix, iy, 9) * 0.08, ao: grout ? 0.4 : 1 };
  }, 2.4);

  const asphaltTex = bake(scene, "asphalt", S, (u, v) => {
    const big = fbm(u, v, 4, 4, 41);
    const grain = vnoise(u, v, 192, 43);
    const chip = vnoise(u, v, 96, 47) > 0.9 ? 0.09 : 0;
    const k = 0.34 + (big - 0.5) * 0.09 + (grain - 0.5) * 0.08 + chip;
    return { r: k, g: k, b: k * 1.02, h: grain * 0.55 + chip * 2.5, rough: 0.82 + (grain - 0.5) * 0.14 - chip * 1.2 + (big - 0.5) * 0.1, ao: 0.85 + grain * 0.15 };
  }, 2.0);

  const curbTex = bake(scene, "curb", 256, (u, v) => {
    const n = fbm(u, v, 6, 4, 51);
    const joint = (u * 4) % 1 < 0.015 ? 0.7 : 1;
    const k = (0.6 + (n - 0.5) * 0.2) * joint;
    return { r: k, g: k * 0.99, b: k * 0.95, h: n, rough: 0.8 + (n - 0.5) * 0.15, ao: joint < 1 ? 0.5 : 1 };
  }, 1.5);

  // Reja de forja (alpha): barrotes verticales con travesaños.
  const railTex = bake(scene, "rail", 128, (u, v) => {
    const bars = (u * 8) % 1;
    const bar = bars > 0.42 && bars < 0.58;
    const rail = v < 0.08 || (v > 0.46 && v < 0.5) || v > 0.9;
    const spear = bar && v > 0.92;
    const on = bar || rail || spear;
    return { r: 0.05, g: 0.055, b: 0.055, a: on ? 1 : 0, h: 0.5 };
  }, 0, true);

  // Persiana mallorquina (lamas).
  const shutterTex = bake(scene, "shutter", 128, (u, v) => {
    const slat = (v * 16) % 1;
    const k = 0.7 + (slat < 0.15 ? 0.2 : slat > 0.85 ? -0.25 : 0) + (vnoise(u, v, 24, 61) - 0.5) * 0.1;
    const frame = u < 0.06 || u > 0.94 ? 1 : 0;
    const kk = frame ? 0.55 : k;
    return { r: kk, g: kk, b: kk, h: slat < 0.5 ? slat : 1 - slat };
  }, 2.0);

  const rollerTex = bake(scene, "roller", 128, (u, v) => {
    const l = (v * 24) % 1;
    const k = 0.55 + (l < 0.2 ? 0.15 : l > 0.8 ? -0.2 : 0) + (vnoise(u, v, 32, 71) - 0.5) * 0.06;
    return { r: k, g: k * 1.01, b: k * 1.03, h: l < 0.5 ? l : 1 - l };
  }, 2.4);

  const awningTex = bake(scene, "awning", 128, (u, v) => {
    const s = (u * 8) % 1 < 0.5 ? 1 : 0.72;
    const n = vnoise(u, v, 64, 81) * 0.05;
    return { r: s - n, g: s - n, b: s - n, h: 0.5 };
  }, 0);

  const gardenTex = bake(scene, "garden", S, (u, v) => {
    const n = fbm(u, v, 6, 5, 91);
    const grass = fbm(u, v, 3, 3, 93) > 0.52;
    const g = vnoise(u, v, 160, 95);
    if (grass) return { r: 0.2 + n * 0.1, g: 0.32 + n * 0.14 + g * 0.05, b: 0.1 + n * 0.05, h: g };
    return { r: 0.52 + n * 0.12, g: 0.47 + n * 0.1, b: 0.38 + n * 0.08, h: g };
  }, 1.6);

  const foliageTex = bake(scene, "foliage", 256, (u, v) => {
    const n = fbm(u, v, 8, 4, 101);
    const sp = vnoise(u, v, 64, 103);
    return { r: 0.3 + n * 0.28 - sp * 0.06, g: 0.42 + n * 0.26, b: 0.14 + n * 0.1, h: n };
  }, 1.2);

  const trunkTex = bake(scene, "trunk", 256, (u, v) => {
    const blotch = fbm(u * 2, v, 4, 4, 111) > 0.5;
    const n = fbm(u, v, 12, 3, 113);
    const k = blotch ? 0.78 + n * 0.16 : 0.5 + n * 0.14;
    return { r: k, g: k * 0.93, b: k * 0.8, h: n };
  }, 1.6);

  const stuccoMat = pbr(scene, "stucco", { tex: stuccoTex, roughness: 0.93 });
  const signTex = makeTextAtlas(scene, "signAtlas", SIGN_ATLAS.cols, SIGN_ATLAS.rows, 512, 128, SIGN_NAMES, "bold {s}px 'Arial Narrow', Arial, Helvetica, sans-serif");
  const numTex = makeTextAtlas(scene, "numAtlas", NUM_ATLAS.cols, NUM_ATLAS.rows, 128, 128, Array.from({ length: 32 }, (_, i) => String(i * 2 + 2)), "bold {s}px Arial, Helvetica, sans-serif");
  const textMat = (name: string, tex: DynamicTexture): PBRMaterial => {
    const m = pbr(scene, name, { roughness: 0.5, alphaTest: true, double: true });
    m.albedoTexture = tex;
    m.useAlphaFromAlbedoTexture = true;
    m.alphaCutOff = 0.45;
    m.zOffset = -2;
    return m;
  };

  const mat = {
    stucco: stuccoMat,
    wall: stuccoMat, // masas de pared (lote aparte para las sombras), mismo material

    stone: pbr(scene, "stone", { tex: stoneTex, roughness: 0.88 }),
    concrete: pbr(scene, "concrete", { tex: concreteTex, roughness: 0.9 }),
    railing: pbr(scene, "railing", { tex: railTex, metallic: 0.6, roughness: 0.5, alphaTest: true, double: true }),
    shutter: pbr(scene, "shutter", { tex: shutterTex, roughness: 0.7 }),
    roller: pbr(scene, "roller", { tex: rollerTex, metallic: 0.55, roughness: 0.5 }),
    glass: pbr(scene, "glass", { color: [0.05, 0.07, 0.09], metallic: 0.2, roughness: 0.05 }),
    iron: pbr(scene, "iron", { color: [0.06, 0.065, 0.065], metallic: 0.7, roughness: 0.45 }),
    dark: pbr(scene, "dark", { color: [0.03, 0.03, 0.03], roughness: 0.85 }),
    paint: pbr(scene, "paint", { color: [1, 1, 1], metallic: 0.45, roughness: 0.28 }),
    awning: pbr(scene, "awning", { tex: awningTex, roughness: 0.85, double: true }),
    plain: pbr(scene, "plain", { color: [1, 1, 1], roughness: 0.55 }),
    signText: textMat("signText", signTex),
    numText: textMat("numText", numTex),
    marking: pbr(scene, "marking", { color: [0.85, 0.85, 0.82], roughness: 0.75 }),
    garden: pbr(scene, "garden", { tex: gardenTex, roughness: 0.95 }),
    foliage: pbr(scene, "foliage", { tex: foliageTex, roughness: 0.8 }),
    trunk: pbr(scene, "trunk", { tex: trunkTex, roughness: 0.9 }),
    batllo0: pbr(scene, "batllo0", { roughness: 0.7 }),
    batllo1: pbr(scene, "batllo1", { roughness: 0.7 }),
    batllo2: pbr(scene, "batllo2", { roughness: 0.7 }),
    batllo3: pbr(scene, "batllo3", { roughness: 0.7 }),
    mailbox: pbr(scene, "mailbox", { roughness: 0.55, metallic: 0.15 }),
  } satisfies Record<MatKey, PBRMaterial>;

  // Buzón de Correos: atlas horneado del escaneo (4 caras + tapa).
  const mbTex = new Texture(MAILBOX_TEXTURE, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  mbTex.anisotropicFilteringLevel = 8;
  mbTex.wrapU = mbTex.wrapV = Texture.CLAMP_ADDRESSMODE;
  mat.mailbox.albedoTexture = mbTex;

  // Fachadas de la Casa Batlló: textura horneada con silueta alfa (4 paletas). Se cargan como imágenes normales.
  for (let i = 0; i < BATLLO_VARIANTS; i++) {
    const m = mat[batlloKey(i) as MatKey];
    const t = new Texture(BATLLO_TEXTURES[i], scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    t.hasAlpha = true;
    t.wrapU = t.wrapV = Texture.CLAMP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 8;
    m.albedoTexture = t;
    m.useAlphaFromAlbedoTexture = true;
    m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
    m.alphaCutOff = 0.5;
    m.backFaceCulling = true;
  }

  // Cristal: dieléctrico con Fresnel (IOR 1,5): sutil de frente, reflectante a ángulos rasantes.
  mat.glass.indexOfRefraction = 1.52;
  mat.glass.environmentIntensity = 1.15;
  // Pintura de coche con capa transparente (clear coat).
  mat.paint.clearCoat.isEnabled = true;
  mat.paint.clearCoat.intensity = 0.7;
  mat.paint.clearCoat.roughness = 0.08;
  mat.paint.metallic = 0.5;
  mat.paint.roughness = 0.35;
  mat.marking.zOffset = -4;
  mat.marking.backFaceCulling = true;

  const tile: Record<MatKey, number> = {
    stucco: 4,
    wall: 4,
    stone: 4,
    concrete: 3,
    railing: 1,
    shutter: 1,
    roller: 1,
    glass: 1,
    iron: 1,
    dark: 1,
    paint: 1,
    awning: 1,
    plain: 1,
    signText: 1,
    numText: 1,
    marking: 1,
    garden: 6,
    foliage: 3,
    trunk: 2,
    batllo0: 1,
    batllo1: 1,
    batllo2: 1,
    batllo3: 1,
    mailbox: 1,
  };

  const panot = pbr(scene, "panot", { tex: panotTex, roughness: 0.82 });
  const asphalt = pbr(scene, "asphalt", { tex: asphaltTex, roughness: 0.95 });
  if (asphalt.bumpTexture) asphalt.bumpTexture.level = 0.6;
  const curbStone = pbr(scene, "curbStone", { tex: curbTex, roughness: 0.85 });
  for (const m of [panot, asphalt, curbStone]) m.environmentIntensity = 1;

  // Texturas fotográficas (escaneos CC0 de Poly Haven) para calzada, acera y estuco: sustituyen a las procedurales cuando terminan de cargar.
  photoTextures(scene, asphalt, "asphalt", 0.9, 0.45);
  photoTextures(scene, panot, "pavement", 1.0, 0.45);
  photoTextures(scene, stuccoMat, "stucco", 0.8, 0.7);
  asphalt.albedoColor = new Color3(1.35, 1.35, 1.35); // el asfalto del escaneo es muy oscuro para la exposición del juego

  return {
    mat,
    tile,
    panot,
    asphalt,
    curbStone,
    dispose() {
      for (const m of new Set(Object.values(mat))) m.dispose(true, true);
      panot.dispose(true, true);
      asphalt.dispose(true, true);
      curbStone.dispose(true, true);
    },
  };
}
