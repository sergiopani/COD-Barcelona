import { ARM_END, BLOCK_HALF, OUTER_START, STREET, STREET_AXIS } from "../config";
import { Rng } from "../util/rng";
import { dist, rotateCW, type V2, v2 } from "../util/geom";

/**
 * Datos puros del mapa (sin Babylon). Todo se deriva de la geometría del Eixample
 * aproximada en config.ts. X = este, Z = norte. La manzana de la basílica está en el origen.
 *
 * Cada "cadena" es una polilínea de fachada recorrida con la MASA DEL EDIFICIO A LA IZQUIERDA
 * y la calle a la derecha; por eso la normal hacia la calle es siempre la normal derecha.
 */

export interface Seg {
  a: V2;
  b: V2;
  len: number;
  ux: number;
  uz: number;
  /** Normal hacia la calle. */
  nx: number;
  nz: number;
  kind: "straight" | "chamfer";
}

export interface Chain {
  id: string;
  role: "outer" | "center" | "endcap";
  points: V2[];
  closed: boolean;
  segs: Seg[];
}

const B = BLOCK_HALF;
const O = OUTER_START;
const E = ARM_END;
const C = STREET.chamfer;
const S = STREET_AXIS;
const SW = STREET.sidewalk;
const ROAD_W = STREET.width - 2 * SW;

function makeSegs(points: V2[], closed: boolean): Seg[] {
  const segs: Seg[] = [];
  const n = points.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const len = dist(a, b);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const diagonal = Math.abs(ux) > 0.1 && Math.abs(uz) > 0.1;
    segs.push({ a, b, len, ux, uz, nx: uz, nz: -ux, kind: diagonal ? "chamfer" : "straight" });
  }
  return segs;
}

function makeChain(id: string, role: Chain["role"], points: V2[], closed: boolean): Chain {
  return { id, role, points, closed, segs: makeSegs(points, closed) };
}

const northBlock = [v2(-B, E), v2(-B, O + C), v2(-B + C, O), v2(B - C, O), v2(B, O + C), v2(B, E)];
const cornerBlock = [v2(O, E), v2(O, O + C), v2(O + C, O), v2(E, O)];
const endcapEast = [v2(B, E), v2(O, E)];
const endcapWest = [v2(-O, E), v2(-B, E)];

/** Cadenas de edificios (manzanas exteriores): 4 laterales + 4 de esquina. */
export const outerChains: Chain[] = [];
for (let k = 0; k < 4; k++) {
  outerChains.push(makeChain(`side${k}`, "outer", northBlock.map((p) => rotateCW(p, k)), false));
  outerChains.push(makeChain(`corner${k}`, "outer", cornerBlock.map((p) => rotateCW(p, k)), false));
}

/** Fachadas de remate al final de cada calle saliente (8). */
export const endcapChains: Chain[] = [];
for (let k = 0; k < 4; k++) {
  endcapChains.push(makeChain(`cap${k}a`, "endcap", endcapEast.map((p) => rotateCW(p, k)), false));
  endcapChains.push(makeChain(`cap${k}b`, "endcap", endcapWest.map((p) => rotateCW(p, k)), false));
}

/** Perímetro de la manzana de la basílica (octógono con chaflanes), sentido antihorario. */
export const centerChain: Chain = makeChain(
  "center",
  "center",
  [
    v2(B, -B + C),
    v2(B, B - C),
    v2(B - C, B),
    v2(-B + C, B),
    v2(-B, B - C),
    v2(-B, -B + C),
    v2(-B + C, -B),
    v2(B - C, -B),
  ],
  true,
);

/** Cadenas sobre las que se extienden aceras (los remates se recortan para no solaparse). */
export const sidewalkChains: Chain[] = [
  centerChain,
  ...outerChains,
  ...endcapChains.map((c) => {
    const [a, b] = c.points;
    const len = dist(a, b);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    return makeChain(c.id + "_sw", "endcap", [v2(a.x + ux * SW, a.z + uz * SW), v2(b.x - ux * SW, b.z - uz * SW)], false);
  }),
];

/** Cadenas con fachada construida (edificios + remates). */
export const buildingChains: Chain[] = [...outerChains, ...endcapChains];

// ---------------------------------------------------------------- pasos de peatones

