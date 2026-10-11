/**
 * Entrada de teclado y ratón con Pointer Lock.
 * El cursor SOLO se bloquea tras una interacción explícita (clic en «Jugar» / «Continuar»).
 */
export class InputManager {
  private readonly keys = new Set<string>();
  private readonly pressedThisFrame = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private buttons = 0;
  private lockedState = false;

  onLockChange: (locked: boolean) => void = () => {};
  onLockError: () => void = () => {};

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedThisFrame.add(e.code);
      if (this.lockedState && ["Space", "ArrowUp", "ArrowDown", "Tab"].includes(e.code)) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.buttons = 0;
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.lockedState) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener("mousedown", (e) => {
      if (this.lockedState) this.buttons |= 1 << e.button;
    });
    document.addEventListener("mouseup", (e) => {
      this.buttons &= ~(1 << e.button);
    });
    document.addEventListener("pointerlockchange", () => {
      this.lockedState = document.pointerLockElement === this.canvas;
      if (!this.lockedState) {
        this.keys.clear();
        this.buttons = 0;
      }
      this.onLockChange(this.lockedState);
    });
    document.addEventListener("pointerlockerror", () => this.onLockError());
  }

  get locked(): boolean {
    return this.lockedState;
  }

  /** Debe llamarse desde un manejador de clic del usuario. */
  async requestLock(): Promise<void> {
    try {
      // `unadjustedMovement` evita la aceleración del sistema operativo (Chrome/Edge)
      await (this.canvas.requestPointerLock as unknown as (o?: object) => Promise<void> | void)({ unadjustedMovement: true });
    } catch {
      try {
        await (this.canvas.requestPointerLock as unknown as () => Promise<void> | void)();
      } catch {
        this.onLockError();
      }
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** True solo en el fotograma siguiente a pulsar la tecla. */
  wasPressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  isMouseDown(button: number): boolean {
    return (this.buttons & (1 << button)) !== 0;
  }

  /** Devuelve y reinicia el movimiento acumulado del ratón. */
  consumeMouse(): { dx: number; dy: number } {
    const r = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
  }
}
