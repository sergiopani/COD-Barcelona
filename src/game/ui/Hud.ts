/** Interfaz de combate (DOM): munición, salud, mira telescópica, marcadores de impacto, daño recibido y muerte. */
export interface HudState {
  health: number;
  ammo: number;
  reserve: number;
  magazine: number;
  weaponName: string;
  reloading: boolean;
  scoped: boolean;
  ads: number;
  zoom: number;
  breath: number;
  kills: number;
  deaths: number;
  headshots: number;
  accuracy: number | null;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Hud {
  private readonly crosshair = $("crosshair");
  private readonly scope = $("scope");
  private readonly scopeZoom = $("scope-zoom");
  private readonly breath = $("scope-breath").firstElementChild as HTMLElement;
  private readonly ammoBox = $("ammo");
  private readonly ammoMag = $("ammo-mag");
  private readonly ammoRes = $("ammo-res");
  private readonly weaponName = $("weapon-name");
  private readonly health = $("health");
  private readonly healthBar = $("health-bar").firstElementChild as HTMLElement;
  private readonly healthNum = $("health-num");
  private readonly reloadTip = $("reload-tip");
  private readonly hitmarker = $("hitmarker");
  private readonly vignette = $("dmg-vignette");
  private readonly arrow = $("dmg-arrow");
  private readonly death = $("death");
  private readonly deathT = $("death-t");
  private readonly feedBox = $("killfeed");
  private readonly stKills = $("st-kills");
  private readonly stDeaths = $("st-deaths");
  private readonly stAcc = $("st-acc");
  private readonly stHs = $("st-hs");
  private lastShownScope = false;

  update(s: HudState): void {
    this.ammoMag.textContent = String(s.ammo);
    this.ammoRes.textContent = String(s.reserve);
    this.ammoBox.classList.toggle("low", s.ammo <= 1);
    this.weaponName.textContent = s.weaponName;
    this.healthNum.textContent = String(Math.max(0, Math.ceil(s.health)));
    this.healthBar.style.transform = `scaleX(${Math.max(0, s.health) / 100})`;
    this.health.classList.toggle("low", s.health <= 35);
    this.reloadTip.hidden = !s.reloading;
    if (s.scoped !== this.lastShownScope) {
      this.lastShownScope = s.scoped;
      this.scope.hidden = !s.scoped;
    }
    this.crosshair.style.display = s.ads > 0.05 ? "none" : "";
    if (s.scoped) {
      this.scopeZoom.textContent = `${s.zoom}×`;
      this.breath.style.transform = `scaleX(${s.breath})`;
    }
    this.stKills.textContent = String(s.kills);
    this.stDeaths.textContent = String(s.deaths);
    this.stHs.textContent = String(s.headshots);
    this.stAcc.textContent = s.accuracy === null ? "--" : `${Math.round(s.accuracy * 100)}%`;
  }

  hitMarker(kind: "body" | "head" | "kill"): void {
    this.hitmarker.classList.remove("show", "head", "kill");
    void this.hitmarker.offsetWidth; // reinicia la transición
    this.hitmarker.classList.add("show");
    if (kind !== "body") this.hitmarker.classList.add(kind);
    window.setTimeout(() => this.hitmarker.classList.remove("show"), 90);
  }

  /** `angle` = ángulo del atacante respecto a la dirección de la mirada (0 = delante, π/2 = derecha). */
  damageFrom(angle: number): void {
    this.vignette.classList.add("show");
    this.arrow.style.transform = `rotate(${(angle * 180) / Math.PI}deg)`;
    this.arrow.classList.add("show");
    window.setTimeout(() => {
      this.vignette.classList.remove("show");
      this.arrow.classList.remove("show");
    }, 120);
  }

  feed(text: string, bad = false): void {
    const d = document.createElement("div");
    d.textContent = text;
    if (bad) d.className = "bad";
    this.feedBox.prepend(d);
    while (this.feedBox.children.length > 5) this.feedBox.lastElementChild?.remove();
    window.setTimeout(() => d.remove(), 4600);
  }

  showDeath(seconds: number): void {
    this.death.hidden = false;
    this.deathT.textContent = String(Math.ceil(seconds));
  }

  hideDeath(): void {
    this.death.hidden = true;
  }
}
