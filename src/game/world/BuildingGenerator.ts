import { Rng } from "../util/rng";
import { type BatchSet, F, Frame, type RGBA } from "./MeshBatch";
import * as M from "./FacadeModules";
import type { Chain, Seg } from "./mapLayout";

/**
 * Generador modular de edificios del Eixample. Cada tramo de fachada se divide en edificios
 * de ancho variable; cada edificio se compone de módulos (FacadeModules) según un estilo.
 * `BuildingSpec` es la interfaz que permitiría sustituir cualquier edificio por un modelo detallado.
 */

export interface BuildingSpec {
  chain: string;
  seg: Seg;
  /** Posición a lo largo del tramo y ancho. */
  u0: number;
  width: number;
  /** Plantas estándar entre el principal y el ático. */
  stdFloors: number;
  style: "plain" | "mirador" | "arched";
  ground: "shops" | "arcade";
  wall: RGBA;
  /** Profundidad de la masa del edificio hacia el interior de la manzana. */
  depth: number;
  seed: number;
}

const PALETTE: RGBA[] = [
  [0.95, 0.82, 0.58, 1], // ocre
  [0.97, 0.92, 0.8, 1], // crema
  [0.93, 0.7, 0.58, 1], // salmón
  [0.86, 0.58, 0.45, 1], // terracota claro
  [0.82, 0.85, 0.76, 1], // verde grisáceo
  [0.9, 0.8, 0.64, 1], // arena
  [0.74, 0.8, 0.84, 1], // azul grisáceo
  [0.96, 0.88, 0.58, 1], // amarillo desvaído
  [0.94, 0.93, 0.89, 1], // blanco roto
  [0.78, 0.68, 0.58, 1], // piedra parda
];

const SHUTTER_TINTS: RGBA[] = [
  [0.22, 0.42, 0.24, 1],
  [0.3, 0.2, 0.12, 1],
  [0.18, 0.28, 0.42, 1],
  [0.82, 0.8, 0.74, 1],
  [0.35, 0.36, 0.34, 1],
];

const H_GROUND = 4.6;
const H_ENTRESOL = 3.0;
const H_PRINCIPAL = 3.9;
const H_STD = 3.3;
const H_ATTIC = 2.9;

export function buildingHeight(stdFloors: number): number {
  return H_GROUND + H_ENTRESOL + H_PRINCIPAL + H_STD * stdFloors + H_ATTIC + 0.9;
}

function perturb(c: RGBA, rng: Rng): RGBA {
  const k = 0.94 + rng.next() * 0.1;
  return [Math.min(1.2, c[0] * k), Math.min(1.2, c[1] * k), Math.min(1.2, c[2] * k), 1];
}

/** Divide cada tramo de fachada en edificios de ancho variable. */
export function planBuildings(chains: Chain[], seed: number): BuildingSpec[] {
  const rng = new Rng(seed);
  const specs: BuildingSpec[] = [];
  for (const chain of chains) {
    chain.segs.forEach((seg, si) => {
      const isChamfer = seg.kind === "chamfer";
      const n = isChamfer ? 1 : Math.max(1, Math.round(seg.len / 12));
      const weights = Array.from({ length: n }, () => rng.range(0.8, 1.25));
      const sum = weights.reduce((a, b) => a + b, 0);
      let u = 0;
      for (let i = 0; i < n; i++) {
        const width = (weights[i] / sum) * seg.len;
        const depth = chain.role === "endcap" ? 26 : isChamfer ? 14 : 38;
        specs.push({
          chain: chain.id,
          seg,
          u0: u,
          width,
          stdFloors: rng.int(2, 4),
          style: rng.pick(["plain", "plain", "mirador", "arched"] as const),
          ground: rng.chance(0.85) ? "shops" : "arcade",
          wall: perturb(rng.pick(PALETTE), rng),
          depth,
          seed: ((rng.next() * 1e9) | 0) ^ (si << 3),
        });
        u += width;
      }
    });
  }
  return specs;
}

