import { ARM_END, BLOCK_HALF, OUTER_START, PARK_CX, STREET, STREET_AXIS, WEST_STREET_AXIS, WEST_WALL } from "../config";
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
  role: "outer" | "center" | "endcap" | "park";
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

// Al OESTE de la basílica está el parque (una manzana más): las manzanas que lo flanquean por el norte y por el sur (esquinas NO y SO)
// se alargan hasta el borde oeste del parque y la manzana lateral oeste desaparece.
const PW = PARK_CX - B; // borde oeste del parque: x = -189.5
const cornerNW = [v2(PW, E), v2(PW, O + C), v2(PW + C, O), v2(-(O + C), O), v2(-O, O + C), v2(-O, E)];
const cornerSW = [v2(-O, -E), v2(-O, -(O + C)), v2(-(O + C), -O), v2(PW + C, -O), v2(PW, -(O + C)), v2(PW, -E)];

/** Cadenas de edificios (manzanas exteriores): 3 laterales (la oeste es el parque) + 4 de esquina + la fachada del fondo oeste. */
export const outerChains: Chain[] = [];
for (let k = 0; k < 4; k++) {
  if (k !== 3) outerChains.push(makeChain(`side${k}`, "outer", northBlock.map((p) => rotateCW(p, k)), false));
  const pts = k === 3 ? cornerNW : k === 2 ? cornerSW : cornerBlock.map((p) => rotateCW(p, k));
  outerChains.push(makeChain(`corner${k}`, "outer", pts, false));
}
/** Fachada continua que cierra por el oeste la calle norte-sur del parque (y las dos calles transversales). Masa de edificio a la izquierda = oeste. */
outerChains.push(makeChain("wallW", "outer", [v2(WEST_WALL, -E), v2(WEST_WALL, E)], false));

/** Fachadas de remate al final de cada calle saliente (6 + 2 de la calle oeste). */
export const endcapChains: Chain[] = [];
for (let k = 0; k < 4; k++) {
  if (k === 3) continue; // las calles transversales siguen hasta la fachada del fondo oeste
  endcapChains.push(makeChain(`cap${k}a`, "endcap", endcapEast.map((p) => rotateCW(p, k)), false));
  endcapChains.push(makeChain(`cap${k}b`, "endcap", endcapWest.map((p) => rotateCW(p, k)), false));
}
endcapChains.push(makeChain("capW0", "endcap", [v2(WEST_WALL, E), v2(WEST_WALL + STREET.width, E)], false));
endcapChains.push(makeChain("capW1", "endcap", [v2(WEST_WALL + STREET.width, -E), v2(WEST_WALL, -E)], false));

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

/** Perímetro del parque: la misma manzana que la de la basílica, un paso de cuadrícula al oeste. */
export const parkChain: Chain = makeChain("park", "park", centerChain.points.map((p) => v2(p.x + PARK_CX, p.z)), true);

/** Cadenas sobre las que se extienden aceras (los remates se recortan para no solaparse). */
export const sidewalkChains: Chain[] = [
  centerChain,
  parkChain,
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

// calle oeste del parque: pasos a ambos lados de sus dos cruces y en las calles transversales (lado del parque)
for (const sz of [-1, 1]) {
  crosswalks.push({ x: WEST_STREET_AXIS, z: sz * (B - C - 2), axis: "z" });
  crosswalks.push({ x: WEST_STREET_AXIS, z: sz * (O + C + 2), axis: "z" });
  crosswalks.push({ x: WEST_STREET_AXIS + (S - (B - C - 2)), z: sz * S, axis: "x" });
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
    streetRuns.push({ axis: "x", at: sgn * S, from: side > 0 ? a : WEST_STREET_AXIS + 32, to: side > 0 ? b : -a }); // al oeste la calle sigue a lo largo del parque
    streetRuns.push({ axis: "z", at: sgn * S, from: side > 0 ? a : -b, to: side > 0 ? b : -a });
  }
}

// calle norte-sur al oeste del parque
streetRuns.push({ axis: "z", at: WEST_STREET_AXIS, from: -ringHalf, to: ringHalf });
for (const side of [-1, 1]) {
  const a = O + C + 8;
  const b = ARM_END - 2;
  streetRuns.push({ axis: "z", at: WEST_STREET_AXIS, from: side > 0 ? a : -b, to: side > 0 ? b : -a });
}

// ---------------------------------------------------------------- mobiliario y vehículos

