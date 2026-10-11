import { Mesh, MeshBuilder, Scene, VertexBuffer } from "@babylonjs/core";
import { ARM_END, STREET } from "../config";
import { offsetPolyline } from "../util/geom";
import { BatchSet, MeshBatch, type P3 } from "./MeshBatch";
import type { CollisionManager } from "./CollisionManager";
import type { MaterialSet } from "./Materials";
import { CROSSWALK_ALONG, centerChain, crosswalks, sidewalkChains, streetRuns, type Chain } from "./mapLayout";

const ROAD_W = STREET.width - 2 * STREET.sidewalk;
const CURB = STREET.curbHeight;
const MARK_Y = 0.014;
const WHITE: [number, number, number, number] = [1, 1, 1, 1];

export interface StreetBuild {
  meshes: Mesh[];
  /** Mallas que reciben sombras. */
  receivers: Mesh[];
}

/**
 * Calzada, aceras con bordillo, interior ajardinado de la manzana, pasos de peatones
 * y marcas viales. Las aceras y la calzada son también la geometría de colisión del suelo.
 */
export function buildStreets(scene: Scene, mats: MaterialSet, collisions: CollisionManager): StreetBuild {
  const meshes: Mesh[] = [];

  // Calzada: un único plano de asfalto bajo todo el mapa (las aceras se apoyan encima).
  const size = (ARM_END + 6) * 2;
  const asphalt = MeshBuilder.CreateGround("asphalt", { width: size, height: size, subdivisions: 1 }, scene);
  const uv = asphalt.getVerticesData(VertexBuffer.UVKind)!;
  for (let i = 0; i < uv.length; i++) uv[i] *= size / 6;
  asphalt.setVerticesData(VertexBuffer.UVKind, uv);
  asphalt.material = mats.asphalt;
  asphalt.receiveShadows = true;
  collisions.addMesh(asphalt, "ground");
  meshes.push(asphalt);

  // Aceras con bordillo.
  const SW_TILE = 2.4;
  for (const chain of sidewalkChains) {
    const m = buildSidewalk(scene, mats, chain, SW_TILE);
    for (const mesh of m) {
      collisions.addMesh(mesh, "ground");
      meshes.push(mesh);
    }
  }

  // Interior de la manzana de la basílica (suelo ajardinado visible a través de la verja).
  const garden = new MeshBatch(6);
  const pts = centerChain.points;
  const c: P3 = [0, CURB, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    garden.addTriangle([c, [a.x, CURB, a.z], [b.x, CURB, b.z]], [0, 1, 0], [[0, 0], [a.x / 6, a.z / 6], [b.x / 6, b.z / 6]]);
  }
  const gardenMesh = garden.toMesh("garden", scene)!;
  gardenMesh.material = mats.mat.garden;
  gardenMesh.receiveShadows = true;
  meshes.push(gardenMesh);

  // Marcas viales y pequeños detalles de calzada (un único lote).
  const marks = new BatchSet({ marking: 1, iron: 1, dark: 1 });
  buildMarkings(marks);
  const markMeshes = marks.build(scene, "road");
  for (const { mesh, key } of markMeshes) {
    mesh.material = key === "marking" ? mats.mat.marking : key === "iron" ? mats.mat.iron : mats.mat.dark;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    meshes.push(mesh);
  }

  return { meshes, receivers: meshes };
}