export interface Crosswalk {
  x: number;
  z: number;
  /** Eje de circulación de la calle que cruza. */
  axis: "x" | "z";
}

export const CROSSWALK_ALONG = 3; // longitud en el sentido del tráfico
export const crosswalks: Crosswalk[] = [];
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    crosswalks.push({ x: sx * (B - C - 2), z: sz * S, axis: "x" });
    crosswalks.push({ x: sx * (O + C + 2), z: sz * S, axis: "x" });
    crosswalks.push({ x: sx * S, z: sz * (B - C - 2), axis: "z" });
    crosswalks.push({ x: sx * S, z: sz * (O + C + 2), axis: "z" });
  }
}

/** Rectángulo (centro y semitamaños) de un paso de peatones. */
export function crosswalkRect(c: Crosswalk): { cx: number; cz: number; hx: number; hz: number } {
  return c.axis === "x"
    ? { cx: c.x, cz: c.z, hx: CROSSWALK_ALONG / 2, hz: ROAD_W / 2 }
    : { cx: c.x, cz: c.z, hx: ROAD_W / 2, hz: CROSSWALK_ALONG / 2 };
}

export function nearCrosswalk(x: number, z: number, margin: number): boolean {
  for (const c of crosswalks) {
    const r = crosswalkRect(c);
    if (Math.abs(x - r.cx) < r.hx + margin && Math.abs(z - r.cz) < r.hz + margin) return true;
  }
  return false;
}

// ---------------------------------------------------------------- tramos de calle rectos

export interface StreetRun {
  /** Eje de la calle: "x" si recorre X (z fijo), "z" si recorre Z. */
  axis: "x" | "z";
  /** Coordenada fija del eje de la calle. */
  at: number;
  from: number;
  to: number;
}

const ringHalf = B - C - 6; // los cruces ocupan |t| ∈ [B-C, O+C]
export const streetRuns: StreetRun[] = [];
for (const sgn of [-1, 1]) {
  streetRuns.push({ axis: "x", at: sgn * S, from: -ringHalf, to: ringHalf });
  streetRuns.push({ axis: "z", at: sgn * S, from: -ringHalf, to: ringHalf });
  // calles salientes
  for (const side of [-1, 1]) {
    const a = O + C + 8;
    const b = ARM_END - 2;
    streetRuns.push({ axis: "x", at: sgn * S, from: side > 0 ? a : -b, to: side > 0 ? b : -a });
    streetRuns.push({ axis: "z", at: sgn * S, from: side > 0 ? a : -b, to: side > 0 ? b : -a });
  }
}

// ---------------------------------------------------------------- mobiliario y vehículos

export type PropKind = "tree" | "lamp" | "bench" | "bin" | "bollard" | "trafficLight" | "sign" | "planter" | "car" | "van" | "moto";

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  /** Eje "a lo largo" del objeto en planta. */
  ux: number;
  uz: number;
  variant: number;
  /** Cobertura para el combate (se le añade collider). */
  cover: boolean;
}

export const props: Prop[] = [];
const rng = new Rng(20260626);

function addProp(kind: PropKind, x: number, z: number, ux: number, uz: number, cover: boolean, variant = rng.int(0, 7)): void {
  props.push({ kind, x, z, ux, uz, variant, cover });
}

