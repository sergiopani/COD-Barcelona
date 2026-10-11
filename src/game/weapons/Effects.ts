import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  Quaternion,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
} from "@babylonjs/core";
import type { BulletHit } from "./Ballistics";

/**
 * Efectos visuales de combate con pools reutilizables (sin crear objetos por disparo):
 * trazadoras, partículas de impacto (polvo/chispas), agujeros de bala y fogonazo (luz puntual
 * creada una sola vez para no provocar recompilación de shaders).
 */
export class Effects {
  private readonly tracers: { mesh: Mesh; life: number; max: number }[] = [];
  private tracerCursor = 0;
  private readonly decals: Mesh[] = [];
  private decalCursor = 0;
  private readonly dust: ParticleSystem;
  private readonly sparks: ParticleSystem;
  private readonly flash: PointLight;
  private flashTime = 0;
  private readonly tmpUp = new Vector3(0, 1, 0);

  constructor(private readonly scene: Scene) {
    // --- Textura radial reutilizable
    const dot = new DynamicTexture("fxDot", { width: 64, height: 64 }, scene, false);
    const c = dot.getContext() as CanvasRenderingContext2D;
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,0.5)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    dot.hasAlpha = true;
    dot.update();

    // --- Partículas
    this.dust = this.makeSystem("fxDust", dot, 160, new Color4(0.62, 0.58, 0.52, 0.55), new Color4(0.5, 0.47, 0.42, 0), 0.25, 0.7, 0.6, 1.1, 1.6);
    this.sparks = this.makeSystem("fxSparks", dot, 120, new Color4(1, 0.75, 0.3, 1), new Color4(1, 0.3, 0.05, 0), 0.03, 0.08, 0.2, 0.45, 5);
    this.sparks.gravity = new Vector3(0, -9, 0);
    this.sparks.blendMode = ParticleSystem.BLENDMODE_ONEONE;

    // --- Agujeros de bala (pool de planos)
    const decalTex = new DynamicTexture("fxDecal", { width: 64, height: 64 }, scene, true);
    const dc = decalTex.getContext() as CanvasRenderingContext2D;
    const dg = dc.createRadialGradient(32, 32, 2, 32, 32, 30);
    dg.addColorStop(0, "rgba(10,10,10,0.95)");
    dg.addColorStop(0.35, "rgba(25,22,20,0.8)");
    dg.addColorStop(1, "rgba(40,35,30,0)");
    dc.fillStyle = dg;
    dc.fillRect(0, 0, 64, 64);
    decalTex.hasAlpha = true;
    decalTex.update();
    const decalMat = new StandardMaterial("fxDecalMat", scene);
    decalMat.diffuseTexture = decalTex;
    decalMat.useAlphaFromDiffuseTexture = true;
    decalMat.disableLighting = true;
    decalMat.emissiveColor = Color3.White();
    decalMat.backFaceCulling = false;
    decalMat.zOffset = -3;
    decalMat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    for (let i = 0; i < 48; i++) {
      const m = MeshBuilder.CreatePlane(`fxDecal${i}`, { size: 0.18 }, scene);
      m.material = decalMat;
      m.isPickable = false;
      m.setEnabled(false);
      this.decals.push(m);
    }

    // --- Trazadoras
    const tracerMat = new StandardMaterial("fxTracerMat", scene);
    tracerMat.emissiveColor = new Color3(1, 0.85, 0.55);
    tracerMat.disableLighting = true;
    tracerMat.transparencyMode = StandardMaterial.MATERIAL_ALPHABLEND;
    for (let i = 0; i < 10; i++) {
      const m = MeshBuilder.CreateCylinder(`fxTracer${i}`, { diameter: 0.04, height: 1, tessellation: 5 }, scene);
      m.material = tracerMat.clone(`fxTracerMat${i}`);
      m.isPickable = false;
      m.rotationQuaternion = new Quaternion();
      m.setEnabled(false);
      m.renderingGroupId = 0;
      this.tracers.push({ mesh: m, life: 0, max: 0.14 });
    }

