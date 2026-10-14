import { Mesh, Scene } from "@babylonjs/core";
import { PARK_CX, STREET } from "../config";
import { offsetPolyline } from "../util/geom";
import type { CollisionManager } from "./CollisionManager";
import type { MaterialSet } from "./Materials";
import { BatchSet, F, Frame, MeshBatch, type P3, type RGBA } from "./MeshBatch";
import { POND, parkBushes, parkChain, parkPaths, parkPlaza, pondPoint } from "./mapLayout";

const CURB = STREET.curbHeight;
const UP: P3 = [0, 1, 0];
const WHITE: RGBA = [1, 1, 1, 1];
const POND_SEGS = 56;
const RIM_H = 0.5;

export interface ParkBuild {
  meshes: Mesh[];
}

/**
 * El parque (Plaça de Gaudí): césped, caminos de gravilla, explanada de baldosa junto a la basílica, estanque con borde de piedra
 * (el borde es sólido: se puede saltar al agua, que es poco profunda) y arbustos. Árboles y mobiliario vienen de `props` (mapLayout).
 * Las coordenadas de mapLayout están en locales del parque (u = x − PARK_CX).
 */
export function buildPark(scene: Scene, mats: MaterialSet, collisions: CollisionManager): ParkBuild {
  const meshes: Mesh[] = [];
  const finish = (mesh: Mesh | null, material: Mesh["material"], shadows = true): void => {
    if (!mesh) return;
    mesh.material = material;
    mesh.receiveShadows = shadows;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    meshes.push(mesh);
  };

  // Césped: abanico desde el centro hasta el perímetro de la manzana (a la misma altura que las aceras).
  const grass = new MeshBatch(mats.tile.grass);
  const pts = parkChain.points;
  const c: P3 = [PARK_CX, CURB, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const uv = (x: number, z: number): [number, number] => [x / mats.tile.grass, z / mats.tile.grass];
    grass.addTriangle([c, [a.x, CURB, a.z], [b.x, CURB, b.z]], UP, [uv(c[0], c[2]), uv(a.x, a.z), uv(b.x, b.z)]);
  }
  finish(grass.toMesh("parkGrass", scene), mats.mat.grass);

  // Caminos de gravilla: cintas que siguen cada polilínea (un pelo por encima del césped; el desplazamiento de profundidad evita el parpadeo).
  const GY = CURB + 0.012;
  const gravel = new MeshBatch(mats.tile.gravel);
  for (const path of parkPaths) {
    const world = path.pts.map((p) => ({ x: p.x + PARK_CX, z: p.z }));
    const left = offsetPolyline(world, -path.width / 2, path.closed);
    const right = offsetPolyline(world, path.width / 2, path.closed);
    const n = world.length;
    const count = path.closed ? n : n - 1;
    const t = mats.tile.gravel;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % n;
      gravel.addQuad(
        [[left[i].x, GY, left[i].z], [left[j].x, GY, left[j].z], [right[j].x, GY, right[j].z], [right[i].x, GY, right[i].z]],
        UP,
        [[left[i].x / t, left[i].z / t], [left[j].x / t, left[j].z / t], [right[j].x / t, right[j].z / t], [right[i].x / t, right[i].z / t]],
        WHITE,
      );
    }
  }
  mats.mat.gravel.zOffset = -2;
  finish(gravel.toMesh("parkPaths", scene), mats.mat.gravel);

  // Explanada de baldosa junto a la basílica.
  const plaza = new MeshBatch(1);
  const { u0, u1, v0, v1 } = parkPlaza;
  const k = 2.4;
  const x0 = u0 + PARK_CX;
  const x1 = u1 + PARK_CX;
  plaza.addQuad([[x0, GY, v0], [x0, GY, v1], [x1, GY, v1], [x1, GY, v0]], UP, [[x0 / k, v0 / k], [x0 / k, v1 / k], [x1 / k, v1 / k], [x1 / k, v0 / k]], WHITE);
  finish(plaza.toMesh("parkPlaza", scene), mats.panot);
  mats.panot.zOffset = -1;

  // Estanque: lámina de agua (sobre el césped, dentro del borde de piedra).
  const contour: { x: number; z: number }[] = [];
  for (let i = 0; i < POND_SEGS; i++) {
    const p = pondPoint((i / POND_SEGS) * Math.PI * 2);
    contour.push({ x: p.x + PARK_CX, z: p.z });
  }
  const WY = CURB + 0.1;
  const water = new MeshBatch(mats.tile.water);
  const wc: P3 = [POND.u + PARK_CX, WY, POND.v];
  const wt = mats.tile.water;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    water.addTriangle([wc, [a.x, WY, a.z], [b.x, WY, b.z]], UP, [[wc[0] / wt, wc[2] / wt], [a.x / wt, a.z / wt], [b.x / wt, b.z / wt]]);
  }
  finish(water.toMesh("parkWater", scene), mats.mat.water, false);

  // Borde de piedra del estanque (visible y sólido).
  const rimSet = new BatchSet(mats.tile);
  const stone = rimSet.get("park", "stone");
  const stoneC: RGBA = [1.05, 1, 0.92, 1];
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const f = new Frame(a.x, CURB, a.z, ux, uz, uz, -ux);
    stone.addBox(f, len / 2, RIM_H / 2, 0, len + 0.12, RIM_H, 0.55, stoneC, F.DOWN);
    collisions.addBox((a.x + b.x) / 2, CURB + RIM_H / 2, (a.z + b.z) / 2, len + 0.1, RIM_H, 0.55, Math.atan2(-uz, ux), "cover");
  }
  for (const { mesh } of rimSet.build(scene, "parkRim")) finish(mesh, mats.mat.stone);

  // Arbustos: grupos de elipsoides con variación de tono (sin colisión).
  const bushes = new MeshBatch(mats.tile.foliage);
  for (const b of parkBushes) {
    const tint: RGBA = [b.tint * 0.9, b.tint, b.tint * 0.85, 1];
    bushes.addEllipsoid(b.x, CURB + b.h * 0.45, b.z, b.r, b.h, b.r * 0.9, 8, 5, tint);
    bushes.addEllipsoid(b.x + b.r * 0.55, CURB + b.h * 0.3, b.z + b.r * 0.3, b.r * 0.7, b.h * 0.7, b.r * 0.65, 7, 4, [tint[0] * 0.92, tint[1] * 0.95, tint[2], 1]);
  }
  finish(bushes.toMesh("parkBushes", scene), mats.mat.foliage);

  return { meshes };
}
