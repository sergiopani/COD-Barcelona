import { Rng } from "../util/rng";
import { type BatchSet, F, Frame, type RGBA } from "./MeshBatch";
import * as M from "./FacadeModules";
import { BATLLO_WALL_TOP_V, addBatlloFacade, batlloKey, hasBatllo } from "./BatlloFacade";
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
  /** Si está definido, la fachada superior es la de la Casa Batlló (paleta `variant`). Solo unas pocas casas. */
  batllo?: { variant: number };
}

const PALETTE: RGBA[] = [
  [0.95, 0.82, 0.58, 1], // ocre
  [0.97, 0.92, 0.8, 1], // crema
  [0.93, 0.7, 0.58, 1], // salmón
  [0.86, 0.58, 0.45, 1], // terracota claro
  [0.82, 0.85, 0.76, 1], // verde grisáceo
  [0.9, 0.8, 0.64, 1], // arena
  [0.84, 0.82, 0.76, 1], // gris cálido
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

  // Masa del edificio (fachada + volumen hacia el interior de la manzana), en un lote "wall" aparte
  // (es el único que proyecta sombra en perfiles BAJO/MEDIO). Tres franjas tonales dan suciedad en la base
  // y bajo la cornisa; el desplazamiento de UV aleatorio evita que todos los edificios repitan el mismo estuco.
  // Casa Batlló: solo las casas marcadas en `spec.batllo` (4 repartidas por el mapa) usan su fachada.
  const bat = hasBatllo() && spec.batllo ? (() => {
    const br = new Rng(spec.seed ^ 0x9e3779b1);
    return { variant: spec.batllo.variant, mirror: br.chance(0.5), fullRoof: true, tint: [1, 1, 1, 1] as RGBA };
  })() : null;
  const yTopRelief = H + (bat?.fullRoof ? 1.5 : 0);
  // con tejado completo la masa de pared acaba donde empieza el tejado del relieve; la cresta del relieve queda por encima
  const Hm = bat?.fullRoof ? H_GROUND + ((0.845 - BATLLO_WALL_TOP_V) / 0.845) * (yTopRelief - H_GROUND) - 0.3 : H;

  const wallBatch = set.get(chunk, "wall");
  wallBatch.uvOffset = [rng.next(), rng.next()];
  const tone = (k: number): RGBA => [spec.wall[0] * k, spec.wall[1] * k, spec.wall[2] * k, 1];
  const baseH = 1.3;
  const topH = 1.6;
  wallBatch.addBox(f, W / 2, baseH / 2, -spec.depth / 2, W, baseH, spec.depth, tone(0.78), F.DOWN | F.UP);
  wallBatch.addBox(f, W / 2, baseH + (Hm - baseH - topH) / 2, -spec.depth / 2, W, Hm - baseH - topH, spec.depth, spec.wall, F.DOWN | F.UP);
  wallBatch.addBox(f, W / 2, Hm - topH / 2, -spec.depth / 2, W, topH, spec.depth, tone(0.92), F.DOWN);
  wallBatch.uvOffset = [0, 0];

  if (!bat) {
    M.pilaster(ctx, 0.15, H - 0.5);
    M.pilaster(ctx, W - 0.15, H - 0.5);
  }
  if (!bat || !bat.fullRoof) M.crown(ctx, W, H);

  const yEntresol = H_GROUND;
  const yPrincipal = yEntresol + H_ENTRESOL;
  const yStd0 = yPrincipal + H_PRINCIPAL;
  const yAttic = yStd0 + H_STD * spec.stdFloors;

  if (bat) M.stringCourse(ctx, W, yEntresol, 0.5, 0.75); // repisa que remata la planta baja y tapa el hueco bajo el relieve
  else M.stringCourse(ctx, W, yEntresol, 0.22, 0.14);
  if (!bat) {
    M.stringCourse(ctx, W, yPrincipal, 0.18, 0.1);
    M.stringCourse(ctx, W, yAttic, 0.2, 0.12);
  }

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

  // ---- Casa Batlló: el relieve sustituye a todo lo que hay por encima de la planta baja
  if (bat) {
    addBatlloFacade(set.get(chunk, batlloKey(bat.variant)), f, W, H_GROUND, yTopRelief, bat);
    return;
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
      const bwid = Math.min(bw - 0.5, 2.1);
      M.balcony(ctx, uc, v + 0.35, bwid, 0.65);
      M.shutters(ctx, uc, v + 0.35, ww, 2.4);
      if (rng.chance(0.22)) M.balconyPlants(ctx, uc, v + 0.35, bwid, 0.65);
      // aire acondicionado en la pared entre ventanas (no en las dos primeras plantas)
      if (fl > 0 && i < nb - 1 && rng.chance(0.13)) M.acUnit(ctx, uc + bw / 2, v + 1.3);
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

/**
 * Elige 4 casas para la fachada de la Casa Batlló, una frente a cada lado de la manzana de la basílica (norte, este, sur y oeste),
 * entre edificios de fachada recta y planta baja de tiendas, con el ancho más cercano al de un solar de la Casa Batlló.
 * Cada una usa una paleta distinta.
 */
export function pickBatlloHouses(specs: BuildingSpec[], idealWidth = 12.5): void {
  for (let q = 0; q < 4; q++) {
    let best: BuildingSpec | null = null;
    for (const sp of specs) {
      // el lado oeste de la basílica es ahora el parque: su casa Batlló (variante 3) va en las esquinas de la calle oeste, frente al parque
      const west = q === 3;
      if (!(west ? sp.chain === "corner3" || sp.chain === "corner2" : sp.chain === `side${q}`) || sp.seg.kind === "chamfer" || sp.ground !== "shops") continue;
      // solo fachadas que dan a la calle que rodea la basílica (no a las calles salientes)
      const mid = sp.u0 + sp.width / 2;
      const cx = sp.seg.a.x + sp.seg.ux * mid, cz = sp.seg.a.z + sp.seg.uz * mid;
      if (west) {
        if (Math.abs(cx + 76.5) > 1) continue; // fachada de x = −76,5 que mira a la calle oeste de la basílica
      } else if (Math.min(Math.abs(cx), Math.abs(cz)) > 50 || Math.max(Math.abs(cx), Math.abs(cz)) > 80) continue;
      if (!best || Math.abs(sp.width - idealWidth) < Math.abs(best.width - idealWidth)) best = sp;
    }
    if (best) best.batllo = { variant: q };
  }
}
