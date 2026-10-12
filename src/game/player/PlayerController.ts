import { Camera, FreeCamera, Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import { PLAYER } from "../config";
import type { CollisionManager } from "../world/CollisionManager";
import type { InputManager } from "./InputManager";

export interface MoveInput {
  forward: number; // -1..1
  strafe: number; // -1..1
  sprint: boolean;
  jump: boolean;
}

/**
 * Control en primera persona: cuerpo elipsoide invisible movido con `moveWithCollisions`,
 * gravedad, salto, detección de suelo y subida automática de bordillos (step-up).
 * La cámara sigue al cuerpo a la altura de los ojos.
 */
export class PlayerController {
  readonly body: Mesh;
  readonly camera: FreeCamera;
  yaw = 0;
  pitch = 0;
  /** Red de seguridad anti-atravesado (se asigna cuando el mapa está construido). */
  safety: CollisionManager | null = null;
  readonly velocity = new Vector3();
  /** 1 + bonus por bajas (usuarios guardados); multiplica la altura de salto. */
  jumpMultiplier = 1;
  grounded = false;
  speed = 0;
  private bobTime = 0;
  /** Multiplicador de velocidad (apuntando se reduce) y permiso para correr. */
  speedScale = 1;
  allowSprint = true;
  /** Escala de la sensibilidad del ratón (con zoom se reduce proporcionalmente al FOV). */
  sensScale = 1;
  /** FOV horizontal objetivo (rad); null = FOV normal. */
  fovTarget: number | null = null;
  fovSpeed = 8;
  /** Oscilación de la mira (rad), aplicada sin modificar la orientación real. */
  swayPitch = 0;
  swayYaw = 0;
  /** Si es true, ignora la entrada (muerto). */
  frozen = false;
  private recoilDebt = 0;
  private deadBlend = 0;
  private readonly tmp = new Vector3();
  /** FOV horizontal de 90° (se mantiene en cualquier relación de aspecto). */
  readonly baseFov = Math.PI / 2;

  constructor(scene: Scene, camera: FreeCamera, private readonly input: InputManager | null) {
    this.camera = camera;
    camera.inputs.clear();
    camera.minZ = 0.1;
    camera.maxZ = 800;
    camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
    camera.fov = this.baseFov;
    camera.rotationQuaternion = null;

    this.body = MeshBuilder.CreateBox("playerBody", { size: 0.1 }, scene);
    this.body.isVisible = false;
    this.body.isPickable = false;
    this.body.checkCollisions = true;
    this.body.ellipsoid = new Vector3(PLAYER.ellipsoid.x, PLAYER.ellipsoid.y, PLAYER.ellipsoid.z);
    // la posición del cuerpo son los PIES; el elipsoide se centra 0.9 m por encima
    this.body.ellipsoidOffset = new Vector3(0, PLAYER.ellipsoid.y, 0);
  }

  teleport(x: number, y: number, z: number, yaw = this.yaw): void {
    this.body.position.set(x, y, z);
    this.velocity.setAll(0);
    this.yaw = yaw;
    this.pitch = 0;
    this.grounded = false;
    this.syncCamera(0, 0);
  }

  get position(): Vector3 {
    return this.body.position;
  }

  /** Actualiza con la entrada real (teclado/ratón). */
  update(dt: number): void {
    const inp = this.input;
    // recuperación parcial del retroceso (la cámara baja sola una parte de lo que subió)
    if (this.recoilDebt > 0) {
      const rec = Math.min(this.recoilDebt, 0.9 * dt);
      this.recoilDebt -= rec;
      this.pitch = Math.min(1.53, this.pitch + rec);
    }
    if (inp?.locked && !this.frozen) {
      const { dx, dy } = inp.consumeMouse();
      const k = PLAYER.mouseSensitivity * this.sensScale;
      this.yaw += dx * k;
      this.pitch = Math.max(-1.53, Math.min(1.53, this.pitch + dy * k));
      this.step(
        {
          forward: (inp.isDown("KeyW") ? 1 : 0) - (inp.isDown("KeyS") ? 1 : 0),
          strafe: (inp.isDown("KeyD") ? 1 : 0) - (inp.isDown("KeyA") ? 1 : 0),
          sprint: this.allowSprint && (inp.isDown("ShiftLeft") || inp.isDown("ShiftRight")),
          jump: inp.isDown("Space"),
        },
        dt,
      );
    } else {
      inp?.consumeMouse();
      this.step({ forward: 0, strafe: 0, sprint: false, jump: false }, dt);
    }
  }

  /** Un paso de simulación (también lo usan las pruebas automáticas de colisión). */
  step(input: MoveInput, dt: number): void {
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    let wx = sinY * input.forward + cosY * input.strafe;
    let wz = cosY * input.forward - sinY * input.strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    const maxSpeed = (input.sprint && input.forward > 0 ? PLAYER.sprintSpeed : PLAYER.walkSpeed) * this.speedScale;
    const k = Math.min(1, PLAYER.accel * dt * (this.grounded ? 1 : PLAYER.airControl));
    this.velocity.x += (wx * maxSpeed - this.velocity.x) * k;
    this.velocity.z += (wz * maxSpeed - this.velocity.z) * k;

    if (this.grounded) {
      this.velocity.y = 0;
      if (input.jump) {
        // la altura de salto sube con las bajas de los usuarios guardados: v = v0·√(1 + bonus) ⇒ altura ×(1 + bonus)
        this.velocity.y = PLAYER.jumpSpeed * Math.sqrt(this.jumpMultiplier);
        this.grounded = false;
      }
    }
    this.velocity.y -= PLAYER.gravity * dt;

    // --- horizontal (con step-up de bordillos)
    const hx = this.velocity.x * dt;
    const hz = this.velocity.z * dt;
    const wasGrounded = this.grounded;
    if (hx !== 0 || hz !== 0) this.moveHorizontal(hx, hz, wasGrounded);

    // --- vertical
    const dy = this.velocity.y * dt;
    const y0 = this.body.position.y;
    this.slide(0, dy, 0);
    const actual = this.body.position.y - y0;
    this.grounded = false;
    if (dy > 0) {
      if (actual < dy * 0.5) this.velocity.y = 0; // golpe con el techo
    } else {
      // Sonda hacia abajo: si hay suelo a menos de 8 cm se considera apoyado (y se pega al suelo).
      const yBefore = this.body.position.y;
      this.slide(0, -0.08, 0);
      if (yBefore - this.body.position.y < 0.075) {
        this.grounded = true;
        this.velocity.y = 0;
      } else {
        this.body.position.y = yBefore;
      }
    }

    if (this.safety && this.safety.depenetrate(this.body.position, PLAYER.ellipsoid.x, PLAYER.ellipsoid.y * 2)) {
      this.body.computeWorldMatrix(true);
    }

    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.syncCamera(dt, input.sprint && this.speed > 1 ? 1 : 0);
  }

  /** Mueve el cuerpo con colisiones; recalcula la matriz mundial para que sea válido sin render intermedio. */
  private slide(x: number, y: number, z: number): void {
    this.body.computeWorldMatrix(true);
    this.body.moveWithCollisions(this.tmp.set(x, y, z));
  }

  private moveHorizontal(hx: number, hz: number, wasGrounded: boolean): void {
    const p = this.body.position;
    const sx = p.x;
    const sy = p.y;
    const sz = p.z;
    this.slide(hx, 0, hz);
    const moved = Math.hypot(p.x - sx, p.z - sz);
    const wanted = Math.hypot(hx, hz);
    if (!wasGrounded || moved >= wanted * 0.6) return;

    // Bloqueado: intenta subir un escalón (bordillo) y avanzar.
    const bx = p.x;
    const by = p.y;
    const bz = p.z;
    p.set(sx, sy, sz);
    this.slide(0, PLAYER.maxStep, 0);
    this.slide(hx, 0, hz);
    this.slide(0, -PLAYER.maxStep - 0.02, 0);
    const movedStep = Math.hypot(p.x - sx, p.z - sz);
    const rose = p.y - sy;
    // Un escalón real permite avanzar (casi) toda la distancia pedida estando elevado; deslizarse a lo largo de una
    // pared o esquina NO cuenta (si no, el jugador "escalaría" coches y muros de forma gradual).
    if (movedStep < wanted * 0.75 || rose < 0.02 || rose > PLAYER.maxStep + 0.01) {
      p.set(bx, by, bz); // no era un escalón: se mantiene el deslizamiento normal
    }
  }

  /** Retroceso de cámara: sube de golpe y recupera el 55 % por sí sola. */
  addRecoil(pitch: number, yaw: number): void {
    this.pitch = Math.max(-1.53, this.pitch - pitch);
    this.yaw += yaw;
    this.recoilDebt += pitch * 0.55;
  }

  /** Muerte: la cámara cae al suelo y se inclina; revivir la restaura. */
  setDead(dead: boolean): void {
    this.frozen = dead;
    if (!dead) {
      this.deadBlend = 0;
      this.velocity.setAll(0);
    }
  }

  get isDead(): boolean {
    return this.frozen;
  }

  private syncCamera(dt: number, sprinting: number): void {
    this.deadBlend = this.frozen ? Math.min(1, this.deadBlend + dt * 2.2) : 0;
    if (this.grounded && this.speed > 0.5) this.bobTime += dt * (this.speed > 5 ? 11 : 8);
    const bob = this.grounded ? Math.sin(this.bobTime) * 0.025 * Math.min(1, this.speed / 4) : 0;
    const eye = PLAYER.eyeHeight * (1 - this.deadBlend * 0.82);
    this.camera.position.set(this.body.position.x, this.body.position.y + eye + bob, this.body.position.z);
    this.camera.rotation.set(this.pitch + this.swayPitch, this.yaw + this.swayYaw, this.deadBlend * 0.9);
    const targetFov = this.fovTarget ?? this.baseFov + sprinting * 0.06;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * this.fovSpeed);
  }
}
