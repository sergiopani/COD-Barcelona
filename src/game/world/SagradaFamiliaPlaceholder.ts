import { Mesh, Scene } from "@babylonjs/core";
import { STREET } from "../config";
import { BatchSet, F, Frame, type RGBA } from "./MeshBatch";
import type { MaterialSet } from "./Materials";

/**
 * Basílica PROVISIONAL de la Sagrada Família, construida con geometría procedural.
 * Solo se usa cuando `public/assets/buildings/sagrada-familia.glb` no existe o no se puede cargar.
 * Es una aproximación esquemática de la volumetría real (nave N–S, transepto E–O, fachada del
 * Nacimiento al este, de la Pasión al oeste, torres de apóstoles, evangelistas, María y Jesucristo);
 * NO reproduce los detalles arquitectónicos reales.
 */

const WORLD = new Frame(0, 0, 0, 1, 0, 0, 1);
const BASE_Y = STREET.curbHeight;
const STONE: RGBA = [1.0, 0.97, 0.9, 1];
const STONE_DARK: RGBA = [0.85, 0.8, 0.72, 1];

function box(b: ReturnType<BatchSet["get"]>, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, c: RGBA = STONE, skip: number = F.DOWN): void {
  b.addBox(WORLD, cx, BASE_Y + cy, cz, sx, sy, sz, c, skip);
}

interface TowerOpts {
  x: number;
  z: number;
  r: number;
  h: number;
  sides: number;
  tip: RGBA;
  y0?: number;
}

/** Torre de perfil parabólico con anillos, ventanas en ranura y remate cerámico. */
function tower(set: BatchSet, o: TowerOpts): void {
  const stone = set.get("sf", "stone");
  const dark = set.get("sf", "dark");
  const plain = set.get("sf", "plain");
  const y0 = (o.y0 ?? 0) + BASE_Y;
  const segs = 14;
  const bodyH = o.h * 0.86;
  const radiusAt = (t: number): number => o.r * (1 - 0.5 * Math.pow(t, 1.4));
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const ya = y0 + bodyH * t0;
    const yb = y0 + bodyH * t1;
    const shade = 0.93 + ((i * 37) % 7) * 0.014;
    stone.addCylinder(o.x, ya, o.z, radiusAt(t0), radiusAt(t1), yb - ya, o.sides, [STONE[0] * shade, STONE[1] * shade, STONE[2] * shade, 1], false);
    if (i % 3 === 2) stone.addCylinder(o.x, ya - 0.2, o.z, radiusAt(t0) + 0.35, radiusAt(t0) + 0.2, 0.6, o.sides, STONE_DARK, true);
    if (i >= 2 && i % 2 === 0) {
      const rr = (radiusAt(t0) + radiusAt(t1)) / 2;
      const nSlots = Math.min(8, o.sides);
      for (let k = 0; k < nSlots; k++) {
        const a = (k / nSlots) * Math.PI * 2 + 0.2;
        const fr = new Frame(o.x + Math.cos(a) * rr, 0, o.z + Math.sin(a) * rr, -Math.sin(a), Math.cos(a), Math.cos(a), Math.sin(a));
        dark.addBox(fr, 0, (ya + yb) / 2, 0.02, 0.5, (yb - ya) * 0.55, 0.2, [1, 1, 1, 1], F.BACK | F.DOWN);
      }
    }
  }
  // aguja superior
  const topR = radiusAt(1);
  const yTop = y0 + bodyH;
  stone.addCylinder(o.x, yTop, o.z, topR, topR * 0.35, o.h * 0.1, o.sides, STONE, true);
  stone.addCylinder(o.x, yTop + o.h * 0.1, o.z, topR * 0.35, 0.12, o.h * 0.04, o.sides, STONE_DARK, true);
  // remate cerámico (frutos/estrellas)
  plain.addEllipsoid(o.x, yTop + o.h * 0.1, o.z, topR * 0.55, topR * 0.5, topR * 0.55, 8, 5, o.tip);
  plain.addEllipsoid(o.x, yTop + o.h * 0.15, o.z, topR * 0.18, topR * 0.25, topR * 0.18, 6, 4, [1.8, 1.6, 0.6, 1]);
}

