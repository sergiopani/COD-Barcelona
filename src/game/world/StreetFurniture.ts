import { addMailbox, hasMailbox, mailboxSize } from "./Mailbox";
import { Rng } from "../util/rng";
import { BatchSet, F, Frame, type RGBA } from "./MeshBatch";
import type { CollisionManager } from "./CollisionManager";
import type { Prop } from "./mapLayout";
import type { VehicleLibrary, VehiclePlacement } from "./VehicleSet";

/**
 * Mobiliario urbano y vehículos aparcados. Todo se acumula en lotes (un draw call por material)
 * y los elementos sólidos reciben un collider de caja sencillo. Las piezas marcadas `cover`
 * son la cobertura del combate (bancos, jardineras, coches).
 */

const CHUNK = "props";
const CAR_COLORS: RGBA[] = [
  [0.92, 0.92, 0.9, 1],
  [0.8, 0.8, 0.82, 1],
  [0.08, 0.08, 0.09, 1],
  [0.45, 0.46, 0.5, 1],
  [0.55, 0.08, 0.08, 1],
  [0.1, 0.22, 0.45, 1],
  [0.75, 0.7, 0.55, 1],
  [0.15, 0.3, 0.2, 1],
];

interface ColBox {
  sx: number;
  sy: number;
  sz: number;
  /** desplazamiento del centro a lo largo de u / w */
  du?: number;
  dw?: number;
}

const wheel = (set: BatchSet, f: Frame, u: number, v: number, w: number, r: number, width: number): void => {
  const poly: [number, number][] = [];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    poly.push([u + Math.cos(a) * r, v + Math.sin(a) * r]);
  }
  set.get(CHUNK, "dark").addExtrudedPolygon(f, poly, w - width / 2, w + width / 2, [1, 1, 1, 1]);
  const hub: [number, number][] = poly.map(([pu, pv]) => [u + (pu - u) * 0.55, v + (pv - v) * 0.55]);
  set.get(CHUNK, "iron").addExtrudedPolygon(f, hub, w - width / 2 - 0.01, w + width / 2 + 0.01, [1.6, 1.6, 1.6, 1]);
};

function car(set: BatchSet, f: Frame, rng: Rng, van: boolean): ColBox {
  const paint = set.get(CHUNK, "paint");
  const glass = set.get(CHUNK, "glass");
  const dark = set.get(CHUNK, "dark");
  const plain = set.get(CHUNK, "plain");
  const col = rng.pick(CAR_COLORS);
  const hw = 0.9;
  if (van) {
    const L = 5.0;
    const hl = L / 2;
    paint.addExtrudedPolygon(f, [[-hl, 0.3], [hl, 0.3], [hl, 1.0], [hl - 0.7, 1.15], [hl - 1.1, 2.3], [-hl, 2.3]], -hw, hw, col);
    glass.addExtrudedPolygon(f, [[hl - 1.15, 1.35], [hl - 0.82, 1.2], [hl - 1.2, 2.0], [hl - 1.4, 2.0]], -hw - 0.01, hw + 0.01, [1, 1, 1, 1]);
    plain.addBox(f, hl, 0.6, 0, 0.06, 0.2, 1.6, [1.5, 1.4, 1.2, 1], F.BACK);
    dark.addBox(f, hl, 0.38, 0, 0.12, 0.2, 1.9, [1, 1, 1, 1], F.BACK);
    dark.addBox(f, -hl, 0.38, 0, 0.12, 0.2, 1.9, [1, 1, 1, 1], F.BACK);
    for (const u of [hl - 1.0, -hl + 1.0]) for (const w of [-hw, hw]) wheel(set, f, u, 0.36, w, 0.36, 0.25);
    return { sx: L, sy: 2.3, sz: 1.85 };
  }
  const L = 4.2 + rng.range(-0.2, 0.3);
  const hl = L / 2;
  const hood = rng.chance(0.5) ? 0.9 : 0.86;
  paint.addExtrudedPolygon(f, [[-hl, 0.28], [hl, 0.28], [hl, 0.78], [hl - 0.9, hood], [-hl + 0.45, 0.92], [-hl, 0.8]], -hw, hw, col);
  const cabinPts: [number, number][] = [[-hl + 0.6, 0.9], [hl - 1.1, 0.9], [hl - 1.7, 1.42], [-hl + 1.3, 1.42], [-hl + 0.8, 1.2]];
  glass.addExtrudedPolygon(f, cabinPts, -0.8, 0.8, [1, 1, 1, 1]);
  paint.addBox(f, (-hl + 1.3 + hl - 1.7) / 2, 1.43, 0, hl - 1.7 - (-hl + 1.3), 0.05, 1.62, col, F.DOWN);
  paint.addBox(f, 0.0, 1.15, 0.8, 0.09, 0.5, 0.05, col, F.BACK);
  paint.addBox(f, 0.0, 1.15, -0.8, 0.09, 0.5, 0.05, col, F.BACK);
  dark.addBox(f, hl, 0.4, 0, 0.1, 0.22, 1.8, [1, 1, 1, 1], F.BACK);
  dark.addBox(f, -hl, 0.4, 0, 0.1, 0.22, 1.8, [1, 1, 1, 1], F.BACK);
  plain.addBox(f, hl, 0.66, 0.6, 0.05, 0.12, 0.35, [2.2, 2.1, 1.8, 1], F.BACK);
  plain.addBox(f, hl, 0.66, -0.6, 0.05, 0.12, 0.35, [2.2, 2.1, 1.8, 1], F.BACK);
  plain.addBox(f, -hl, 0.7, 0.6, 0.05, 0.12, 0.35, [1.8, 0.1, 0.1, 1], F.BACK);
  plain.addBox(f, -hl, 0.7, -0.6, 0.05, 0.12, 0.35, [1.8, 0.1, 0.1, 1], F.BACK);
  for (const u of [hl - 0.85, -hl + 0.85]) for (const w of [-hw, hw]) wheel(set, f, u, 0.32, w, 0.32, 0.22);
  return { sx: L, sy: 1.45, sz: 1.85 };
}

