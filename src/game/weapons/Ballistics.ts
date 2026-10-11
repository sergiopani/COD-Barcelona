import { Matrix, Mesh, Ray, Vector3 } from "@babylonjs/core";
import { isRoad as isRoadShared } from "../../../shared/world";
import type { CollisionManager } from "../world/CollisionManager";

/**
 * Balística por trazado de rayo ANALÍTICO (hitscan): rayo contra las cajas de colisión (OBB), el suelo,
 * el proxy de la basílica y los actores (bots). No usa el picking de Babylon porque los colliders son
 * invisibles y no pickables, y así el coste es mínimo y determinista.
 */
export type HitZone = "head" | "torso" | "legs";

export interface ActorHit {
  distance: number;
  zone: HitZone;
}

/** Algo que puede ser alcanzado por una bala (bots, y en el futuro otros jugadores). */
export interface Shootable {
  readonly alive: boolean;
  hitTest(origin: Vector3, dir: Vector3, maxDist: number): ActorHit | null;
}

export interface BulletHit {
  distance: number;
  point: Vector3;
  normal: Vector3;
  kind: "world" | "ground" | "actor";
  surface: "stone" | "metal" | "dirt" | "asphalt";
  actor?: Shootable;
  zone?: HitZone;
}

interface Obb {
  inv: Matrix;
  world: Matrix;
  min: Vector3;
  max: Vector3;
  tag: string;
}

/** Cilindro vertical finito: devuelve la distancia de entrada o null. */
export function rayVsVerticalCylinder(o: Vector3, d: Vector3, cx: number, cz: number, r: number, y0: number, y1: number, maxDist: number): number | null {
  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  let tEnter = -Infinity;
  let tExit = Infinity;
  if (a < 1e-9) {
    if (ox * ox + oz * oz > r * r) return null;
  } else {
    const b = 2 * (ox * d.x + oz * d.z);
    const c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    tEnter = (-b - sq) / (2 * a);
    tExit = (-b + sq) / (2 * a);
  }
  // rebanada de altura
  if (Math.abs(d.y) < 1e-9) {
    if (o.y < y0 || o.y > y1) return null;
  } else {
    const t0 = (y0 - o.y) / d.y;
    const t1 = (y1 - o.y) / d.y;
    tEnter = Math.max(tEnter, Math.min(t0, t1));
    tExit = Math.min(tExit, Math.max(t0, t1));
  }
  if (tEnter > tExit || tExit < 0) return null;
  const t = Math.max(0, tEnter);
  return t <= maxDist ? t : null;
}

export function rayVsSphere(o: Vector3, d: Vector3, c: Vector3, r: number, maxDist: number): number | null {
  const mx = o.x - c.x;
  const my = o.y - c.y;
  const mz = o.z - c.z;
  const b = mx * d.x + my * d.y + mz * d.z;
  const cc = mx * mx + my * my + mz * mz - r * r;
  if (cc > 0 && b > 0) return null;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = Math.max(0, -b - Math.sqrt(disc));
  return t <= maxDist ? t : null;
}

export class Ballistics {
  private readonly obbs: Obb[] = [];
  private proxy: Mesh | null = null;
  readonly actors: Shootable[] = [];

  constructor(collisions: CollisionManager) {
    this.refresh(collisions);
  }

  /** (Re)construye la lista de cajas a partir del CollisionManager. */
  refresh(collisions: CollisionManager): void {
    this.obbs.length = 0;
    for (const m of collisions.colliders) {
      const tag = m.metadata?.tag as string;
      // el suelo se trata aparte; la verja y los límites no detienen balas (la verja es transparente)
      if (tag === "ground" || tag === "bounds" || tag === "fence") continue;
      const bb = m.getBoundingInfo().boundingBox;
      const world = m.getWorldMatrix().clone();
      this.obbs.push({ world, inv: world.clone().invert(), min: bb.minimum.clone(), max: bb.maximum.clone(), tag });
    }
  }

  setBasilicaProxy(mesh: Mesh | null): void {
    this.proxy = mesh;
  }

  private static readonly lo = new Vector3();
  private static readonly ld = new Vector3();