/** Construye la geometría de un edificio en los lotes del chunk indicado. */
export function buildBuilding(set: BatchSet, chunk: string, spec: BuildingSpec): void {
  const { seg } = spec;
  const rng = new Rng(spec.seed);
  const ox = seg.a.x + seg.ux * spec.u0;
  const oz = seg.a.z + seg.uz * spec.u0;
  const f = new Frame(ox, 0, oz, seg.ux, seg.uz, seg.nx, seg.nz);
  const W = spec.width;
  const H = buildingHeight(spec.stdFloors);
  const trim: RGBA = [Math.min(1.1, spec.wall[0] * 1.08), Math.min(1.1, spec.wall[1] * 1.08), Math.min(1.1, spec.wall[2] * 1.08), 1];
  const ctx: M.FacadeCtx = { set, chunk, f, rng, wall: spec.wall, trim, shutterTint: rng.pick(SHUTTER_TINTS) };

  // Masa del edificio (fachada + volumen hacia el interior de la manzana).
  set.get(chunk, "stucco").addBox(f, W / 2, H / 2, -spec.depth / 2, W, H, spec.depth, spec.wall, F.DOWN);

  M.pilaster(ctx, 0.15, H - 0.5);
  M.pilaster(ctx, W - 0.15, H - 0.5);
  M.crown(ctx, W, H);

  const yEntresol = H_GROUND;
  const yPrincipal = yEntresol + H_ENTRESOL;
  const yStd0 = yPrincipal + H_PRINCIPAL;
  const yAttic = yStd0 + H_STD * spec.stdFloors;

  M.stringCourse(ctx, W, yEntresol, 0.22, 0.14);
  M.stringCourse(ctx, W, yPrincipal, 0.18, 0.1);
  M.stringCourse(ctx, W, yAttic, 0.2, 0.12);

  const nb = Math.max(2, Math.round(W / 3.4));
  const bw = W / nb;

  // ---- Planta baja
  const portalBay = rng.int(0, nb - 1);
  for (let i = 0; i < nb; i++) {
    const uc = (i + 0.5) * bw;
    if (i === portalBay) {
      M.portal(ctx, uc, Math.min(bw - 0.9, 2.2), 3.4);
    } else if (spec.ground === "arcade") {
      set.get(chunk, "stone").addBox(f, uc, 2.3, 0.06, bw - 0.3, 4.6, 0.12, [1, 0.98, 0.92, 1], F.BACK | F.DOWN);
      M.windowArched(ctx, uc, 0.9, Math.min(bw - 1.0, 2.2), 3.2);
    } else {
      M.shopfront(ctx, uc, bw, H_GROUND);
    }
  }

  // ---- Entresuelo: ventanas bajas con alféizar
  for (let i = 0; i < nb; i++) {
    const uc = (i + 0.5) * bw;
    M.windowRect(ctx, uc, yEntresol + 0.9, Math.min(1.1, bw - 1.2), 1.3, { sill: true, lintel: true });
  }

  // ---- Principal: balcón corrido + balconeras altas
  M.balcony(ctx, W / 2, yPrincipal + 0.35, W - 0.5, 0.95);
  for (let i = 0; i < nb; i++) {
    const uc = (i + 0.5) * bw;
    const ww = Math.min(1.15, bw - 1.2);
    M.windowRect(ctx, uc, yPrincipal + 0.4, ww, 2.8, { lintel: true });
    M.shutters(ctx, uc, yPrincipal + 0.4, ww, 2.8);
  }

  // ---- Plantas estándar: balcones individuales
  const miradorOn = spec.style === "mirador" && W > 9;
  const miradorW = Math.min(3.6, W * 0.32);
  for (let fl = 0; fl < spec.stdFloors; fl++) {
    const v = yStd0 + fl * H_STD;
    for (let i = 0; i < nb; i++) {
      const uc = (i + 0.5) * bw;
      // el mirador cubre las dos primeras plantas estándar en el centro
      if (miradorOn && fl < 2 && Math.abs(uc - W / 2) < miradorW / 2 + 0.2) continue;
      const ww = Math.min(1.05, bw - 1.2);
      if (spec.style === "arched" && fl === spec.stdFloors - 1) M.windowArched(ctx, uc, v + 0.35, ww, 2.5);
      else M.windowRect(ctx, uc, v + 0.35, ww, 2.4, { lintel: fl % 2 === 0 });
      M.balcony(ctx, uc, v + 0.35, Math.min(bw - 0.5, 2.1), 0.65);
      M.shutters(ctx, uc, v + 0.35, ww, 2.4);
    }
  }
  if (miradorOn) {
    M.mirador(ctx, W / 2, yStd0 + 0.2, yStd0 + H_STD * Math.min(2, spec.stdFloors) - 0.2, miradorW);
  }

  // ---- Ático: ventanas pequeñas y barandilla
  for (let i = 0; i < nb; i++) {
    const uc = (i + 0.5) * bw;
    M.windowRect(ctx, uc, yAttic + 0.5, Math.min(0.95, bw - 1.2), 1.5, { sill: true });
    if (rng.chance(0.5)) M.juliet(ctx, uc, yAttic + 0.5, Math.min(1.6, bw - 0.8));
  }
}
