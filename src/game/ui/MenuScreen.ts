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
  private readonly mpFields = document.getElementById("mp-fields") as HTMLElement;
  private readonly mpName = document.getElementById("mp-name") as HTMLInputElement;
  private readonly mpRoom = document.getElementById("mp-room") as HTMLInputElement;
  private readonly mpUrl = document.getElementById("mp-url") as HTMLInputElement;
  private onPlay: () => void = () => {};

  constructor() {
    this.button.addEventListener("click", () => this.onPlay());
    for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
      r.addEventListener("change", () => (this.mpFields.hidden = this.mode !== "mp"));
    }
    try {
      this.mpName.value = localStorage.getItem("barcelonaFps.name") ?? "";
      this.mpRoom.value = localStorage.getItem("barcelonaFps.room") ?? "";
      this.mpUrl.value = localStorage.getItem("barcelonaFps.url") ?? "";
    } catch {
      /* sin persistencia */
    }
  }

  get mode(): "sp" | "mp" {
    return (document.querySelector('input[name="mode"]:checked') as HTMLInputElement | null)?.value === "mp" ? "mp" : "sp";
  }

  /** Datos del formulario multijugador (y los recuerda en localStorage). */
  get mpSettings(): { name: string; room: string; url: string } {
    const v = { name: this.mpName.value.trim(), room: this.mpRoom.value.trim(), url: this.mpUrl.value.trim() };
    try {
      localStorage.setItem("barcelonaFps.name", v.name);
      localStorage.setItem("barcelonaFps.room", v.room);
      localStorage.setItem("barcelonaFps.url", v.url);
    } catch {
      /* ignorar */
    }
    return v;
  }

  setPlayLabel(label: string): void {
    this.button.textContent = label;
  }

  setUrlPlaceholder(url: string): void {
    this.mpUrl.placeholder = `Servidor (por defecto ${url})`;
  }

  /** Bloquea el selector de modo (en partida) y muestra un error persistente. */
  lockMode(): void {
    for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) r.disabled = true;
  }

  showError(text: string, reloadLabel = "Volver a empezar"): void {
    this.root.hidden = false;
    this.hud.hidden = true;
    this.status.textContent = text;
    this.button.textContent = reloadLabel;
    this.onPlay = () => location.reload();
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
