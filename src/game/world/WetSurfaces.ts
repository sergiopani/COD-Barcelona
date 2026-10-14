import { DynamicTexture, Mesh, PBRMaterial, Scene, Texture, VertexBuffer } from "@babylonjs/core";
import { GROUND } from "../config";
import { Rng } from "../util/rng";
import type { MaterialSet } from "./Materials";
import { streetRuns } from "./mapLayout";

/**
 * Asfalto mojado OPCIONAL con charcos selectivos. Se crea de forma perezosa la primera vez que se
 * activa (no cuesta nada en seco). Los charcos viven en una máscara a escala de mundo (UV2 del suelo)
 * y siguen las cunetas y los cruces; la rugosidad baja a ~0,03 en los charcos (reflejo casi especular del
 * IBL y, en perfil ALTO, de SSR) y a ~0,3 en el resto del asfalto húmedo.
 */
export interface WetSet {
  asphalt: PBRMaterial;
  panot: PBRMaterial;
  curb: PBRMaterial;
}

// la máscara es cuadrada y cubre el lado largo del plano de asfalto; (GROUND.cx, 0) es su centro
const WORLD = GROUND.width;
const MASK_SIZE = 2048;

/** Asigna UV2 (coordenadas de mundo normalizadas) al plano del asfalto. */
export function addWorldUv2(ground: Mesh): void {
  const pos = ground.getVerticesData(VertexBuffer.PositionKind)!;
  const uv2: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv2.push((pos[i] + ground.position.x - GROUND.cx + WORLD / 2) / WORLD, (pos[i + 2] + WORLD / 2) / WORLD);
  ground.setVerticesData(VertexBuffer.UV2Kind, uv2);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function paintPuddleMask(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("puddleMask", { width: MASK_SIZE, height: MASK_SIZE }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
  const rng = new Rng(4242);
  const k = MASK_SIZE / WORLD;
  const toPx = (x: number, z: number): [number, number] => [(x - GROUND.cx + WORLD / 2) * k, (z + WORLD / 2) * k];
  const blob = (x: number, z: number, rx: number, rz: number, rot: number) => {
    const [px, py] = toPx(x, z);
    for (const [s, a] of [[1, 0.3], [0.85, 0.35], [0.7, 0.45], [0.5, 0.6]] as const) {
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.ellipse(px, py, rx * k * s, rz * k * s, rot, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  // Cunetas: charcos alargados junto a ambos bordillos de cada tramo recto.
  for (const run of streetRuns) {
    for (const side of [-1, 1]) {
      for (let t = run.from; t < run.to; t += rng.range(3, 9)) {
        if (!rng.chance(0.6)) continue;
        const lateral = run.at + side * (5.5 - rng.range(0.5, 1.3));
        const x = run.axis === "x" ? t : lateral;
        const z = run.axis === "x" ? lateral : t;
        const rx = rng.range(1.2, 4.5);
        const rz = rng.range(0.35, 0.95);
        blob(x, z, run.axis === "x" ? rx : rz, run.axis === "x" ? rz : rx, 0);
      }
    }
    // algunos charcos en mitad de la calzada
    for (let t = run.from; t < run.to; t += rng.range(9, 20)) {
      if (!rng.chance(0.8)) continue;
      const lateral = run.at + rng.range(-3.2, 3.2);
      const x = run.axis === "x" ? t : lateral;
      const z = run.axis === "x" ? lateral : t;
      const a = rng.range(1.4, 3.6);
      const b = rng.range(0.9, 2.0);
      blob(x, z, run.axis === "x" ? a : b, run.axis === "x" ? b : a, 0);
    }
  }
  // Cruces: depresiones centrales
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 5; i++) blob(sx * 66.5 + rng.range(-9, 9), sz * 66.5 + rng.range(-9, 9), rng.range(1.5, 4.5), rng.range(1.2, 3.2), rng.range(0, Math.PI));
    }
  }

  // Bordes orgánicos (umbral modulado por ruido) y conversión a ORM: R=AO, G=rugosidad, B=metal
  const img = ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE);
  const WET_ROUGH = 0.64;
  const PUDDLE_ROUGH = 0.04;
  for (let y = 0; y < MASK_SIZE; y++) {
    for (let x = 0; x < MASK_SIZE; x++) {
      const i = (y * MASK_SIZE + x) * 4;
      const n = Math.sin(x * 0.11) * Math.sin(y * 0.093) * 0.5 + Math.sin(x * 0.037 + y * 0.052) * 0.5 + Math.sin(x * 0.23 + y * 0.19) * 0.25;
      const v = img.data[i] / 255 + n * 0.12;
      const p = smoothstep(0.38, 0.5, v);
      img.data[i] = 255;
      img.data[i + 1] = (WET_ROUGH + (PUDDLE_ROUGH - WET_ROUGH) * p) * 255;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex.anisotropicFilteringLevel = 8;
  tex.coordinatesIndex = 1; // UV2 = coordenadas de mundo
  tex.update(false);
  return tex;
}

/**
 * Variante de un material PBR que COMPARTE las texturas del original. (PBRMaterial.clone() re-crea las
 * texturas dinámicas a partir de PNG en base64 y cambia su aspecto, por eso no se usa.)
 */
function variant(scene: Scene, name: string, base: PBRMaterial): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoTexture = base.albedoTexture;
  m.bumpTexture = base.bumpTexture;
  m.metallicTexture = base.metallicTexture;
  m.useRoughnessFromMetallicTextureGreen = base.useRoughnessFromMetallicTextureGreen;
  m.useMetallnessFromMetallicTextureBlue = base.useMetallnessFromMetallicTextureBlue;
  m.useAmbientOcclusionFromMetallicTextureRed = base.useAmbientOcclusionFromMetallicTextureRed;
  m.albedoColor = base.albedoColor.clone();
  m.metallic = base.metallic;
  m.roughness = base.roughness;
  m.environmentIntensity = base.environmentIntensity;
  return m;
}

export function createWetMaterials(scene: Scene, mats: MaterialSet): WetSet {
  const asphalt = variant(scene, "asphaltWet", mats.asphalt);
  asphalt.albedoColor.scaleInPlace(0.55);
  asphalt.metallicTexture = paintPuddleMask(scene);
  asphalt.useRoughnessFromMetallicTextureGreen = true;
  asphalt.useMetallnessFromMetallicTextureBlue = true;
  asphalt.useAmbientOcclusionFromMetallicTextureRed = false;
  asphalt.metallic = 1;
  asphalt.roughness = 1;
  asphalt.roughness = 1;
  asphalt.environmentIntensity = 0.85;

  const panot = variant(scene, "panotWet", mats.panot);
  panot.albedoColor.scaleInPlace(0.62);
  panot.roughness = 0.5; // multiplica la rugosidad de la textura ORM
  panot.environmentIntensity = 1.15;

  const curb = variant(scene, "curbWet", mats.curbStone);
  curb.albedoColor.scaleInPlace(0.65);
  curb.roughness = 0.55;

  return { asphalt, panot, curb };
}
