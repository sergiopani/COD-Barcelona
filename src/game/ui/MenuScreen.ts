/** Pantalla inicial y de pausa (DOM). El botón «Jugar» es la interacción explícita que activa Pointer Lock. */
export class MenuScreen {
  private readonly root = document.getElementById("menu") as HTMLElement;
  private readonly button = document.getElementById("play") as HTMLButtonElement;
  private readonly status = document.getElementById("status") as HTMLElement;
  private readonly fill = document.getElementById("bar-fill") as HTMLElement;
  private readonly note = document.getElementById("note") as HTMLElement;
  private readonly hud = document.getElementById("hud") as HTMLElement;
  private readonly fps = document.getElementById("fps") as HTMLElement;
  private onPlay: () => void = () => {};

  constructor() {
    this.button.addEventListener("click", () => this.onPlay());
  }

  setProgress(label: string, fraction: number): void {
    this.status.textContent = label;
    this.fill.style.width = `${Math.round(fraction * 100)}%`;
  }

  setNote(text: string): void {
    this.note.textContent = text;
  }

  ready(onPlay: () => void): void {
    this.onPlay = onPlay;
    this.button.disabled = false;
    this.button.textContent = "Jugar";
    this.setProgress("Listo", 1);
  }

  showPause(): void {
    this.button.textContent = "Continuar";
    this.status.textContent = "Pausa";
    this.root.hidden = false;
    this.hud.hidden = true;
  }

  hide(): void {
    this.root.hidden = true;
    this.hud.hidden = false;
  }

  setFps(text: string): void {
    this.fps.textContent = text;
  }
}
