import { ARM_END, PARK_CX, STREET_AXIS } from "../src/game/config";
import { PLAYER_RADIUS, type V3 } from "./combat";

/**
 * Colisión del mundo para el SERVIDOR (y para pruebas): las mismas cajas invisibles que usa el cliente, exportadas a
 * JSON con `__game.dumpWorld()` (server/data/world-colliders.json). Solo contiene cajas orientadas en Y (rotY).
 */
export type BoxTag = "building" | "fence" | "cover" | "prop" | "bounds" | "sagrada";
export interface WorldBox {
  tag: BoxTag;
  c: V3;
  s: V3;
  r: number;
}
export interface WorldData {
  version: number;
  boxes: [BoxTag, number, number, number, number, number, number, number][];
}

/** ¿Es calzada (y = 0) o acera (y = 0,14)? Misma aproximación que el cliente. */
export function isRoad(x: number, z: number): boolean {
  // al oeste de la basílica la cuadrícula se repite (parque + calle oeste): la misma regla con el origen trasladado un paso
  if (x < -100) return isRoadBase(x, z) || isRoadBase(x - PARK_CX, z);
  return isRoadBase(x, z);
}
function isRoadBase(x: number, z: number): boolean {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const dx = Math.abs(ax - STREET_AXIS);
  const dz = Math.abs(az - STREET_AXIS);
  if (ax > ARM_END || az > ARM_END) return false;
  if (dx < 5.5 && az < ARM_END) return true;
  if (dz < 5.5 && ax < ARM_END) return true;
  return dx < 24 && dz < 24 && dx + dz < 36;
}

export class WorldCollision {
  readonly boxes: (WorldBox & { cos: number; sin: number; hx: number; hy: number; hz: number })[] = [];

  constructor(data: WorldData) {
    for (const [tag, cx, cy, cz, sx, sy, sz, r] of data.boxes) {
      this.boxes.push({ tag, c: [cx, cy, cz], s: [sx, sy, sz], r, cos: Math.cos(r), sin: Math.sin(r), hx: sx / 2, hy: sy / 2, hz: sz / 2 });
    }
  }

  /** Distancia al primer sólido que detiene balas (las verjas y los límites invisibles no), o null. Incluye el suelo. */
  raycast(o: V3, d: V3, maxDist: number): number | null {
    let best = maxDist;
    let found = false;
    for (const b of this.boxes) {
      if (b.tag === "fence" || b.tag === "bounds") continue;
      // rayo al espacio local de la caja (rotación Y inversa); Babylon: x' = x cos + z sin, z' = -x sin + z cos
      const dx = o[0] - b.c[0];
      const dz = o[2] - b.c[2];
      const lo: V3 = [dx * b.cos - dz * b.sin, o[1] - b.c[1], dx * b.sin + dz * b.cos];
      const ld: V3 = [d[0] * b.cos - d[2] * b.sin, d[1], d[0] * b.sin + d[2] * b.cos];
      let tmin = 0;
      let tmax = best;
      let ok = true;
      const half = [b.hx, b.hy, b.hz];
      for (let i = 0; i < 3 && ok; i++) {
        if (Math.abs(ld[i]) < 1e-9) {
          if (lo[i] < -half[i] || lo[i] > half[i]) ok = false;
        } else {
          let t1 = (-half[i] - lo[i]) / ld[i];
          let t2 = (half[i] - lo[i]) / ld[i];
          if (t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) ok = false;
        }
      }
      if (ok && tmin < best) {
        best = tmin;
        found = true;
      }
    }
    if (d[1] < -1e-6) {
      for (const h of [0.14, 0]) {
        const t = (h - o[1]) / d[1];
        if (t <= 0 || t >= best) continue;
        if ((h === 0) !== isRoad(o[0] + d[0] * t, o[2] + d[2] * t)) continue;
        best = t;
        found = true;
        break;
      }
    }
    return found ? best : null;
  }

  /** Profundidad máxima con la que el cilindro del jugador se mete en una caja sólida (0 si no hay solape). */
  penetration(feet: V3, radius = PLAYER_RADIUS, height = 1.8): number {
    let worst = 0;
    for (const b of this.boxes) {
      if (b.tag === "bounds") continue;
      const top = b.c[1] + b.hy;
      const bottom = b.c[1] - b.hy;
      if (feet[1] >= top - 0.05 || feet[1] + height <= bottom + 0.02) continue;
      const dx = feet[0] - b.c[0];
      const dz = feet[2] - b.c[2];
      if (Math.abs(dx) > b.hx + b.hz + radius + 0.5 || Math.abs(dz) > b.hx + b.hz + radius + 0.5) continue;
      const lx = dx * b.cos - dz * b.sin;
      const lz = dx * b.sin + dz * b.cos;
      const px = b.hx + radius - Math.abs(lx);
      const pz = b.hz + radius - Math.abs(lz);
      if (px > 0 && pz > 0) worst = Math.max(worst, Math.min(px, pz));
    }
    return worst;
  }
}
