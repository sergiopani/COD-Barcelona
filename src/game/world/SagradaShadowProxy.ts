import { AbstractMesh, Mesh, Scene, Vector3 } from "@babylonjs/core";
import { MeshBatch, type P3 } from "./MeshBatch";

/**
 * Proxy de sombra para el modelo de la basílica (930 k triángulos): un campo de alturas de columnas
 * de 0,75 m calculado a partir de los vértices del modelo (≈ 15–30 k triángulos). Proyecta casi la misma
 * sombra que el modelo real a una fracción del coste. Solo se dibuja en el mapa de sombras:
 * su layerMask lo excluye de la cámara principal.
 */
export const SHADOW_ONLY_LAYER = 0x10000000;

export function buildHeightfieldShadowProxy(scene: Scene, meshes: AbstractMesh[], cell = 0.75): Mesh | null {
  const pts: Vector3[] = [];
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity,
    minY = Infinity;
  const v = new Vector3();
  for (const m of meshes) {
    if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
    const pos = m.getVerticesData("position");
    if (!pos) continue;
    const w = m.computeWorldMatrix(true);
    for (let i = 0; i < pos.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], w, v);
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minZ = Math.min(minZ, v.z);
      maxZ = Math.max(maxZ, v.z);
      minY = Math.min(minY, v.y);
      pts.push(v.clone());
    }
  }
  if (pts.length === 0) return null;
  const nx = Math.ceil((maxX - minX) / cell) + 1;
  const nz = Math.ceil((maxZ - minZ) / cell) + 1;
  const h = new Float32Array(nx * nz).fill(minY);
  for (const p of pts) {
    const ix = Math.min(nx - 1, Math.floor((p.x - minX) / cell));
    const iz = Math.min(nz - 1, Math.floor((p.z - minZ) / cell));
    const k = iz * nx + ix;
    if (p.y > h[k]) h[k] = p.y;
  }
  // un pequeño "cierre" evita agujeros entre vértices dispersos: cada celda toma el mínimo de máximos vecinos si está vacía
  const filled = new Float32Array(h);
  for (let iz = 1; iz < nz - 1; iz++) {
    for (let ix = 1; ix < nx - 1; ix++) {
      const k = iz * nx + ix;
      if (h[k] <= minY + 0.01) {
        const n = [h[k - 1], h[k + 1], h[k - nx], h[k + nx]].filter((x) => x > minY + 0.01);
        if (n.length >= 3) filled[k] = Math.min(...n);
      }
    }
  }
  const Q = 0.5; // las alturas se cuantizan para poder fusionar celdas contiguas
  const at = (ix: number, iz: number): number =>
    ix < 0 || iz < 0 || ix >= nx || iz >= nz ? minY : Math.round((filled[iz * nx + ix] - minY) / Q) * Q + minY;

  const batch = new MeshBatch(1);
  const up: P3 = [0, 1, 0];
  const uv: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const solid = (ix: number, iz: number): boolean => at(ix, iz) > minY + 0.01;

  // Techos: cada fila se fusiona en tramos de igual altura.
  for (let iz = 0; iz < nz; iz++) {
    let ix = 0;
    while (ix < nx) {
      if (!solid(ix, iz)) {
        ix++;
        continue;
      }
      const top = at(ix, iz);
      let end = ix;
      while (end + 1 < nx && at(end + 1, iz) === top) end++;
      const x0 = minX + ix * cell,
        x1 = minX + (end + 1) * cell,
        z0 = minZ + iz * cell,
        z1 = z0 + cell;
      batch.addQuad([[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]], up, uv);
      ix = end + 1;
    }
  }
  // Caras laterales hasta la altura del vecino, fusionando tramos con el mismo par de alturas.
  // Caras normales a ±Z (recorren X) y a ±X (recorren Z).
  for (const dir of [-1, 1] as const) {
    for (let iz = 0; iz < nz; iz++) {
      let ix = 0;
      while (ix < nx) {
        const top = at(ix, iz);
        const nb = at(ix, iz + dir);
        if (top <= minY + 0.01 || nb >= top) {
          ix++;
          continue;
        }
        let end = ix;
        while (end + 1 < nx && at(end + 1, iz) === top && at(end + 1, iz + dir) === nb) end++;
        const x0 = minX + ix * cell,
          x1 = minX + (end + 1) * cell,
          z = minZ + (iz + (dir > 0 ? 1 : 0)) * cell,
          lo = Math.max(nb, minY);
        batch.addQuad([[x0, lo, z], [x1, lo, z], [x1, top, z], [x0, top, z]], [0, 0, dir], uv);
        ix = end + 1;
      }
    }
    for (let ix = 0; ix < nx; ix++) {
      let iz = 0;
      while (iz < nz) {
        const top = at(ix, iz);
        const nb = at(ix + dir, iz);
        if (top <= minY + 0.01 || nb >= top) {
          iz++;
          continue;
        }
        let end = iz;
        while (end + 1 < nz && at(ix, end + 1) === top && at(ix + dir, end + 1) === nb) end++;
        const z0 = minZ + iz * cell,
          z1 = minZ + (end + 1) * cell,
          x = minX + (ix + (dir > 0 ? 1 : 0)) * cell,
          lo = Math.max(nb, minY);
        batch.addQuad([[x, lo, z0], [x, lo, z1], [x, top, z1], [x, top, z0]], [dir, 0, 0], uv);
        iz = end + 1;
      }
    }
  }
  const mesh = batch.toMesh("sagradaShadowProxy", scene);
  if (!mesh) return null;
  mesh.layerMask = SHADOW_ONLY_LAYER; // no lo ve la cámara (layerMask por defecto 0x0FFFFFFF)
  mesh.isPickable = false;
  mesh.freezeWorldMatrix();
  console.info(`[SagradaFamilia] Proxy de sombra: ${nx}×${nz} celdas, ${(mesh.getTotalIndices() / 3).toLocaleString()} triángulos.`);
  return mesh;
}
