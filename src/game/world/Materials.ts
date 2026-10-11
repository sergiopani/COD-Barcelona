import { Color3, DynamicTexture, PBRMaterial, Scene, Texture } from "@babylonjs/core";

/**
 * Materiales PBR con texturas 100 % procedurales (sin descargas externas).
 * Cada textura genera mapa de color + mapa de normales derivado de un campo de alturas.
 */
export type MatKey =
  | "stucco"
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
  | "marking"
  | "garden"
  | "foliage"
  | "trunk";

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
}

function bake(
  scene: Scene,
  name: string,
  size: number,
  shade: (u: number, v: number) => Texel,
  normalStrength = 2,
  hasAlpha = false,
): { albedo: DynamicTexture; normal: DynamicTexture | null } {
  const albedo = new DynamicTexture(name + "_a", { width: size, height: size }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctxA = albedo.getContext() as CanvasRenderingContext2D;
  const img = ctxA.createImageData(size, size);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = shade(x / size, y / size);
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
  return { albedo, normal };
}

function pbr(scene: Scene, name: string, opts: {
  tex?: { albedo: DynamicTexture; normal: DynamicTexture | null };
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

export function createMaterials(scene: Scene): MaterialSet {
  const S = 512;

  // Estuco: blanco roto con manchas suaves; el color lo aporta el color de vértice de cada edificio.
  const stuccoTex = bake(scene, "stucco", S, (u, v) => {
    const n = fbm(u, v, 4, 5, 1);
    const g = vnoise(u, v, 128, 5);
    const stain = fbm(u, v * 0.5, 3, 3, 9);
    const k = 0.88 + (n - 0.5) * 0.18 + (g - 0.5) * 0.05 - stain * 0.04;
    return { r: k, g: k, b: k, h: n * 0.35 + g * 0.65 };
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
    return { r: 0.92 * k, g: 0.84 * k, b: 0.7 * k, h: mortar ? 0 : 0.5 + (fbm(u, v, 16, 3, 5) - 0.5) * 0.5 };
  }, 2.2);

  const concreteTex = bake(scene, "concrete", S, (u, v) => {
    const n = fbm(u, v, 6, 5, 21);
    const pores = vnoise(u, v, 96, 31) > 0.86 ? 0.82 : 1;
    const k = (0.56 + (n - 0.5) * 0.22) * pores;
    return { r: k, g: k, b: k * 0.98, h: n * 0.5 + (pores < 1 ? 0 : 0.5) };
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
    return { r: k, g: k, b: k * 0.97, h: grout ? 0 : 0.6 + ring * 0.4 };
  }, 2.4);

  const asphaltTex = bake(scene, "asphalt", S, (u, v) => {
    const big = fbm(u, v, 4, 4, 41);
    const grain = vnoise(u, v, 192, 43);
    const chip = vnoise(u, v, 96, 47) > 0.9 ? 0.09 : 0;
    const k = 0.27 + (big - 0.5) * 0.08 + (grain - 0.5) * 0.08 + chip;
    return { r: k, g: k, b: k * 1.02, h: grain * 0.8 + chip * 4 };
  }, 2.0);

  const curbTex = bake(scene, "curb", 256, (u, v) => {
    const n = fbm(u, v, 6, 4, 51);
    const joint = (u * 4) % 1 < 0.015 ? 0.7 : 1;
    const k = (0.6 + (n - 0.5) * 0.2) * joint;
    return { r: k, g: k * 0.99, b: k * 0.95, h: n };
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

  const mat = {
    stucco: pbr(scene, "stucco", { tex: stuccoTex, roughness: 0.93 }),
    stone: pbr(scene, "stone", { tex: stoneTex, roughness: 0.88 }),
    concrete: pbr(scene, "concrete", { tex: concreteTex, roughness: 0.9 }),
    railing: pbr(scene, "railing", { tex: railTex, metallic: 0.6, roughness: 0.5, alphaTest: true, double: true }),
    shutter: pbr(scene, "shutter", { tex: shutterTex, roughness: 0.7 }),
    roller: pbr(scene, "roller", { tex: rollerTex, metallic: 0.55, roughness: 0.5 }),
    glass: pbr(scene, "glass", { color: [0.09, 0.13, 0.17], metallic: 0.85, roughness: 0.06 }),
    iron: pbr(scene, "iron", { color: [0.06, 0.065, 0.065], metallic: 0.7, roughness: 0.45 }),
    dark: pbr(scene, "dark", { color: [0.03, 0.03, 0.03], roughness: 0.85 }),
    paint: pbr(scene, "paint", { color: [1, 1, 1], metallic: 0.45, roughness: 0.28 }),
    awning: pbr(scene, "awning", { tex: awningTex, roughness: 0.85, double: true }),
    plain: pbr(scene, "plain", { color: [1, 1, 1], roughness: 0.55 }),
    marking: pbr(scene, "marking", { color: [0.85, 0.85, 0.82], roughness: 0.75 }),
    garden: pbr(scene, "garden", { tex: gardenTex, roughness: 0.95 }),
    foliage: pbr(scene, "foliage", { tex: foliageTex, roughness: 0.8 }),
    trunk: pbr(scene, "trunk", { tex: trunkTex, roughness: 0.9 }),
  } satisfies Record<MatKey, PBRMaterial>;

  mat.marking.zOffset = -4;
  mat.marking.backFaceCulling = true;

  const tile: Record<MatKey, number> = {
    stucco: 4,
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
    marking: 1,
    garden: 6,
    foliage: 3,
    trunk: 2,
  };

  const panot = pbr(scene, "panot", { tex: panotTex, roughness: 0.82 });
  const asphalt = pbr(scene, "asphalt", { tex: asphaltTex, roughness: 0.95 });
  const curbStone = pbr(scene, "curbStone", { tex: curbTex, roughness: 0.85 });
  for (const m of [panot, asphalt, curbStone]) m.environmentIntensity = 1;

  return {
    mat,
    tile,
    panot,
    asphalt,
    curbStone,
    dispose() {
      for (const m of Object.values(mat)) m.dispose(true, true);
      panot.dispose(true, true);
      asphalt.dispose(true, true);
      curbStone.dispose(true, true);
    },
  };
}
