/** Pantalla inicial y de pausa (DOM). El botón «Jugar» es la interacción explícita que activa Pointer Lock. */
export class MenuScreen {
  private readonly root = document.getElementById("menu") as HTMLElement;
  private readonly button = document.getElementById("play") as HTMLButtonElement;
  private readonly status = document.getElementById("status") as HTMLElement;
  private readonly fill = document.getElementById("bar-fill") as HTMLElement;
  private readonly note = document.getElementById("note") as HTMLElement;
  private readonly hud = document.getElementById("hud") as HTMLElement;
  private readonly fps = document.getElementById("fps") as HTMLElement;
  private readonly quality = document.getElementById("quality") as HTMLSelectElement;
  private readonly wet = document.getElementById("wet") as HTMLInputElement;
  private onPlay: () => void = () => {};

  constructor() {
    this.button.addEventListener("click", () => this.onPlay());
  }

  /** Enlaza los controles gráficos con el estado real (cada cambio se aplica al instante). */
  bindGraphics(profile: string, wet: boolean, onChange: (profile: string, wet: boolean) => void): void {
    this.quality.value = profile;
    this.wet.checked = wet;
    const fire = () => onChange(this.quality.value, this.wet.checked);
    this.quality.addEventListener("change", fire);
    this.wet.addEventListener("change", fire);
  }

  setQualityValue(profile: string): void {
    this.quality.value = profile;
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