function buildSidewalk(scene: Scene, mats: MaterialSet, chain: Chain, tile: number): Mesh[] {
  const inner = chain.points;
  const outer = offsetPolyline(inner, STREET.sidewalk, chain.closed);
  const top = new MeshBatch(1);
  const curb = new MeshBatch(1);
  const n = inner.length;
  const count = chain.closed ? n : n - 1;
  let along = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % n;
    const a0 = inner[i];
    const a1 = inner[j];
    const b0 = outer[i];
    const b1 = outer[j];
    const len = Math.hypot(a1.x - a0.x, a1.z - a0.z);
    const u0 = along / tile;
    const u1 = (along + len) / tile;
    top.addQuad(
      [[a0.x, CURB, a0.z], [a1.x, CURB, a1.z], [b1.x, CURB, b1.z], [b0.x, CURB, b0.z]],
      [0, 1, 0],
      [[u0, 0], [u1, 0], [u1, STREET.sidewalk / tile], [u0, STREET.sidewalk / tile]],
      WHITE,
    );
    const dx = b1.x - b0.x;
    const dz = b1.z - b0.z;
    const l = Math.hypot(dx, dz) || 1;
    // normal hacia la calle (derecha de la dirección de recorrido)
    const nrm: P3 = [dz / l, 0, -dx / l];
    const cu0 = along / 1.2;
    const cu1 = (along + l) / 1.2;
    curb.addQuad(
      [[b0.x, 0, b0.z], [b1.x, 0, b1.z], [b1.x, CURB, b1.z], [b0.x, CURB, b0.z]],
      nrm,
      [[cu0, 0], [cu1, 0], [cu1, 0.35], [cu0, 0.35]],
      WHITE,
    );
    // cantería del borde superior: pequeña banda más clara
    along += len;
  }
  const out: Mesh[] = [];
  const t = top.toMesh(`sidewalk_${chain.id}`, scene);
  if (t) {
    t.material = mats.panot;
    t.receiveShadows = true;
    out.push(t);
  }
  const c = curb.toMesh(`curb_${chain.id}`, scene);
  if (c) {
    c.material = mats.curbStone;
    c.receiveShadows = true;
    out.push(c);
  }
  return out;
}

function buildMarkings(set: BatchSet): void {
  const white = set.get("m", "marking");
  const iron = set.get("m", "iron");
  const dark = set.get("m", "dark");

  // Pasos de peatones (cebra).
  for (const cw of crosswalks) {
    const stripe = 0.55;
    const pitch = 1.1;
    const n = Math.floor(ROAD_W / pitch);
    const start = -((n - 1) * pitch) / 2;
    for (let i = 0; i < n; i++) {
      const off = start + i * pitch;
      if (cw.axis === "x") white.addFlatRect(cw.x, MARK_Y, cw.z + off, CROSSWALK_ALONG, stripe, 0, WHITE);
      else white.addFlatRect(cw.x + off, MARK_Y, cw.z, stripe, CROSSWALK_ALONG, 0, WHITE);
    }
  }

  const laneEdge = ROAD_W / 2 - 2.5; // límite del carril de aparcamiento
  for (const run of streetRuns) {
    // Línea central discontinua.
    for (let t = run.from + 1; t < run.to - 3; t += 8) {
      if (run.axis === "x") white.addFlatRect(t + 1.5, MARK_Y, run.at, 3, 0.14, 0, WHITE);
      else white.addFlatRect(run.at, MARK_Y, t + 1.5, 0.14, 3, 0, WHITE);
    }
    // Línea continua del carril de aparcamiento y marcas en T cada 5.4 m.
    for (const side of [-1, 1]) {
      const d = side * laneEdge;
      if (run.axis === "x") white.addFlatRect((run.from + run.to) / 2, MARK_Y, run.at + d, run.to - run.from, 0.1, 0, WHITE);
      else white.addFlatRect(run.at + d, MARK_Y, (run.from + run.to) / 2, 0.1, run.to - run.from, 0, WHITE);
      for (let t = run.from; t <= run.to + 0.01; t += 5.4) {
        if (run.axis === "x") white.addFlatRect(t, MARK_Y, run.at + side * (laneEdge + 1.25), 0.1, 2.5, 0, WHITE);
        else white.addFlatRect(run.at + side * (laneEdge + 1.25), MARK_Y, t, 2.5, 0.1, 0, WHITE);
      }
    }
    // Registros y sumideros.
    for (let t = run.from + 8; t < run.to - 6; t += 22) {
      const cx = run.axis === "x" ? t : run.at + 1.6;
      const cz = run.axis === "x" ? run.at + 1.6 : t;
      iron.addCylinder(cx, 0.004, cz, 0.45, 0.45, 0.02, 12, [0.7, 0.7, 0.7, 1]);
      for (const side of [-1, 1]) {
        const sx = run.axis === "x" ? t + 2 : run.at + side * (ROAD_W / 2 - 0.2);
        const sz = run.axis === "x" ? run.at + side * (ROAD_W / 2 - 0.2) : t + 2;
        dark.addFlatRect(sx, MARK_Y, sz, run.axis === "x" ? 0.9 : 0.3, run.axis === "x" ? 0.3 : 0.9, 0, WHITE);
      }
    }
  }
}
