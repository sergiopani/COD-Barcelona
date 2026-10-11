import { Mesh, MeshBuilder, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { buildCharacter } from "../characters/Character";
import type { AudioManager } from "../audio/AudioManager";
import { type ActorHit, Ballistics, type Shootable, rayVsSphere, rayVsVerticalCylinder } from "../weapons/Ballistics";
import type { Effects } from "../weapons/Effects";

/**
 * Objetivo de combate (bot) con apariencia de maniquí. Patrulla por las aceras, detecta al jugador por visión
 * y por el sonido de los disparos, apunta con retardo y dispara con una probabilidad de acierto que baja con la
 * distancia. Tiene 100 PS: cabeza (200 de daño) y torso (100) matan de un tiro; las piernas (60) necesitan dos.
 */
export interface BotContext {
  playerEye: Vector3;
  playerAlive: boolean;
  playerSpeed: number;
  ballistics: Ballistics;
  effects: Effects;
  audio: AudioManager;
  waypoints: Vector3[];
  /** El bot ha disparado al jugador: aplicar daño (si acierta). */
  damagePlayer(amount: number, from: Vector3): void;
}

export const BOT_HEIGHT = 1.75;
const HEAD_Y = 1.62;
const HEAD_R = 0.15;
const TORSO_R = 0.3;
const WALK_SPEED = 1.7;

type State = "patrol" | "aim" | "cooldown" | "dead";

export class Bot implements Shootable {
  health = 100;
  alive = true;
  readonly root: TransformNode;
  readonly body: Mesh;
  yaw = Math.random() * Math.PI * 2;
  private state: State = "patrol";
  private target: Vector3 | null = null;
  private timer = 0;
  private lostSight = 0;
  private alert = 0;
  private losTimer = Math.random() * 0.2;
  private canSee = false;
  private walk = 0;
  private stuckTimer = 0;
  private lastPos = new Vector3();
  private deadTime = 0;
  private flash = 0;
  private legL!: Mesh;
  private legR!: Mesh;
  private armL!: Mesh;
  private armR!: Mesh;
  readonly casters: Mesh[] = [];
  private readonly allMeshes: Mesh[] = [];

  constructor(scene: Scene, readonly id: number, readonly name: string) {
    this.root = new TransformNode(`bot${id}`, scene);
    // cuerpo de colisión (invisible) para moverse con el motor de colisiones
    this.body = MeshBuilder.CreateBox(`botBody${id}`, { size: 0.1 }, scene);
    this.body.isVisible = false;
    this.body.isPickable = false;
    this.body.checkCollisions = true;
    this.body.ellipsoid = new Vector3(0.32, 0.9, 0.32);
    this.body.ellipsoidOffset = new Vector3(0, 0.9, 0);
    this.root.parent = this.body;

    // Aspecto compartido por todos los personajes (ver characters/Character.ts); solo torso y piernas proyectan sombra
    const parts = buildCharacter(scene, id, this.root);
    this.legL = parts.legL;
    this.legR = parts.legR;
    this.armL = parts.armL;
    this.armR = parts.armR;
    this.allMeshes.push(...parts.meshes);
    this.casters.push(...parts.casters);
    this.lastPos.setAll(0);
  }

  /** Para pruebas: desactiva la IA (el bot no se mueve ni dispara). */
  private frozenAi = false;
  freeze(on: boolean): void {
    this.frozenAi = on;
  }

  get position(): Vector3 {
    return this.body.position;
  }
  get eye(): Vector3 {
    return this.body.position.add(new Vector3(0, 1.55, 0));
  }

  respawn(pos: Vector3): void {
    this.health = 100;
    this.alive = true;
    this.state = "patrol";
    this.target = null;
    this.deadTime = 0;
    this.alert = 0;
    this.body.position.copyFrom(pos);
    this.body.computeWorldMatrix(true);
    this.root.rotation.set(0, 0, 0);
    this.root.position.set(0, 0, 0);
    this.body.checkCollisions = true;
    this.allMeshes.forEach((m) => m.setEnabled(true));
  }

  /** Aplica daño; devuelve true si muere. */
  damage(amount: number, attackerPos: Vector3): boolean {
    if (!this.alive) return false;
    this.health -= amount;
    this.flash = 0.12;
    // reacción: se vuelve hacia el atacante y se pone en alerta
    this.alert = 6;
    this.faceToward(attackerPos, 1);
    if (this.state === "patrol") this.startAim(0.5);
    if (this.health <= 0) {
      this.alive = false;
      this.state = "dead";
      this.deadTime = 0;
      this.body.checkCollisions = false; // el cadáver no bloquea
      return true;
    }
    return false;
  }

  /** Disparo oído cerca: gira hacia el origen del sonido. */
  hear(source: Vector3): void {
    if (!this.alive) return;
    this.alert = Math.max(this.alert, 4);
    this.faceToward(source, 0.6);
  }

  hitTest(o: Vector3, d: Vector3, maxDist: number): ActorHit | null {
    const p = this.body.position;
    const head = rayVsSphere(o, d, new Vector3(p.x, p.y + HEAD_Y, p.z), HEAD_R + 0.02, maxDist);
    const torso = rayVsVerticalCylinder(o, d, p.x, p.z, TORSO_R, p.y + 0.85, p.y + 1.5, maxDist);
    const legs = rayVsVerticalCylinder(o, d, p.x, p.z, 0.2, p.y, p.y + 0.85, maxDist);
    let best: ActorHit | null = null;
    const consider = (t: number | null, zone: ActorHit["zone"]): void => {
      if (t !== null && (!best || t < best.distance)) best = { distance: t, zone };
    };
    consider(head, "head");
    consider(torso, "torso");
    consider(legs, "legs");
    return best;
  }

  private faceToward(p: Vector3, amount: number): void {
    const dx = p.x - this.body.position.x;
    const dz = p.z - this.body.position.z;
    const want = Math.atan2(dx, dz);
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, amount);
  }

  private startAim(delay: number): void {
    this.state = "aim";
    this.timer = delay;
    this.lostSight = 0;
  }

  update(dt: number, ctx: BotContext): void {
    if (!this.alive) {
      this.deadTime += dt;
      const k = Math.min(1, this.deadTime / 0.45);
      this.root.rotation.x = -k * (Math.PI / 2) * 0.98;
      this.root.position.y = 0.2 * k;
      this.root.position.z = 0;
      return;
    }
    if (this.frozenAi) return;
    this.alert = Math.max(0, this.alert - dt);
    this.flash = Math.max(0, this.flash - dt);

    const eye = this.eye;
    const toPlayer = ctx.playerEye.subtract(eye);
    const dist = toPlayer.length();

    // visión (el trazado de línea de visión se hace a ~5 Hz por bot)
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.18 + Math.random() * 0.06;
      this.canSee = false;
      if (ctx.playerAlive && dist < 130) {
        const dir = toPlayer.scale(1 / dist);
        const fx = Math.sin(this.yaw);
        const fz = Math.cos(this.yaw);
        const cos = fx * dir.x + fz * dir.z;
        const inFov = cos > 0.35 || dist < 9 || this.alert > 0 || this.state !== "patrol";
        if (inFov && ctx.ballistics.hasLineOfSight(eye, ctx.playerEye)) this.canSee = true;
      }
    }

    switch (this.state) {
      case "patrol":
        this.patrol(dt, ctx);
        if (this.canSee) this.startAim(this.alert > 0 ? 0.55 : 0.9 + Math.random() * 0.7);
        break;
      case "aim":
        this.faceToward(ctx.playerEye, dt * 7);
        this.lostSight = this.canSee ? 0 : this.lostSight + dt;
        if (this.lostSight > 1.2 || !ctx.playerAlive) {
          this.state = "patrol";
          this.target = null;
          break;
        }
        this.timer -= dt;
        if (this.timer <= 0 && this.canSee) this.fire(ctx, dist);
        break;
      case "cooldown":
        this.faceToward(ctx.playerEye, dt * 4);
        this.timer -= dt;
        if (this.timer <= 0) this.startAim(0.35);
        break;
      default:
        break;
    }
    this.animate(dt);
  }

  private fire(ctx: BotContext, dist: number): void {
    const muzzle = this.body.position.add(new Vector3(Math.sin(this.yaw) * 0.6 + Math.cos(this.yaw) * 0.14, 1.3, Math.cos(this.yaw) * 0.6 - Math.sin(this.yaw) * 0.14));
    // probabilidad de acierto: alta de cerca, baja de lejos y si el jugador se mueve
    let p = 0.8 - dist / 140;
    p *= 1 - Math.min(0.35, ctx.playerSpeed * 0.07);
    p = Math.max(0.12, Math.min(0.85, p));
    const hits = Math.random() < p;
    const aimPoint = ctx.playerEye.add(new Vector3(0, -0.35, 0));
    if (!hits) {
      aimPoint.x += (Math.random() - 0.5) * 3.2;
      aimPoint.y += (Math.random() - 0.5) * 1.6;
      aimPoint.z += (Math.random() - 0.5) * 3.2;
    }
    ctx.effects.tracer(muzzle, aimPoint);
    ctx.audio.distantShot(dist);
    if (hits) ctx.damagePlayer(25, this.body.position);
    this.state = "cooldown";
    this.timer = 1.0 + Math.random() * 0.8;
  }

  private patrol(dt: number, ctx: BotContext): void {
    if (!this.target || Vector3.Distance(this.body.position, this.target) < 1.0) {
      const wps = ctx.waypoints;
      // siguiente punto: uno razonablemente cercano al azar
      let tries = 0;
      do {
        this.target = wps[Math.floor(Math.random() * wps.length)];
        tries++;
      } while (tries < 12 && (Vector3.Distance(this.body.position, this.target) > 55 || Vector3.Distance(this.body.position, this.target) < 6));
    }
    const t = this.target!;
    this.faceToward(t, dt * 4);
    const dx = t.x - this.body.position.x;
    const dz = t.z - this.body.position.z;
    const l = Math.hypot(dx, dz) || 1;
    const sp = WALK_SPEED * (this.alert > 0 ? 1.4 : 1);
    this.move((dx / l) * sp * dt, (dz / l) * sp * dt);
    this.walk += dt * sp * 3.2;
    // atasco: si apenas avanza en 1 s, elige otro destino
    this.stuckTimer += dt;
    if (this.stuckTimer > 1) {
      if (Vector3.Distance(this.body.position, this.lastPos) < 0.5) this.target = null;
      this.lastPos.copyFrom(this.body.position);
      this.stuckTimer = 0;
    }
  }

  private move(dx: number, dz: number): void {
    this.body.computeWorldMatrix(true);
    this.body.moveWithCollisions(new Vector3(dx, 0, dz));
    // altura: calzada a 0, acera a 0,14
    const wantY = Ballistics.isRoad(this.body.position.x, this.body.position.z) ? 0 : 0.14;
    this.body.position.y += (wantY - this.body.position.y) * 0.5;
  }

  private animate(dt: number): void {
    this.body.rotation.y = this.yaw;
    const moving = this.state === "patrol";
    const swing = moving ? Math.sin(this.walk) * 0.7 : 0;
    this.legL.rotation.x = swing;
    this.legR.rotation.x = -swing;
    const aiming = this.state === "aim" || this.state === "cooldown";
    this.armL.rotation.x = aiming ? -1.3 : -swing * 0.6;
    this.armR.rotation.x = aiming ? -1.35 : swing * 0.6;
    this.root.position.y = moving ? Math.abs(Math.sin(this.walk)) * 0.025 : 0;
    void dt;
  }

  setVisible(v: boolean): void {
    this.allMeshes.forEach((m) => m.setEnabled(v));
  }

  dispose(): void {
    this.allMeshes.forEach((m) => m.dispose());
    this.body.dispose();
    this.root.dispose();
  }
}

