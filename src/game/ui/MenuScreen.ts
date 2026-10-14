import { assetUrl } from "../assets";
import { getAuth, onAuthChange, setupGoogleButton, signOut } from "../multiplayer/auth";

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
  private readonly skyPhoto = document.getElementById("sky-photo") as HTMLInputElement;
  private readonly mpName = document.getElementById("mp-name") as HTMLInputElement;
  private readonly mpBoardList = document.getElementById("mp-board-list") as HTMLElement;
  private readonly mpBoardNote = document.getElementById("mp-board-note") as HTMLElement;
  private readonly mpUrl = document.getElementById("mp-url") as HTMLInputElement;
  private onPlay: () => void = () => {};
  /** Personaje elegido (0..3). */
  skin = 0;

  constructor() {
    const bg = document.getElementById("menu-bg");
    if (bg) bg.style.backgroundImage = `url("${assetUrl("assets/env/menu-panorama.webp")}")`;
    this.button.addEventListener("click", () => this.onPlay());
    document.getElementById("auth-out")?.addEventListener("click", () => signOut());
    this.setupSkins();
    onAuthChange(() => this.refreshAuth());
    try {
      this.mpName.value = localStorage.getItem("barcelonaFps.name") ?? "";
      this.mpUrl.value = localStorage.getItem("barcelonaFps.url") ?? "";
    } catch {
      /* sin persistencia */
    }
  }

  /** Sustituye los iconos de color del selector por las miniaturas 3D de cada personaje. */
  setSkinPreviews(urls: string[]): void {
    document.querySelectorAll<HTMLButtonElement>("#skin-picker button").forEach((b) => {
      const url = urls[Number(b.dataset.skin)];
      if (!url) return;
      const img = b.querySelector("img");
      const icon = b.querySelector("i");
      if (img) {
        img.src = url;
        img.hidden = false;
      }
      if (icon) icon.hidden = true;
    });
  }

  /** Selector de personaje: cuatro botones (se recuerda la elección). */
  private setupSkins(): void {
    try {
      const saved = Number(localStorage.getItem("barcelonaFps.skin"));
      if (Number.isInteger(saved) && saved >= 0 && saved < 4) this.skin = saved;
    } catch {
      /* sin persistencia */
    }
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("#skin-picker button")];
    const mark = (): void => buttons.forEach((b) => b.classList.toggle("sel", Number(b.dataset.skin) === this.skin));
    for (const b of buttons) b.addEventListener("click", () => {
      this.skin = Number(b.dataset.skin);
      mark();
    });
    mark();
  }

  /** Muestra el usuario de Google (o el botón / el nickname de invitado). */
  private refreshAuth(): void {
    const u = getAuth();
    (document.getElementById("auth-google") as HTMLElement).hidden = !!u || !this.googleReady;
    (document.getElementById("auth-user") as HTMLElement).hidden = !u;
    (document.getElementById("guest-box") as HTMLElement).hidden = !!u;
    if (u) {
      (document.getElementById("auth-name") as HTMLElement).textContent = u.name;
      const pic = document.getElementById("auth-pic") as HTMLImageElement;
      pic.src = u.picture;
      pic.hidden = !u.picture;
    }
  }

  private googleReady = false;
  /** Configura el inicio de sesión con Google con el ID de cliente que publica el servidor (null = no configurado). */
  async setupAuth(googleClientId: string | null): Promise<void> {
    const note = document.getElementById("auth-note") as HTMLElement;
    if (googleClientId) {
      this.googleReady = await setupGoogleButton(googleClientId, document.getElementById("auth-google") as HTMLElement);
      note.textContent = this.googleReady ? "" : "No se pudo cargar el inicio de sesión de Google; puedes jugar como invitado.";
    } else {
      note.textContent = "Inicio de sesión con Google no disponible en este servidor: entra como invitado.";
    }
    this.refreshAuth();
  }

  /** Validación del formulario antes de entrar: sesión de Google o nickname de al menos 2 caracteres. */
  canPlay(): boolean {
    const ok = !!getAuth() || this.mpName.value.trim().length >= 2;
    if (!ok) this.setNote("Inicia sesión con Google o escribe un nickname (mínimo 2 caracteres) para jugar.");
    return ok;
  }

  /** Datos del formulario multijugador (y los recuerda en localStorage). */
  get mpSettings(): { name: string; url: string; idToken?: string; skin: number } {
    const v = { name: this.mpName.value.trim(), url: this.mpUrl.value.trim(), idToken: getAuth()?.idToken, skin: this.skin };
    try {
      localStorage.setItem("barcelonaFps.name", v.name);
      localStorage.setItem("barcelonaFps.url", v.url);
      localStorage.setItem("barcelonaFps.skin", String(v.skin));
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
    // en la partida el menú solo sirve de pausa: no hay selector de modo que bloquear
  }

  showError(text: string, reloadLabel = "Volver a empezar"): void {
    this.root.hidden = false;
    this.hud.hidden = true;
    this.status.textContent = text;
    this.button.textContent = reloadLabel;
    this.onPlay = () => location.reload();
  }

  /** Enlaza los controles gráficos con el estado real (cada cambio se aplica al instante). */
  bindGraphics(profile: string, wet: boolean, skyPhoto: boolean, onChange: (profile: string, wet: boolean, skyPhoto: boolean) => void): void {
    this.quality.value = profile;
    this.wet.checked = wet;
    this.skyPhoto.checked = skyPhoto;
    const fire = () => onChange(this.quality.value, this.wet.checked, this.skyPhoto.checked);
    this.quality.addEventListener("change", fire);
    this.wet.addEventListener("change", fire);
    this.skyPhoto.addEventListener("change", fire);
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
    this.root.classList.add("paused"); // en pausa se ve la escena detrás, no el panorama del menú
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