    // --- Fogonazo (luz creada una vez; solo cambia su intensidad)
    this.flash = new PointLight("muzzleFlash", Vector3.Zero(), scene);
    this.flash.diffuse = new Color3(1, 0.8, 0.5);
    this.flash.intensity = 0;
    this.flash.range = 25;
  }

  private makeSystem(name: string, tex: Texture, capacity: number, c1: Color4, c2: Color4, s1: number, s2: number, l1: number, l2: number, power: number): ParticleSystem {
    const ps = new ParticleSystem(name, capacity, this.scene);
    ps.particleTexture = tex;
    ps.emitter = Vector3.Zero();
    ps.minEmitBox = ps.maxEmitBox = Vector3.Zero();
    ps.color1 = c1;
    ps.color2 = c1;
    ps.colorDead = c2;
    ps.minSize = s1;
    ps.maxSize = s2;
    ps.minLifeTime = l1 * 0.5;
    ps.maxLifeTime = l2 * 0.5;
    ps.emitRate = 0;
    ps.minEmitPower = power * 0.4;
    ps.maxEmitPower = power;
    ps.direction1 = new Vector3(-1, 1, -1);
    ps.direction2 = new Vector3(1, 1, 1);
    ps.gravity = new Vector3(0, -2, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    return ps;
  }

  /** Fogonazo: pico de luz en el cañón y trazadora desde el cañón hasta el impacto. */
  muzzleFlash(position: Vector3): void {
    this.flash.position.copyFrom(position);
    this.flash.intensity = 40;
    this.flashTime = 0.07;
  }

  tracer(from: Vector3, to: Vector3): void {
    const t = this.tracers[this.tracerCursor++ % this.tracers.length];
    const d = to.subtract(from);
    const len = d.length();
    if (len < 0.5) return;
    d.scaleInPlace(1 / len);
    t.mesh.position.copyFrom(from.add(to).scaleInPlace(0.5));
    t.mesh.scaling.set(1, len, 1);
    Quaternion.FromUnitVectorsToRef(this.tmpUp, d, t.mesh.rotationQuaternion!);
    t.mesh.setEnabled(true);
    t.life = t.max;
    (t.mesh.material as StandardMaterial).alpha = 0.9;
  }

  /** Impacto de bala sobre el mundo: polvo, chispas (metal) y agujero. */
  impact(hit: BulletHit): void {
    const n = hit.normal;
    const base = hit.point;
    this.dust.emitter = base.add(n.scale(0.03));
    this.dust.direction1 = n.scale(1.5).add(new Vector3(-0.7, 0.2, -0.7));
    this.dust.direction2 = n.scale(2.5).add(new Vector3(0.7, 1, 0.7));
    this.dust.manualEmitCount = hit.surface === "asphalt" || hit.surface === "dirt" ? 8 : 12;
    if (hit.surface === "metal" || hit.surface === "stone") {
      this.sparks.emitter = base.add(n.scale(0.03));
      this.sparks.direction1 = n.scale(2).add(new Vector3(-1, 0, -1));
      this.sparks.direction2 = n.scale(4).add(new Vector3(1, 1, 1));
      this.sparks.manualEmitCount = hit.surface === "metal" ? 14 : 6;
    }
    if (hit.kind === "actor") return;
    const d = this.decals[this.decalCursor++ % this.decals.length];
    d.position.copyFrom(base.add(n.scale(0.012)));
    d.lookAt(base.add(n));
    d.rotation.z = Math.random() * Math.PI * 2;
    d.scaling.setAll(0.7 + Math.random() * 0.8);
    d.setEnabled(true);
  }

  /** Sangre/impacto sobre un actor: chispas rojizas. */
  actorImpact(point: Vector3, dir: Vector3): void {
    this.dust.emitter = point.clone();
    this.dust.direction1 = dir.scale(1).add(new Vector3(-0.5, 0.3, -0.5));
    this.dust.direction2 = dir.scale(2).add(new Vector3(0.5, 1, 0.5));
    this.dust.manualEmitCount = 6;
  }

  update(dt: number): void {
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      if (this.flashTime <= 0) this.flash.intensity = 0;
    }
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.setEnabled(false);
      else (t.mesh.material as StandardMaterial).alpha = (t.life / t.max) * 0.9;
    }
  }
}
