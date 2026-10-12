import fs from "node:fs";
import path from "node:path";
import type { GoogleProfile } from "./GoogleAuth";

/**
 * Usuarios guardados + ranking GLOBAL de bajas, persistentes en un archivo JSON (escritura atómica).
 * Solo se guardan los usuarios que inician sesión con Google (id = identificador de cuenta `sub`): nombre, correo y foto de perfil
 * de Google, fechas y sus estadísticas. Los invitados (solo nickname) no se guardan ni puntúan.
 * El ranking lista a los usuarios guardados con al menos una baja; el correo y la foto NUNCA salen del servidor.
 */
export interface LeaderboardEntry {
  /** `sub` de Google. */
  id: string;
  name: string;
  email: string;
  picture: string;
  kills: number;
  deaths: number;
  headshots: number;
  /** Primer inicio de sesión / último movimiento (ms desde 1970). */
  first: number;
  last: number;
  logins: number;
}

export interface BoardRow {
  rank: number;
  name: string;
  kills: number;
  deaths: number;
  headshots: number;
}

const MAX_ENTRIES = 10000;
const FILE_VERSION = 2;

export class Leaderboard {
  private readonly entries = new Map<string, LeaderboardEntry>();
  private sorted: LeaderboardEntry[] | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  /** Se incrementa en cada cambio (para difundir el ranking solo cuando cambia). */
  version = 0;

  /** `file` null = solo en memoria (pruebas). */
  constructor(private readonly file: string | null) {
    if (file) this.load();
  }

  private load(): void {
    const f = this.file!;
    try {
      if (!fs.existsSync(f)) return;
      const data = JSON.parse(fs.readFileSync(f, "utf8")) as { version?: number; entries?: LeaderboardEntry[] };
      if (data.version !== FILE_VERSION) throw new Error(`versión de archivo ${data.version} (se esperaba ${FILE_VERSION}): ranking anónimo antiguo`);
      for (const e of data.entries ?? []) {
        if (e && typeof e.id === "string" && Number.isFinite(e.kills)) this.entries.set(e.id, e);
      }
    } catch (err) {
      // archivo corrupto: se guarda una copia y se empieza de cero (no se pierde el original)
      try {
        fs.copyFileSync(f, `${f}.corrupt-${Date.now()}`);
      } catch {
        /* nada que copiar */
      }
      console.error("[Ranking] Archivo corrupto, se ha guardado una copia y se reinicia:", err);
    }
  }

  /** Usuarios con al menos una baja (los que aparecen en el ranking). */
  get size(): number {
    return this.order().length;
  }

  /** Usuarios guardados (con sesión de Google), tengan bajas o no. */
  get users(): number {
    return this.entries.size;
  }

  private touchChange(): void {
    this.sorted = null;
    this.version++;
    this.scheduleSave();
  }

  /** Alta o actualización del usuario al iniciar sesión (nombre, correo, foto). Devuelve su ficha. */
  upsertUser(p: GoogleProfile): LeaderboardEntry {
    const now = Date.now();
    let e = this.entries.get(p.sub);
    if (!e) {
      if (this.entries.size >= MAX_ENTRIES) this.prune();
      e = { id: p.sub, name: p.name, email: p.email, picture: p.picture, kills: 0, deaths: 0, headshots: 0, first: now, last: now, logins: 0 };
      this.entries.set(p.sub, e);
    }
    const nameChanged = e.name !== p.name;
    e.name = p.name;
    e.email = p.email;
    e.picture = p.picture;
    e.last = now;
    e.logins++;
    this.sorted = null;
    if (nameChanged && e.kills > 0) this.version++; // el nombre aparece en el ranking
    this.scheduleSave();
    return e;
  }

  /** Suma una baja a un usuario guardado (los invitados no puntúan). */
  recordKill(id: string | null, headshot: boolean): void {
    const e = id ? this.entries.get(id) : undefined;
    if (!e) return;
    e.kills++;
    if (headshot) e.headshots++;
    e.last = Date.now();
    this.touchChange();
  }

  /** Las muertes se acumulan solo para usuarios guardados. */
  recordDeath(id: string | null): void {
    const e = id ? this.entries.get(id) : undefined;
    if (!e) return;
    e.deaths++;
    this.touchChange();
  }

  private order(): LeaderboardEntry[] {
    if (!this.sorted) this.sorted = [...this.entries.values()].filter((e) => e.kills > 0).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.first - b.first);
    return this.sorted;
  }

  top(n: number): BoardRow[] {
    return this.order()
      .slice(0, n)
      .map((e, i) => ({ rank: i + 1, name: e.name, kills: e.kills, deaths: e.deaths, headshots: e.headshots }));
  }

  /** Cifras de un usuario guardado (null si es invitado). `rank` es 0 mientras no tenga bajas. */
  entry(id: string | null): (BoardRow & { total: number }) | null {
    const e = id ? this.entries.get(id) : undefined;
    if (!e) return null;
    const list = this.order();
    const i = e.kills > 0 ? list.findIndex((x) => x.id === e.id) : -1;
    return { rank: i + 1, name: e.name, kills: e.kills, deaths: e.deaths, headshots: e.headshots, total: list.length };
  }

  private prune(): void {
    // se descartan los usuarios con menos bajas (y, a igualdad, los más antiguos sin actividad)
    const all = [...this.entries.values()].sort((a, b) => b.kills - a.kills || b.last - a.last);
    for (const e of all.slice(MAX_ENTRIES - 100)) this.entries.delete(e.id);
    this.sorted = null;
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 2000);
  }

  /** Guarda ya (escritura atómica: archivo temporal + rename). */
  flush(): void {
    if (!this.file) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: FILE_VERSION, entries: [...this.entries.values()] }));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error("[Ranking] No se pudo guardar:", err);
    }
  }
}
