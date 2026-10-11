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
  private readonly mpBoard = document.getElementById("mp-board") as HTMLElement;
  private readonly mpBoardList = document.getElementById("mp-board-list") as HTMLElement;
  private readonly mpBoardNote = document.getElementById("mp-board-note") as HTMLElement;
  /** Se invoca al cambiar de modo (para cargar el ranking global al elegir multijugador). */
  onModeChange: (mode: "sp" | "mp") => void = () => {};
  private readonly mpUrl = document.getElementById("mp-url") as HTMLInputElement;
  private onPlay: () => void = () => {};

  constructor() {
    this.button.addEventListener("click", () => this.onPlay());
    for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
      r.addEventListener("change", () => {
        this.mpFields.hidden = this.mode !== "mp";
        this.mpBoard.hidden = this.mode !== "mp";
        this.onModeChange(this.mode);
      });
    }
    try {
      this.mpName.value = localStorage.getItem("barcelonaFps.name") ?? "";
      this.mpUrl.value = localStorage.getItem("barcelonaFps.url") ?? "";
    } catch {
      /* sin persistencia */
    }
  }

  get mode(): "sp" | "mp" {
    return (document.querySelector('input[name="mode"]:checked') as HTMLInputElement | null)?.value === "mp" ? "mp" : "sp";
  }

  /** Datos del formulario multijugador (y los recuerda en localStorage). */
  get mpSettings(): { name: string; url: string } {
    const v = { name: this.mpName.value.trim(), url: this.mpUrl.value.trim() };
    try {
      localStorage.setItem("barcelonaFps.name", v.name);
      localStorage.setItem("barcelonaFps.url", v.url);
    } catch {
      /* ignorar */
    }
    return v;
  }

  /** Pinta el top del ranking global en el menú (null = no disponible). */
  showGlobalBoard(top: { rank: number; name: string; kills: number; headshots: number }[] | null, total = 0): void {
    this.mpBoardList.replaceChildren();
    if (top === null) {
      this.mpBoardNote.textContent = "Ranking no disponible (¿servidor apagado?)";
      return;
    }
    this.mpBoardNote.textContent = top.length ? `${total} jugador${total === 1 ? "" : "es"} en el ranking` : "Aún no hay bajas registradas: ¡sé el primero!";
    for (const r of top) {
      const li = document.createElement("li");
      const n = document.createElement("span");
      n.textContent = r.name;
      const k = document.createElement("b");
      k.textContent = `${r.kills}`;
      li.append(n, k);
      this.mpBoardList.appendChild(li);
    }
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
