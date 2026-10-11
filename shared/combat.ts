import { M1A_SNIPER } from "../src/game/weapons/WeaponDefinition";

/**
 * Reglas y geometría de combate compartidas (sin dependencias de Babylon): las usa el servidor para validar impactos
 * y el cliente para mantener la misma geometría de colisión de jugadores. Los valores del arma salen de WeaponDefinition.
 */
export const WEAPON = M1A_SNIPER;
export const PLAYER_HP = 100;
export const EYE_HEIGHT = 1.65;
export const PLAYER_RADIUS = 0.4;

/** Geometría de impacto de un jugador (pies en y). */
export const HIT = {
  headY: 1.62,
  headR: 0.17,
  torsoR: 0.3,
  torsoY0: 0.85,
  torsoY1: 1.5,
  legsR: 0.2,
  legsY1: 0.85,
};

export type Zone = "head" | "torso" | "legs";
export type V3 = [number, number, number];

export function rayVsSphere(o: V3, d: V3, c: V3, r: number, maxDist: number): number | null {
  const mx = o[0] - c[0];
  const my = o[1] - c[1];
  const mz = o[2] - c[2];
  const b = mx * d[0] + my * d[1] + mz * d[2];
  const cc = mx * mx + my * my + mz * mz - r * r;
  if (cc > 0 && b > 0) return null;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = Math.max(0, -b - Math.sqrt(disc));
  return t <= maxDist ? t : null;
}

export function rayVsVerticalCylinder(o: V3, d: V3, cx: number, cz: number, r: number, y0: number, y1: number, maxDist: number): number | null {
  const ox = o[0] - cx;
  const oz = o[2] - cz;
  const a = d[0] * d[0] + d[2] * d[2];
  let tEnter = -Infinity;
  let tExit = Infinity;
  if (a < 1e-9) {
    if (ox * ox + oz * oz > r * r) return null;
  } else {
    const b = 2 * (ox * d[0] + oz * d[2]);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    tEnter = (-b - sq) / (2 * a);
    tExit = (-b + sq) / (2 * a);
  }
  if (Math.abs(d[1]) < 1e-9) {
    if (o[1] < y0 || o[1] > y1) return null;
  } else {
    const t0 = (y0 - o[1]) / d[1];
    const t1 = (y1 - o[1]) / d[1];
    tEnter = Math.max(tEnter, Math.min(t0, t1));
    tExit = Math.min(tExit, Math.max(t0, t1));
  }
  if (tEnter > tExit || tExit < 0) return null;
  const t = Math.max(0, tEnter);
  return t <= maxDist ? t : null;
}

/** Rayo contra un jugador con los pies en `feet`: devuelve distancia y zona, o null. */
export function rayVsPlayer(o: V3, d: V3, feet: V3, maxDist: number): { dist: number; zone: Zone } | null {
  const head = rayVsSphere(o, d, [feet[0], feet[1] + HIT.headY, feet[2]], HIT.headR, maxDist);
  const torso = rayVsVerticalCylinder(o, d, feet[0], feet[2], HIT.torsoR, feet[1] + HIT.torsoY0, feet[1] + HIT.torsoY1, maxDist);
  const legs = rayVsVerticalCylinder(o, d, feet[0], feet[2], HIT.legsR, feet[1], feet[1] + HIT.legsY1, maxDist);
  let best: { dist: number; zone: Zone } | null = null;
  const consider = (t: number | null, zone: Zone) => {
    if (t !== null && (!best || t < best.dist)) best = { dist: t, zone };
  };
  consider(head, "head");
  consider(torso, "torso");
  consider(legs, "legs");
  return best;
}

export function normalize(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Dirección con dispersión cónica aleatoria alrededor de `fwd`. */
export function spreadDirection(fwd: V3, spread: number, rnd: () => number): V3 {
  const f = normalize(fwd);
  // base ortonormal (right, up) alrededor de f
  const helper: V3 = Math.abs(f[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  const right = normalize([helper[1] * f[2] - helper[2] * f[1], helper[2] * f[0] - helper[0] * f[2], helper[0] * f[1] - helper[1] * f[0]]);
  const up: V3 = [f[1] * right[2] - f[2] * right[1], f[2] * right[0] - f[0] * right[2], f[0] * right[1] - f[1] * right[0]];
  const a = rnd() * Math.PI * 2;
  const r = Math.sqrt(rnd()) * spread;
  return normalize([f[0] + right[0] * Math.cos(a) * r + up[0] * Math.sin(a) * r, f[1] + right[1] * Math.cos(a) * r + up[1] * Math.sin(a) * r, f[2] + right[2] * Math.cos(a) * r + up[2] * Math.sin(a) * r]);
}