function moto(set: BatchSet, f: Frame, rng: Rng): ColBox {
  const paint = set.get(CHUNK, "paint");
  const dark = set.get(CHUNK, "dark");
  const col = rng.pick(CAR_COLORS);
  wheel(set, f, 0.55, 0.28, 0, 0.28, 0.12);
  wheel(set, f, -0.55, 0.28, 0, 0.28, 0.12);
  paint.addBox(f, 0, 0.5, 0, 1.0, 0.3, 0.32, col, F.BACK);
  dark.addBox(f, -0.1, 0.72, 0, 0.7, 0.1, 0.3, [1, 1, 1, 1]);
  dark.addBox(f, 0.55, 0.95, 0, 0.06, 0.06, 0.7, [1, 1, 1, 1]);
  return { sx: 1.6, sy: 1.0, sz: 0.6 };
}

function tree(set: BatchSet, f: Frame, rng: Rng, x: number, z: number): ColBox {
  const trunk = set.get(CHUNK, "trunk");
  const leaf = set.get(CHUNK, "foliage");
  const h = 4.4 + rng.range(0, 1.2);
  trunk.addCylinder(x, 0.14, z, 0.26, 0.17, h, 8, [1, 1, 1, 1]);
  const R = 2.3 + rng.range(0, 0.6);
  const cy = h + 1.9;
  const tint = 0.85 + rng.next() * 0.3;
  const col: RGBA = [tint, tint * 1.05, tint * 0.9, 1];
  leaf.addEllipsoid(x, cy, z, R, R * 0.8, R, 12, 8, col);
  leaf.addEllipsoid(x + R * 0.5, cy - 0.5, z + R * 0.2, R * 0.7, R * 0.6, R * 0.7, 10, 6, [col[0] * 0.9, col[1] * 0.95, col[2], 1]);
  leaf.addEllipsoid(x - R * 0.45, cy + 0.2, z - R * 0.3, R * 0.7, R * 0.65, R * 0.7, 10, 6, [col[0] * 1.05, col[1], col[2] * 0.9, 1]);
  set.get(CHUNK, "iron").addBox(f, 0, 0.145, 0, 1.2, 0.01, 1.2, [1.2, 1.2, 1.2, 1], F.DOWN | F.BACK);
  return { sx: 0.55, sy: 4, sz: 0.55 };
}

function lamp(set: BatchSet, f: Frame, x: number, z: number): ColBox {
  const iron = set.get(CHUNK, "iron");
  const plain = set.get(CHUNK, "plain");
  iron.addCylinder(x, 0.14, z, 0.16, 0.12, 0.7, 8, [1, 1, 1, 1], true);
  iron.addCylinder(x, 0.84, z, 0.08, 0.06, 4.0, 8, [1, 1, 1, 1], true);
  // brazo hacia la calle + farol
  iron.addBox(f, 0, 4.8, 0.55, 0.08, 0.08, 1.1, [1, 1, 1, 1]);
  plain.addBox(f, 0, 4.66, 1.1, 0.5, 0.16, 0.5, [0.3, 0.3, 0.32, 1]);
  plain.addBox(f, 0, 4.56, 1.1, 0.4, 0.05, 0.4, [3, 2.8, 2.2, 1]);
  return { sx: 0.35, sy: 4.8, sz: 0.35 };
}