// Aceras: árboles, farolas, bancos, papeleras a lo largo de los tramos rectos.
for (const chain of [centerChain, ...outerChains]) {
  for (const seg of chain.segs) {
    if (seg.kind === "chamfer") {
      // bolardos y papelera en el chaflán
      const mx = (seg.a.x + seg.b.x) / 2 + seg.nx * 2.6;
      const mz = (seg.a.z + seg.b.z) / 2 + seg.nz * 2.6;
      addProp("bin", mx, mz, seg.ux, seg.uz, false);
      for (const t of [0.25, 0.75]) {
        addProp("bollard", seg.a.x + seg.ux * seg.len * t + seg.nx * 3.9, seg.a.z + seg.uz * seg.len * t + seg.nz * 3.9, 1, 0, false);
      }
      continue;
    }
    const at = (t: number, d: number): V2 => ({ x: seg.a.x + seg.ux * t + seg.nx * d, z: seg.a.z + seg.uz * t + seg.nz * d });
    const free = (t: number, d: number, m = 2.6): boolean => {
      const p = at(t, d);
      return !nearCrosswalk(p.x, p.z, m);
    };
    // Árboles (plátanos) cada ~12 m junto al bordillo
    for (let t = 6 + rng.range(0, 3); t < seg.len - 5; t += 12 + rng.range(-1, 1)) {
      if (!free(t, 3.7, 3.2)) continue;
      const p = at(t, 3.7);
      addProp("tree", p.x, p.z, seg.ux, seg.uz, false);
    }
    // Farolas intercaladas
    for (let t = 12 + rng.range(0, 2); t < seg.len - 5; t += 24) {
      if (!free(t, 4.0)) continue;
      const p = at(t, 4.0);
      addProp("lamp", p.x, p.z, seg.ux, seg.uz, false);
    }
    // Bancos y papeleras
    for (let t = 8; t < seg.len - 8; t += 17 + rng.range(0, 8)) {
      if (!free(t, 1.2, 2.2)) continue;
      const p = at(t, 1.1);
      addProp(rng.chance(0.7) ? "bench" : "bin", p.x, p.z, seg.ux, seg.uz, true);
    }
    // Jardineras de hormigón (cobertura baja) en algunos tramos
    if (seg.len > 40 && chain.role !== "center") {
      const t = seg.len * rng.range(0.35, 0.65);
      if (free(t, 3.9, 3)) {
        const p = at(t, 3.9);
        addProp("planter", p.x, p.z, seg.ux, seg.uz, true);
      }
    }
  }
}

// Semáforos y señales en los extremos de cada paso de peatones.
for (const c of crosswalks) {
  const r = crosswalkRect(c);
  const along = c.axis === "x" ? { ux: 1, uz: 0 } : { ux: 0, uz: 1 };
  const off = ROAD_W / 2 + 0.7;
  if (c.axis === "x") {
    // los cabezales miran hacia el centro de la calzada (normal = derecha de la dirección)
    addProp("trafficLight", r.cx - 1.4, r.cz + off, 1, 0, false);
    addProp("sign", r.cx + 1.4, r.cz - off, -along.ux, along.uz, false);
  } else {
    addProp("trafficLight", r.cx + off, r.cz - 1.4, 0, -1, false);
    addProp("sign", r.cx - off, r.cz + 1.4, along.ux, along.uz, false);
  }
}

// Vehículos aparcados en batería/cordón junto a ambos bordillos, con huecos.
const PARK_OFFSET = ROAD_W / 2 - 1.25;
for (const run of streetRuns) {
  for (const side of [-1, 1]) {
    for (let t = run.from + 3; t < run.to - 3; t += 5.4) {
      if (!rng.chance(0.55)) continue;
      const x = run.axis === "x" ? t : run.at + side * PARK_OFFSET;
      const z = run.axis === "x" ? run.at + side * PARK_OFFSET : t;
      if (nearCrosswalk(x, z, 1.5)) continue;
      const ux = run.axis === "x" ? 1 : 0;
      const uz = run.axis === "x" ? 0 : 1;
      const r = rng.next();
      const jitter = rng.range(-0.25, 0.25);
      const px = x + (run.axis === "x" ? jitter : 0);
      const pz = z + (run.axis === "z" ? jitter : 0);
      addProp(r < 0.12 ? "van" : r < 0.24 ? "moto" : "car", px, pz, ux, uz, true);
    }
  }
}

// ---------------------------------------------------------------- puntos de aparición

export interface Spawn {
  x: number;
  z: number;
  /** Yaw (rad): 0 = norte (+Z), π/2 = este (+X). */
  yaw: number;
}
export const spawns: Spawn[] = [
  { x: S + 1.5, z: -28, yaw: -Math.PI / 2 }, // calle este, mirando a la basílica
  { x: -S - 1.5, z: 24, yaw: Math.PI / 2 },
  { x: 22, z: S + 1.5, yaw: Math.PI },
  { x: -22, z: -S - 1.5, yaw: 0 },
  { x: S + 1.5, z: 100, yaw: Math.PI },
  { x: 100, z: -S - 1.5, yaw: -Math.PI / 2 },
  { x: -S - 1.5, z: -100, yaw: 0 },
  { x: -100, z: S + 1.5, yaw: Math.PI / 2 },
];

export const WORLD_HALF = ARM_END + 12;
