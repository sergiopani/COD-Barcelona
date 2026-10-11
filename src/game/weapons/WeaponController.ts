import { Axis, Vector3 } from "@babylonjs/core";
import type { AudioManager } from "../audio/AudioManager";
import type { InputManager } from "../player/InputManager";
import type { PlayerController } from "../player/PlayerController";
import type { Ballistics, HitZone, Shootable } from "./Ballistics";
import type { Effects } from "./Effects";
import type { Viewmodel } from "./Viewmodel";
import type { WeaponDefinition } from "./WeaponDefinition";

export interface WeaponEvents {
  onShot(): void;
  /** Daño a un actor: devuelve true si lo mató. */
  onActorHit(actor: Shootable, damage: number, zone: HitZone): boolean;
  onWorldHit?(distance: number): void;
  /** Multijugador: intención de disparo (origen del ojo y dirección SIN dispersión). */
  onFire?(origin: Vector3, forward: Vector3, ads: number): void;
  onReload?(): void;
}

/**
 * Lógica del arma del jugador: munición, cadencia (cerrojo), recarga, apuntado (ADS) con zoom y oscilación,
 * disparo hitscan con dispersión y retroceso. Es independiente del arma concreta (usa WeaponDefinition).
 */
export class WeaponController {
  ammo: number;
  reserve: number;
  private cooldown = 0;
  private reloadTimer = 0;
  private reloading = false;
  private aimHeld = false;
  /** 0..1 suavizado de entrada/salida de la mira. */
  ads = 0;
  zoomIndex = 0;
  /** Resistencia para aguantar la respiración (1 = llena). */
  breath = 1;
  private breathExhausted = false;
  private swayT = 0;
  private lastShotAge = 99;

  constructor(
    readonly def: WeaponDefinition,
    private readonly player: PlayerController,
    private readonly input: InputManager,
    private readonly ballistics: Ballistics,
    private readonly effects: Effects,
    private readonly audio: AudioManager,
    private readonly viewmodel: Viewmodel,
    private readonly events: WeaponEvents,
  ) {
    this.ammo = def.magazine;
    this.reserve = def.reserve;
  }

  reset(): void {
    this.ammo = this.def.magazine;
    this.reserve = this.def.reserve;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.ads = 0;
    this.aimHeld = false;
    this.breath = 1;
    this.breathExhausted = false;
  }

  get zoom(): number {
    return this.def.zoomLevels[this.zoomIndex];
  }
  get isReloading(): boolean {
    return this.reloading;
  }
  get reloadProgress(): number {
    return this.reloading ? 1 - this.reloadTimer / this.def.reloadTime : -1;
  }
  get boltProgress(): number {
    if (this.cooldown <= 0) return -1;
    const t = this.def.cycleTime;
    const p = (t - this.cooldown - 0.25) / (t - 0.25);
    return p < 0 ? -1 : Math.min(1, p);
  }
  /** La mira telescópica es visible (apuntado casi completo). */
  get scoped(): boolean {
    return this.ads > 0.92;
  }

