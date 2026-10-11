import { Engine, FreeCamera, Scene, SceneInstrumentation, Vector3 } from "@babylonjs/core";
import { PLAYER } from "./config";
import { InputManager } from "./player/InputManager";
import { PlayerController } from "./player/PlayerController";
import { MenuScreen } from "./ui/MenuScreen";
import { BarcelonaMap } from "./world/BarcelonaMap";
import { setupLighting, type LightingRig } from "./world/Lighting";
import { runCollisionSelfTest } from "./debug/selfTest";

/**
 * Motor, escena, bucle principal y estados (cargando → menú → jugando → pausa).
 */
export class Game {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly menu = new MenuScreen();
  private readonly input: InputManager;
  private player!: PlayerController;
  private map!: BarcelonaMap;
  private lighting!: LightingRig;
  private started = false;
  private fpsTimer = 0;
  private slowTime = 0;
  private readonly instrumentation: SceneInstrumentation;

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, powerPreference: "high-performance" }, true);
    // En pantallas retina limitamos la resolución interna para mantener los FPS.
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new Scene(this.engine);
    this.input = new InputManager(canvas);
    this.instrumentation = new SceneInstrumentation(this.scene);
    this.instrumentation.captureFrameTime = true;
    window.addEventListener("resize", () => this.engine.resize());
  }

  async init(): Promise<void> {
    const camera = new FreeCamera("fpsCamera", new Vector3(0, 2, 0), this.scene);
    this.lighting = setupLighting(this.scene, camera);
    this.player = new PlayerController(this.scene, camera, this.input);

    this.map = new BarcelonaMap(this.scene, this.lighting);
    const steps = 6;
    let n = 0;
    await this.map.build((label) => this.menu.setProgress(label, ++n / (steps + 1)));

    const s = this.map.spawnPosition(0);
    this.player.teleport(s.position.x, s.position.y, s.position.z, s.yaw);

    // Estado de Pointer Lock ↔ menú
    this.input.onLockChange = (locked) => {
      if (locked) this.menu.hide();
      else if (this.started) this.menu.showPause();
    };
    this.input.onLockError = () => this.menu.setNote("El navegador rechazó el bloqueo del ratón. Vuelve a pulsar el botón.");

    this.scene.executeWhenReady(() => {
      this.menu.ready(() => {
        this.started = true;
        this.menu.setNote("");
        void this.input.requestLock();
      });
      if (this.map.sagrada.usedPlaceholder) {
        this.menu.setNote("Modelo sagrada-familia.glb no encontrado: se usa una basílica provisional.");
      }
    });

    this.engine.runRenderLoop(() => this.frame());
    this.exposeDebug();
  }

  private frame(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.05);
    this.player.update(dt);
    // caída fuera del mundo → reaparición
    if (this.player.position.y < PLAYER.killPlaneY) {
      const s = this.map.spawnPosition(0);
      this.player.teleport(s.position.x, s.position.y, s.position.z, s.yaw);
    }
    this.scene.render();
    this.input.endFrame();

    this.fpsTimer += dt;
    if (this.fpsTimer >= 0.5) {
      this.fpsTimer = 0;
      const fps = this.engine.getFps();
      this.menu.setFps(`FPS ${fps.toFixed(0)} · ${this.instrumentation.frameTimeCounter.average.toFixed(1)} ms · ${this.instrumentation.drawCallsCounter.current} draws`);
      this.autoQuality(fps, 0.5);
    }
  }

  /** Si el rendimiento es bajo de forma sostenida, desactiva sombras y después reduce la resolución. */
  private autoQuality(fps: number, dt: number): void {
    if (!this.input.locked) return;
    this.slowTime = fps < 30 ? this.slowTime + dt : 0;
    if (this.slowTime > 4) {
      this.slowTime = 0;
      if (this.lighting.shadowsEnabled) {
        this.lighting.setShadowsEnabled(false);
        console.warn("[Calidad] FPS bajos: sombras desactivadas.");
      } else if (this.engine.getHardwareScalingLevel() < 2) {
        this.engine.setHardwareScalingLevel(this.engine.getHardwareScalingLevel() + 0.25);
        console.warn("[Calidad] FPS bajos: reduciendo resolución interna.");
      }
    }
  }

  private exposeDebug(): void {
    const g = {
      scene: this.scene,
      engine: this.engine,
      player: this.player,
      input: this.input,
      map: this.map,
      lighting: this.lighting,
      stats: () => ({ ...this.map.stats, fps: this.engine.getFps(), drawCalls: this.instrumentation.drawCallsCounter.current, frameMs: this.instrumentation.frameTimeCounter.average }),
      tp: (x: number, z: number, yawDeg = 0, y = 0.05) => this.player.teleport(x, y, z, (yawDeg * Math.PI) / 180),
      selfTest: () => runCollisionSelfTest(this.scene, this.player, this.map),
      /** Entra en juego sin Pointer Lock (útil para capturas y pruebas automáticas). */
      hideMenu: () => this.menu.hide(),
    };
    (window as unknown as { __game: typeof g }).__game = g;
  }
}