export type PropKind = "tree" | "lamp" | "bench" | "parkBench" | "bin" | "bollard" | "trafficLight" | "sign" | "planter" | "car" | "van" | "moto" | "terrace" | "mailbox";

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
for (const chain of [centerChain, parkChain, ...outerChains]) {
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
      if (chain.role === "park") rng.int(0, 7); // el parque no lleva árboles (tapan la basílica): se consume el mismo azar para no alterar el resto del mapa
      else addProp("tree", p.x, p.z, seg.ux, seg.uz, false);
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
    if (seg.len > 40 && chain.role !== "center" && chain.role !== "park") {
      const t = seg.len * rng.range(0.35, 0.65);
      if (free(t, 3.9, 3)) {
        const p = at(t, 3.9);
        addProp("planter", p.x, p.z, seg.ux, seg.uz, true);
      }
    }
  }
}

// Terrazas de bar (mesas, sillas y sombrilla) frente a algunos comercios; sirven de cobertura baja.
// En cada tramo se prueban posiciones aleatorias libres (la acera ya tiene árboles, farolas y bancos).
for (const chain of outerChains) {
  for (const seg of chain.segs) {
    if (seg.kind !== "straight" || seg.len < 26) continue;
    let placed = 0;
    for (let attempt = 0; attempt < 24 && placed < 2; attempt++) {
      const t = rng.range(8, seg.len - 8);
      const x = seg.a.x + seg.ux * t + seg.nx * 1.9;
      const z = seg.a.z + seg.uz * t + seg.nz * 1.9;
      if (nearCrosswalk(x, z, 3)) continue;
      if (props.some((p) => Math.hypot(p.x - x, p.z - z) < (p.kind === "tree" ? 2.6 : 2.4))) continue;
      addProp("terrace", x, z, seg.ux, seg.uz, true);
      placed++;
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

// Buzones de Correos: 8 repartidos por las aceras de la calle que rodea la basílica (dos por lado), sin tocar el generador aleatorio.
// Posición determinista: se busca, junto a la fachada, el primer hueco libre a partir de cierto punto del tramo.
{
  const wanted = new Map<string, number[]>([["side0", [0.3, 0.72]], ["side1", [0.3, 0.72]], ["side2", [0.3, 0.72]], ["side3", [0.3, 0.72]]]);
  for (const chain of outerChains) {
    for (const frac of wanted.get(chain.id) ?? []) {
      // el tramo recto más largo de la cadena que da a la calle del anillo
      const seg = chain.segs.filter((s) => s.kind === "straight").sort((a, b) => b.len - a.len)[0];
      if (!seg) continue;
      for (let k = 0; k < 40; k++) {
        const t = seg.len * frac + k * 0.8;
        if (t > seg.len - 4) break;
        const x = seg.a.x + seg.ux * t + seg.nx * 1.7, z = seg.a.z + seg.uz * t + seg.nz * 1.7;
        if (nearCrosswalk(x, z, 3)) continue;
        if (props.some((p) => Math.hypot(p.x - x, p.z - z) < 2.4)) continue;
        addProp("mailbox", x, z, seg.ux, seg.uz, true, 0);
        break;
      }
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
  { x: WEST_STREET_AXIS + 1.5, z: -30, yaw: Math.PI / 2 }, // calle oeste, mirando al parque
  { x: -150, z: -S - 1.5, yaw: -Math.PI / 2 },
];


// ---------------------------------------------------------------- el parque (Plaça de Gaudí)

/**
 * Datos del parque en coordenadas LOCALES (u = x − PARK_CX, v = z): estanque, caminos de gravilla, explanada de baldosa junto a la basílica,
 * arbustos y arbolado. Inspirado en la Plaça de Gaudí real (medidas tomadas de la fotogrametría: estanque de ~46 × 50 m desplazado al este del centro).
 */
export const POND = { u: 18, v: -12, rx: 23, rz: 25 };
/** Contorno irregular del estanque (factor sobre el radio) según el ángulo. */
function pondFactor(th: number): number {
  return 1 + 0.1 * Math.sin(3 * th + 0.8) + 0.06 * Math.sin(5 * th + 2.1);
}
/** Punto del contorno del estanque (escalado `scale` y desplazado `extra` metros hacia fuera), en coordenadas locales. */
export function pondPoint(th: number, scale = 1, extra = 0): V2 {
  const k = pondFactor(th);
  return v2(POND.u + Math.cos(th) * (POND.rx * k * scale + extra), POND.v + Math.sin(th) * (POND.rz * k * scale + extra));
}
const PARK_RING_EXTRA = 6;
/** Caminos (polilíneas locales y anchura). El anillo rodea el estanque; los radios lo unen con los cuatro lados del parque. */
export const parkPaths: { pts: V2[]; width: number; closed: boolean }[] = [];
{
  const ring: V2[] = [];
  for (let i = 0; i < 48; i++) ring.push(pondPoint((i / 48) * Math.PI * 2, 1, PARK_RING_EXTRA));
  parkPaths.push({ pts: ring, width: 3.2, closed: true });
  const spoke = (th: number, to: V2) => parkPaths.push({ pts: [pondPoint(th, 1, PARK_RING_EXTRA), to], width: 2.6, closed: false });
  spoke(Math.PI / 2, v2(POND.u + 4, B));
  spoke(-Math.PI / 2, v2(POND.u - 4, -B));
  spoke(Math.PI, v2(-B, POND.v - 3));
}
/** Explanada de baldosa junto a la fachada de la basílica (lado este del parque): rectángulo local. */
export const parkPlaza = { u0: B - 13, u1: B, v0: -(B - C), v1: B - C };

function distToSeg(p: V2, a: V2, b: V2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
/** Distancia (m) de un punto local al camino más cercano (descontando la mitad de su anchura). */
export function distToParkPath(u: number, v: number): number {
  let best = Infinity;
  for (const path of parkPaths) {
    const n = path.pts.length;
    const count = path.closed ? n : n - 1;
    for (let i = 0; i < count; i++) best = Math.min(best, distToSeg(v2(u, v), path.pts[i], path.pts[(i + 1) % n]) - path.width / 2);
  }
  return best;
}
/** Distancia (m) al borde del estanque (negativa dentro). Se mide con el radio del contorno en esa dirección. */
export function distToPond(u: number, v: number): number {
  const du = u - POND.u;
  const dv = v - POND.v;
  const th = Math.atan2(dv / POND.rz, du / POND.rx);
  const edge = pondPoint(th);
  return Math.hypot(du, dv) - Math.hypot(edge.x - POND.u, edge.z - POND.v);
}
/** ¿Está el punto local dentro del octógono del parque, con `margin` m de holgura respecto al perímetro? */
export function insidePark(u: number, v: number, margin = 0): boolean {
  const h = B - margin;
  return Math.abs(u) <= h && Math.abs(v) <= h && Math.abs(u) + Math.abs(v) <= 2 * B - C - margin * 1.414;
}
export function inParkPlaza(u: number, v: number, margin = 0): boolean {
  return u > parkPlaza.u0 - margin && u < parkPlaza.u1 + margin && v > parkPlaza.v0 - margin && v < parkPlaza.v1 + margin;
}

export interface ParkBush {
  x: number;
  z: number;
  r: number;
  h: number;
  tint: number;
}
export const parkBushes: ParkBush[] = [];

{
  const prng = new Rng(20260705);
  const free = (u: number, v: number, pondM: number, pathM: number): boolean =>
    insidePark(u, v, 3) && !inParkPlaza(u, v, 2) && distToPond(u, v) > pondM && distToParkPath(u, v) > pathM;
  const wx = (u: number) => u + PARK_CX;

  // Sin árboles: solo arbustos BAJOS (≤ 1,3 m, por debajo de la vista) para que se vea la basílica desde todo el parque. Van en macizos
  // (sin colisión), separados entre sí, sobre el césped y lejos de caminos y estanque.
  const clumps: V2[] = [];
  for (let tries = 0; tries < 1200 && clumps.length < 26; tries++) {
    const u = prng.range(-B, B);
    const v = prng.range(-B, B);
    if (!free(u, v, 3, 3) || clumps.some((c) => Math.hypot(c.x - u, c.z - v) < 11)) continue;
    clumps.push(v2(u, v));
  }
  for (const c of clumps) {
    const n = prng.int(4, 8);
    for (let k = 0; k < n; k++) {
      const a = prng.range(0, Math.PI * 2);
      const d = prng.range(0, 3.6);
      const u = c.x + Math.cos(a) * d;
      const v = c.z + Math.sin(a) * d;
      if (!free(u, v, 1, 1.6)) continue;
      const r = prng.range(0.6, 1.4);
      parkBushes.push({ x: wx(u), z: v, r, h: Math.min(1.3, r * prng.range(0.6, 0.9)), tint: prng.range(0.8, 1.15) });
    }
  }
  // Bancos mirando al estanque y farolas en el anillo; papeleras en las bocas de los caminos.
  for (let i = 0; i < 10; i++) {
    const th = ((i + 0.5) / 10) * Math.PI * 2;
    const p = pondPoint(th, 1, PARK_RING_EXTRA + 2.6);
    const q = pondPoint(th, 1, 0);
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    if (!insidePark(p.x, p.z, 4) || inParkPlaza(p.x, p.z, 3)) continue;
    // el Frame del banco (ux,uz) es el eje largo: perpendicular al estanque
    addProp(i % 2 === 0 ? "parkBench" : "lamp", wx(p.x), p.z, -dz / l, dx / l, i % 2 === 0, prng.int(0, 7));
  }
  for (const [u, v] of [[-30, 50], [-8, -46], [50, 30], [-48, -20]] as const) addProp("bin", wx(u), v, 1, 0, false);
}