  update(dt: number, active: boolean): void {
    this.lastShotAge += dt;
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const take = Math.min(this.def.magazine - this.ammo, this.reserve);
        this.ammo += take;
        this.reserve -= take;
        this.reloading = false;
      }
    }

    // ---- entrada
    if (active) {
      const wheel = this.input.consumeWheel();
      if (wheel !== 0 && this.aimHeld) {
        const n = this.def.zoomLevels.length;
        this.zoomIndex = (this.zoomIndex + (wheel > 0 ? -1 : 1) + n) % n;
      }
      const sprinting = (this.input.isDown("ShiftLeft") || this.input.isDown("ShiftRight")) && this.player.speed > 4 && this.ads < 0.2;
      this.aimHeld = this.input.isMouseDown(2) && !this.reloading && !sprinting;
      if (this.input.wasPressed("KeyR")) this.startReload();
      if (this.input.wasMousePressed(0)) this.tryFire();
    } else {
      this.aimHeld = false;
    }

    // ---- apuntado
    const target = this.aimHeld ? 1 : 0;
    const step = dt / this.def.adsTime;
    this.ads = target === 1 ? Math.min(1, this.ads + step) : Math.max(0, this.ads - step * 1.3);
    const baseHalf = Math.tan(this.player.baseFov / 2);
    if (this.aimHeld) {
      const zFov = 2 * Math.atan(baseHalf / this.zoom);
      this.player.fovTarget = zFov;
      this.player.fovSpeed = 16;
      this.player.sensScale = Math.tan(zFov / 2) / baseHalf; // misma sensación de giro que sin zoom
    } else {
      this.player.fovTarget = null;
      this.player.fovSpeed = 12;
      this.player.sensScale = 1 + (this.player.sensScale - 1) * 0.5;
      if (Math.abs(this.player.sensScale - 1) < 0.01) this.player.sensScale = 1;
    }
    this.player.speedScale = 1 + (this.def.adsMoveSpeed - 1) * this.ads;
    this.player.allowSprint = this.ads < 0.15 && !this.reloading;

    // ---- aguantar la respiración (Shift mientras se mira por la mira)
    const holding = this.scoped && active && (this.input.isDown("ShiftLeft") || this.input.isDown("ShiftRight")) && !this.breathExhausted;
    if (holding) {
      this.breath = Math.max(0, this.breath - dt / 3.5);
      if (this.breath <= 0) this.breathExhausted = true;
    } else {
      this.breath = Math.min(1, this.breath + dt / (this.breathExhausted ? 5 : 3));
      if (this.breathExhausted && this.breath > 0.45) this.breathExhausted = false;
    }

    // ---- oscilación de la mira (más con zoom, al moverse y tras un disparo; casi nula si aguantas la respiración)
    this.swayT += dt;
    if (this.ads > 0.05) {
      const moveF = 1 + Math.min(4, this.player.speed * 0.9);
      const shotF = 1 + Math.max(0, 1.5 - this.lastShotAge) * 1.2;
      const amp = 0.0011 * (this.zoom / 4) * moveF * shotF * (holding ? 0.12 : 1) * this.ads;
      const t = this.swayT;
      this.player.swayPitch = amp * (Math.sin(t * 0.9) + 0.5 * Math.sin(t * 2.3 + 1));
      this.player.swayYaw = amp * (Math.sin(t * 0.7 + 2) + 0.5 * Math.sin(t * 1.9));
    } else {
      this.player.swayPitch = 0;
      this.player.swayYaw = 0;
    }

    // ---- viewmodel
    this.viewmodel.setVisible(this.ads < 0.92);
    this.viewmodel.update(dt, {
      ads: this.ads,
      speed: this.player.speed,
      sprinting: !this.aimHeld && (this.input.isDown("ShiftLeft") || this.input.isDown("ShiftRight")) && this.player.speed > 4,
      grounded: this.player.grounded,
      bolt: this.boltProgress,
      reload: this.reloadProgress,
    });
  }

  startReload(): void {
    if (this.reloading || this.ammo >= this.def.magazine || this.reserve <= 0) return;
    this.reloading = true;
    this.reloadTimer = this.def.reloadTime;
    this.audio.reload(this.def.reloadTime);
    this.events.onReload?.();
  }

  /** Multijugador: el servidor es la autoridad de munición y recarga. */
  applyServerState(s: { ammo: number; reserve: number; reloading: boolean }): void {
    this.reserve = s.reserve;
    if (!this.reloading) this.ammo = s.ammo;
    else if (!s.reloading && this.reloadTimer < 0.6) {
      this.ammo = s.ammo;
      this.reloading = false;
    }
  }

  private tryFire(): void {
    if (this.reloading || this.cooldown > 0 || this.player.isDead) return;
    if (this.ads <= 0 && this.player.speed > 6.2) return; // no se dispara a pleno sprint
    if (this.ammo <= 0) {
      this.audio.empty();
      this.startReload();
      return;
    }
    this.fire();
  }

  private fire(): void {
    this.ammo--;
    this.cooldown = this.def.cycleTime;
    this.lastShotAge = 0;
    const cam = this.player.camera;
    const origin = cam.position.clone();
    const forward = cam.getDirection(Axis.Z);
    // dispersión: cono; mucho mayor en cadera y en movimiento
    const moving = Math.min(1, this.player.speed / 5);
    const spread = (this.def.hipSpread * (1 - this.ads) + this.def.adsSpread * this.ads) * (1 + moving * (this.ads > 0.5 ? 3 : 0.6));
    const right = cam.getDirection(Axis.X);
    const up = cam.getDirection(Axis.Y);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    const dir = forward.add(right.scale(Math.cos(a) * r)).add(up.scale(Math.sin(a) * r)).normalize();

    this.audio.shot();
    this.audio.bolt();
    this.viewmodel.kick(1);
    this.player.addRecoil(this.def.recoilPitch * (this.ads > 0.5 ? 1.25 : 1), (Math.random() - 0.5) * 2 * this.def.recoilYaw);
    this.events.onShot();
    this.events.onFire?.(origin, forward, this.ads);

    const muzzle = this.ads > 0.5 ? origin.add(forward.scale(0.9)).add(up.scale(-0.12)).add(right.scale(0.12)) : this.viewmodel.getMuzzleWorld();
    this.effects.muzzleFlash(muzzle.add(forward.scale(0.2)));

    const hit = this.ballistics.shoot(origin, dir, this.def.range);
    const end = hit ? hit.point : origin.add(dir.scale(this.def.range));
    this.effects.tracer(muzzle, end);
    if (!hit) return;
    if (hit.kind === "actor" && hit.actor && hit.zone) {
      const dmg = this.def.damage[hit.zone];
      this.effects.actorImpact(hit.point, dir);
      this.events.onActorHit(hit.actor, dmg, hit.zone);
    } else {
      this.effects.impact(hit);
      this.audio.impact(hit.distance);
      this.events.onWorldHit?.(hit.distance);
    }
  }

  /** Posición del arma para efectos externos. */
  get muzzle(): Vector3 {
    return this.viewmodel.getMuzzleWorld();
  }
}
