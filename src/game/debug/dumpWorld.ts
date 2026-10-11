import type { Mesh, Scene } from "@babylonjs/core";
import type { BarcelonaMap } from "../world/BarcelonaMap";
import type { WorldData } from "../../../shared/world";

/**
 * Exporta la colisión del mundo (cajas invisibles + una versión gruesa de la basílica) a JSON para el servidor
 * (`server/data/world-colliders.json`). Ejecutar en la consola: copy(JSON.stringify(__game.dumpWorld())) o ver docs.
 */
export function dumpWorld(scene: Scene, map: BarcelonaMap): WorldData {
  const boxes: WorldData["boxes"] = [];
  const r = (n: number) => Math.round(n * 1000) / 1000;
  for (const m of map.collisions.colliders) {
    const tag = m.metadata?.tag as string;
    if (tag === "ground") continue;
    const bb = m.getBoundingInfo().boundingBox;
    const size = bb.maximum.subtract(bb.minimum);
    boxes.push([tag as WorldData["boxes"][number][0], r(m.position.x), r(m.position.y), r(m.position.z), r(size.x), r(size.y), r(size.z), r(m.rotation.y)]);
  }

  // Basílica: mapa de alturas grueso (celdas de 2 m, alturas cuantizadas a 2 m) → cajas fusionadas por filas
  const proxy = scene.getMeshByName("sagradaShadowProxy") as Mesh | null;
  if (proxy) {
    const pos = proxy.getVerticesData("position")!;
    const cell = 2;
    const heights = new Map<string, number>();
    let minX = Infinity,
      minZ = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i]);
      minZ = Math.min(minZ, pos[i + 2]);
    }
    for (let i = 0; i < pos.length; i += 3) {
      const ix = Math.floor((pos[i] - minX) / cell);
      const iz = Math.floor((pos[i + 2] - minZ) / cell);
      const k = ix + "," + iz;
      heights.set(k, Math.max(heights.get(k) ?? 0, pos[i + 1]));
    }
    const rows = new Map<number, [number, number][]>();
    for (const [k, h] of heights) {
      const [ix, iz] = k.split(",").map(Number);
      if (!rows.has(iz)) rows.set(iz, []);
      rows.get(iz)!.push([ix, Math.round(h / 2) * 2]);
    }
    for (const [iz, list] of rows) {
      list.sort((a, b) => a[0] - b[0]);
      let i = 0;
      while (i < list.length) {
        let j = i;
        while (j + 1 < list.length && list[j + 1][0] === list[j][0] + 1 && list[j + 1][1] === list[i][1]) j++;
        const h = list[i][1];
        if (h > 0.5) {
          const x0 = minX + list[i][0] * cell;
          const x1 = minX + (list[j][0] + 1) * cell;
          boxes.push(["sagrada", r((x0 + x1) / 2), r(h / 2), r(minZ + (iz + 0.5) * cell), r(x1 - x0), r(h), cell, 0]);
        }
        i = j + 1;
      }
    }
  }
  return { version: 1, boxes };
}
