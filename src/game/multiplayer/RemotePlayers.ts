import { Color3, DynamicTexture, Mesh, MeshBuilder, PBRMaterial, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { interpolate, ClockSync } from "../../../shared/interp";
import { INTERP_DELAY_MS, type SnapPlayer } from "../../../shared/protocol";
import type { LightingRig } from "../world/Lighting";

/**
 * Jugadores remotos: maniquíes interpolados a partir de las instantáneas del servidor (renderizados
 * ~100 ms en el pasado para que el movimiento sea fluido aunque lleguen a 20 Hz y con jitter).
 */
const VEST_COLORS: [number, number, number][] = [
  [0.75, 0.22, 0.08],
  [0.1, 0.35, 0.75],
  [0.15, 0.6, 0.25],
  [0.7, 0.6, 0.1],
  [0.55, 0.15, 0.6],
  [0.1, 0.6, 0.6],
  [0.7, 0.1, 0.3],
  [0.45, 0.45, 0.5],
];

type Sample = import("../../../shared/interp").NetSample;

export class RemotePlayer {
  readonly root: TransformNode;
  private readonly meshes: Mesh[] = [];
  private readonly legL: Mesh;
  private readonly legR: Mesh;
  private readonly armL: Mesh;
  private readonly armR: Mesh;
  private readonly tag: Mesh;
  readonly samples: Sample[] = [];
  private walk = 0;
  private lastPos = new Vector3();
  private deadT = 0;
  hp = 100;
  alive = true;
  /** Posición interpolada actual (pies). */
  readonly position = new Vector3();

  constructor(scene: Scene, readonly id: number, public name: string, lighting: LightingRig) {
    const c = VEST_COLORS[(id - 1) % VEST_COLORS.length];
    const mk = (n: string, col: [number, number, number], rough = 0.75): PBRMaterial => {
      const m = new PBRMaterial(`${n}${id}`, scene);
      m.albedoColor = new Color3(...col);
      m.metallic = 0;
      m.roughness = rough;
      return m;
    };
    const vest = mk("rpVest", c, 0.6);
    const cloth = mk("rpCloth", [0.1, 0.12, 0.16]);
    const skin = mk("rpSkin", [0.62, 0.45, 0.36]);
    const dark = mk("rpDark", [0.04, 0.04, 0.05], 0.5);
    this.root = new TransformNode(`remote${id}`, scene);
    const add = (mesh: Mesh, mat: PBRMaterial, cast = false): Mesh => {
      mesh.material = mat;
      mesh.parent = this.root;
      mesh.isPickable = false;
      mesh.receiveShadows = true;
      this.meshes.push(mesh);
      if (cast) lighting.addShadowCaster(mesh, "prop");
      return mesh;
    };
    add(MeshBuilder.CreateBox(`rt${id}`, { width: 0.44, height: 0.62, depth: 0.24 }, scene), vest, true).position.y = 1.2;
    add(MeshBuilder.CreateSphere(`rh${id}`, { diameter: 0.3, segments: 8 }, scene), skin).position.y = 1.62;
    add(MeshBuilder.CreateSphere(`rhm${id}`, { diameter: 0.34, segments: 8, slice: 0.55 }, scene), dark).position.y = 1.64;
    add(MeshBuilder.CreateBox(`rp${id}`, { width: 0.4, height: 0.22, depth: 0.22 }, scene), cloth).position.y = 0.83;
    const leg = (x: number): Mesh => {
      const l = add(MeshBuilder.CreateBox(`rl${id}${x}`, { width: 0.17, height: 0.76, depth: 0.2 }, scene), cloth, true);
      l.setPivotPoint(new Vector3(0, 0.38, 0));
      l.position.set(x, 0.38, 0);
      return l;
    };
    this.legL = leg(-0.11);
    this.legR = leg(0.11);
    const arm = (x: number): Mesh => {
      const a = add(MeshBuilder.CreateBox(`ra${id}${x}`, { width: 0.11, height: 0.56, depth: 0.13 }, scene), cloth);
      a.setPivotPoint(new Vector3(0, 0.26, 0));
      a.position.set(x, 1.18, 0.06);
      return a;
    };
    this.armL = arm(-0.29);
    this.armR = arm(0.29);
    // rifle francotirador (caja larga con visor)
    add(MeshBuilder.CreateBox(`rr${id}`, { width: 0.06, height: 0.08, depth: 1.0 }, scene), dark).position.set(0.14, 1.12, 0.4);
    add(MeshBuilder.CreateCylinder(`rs${id}`, { diameter: 0.05, height: 0.3, tessellation: 8 }, scene), dark).position.set(0.14, 1.2, 0.35);
    (this.meshes[this.meshes.length - 1] as Mesh).rotation.x = Math.PI / 2;

    // etiqueta con el nombre (billboard)
    const tex = new DynamicTexture(`tagTex${id}`, { width: 256, height: 64 }, scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 8, 256, 48);
    ctx.font = "bold 30px Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.fillText(name, 128, 44);
    tex.hasAlpha = true;
    tex.update();
    const tm = new StandardMaterial(`tagMat${id}`, scene);
    tm.diffuseTexture = tex;
    tm.useAlphaFromDiffuseTexture = true;
    tm.emissiveColor = Color3.White();
    tm.disableLighting = true;
    tm.backFaceCulling = false;
    this.tag = MeshBuilder.CreatePlane(`tag${id}`, { width: 1.1, height: 0.275 }, scene);
    this.tag.material = tm;
    this.tag.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.tag.parent = this.root;
    this.tag.position.y = 2.05;
    this.tag.isPickable = false;
    this.tag.renderingGroupId = 1;
    this.meshes.push(this.tag);
  }

  push(t: number, s: SnapPlayer): void {
    if (this.samples.length && t <= this.samples[this.samples.length - 1].t) return; // fuera de orden o duplicado
    this.samples.push({ t, x: s[1], y: s[2], z: s[3], yaw: s[4], ads: s[6], alive: s[8] });
    while (this.samples.length > 40) this.samples.shift();
    this.hp = s[7];
    this.alive = s[8] === 1;
  }

  /** Interpola/extrapola en el instante `renderTime` (reloj del servidor). */
  update(dt: number, renderTime: number, viewerPos: Vector3): void {
    const it = interpolate(this.samples, renderTime);
    if (!it) return;
    const { x, y, z, yaw, ads, alive } = it;
    this.position.set(x, y, z);
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    // animación de caminar según la velocidad real
    const speed = Math.hypot(x - this.lastPos.x, z - this.lastPos.z) / Math.max(dt, 0.001);
    this.lastPos.set(x, y, z);
    this.walk += dt * Math.min(speed, 8) * 3.2;
    const swing = alive ? Math.sin(this.walk) * 0.7 * Math.min(1, speed / 2) : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    this.armL.rotation.x = ads ? -1.3 : -swing * 0.6;
    this.armR.rotation.x = ads ? -1.35 : swing * 0.6;
    if (!alive) {
      this.deadT = Math.min(1, this.deadT + dt * 2.2);
      this.root.rotation.x = -this.deadT * 1.5;
    } else {
      this.deadT = 0;
      this.root.rotation.x = 0;
    }
    // la etiqueta solo se ve a corta/media distancia y con el jugador vivo
    this.tag.setEnabled(alive === 1 && Vector3.Distance(viewerPos, this.root.position) < 70);
  }

  dispose(): void {
    this.meshes.forEach((m) => m.dispose(false, true));
    this.root.dispose();
  }
}

export class RemotePlayers {
  readonly players = new Map<number, RemotePlayer>();
  private readonly clock = new ClockSync();

  constructor(private readonly scene: Scene, private readonly lighting: LightingRig) {}

  /** Tiempo del servidor (ms) que se está dibujando ahora mismo. */
  renderTime(): number {
    return this.clock.serverNow(performance.now()) - INTERP_DELAY_MS;
  }
  /** Tiempo estimado actual del servidor. */
  serverNow(): number {
    return this.clock.serverNow(performance.now());
  }

  onSnapshot(st: number, ps: SnapPlayer[], selfId: number, names: Map<number, string>): void {
    this.clock.update(st, performance.now());
    const seen = new Set<number>();
    for (const s of ps) {
      if (s[0] === selfId) continue;
      seen.add(s[0]);
      let p = this.players.get(s[0]);
      if (!p) {
        p = new RemotePlayer(this.scene, s[0], names.get(s[0]) ?? `Jugador ${s[0]}`, this.lighting);
        this.players.set(s[0], p);
      }
      p.push(st, s);
    }
    for (const [id, p] of this.players) {
      if (!seen.has(id)) {
        p.dispose();
        this.players.delete(id);
      }
    }
  }

  remove(id: number): void {
    this.players.get(id)?.dispose();
    this.players.delete(id);
  }

  update(dt: number, viewerPos: Vector3): void {
    const rt = this.renderTime();
    for (const p of this.players.values()) p.update(dt, rt, viewerPos);
  }

  clear(): void {
    for (const p of this.players.values()) p.dispose();
    this.players.clear();
  }
}