  /** Mundo estático: cajas + basílica + suelo. */
  raycastWorld(origin: Vector3, dir: Vector3, maxDist: number): BulletHit | null {
    let best: BulletHit | null = null;
    let bestT = maxDist;
    const lo = Ballistics.lo;
    const ld = Ballistics.ld;
    for (const b of this.obbs) {
      Vector3.TransformCoordinatesToRef(origin, b.inv, lo);
      Vector3.TransformNormalToRef(dir, b.inv, ld);
      let tmin = 0;
      let tmax = bestT;
      let axis = -1;
      let sign = 1;
      let ok = true;
      for (let i = 0; i < 3; i++) {
        const o = i === 0 ? lo.x : i === 1 ? lo.y : lo.z;
        const d = i === 0 ? ld.x : i === 1 ? ld.y : ld.z;
        const mn = i === 0 ? b.min.x : i === 1 ? b.min.y : b.min.z;
        const mx = i === 0 ? b.max.x : i === 1 ? b.max.y : b.max.z;
        if (Math.abs(d) < 1e-9) {
          if (o < mn || o > mx) {
            ok = false;
            break;
          }
        } else {
          let t1 = (mn - o) / d;
          let t2 = (mx - o) / d;
          let s = -1;
          if (t1 > t2) {
            [t1, t2] = [t2, t1];
            s = 1;
          }
          if (t1 > tmin) {
            tmin = t1;
            axis = i;
            sign = s;
          }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) {
            ok = false;
            break;
          }
        }
      }
      if (!ok || axis < 0 || tmin >= bestT) continue;
      const n = new Vector3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
      Vector3.TransformNormalToRef(n, b.world, n);
      n.normalize();
      bestT = tmin;
      best = {
        distance: tmin,
        point: origin.add(dir.scale(tmin)),
        normal: n,
        kind: "world",
        surface: b.tag === "cover" || b.tag === "prop" ? "metal" : "stone",
      };
    }

    // Basílica (proxy de columnas): triángulos del proxy
    if (this.proxy) {
      const hit = new Ray(origin, dir, bestT).intersectsMesh(this.proxy, false);
      if (hit.hit && hit.distance < bestT) {
        const n = hit.getNormal(true, true) ?? new Vector3(0, 1, 0);
        bestT = hit.distance;
        best = { distance: hit.distance, point: origin.add(dir.scale(hit.distance)), normal: n, kind: "world", surface: "stone" };
      }
    }

    // Suelo: aceras a 0,14 m y calzada a 0
    if (dir.y < -1e-6) {
      for (const h of [0.14, 0]) {
        const t = (h - origin.y) / dir.y;
        if (t <= 0 || t >= bestT) continue;
        const x = origin.x + dir.x * t;
        const z = origin.z + dir.z * t;
        const road = Ballistics.isRoad(x, z);
        if ((h === 0) !== road) continue;
        bestT = t;
        best = { distance: t, point: new Vector3(x, h, z), normal: new Vector3(0, 1, 0), kind: "ground", surface: road ? "asphalt" : "dirt" };
        break;
      }
    }
    return best;
  }

  /** Mundo + actores: devuelve el impacto más cercano. */
  shoot(origin: Vector3, dir: Vector3, maxDist: number): BulletHit | null {
    const world = this.raycastWorld(origin, dir, maxDist);
    let limit = world ? world.distance : maxDist;
    let result: BulletHit | null = world;
    for (const a of this.actors) {
      if (!a.alive) continue;
      const h = a.hitTest(origin, dir, limit);
      if (h && h.distance < limit) {
        limit = h.distance;
        result = {
          distance: h.distance,
          point: origin.add(dir.scale(h.distance)),
          normal: dir.scale(-1),
          kind: "actor",
          surface: "dirt",
          actor: a,
          zone: h.zone,
        };
      }
    }
    return result;
  }

  /** ¿Hay línea de visión libre entre dos puntos (sin contar actores)? */
  hasLineOfSight(from: Vector3, to: Vector3): boolean {
    const d = to.subtract(from);
    const len = d.length();
    if (len < 1e-3) return true;
    d.scaleInPlace(1 / len);
    const hit = this.raycastWorld(from, d, len);
    return !hit || hit.distance >= len - 0.3;
  }

  /** Calzada vs acera (compartido con el servidor). */
  static isRoad(x: number, z: number): boolean {
    return isRoadShared(x, z);
  }
}
