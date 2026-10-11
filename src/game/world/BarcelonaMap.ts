import { Mesh, Scene, Vector3 } from "@babylonjs/core";
import { ARM_END, STREET } from "../config";
import { buildBuilding, planBuildings } from "./BuildingGenerator";
import { CollisionManager } from "./CollisionManager";
import type { LightingRig } from "./Lighting";
import { createMaterials, type MatKey, type MaterialSet } from "./Materials";
import { BatchSet, F, Frame, type RGBA } from "./MeshBatch";
import { buildPalms, type PalmSet } from "./PalmTrees";
import { loadSagradaFamilia, type SagradaResult } from "./SagradaFamiliaLoader";
import { buildProps } from "./StreetFurniture";
import { buildStreets } from "./StreetGenerator";
import { buildingChains, centerChain, crosswalkRect, crosswalks, props, spawns, type Spawn } from "./mapLayout";

export interface MapStats {
  buildings: number;
  props: number;
  covers: number;
  colliders: number;
  staticMeshes: number;
  vertices: number;
  sagradaPlaceholder: boolean;
}

/**
 * Orquesta la construcción del mapa: materiales, calles, edificios, vallado de la manzana,
 * mobiliario, basílica y colisiones. Todo está limitado a la manzana de la Sagrada Família
 * y su entorno inmediato.
 */
export class BarcelonaMap {
  readonly collisions: CollisionManager;
  readonly spawns: Spawn[] = spawns;
  materials!: MaterialSet;
  sagrada!: SagradaResult;
  private palms: PalmSet | null = null;
  stats!: MapStats;
  readonly warnings: string[] = [];
  private readonly meshes: Mesh[] = [];

  constructor(private readonly scene: Scene, private readonly lighting: LightingRig) {
    this.collisions = new CollisionManager(scene);
  }

  async build(onProgress?: (label: string) => void): Promise<void> {
    const tick = async (label: string): Promise<void> => {
      onProgress?.(label);
      await new Promise((r) => setTimeout(r, 0)); // deja respirar al navegador entre fases
    };

    await tick("Generando materiales…");
    this.materials = createMaterials(this.scene);
    const mats = this.materials;
    let vertices = 0;

    await tick("Construyendo calles y aceras…");
    const streets = buildStreets(this.scene, mats, this.collisions);
    this.meshes.push(...streets.meshes);

    await tick("Levantando edificios del Eixample…");
    const specs = planBuildings(buildingChains, 1714);
    const bset = new BatchSet(mats.tile);
    for (const spec of specs) buildBuilding(bset, spec.chain.startsWith("cap") ? "caps" : spec.chain, spec);
    vertices += bset.totalVertices;
    this.addBuilt(bset.build(this.scene, "bld"), true);
    for (const chain of buildingChains) {
      for (const seg of chain.segs) this.collisions.addSegmentWall(seg, 8, 40, "building");
    }

    await tick("Cerrando la manzana de la basílica…");
    const fset = new BatchSet(mats.tile);
    this.buildFence(fset);
    vertices += fset.totalVertices;
    this.addBuilt(fset.build(this.scene, "fence"), true);
    for (const seg of centerChain.segs) this.collisions.addSegmentWall(seg, 0.9, 8, "fence");

    await tick("Colocando mobiliario y vehículos…");
    this.palms = await buildPalms(
      this.scene,
      props.filter((p) => p.kind === "tree").map((p) => ({ x: p.x, y: STREET.curbHeight, z: p.z })),
    );
    if (this.palms) {
      for (const m of this.palms.meshes) this.lighting.addShadowCaster(m);
      this.meshes.push(...this.palms.meshes);
    }
    const pset = new BatchSet(mats.tile);
    buildProps(pset, props, this.collisions, 7, !this.palms);
    vertices += pset.totalVertices;
    this.addBuilt(pset.build(this.scene, "props"), true);

    await tick("Cargando la Sagrada Família…");
    this.sagrada = await loadSagradaFamilia(this.scene, mats, this.collisions);
    for (const m of this.sagrada.meshes) {
      if (m instanceof Mesh && this.sagrada.castShadows && m.getTotalVertices() > 0) this.lighting.addShadowCaster(m);
    }

    this.collisions.addWorldBounds(ARM_END + 8);
    this.validate();

    this.stats = {
      buildings: specs.length,
      props: props.length,
      covers: props.filter((p) => p.cover).length,
      colliders: this.collisions.colliders.length,
      staticMeshes: this.scene.meshes.length,
      vertices,
      sagradaPlaceholder: this.sagrada.usedPlaceholder,
    };
  }

  private addBuilt(built: { mesh: Mesh; key: string }[], castShadows: boolean): void {
    for (const { mesh, key } of built) {
      mesh.material = this.materials.mat[key as MatKey];
      mesh.receiveShadows = true;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      this.meshes.push(mesh);
      // las rejas (alpha test) y el cristal no proyectan sombra útil
      if (castShadows && key !== "railing" && key !== "glass" && key !== "marking") this.lighting.addShadowCaster(mesh);
    }
  }

  /** Verja de forja con zócalo de piedra alrededor del solar de la basílica. */
  private buildFence(set: BatchSet): void {
    const concrete = set.get("fence", "concrete");
    const iron = set.get("fence", "iron");
    const rail = set.get("fence", "railing");
    const stone = set.get("fence", "stone");
    const stoneC: RGBA = [1.05, 1, 0.92, 1];
    for (const seg of centerChain.segs) {
      const f = new Frame(seg.a.x, STREET.curbHeight, seg.a.z, seg.ux, seg.uz, seg.nx, seg.nz);
      const n = Math.max(1, Math.round(seg.len / 3));
      const step = seg.len / n;
      concrete.addBox(f, seg.len / 2, 0.25, -0.3, seg.len, 0.5, 0.45, [1, 1, 1, 1], F.DOWN);
      for (let i = 0; i < n; i++) {
        rail.addPanel(f, i * step + 0.06, (i + 1) * step - 0.06, 0.5, 2.5, -0.3, [1, 1, 1, 1], [step / 1.6, 1]);
      }
      for (let i = 0; i <= n; i++) {
        iron.addBox(f, i * step, 1.3, -0.3, 0.14, 2.6, 0.14, [1, 1, 1, 1], F.DOWN);
        iron.addBox(f, i * step, 2.65, -0.3, 0.2, 0.12, 0.2, [1.4, 1.3, 0.8, 1], F.DOWN);
      }
      stone.addBox(f, 0, 1.6, -0.3, 0.7, 3.2, 0.7, stoneC, F.DOWN); // pilar en cada vértice
    }
  }

  /** Comprobaciones de diseño: cobertura sobre pasos de peatones y puntos de aparición libres. */
  private validate(): void {
    for (const p of props) {
      if (!p.cover) continue;
      for (const cw of crosswalks) {
        const r = crosswalkRect(cw);
        if (Math.abs(p.x - r.cx) < r.hx + 0.6 && Math.abs(p.z - r.cz) < r.hz + 0.6) {
          this.warnings.push(`Cobertura (${p.kind}) sobre paso de peatones en (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
        }
      }
    }
    for (const w of this.warnings) console.warn("[Mapa] " + w);
  }

  spawnPosition(i: number): { position: Vector3; yaw: number } {
    const s = this.spawns[i % this.spawns.length];
    return { position: new Vector3(s.x, 0.05, s.z), yaw: s.yaw };
  }

  dispose(): void {
    this.sagrada?.dispose();
    this.palms?.dispose();
    this.meshes.forEach((m) => m.dispose());
    this.materials?.dispose();
  }
}