function bench(set: BatchSet, f: Frame): ColBox {
  const plain = set.get(CHUNK, "plain");
  const iron = set.get(CHUNK, "iron");
  const wood: RGBA = [0.42, 0.28, 0.16, 1];
  for (let i = 0; i < 3; i++) plain.addBox(f, 0, 0.45, 0.1 + i * 0.17, 1.8, 0.05, 0.14, wood);
  for (let i = 0; i < 3; i++) plain.addBox(f, 0, 0.62 + i * 0.16, -0.12 - i * 0.04, 1.8, 0.12, 0.04, wood);
  for (const u of [-0.75, 0.75]) {
    iron.addBox(f, u, 0.22, 0.2, 0.06, 0.44, 0.5, [1, 1, 1, 1]);
    iron.addBox(f, u, 0.6, -0.1, 0.06, 0.45, 0.06, [1, 1, 1, 1]);
  }
  return { sx: 1.85, sy: 0.9, sz: 0.6, dw: 0.1 };
}

function bin(set: BatchSet, x: number, z: number): ColBox {
  set.get(CHUNK, "iron").addCylinder(x, 0.14, z, 0.26, 0.26, 0.95, 10, [0.55, 0.7, 0.55, 1], true);
  return { sx: 0.55, sy: 0.95, sz: 0.55 };
}

function bollard(set: BatchSet, x: number, z: number): ColBox {
  const d = set.get(CHUNK, "dark");
  d.addCylinder(x, 0.14, z, 0.1, 0.1, 0.75, 8, [1.5, 1.5, 1.5, 1], true);
  d.addEllipsoid(x, 0.9, z, 0.1, 0.06, 0.1, 8, 3, [2, 2, 2, 1]);
  return { sx: 0.2, sy: 0.9, sz: 0.2 };
}

function trafficLight(set: BatchSet, f: Frame, x: number, z: number): ColBox {
  const iron = set.get(CHUNK, "iron");
  const plain = set.get(CHUNK, "plain");
  iron.addCylinder(x, 0.14, z, 0.07, 0.06, 3.1, 8, [1, 1, 1, 1], true);
  plain.addBox(f, 0, 3.0, 0.25, 0.32, 0.95, 0.26, [0.05, 0.05, 0.05, 1]);
  plain.addBox(f, 0, 3.28, 0.39, 0.16, 0.16, 0.02, [4, 0.2, 0.15, 1]);
  plain.addBox(f, 0, 3.0, 0.39, 0.16, 0.16, 0.02, [0.4, 0.3, 0.05, 1]);
  plain.addBox(f, 0, 2.72, 0.39, 0.16, 0.16, 0.02, [0.1, 0.4, 0.15, 1]);
  plain.addBox(f, 0, 2.25, 0.2, 0.3, 0.3, 0.2, [0.05, 0.05, 0.05, 1]);
  plain.addBox(f, 0, 2.25, 0.31, 0.2, 0.2, 0.02, [0.3, 0.3, 0.9, 1]);
  return { sx: 0.3, sy: 3.4, sz: 0.3 };
}

function sign(set: BatchSet, f: Frame, x: number, z: number): ColBox {
  const iron = set.get(CHUNK, "iron");
  const plain = set.get(CHUNK, "plain");
  iron.addCylinder(x, 0.14, z, 0.04, 0.04, 2.4, 6, [1, 1, 1, 1], true);
  plain.addBox(f, 0, 2.35, 0.05, 0.62, 0.62, 0.03, [0.1, 0.25, 0.7, 1]);
  plain.addBox(f, 0, 2.33, 0.07, 0.4, 0.4, 0.01, [1.4, 1.4, 1.4, 1]);
  plain.addBox(f, 0, 2.33, 0.08, 0.08, 0.28, 0.01, [0.1, 0.25, 0.7, 1]);
  return { sx: 0.2, sy: 2.5, sz: 0.2 };
}