export function buildSagradaPlaceholder(scene: Scene, mats: MaterialSet): { meshes: Mesh[]; triangleCount: number } {
  const set = new BatchSet(mats.tile);
  const stone = set.get("sf", "stone");
  const glass = set.get("sf", "glass");
  const dark = set.get("sf", "dark");

  // ---- Cuerpo: nave central + naves laterales, transepto y ábside.
  box(stone, 0, 15, -6, 40, 30, 56); // naves (z -34..22)
  box(stone, 0, 21, -6, 18, 42, 54, STONE_DARK, 0); // nave central elevada
  box(stone, 0, 16, 1, 62, 32, 18); // transepto (x ±31, z -8..10)
  // ábside semicircular
  stone.addCylinder(0, BASE_Y, 22, 20, 20, 28, 18, STONE, true);
  // cubierta sutil
  box(stone, 0, 44, -6, 20, 2, 55, STONE_DARK, 0);
  // contrafuertes verticales ("árboles") en las paredes laterales
  for (let z = -30; z <= 18; z += 6) {
    for (const sx of [-1, 1]) {
      box(stone, sx * 21.2, 16, z, 2.4, 31, 1.8, STONE_DARK, F.DOWN);
    }
  }
  // ventanas de ranura en la nave alta
  for (let z = -30; z <= 18; z += 4) {
    for (const sx of [-1, 1]) {
      glass.addBox(WORLD, sx * 9.05, BASE_Y + 34, z, 0.1, 6, 1.6, [1, 1, 1, 1], F.DOWN | F.UP | F.BACK);
    }
  }

  // ---- Fachada del Nacimiento (este) y de la Pasión (oeste): portadas con 4 torres
  for (const sx of [1, -1]) {
    box(stone, sx * 33.5, 22, 1, 5, 44, 26, STONE, F.DOWN);
    // tres portales
    for (const z of [-7, 1, 9]) {
      dark.addBox(WORLD, sx * 36.1, BASE_Y + 5, z, 0.3, 9, 5, [1, 1, 1, 1], F.DOWN);
      stone.addBox(WORLD, sx * 36.4, BASE_Y + 11, z, 0.9, 3, 7, STONE_DARK, F.DOWN);
    }
    // gabletes escalonados
    for (let k = 0; k < 5; k++) box(stone, sx * 34.2, 47 + k * 4, 1, 3.5 - k * 0.5, 4.5, 20 - k * 3.5, STONE_DARK, F.DOWN);
    for (const z of [-9, -3, 3, 9]) {
      tower(set, {
        x: sx * 33,
        z: z + 1,
        r: sx > 0 ? 2.7 : 2.9,
        h: sx > 0 ? 106 : 112,
        sides: sx > 0 ? 14 : 8,
        tip: sx > 0 ? [2.2, 1.1, 0.35, 1] : [2.0, 1.9, 0.6, 1],
        y0: 12,
      });
    }
  }

  // ---- Fachada de la Gloria (sur): pórtico y arranques de torres
  box(stone, 0, 14, -37, 36, 28, 6, STONE, F.DOWN);
  for (let k = 0; k < 4; k++) {
    const x = -10.5 + k * 7;
    tower(set, { x, z: -37, r: 3.0, h: 62, sides: 12, tip: [1.2, 1.2, 1.2, 1], y0: 18 });
    dark.addBox(WORLD, x, BASE_Y + 5, -40.1, 4, 9, 0.3, [1, 1, 1, 1], F.DOWN);
  }

  // ---- Torres del crucero: Jesucristo (central), evangelistas, María y apóstoles del ábside
  tower(set, { x: 0, z: 1, r: 8.0, h: 172, sides: 16, tip: [2.4, 2.2, 1.2, 1], y0: 30 });
  for (const [x, z] of [[-9, -7], [9, -7], [-9, 9], [9, 9]]) {
    tower(set, { x, z, r: 4.2, h: 135, sides: 12, tip: [2.2, 1.0, 0.3, 1], y0: 30 });
  }
  tower(set, { x: 0, z: 22, r: 4.6, h: 138, sides: 12, tip: [1.6, 1.8, 2.4, 1], y0: 26 });
  for (let k = 0; k < 6; k++) {
    const a = ((k + 0.5) / 6) * Math.PI;
    tower(set, { x: Math.cos(a) * 17, z: 22 + Math.sin(a) * 17, r: 2.6, h: 98, sides: 10, tip: [2.0, 1.4, 0.4, 1], y0: 26 });
  }

  const built = set.build(scene, "sagrada");
  const meshes: Mesh[] = [];
  let tris = 0;
  for (const { mesh, key } of built) {
    mesh.material = mats.mat[key as keyof typeof mats.mat];
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    tris += (mesh.getTotalIndices() ?? 0) / 3;
    meshes.push(mesh);
  }
  return { meshes, triangleCount: tris };
}