function terrace(set: BatchSet, f: Frame, rng: Rng, x: number, z: number): ColBox {
  const plain = set.get(CHUNK, "plain");
  const iron = set.get(CHUNK, "iron");
  const col = rng.pick<RGBA>([[0.8, 0.15, 0.1, 1], [0.15, 0.4, 0.25, 1], [0.92, 0.85, 0.6, 1], [0.2, 0.3, 0.6, 1]]);
  for (const du of [-1.0, 1.0]) {
    // mesa redonda
    iron.addCylinder(x + f.ux * du, 0.14, z + f.uz * du, 0.05, 0.05, 0.72, 6, [1, 1, 1, 1], false);
    plain.addBox(f, du, 0.88, 0, 0.7, 0.04, 0.7, [0.85, 0.82, 0.75, 1]);
    // dos sillas enfrentadas
    for (const dw of [-0.6, 0.6]) {
      plain.addBox(f, du, 0.5, dw, 0.42, 0.05, 0.42, [0.2, 0.17, 0.14, 1]);
      plain.addBox(f, du, 0.78, dw + Math.sign(dw) * 0.2, 0.42, 0.5, 0.04, [0.2, 0.17, 0.14, 1]);
      for (const sx of [-0.18, 0.18]) for (const sz of [-0.18, 0.18]) iron.addBox(f, du + sx, 0.25, dw + sz, 0.03, 0.5, 0.03, [1, 1, 1, 1]);
    }
  }
  // sombrilla entre las dos mesas
  iron.addCylinder(x, 0.14, z, 0.04, 0.04, 2.5, 6, [1, 1, 1, 1], false);
  plain.addEllipsoid(x, 2.6, z, 1.7, 0.3, 1.7, 10, 3, col);
  return { sx: 3.2, sy: 1.0, sz: 1.7 };
}

function planter(set: BatchSet, f: Frame, rng: Rng, x: number, z: number): ColBox {
  set.get(CHUNK, "stone").addBox(f, 0, 0.5, 0, 2.0, 0.7, 0.8, [1.05, 1.0, 0.95, 1]);
  const leaf = set.get(CHUNK, "foliage");
  for (let i = -1; i <= 1; i++) leaf.addEllipsoid(x + f.ux * i * 0.6, 1.1, z + f.uz * i * 0.6, 0.55, 0.45, 0.55, 7, 4, [0.9 + rng.next() * 0.3, 1, 0.9, 1]);
  return { sx: 2.0, sy: 0.85, sz: 0.8 };
}

/** Genera todo el mobiliario y vehículos y registra sus colliders. */
export function buildProps(
  set: BatchSet,
  props: Prop[],
  collisions: CollisionManager,
  seed = 7,
  proceduralTrees = false,
  vehicles: VehicleLibrary | null = null,
): VehiclePlacement[] {
  const rng = new Rng(seed);
  const placements: VehiclePlacement[] = [];
  for (const p of props) {
    const f = new Frame(p.x, 0.14, p.z, p.ux, p.uz, p.uz, -p.ux);
    // los vehículos están sobre la calzada (y = 0); el resto sobre la acera (y = 0.14)
    const onRoad = p.kind === "car" || p.kind === "van" || p.kind === "moto";
    if (onRoad) f.oy = 0;
    let col: ColBox | null = null;
    switch (p.kind) {
      case "car":
      case "van":
        if (vehicles) {
          // el modelo GLB se dibuja con thin instances (VehicleSet); aquí solo el collider a su medida
          const type = vehicles.pick(p.kind, p.variant);
          placements.push({ type, x: p.x, z: p.z, ux: p.ux, uz: p.uz });
          const sz = vehicles.size(type);
          col = { sx: sz.x + 0.1, sy: sz.y, sz: sz.z + 0.1 };
        } else {
          col = car(set, f, rng, p.kind === "van");
        }
        break;
      case "moto":
        col = moto(set, f, rng);
        break;
      case "tree":
        // las palmeras se dibujan aparte (PalmTrees, thin instances); aquí solo el collider del tronco
        col = proceduralTrees ? tree(set, f, rng, p.x, p.z) : { sx: 0.5, sy: 4, sz: 0.5 };
        break;
      case "lamp":
        col = lamp(set, f, p.x, p.z);
        break;
      case "bench":
        col = bench(set, f);
        break;
      case "bin":
        col = bin(set, p.x, p.z);
        break;
      case "bollard":
        col = bollard(set, p.x, p.z);
        break;
      case "trafficLight":
        col = trafficLight(set, f, p.x, p.z);
        break;
      case "sign":
        col = sign(set, f, p.x, p.z);
        break;
      case "terrace":
        col = terrace(set, f, rng, p.x, p.z);
        break;
      case "planter":
        col = planter(set, f, rng, p.x, p.z);
        break;
      case "mailbox":
        if (hasMailbox()) {
          addMailbox(set.get(CHUNK, "mailbox"), f);
          const sz = mailboxSize();
          col = { sx: sz.sx, sy: sz.sy, sz: sz.sz };
        }
        break;
    }
    if (col) {
      const base = onRoad ? 0 : 0.14;
      const cx = p.x + p.ux * (col.du ?? 0) + p.uz * (col.dw ?? 0);
      const cz = p.z + p.uz * (col.du ?? 0) - p.ux * (col.dw ?? 0);
      collisions.addBox(cx, base + col.sy / 2, cz, col.sx, col.sy, col.sz, f.yaw, p.cover ? "cover" : "prop");
    }
  }
  return placements;
}
