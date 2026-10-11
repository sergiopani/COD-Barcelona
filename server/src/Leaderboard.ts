import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Ranking GLOBAL de bajas, persistente en un archivo JSON (escritura atómica). Cada jugador se identifica con un token
 * anónimo generado por su navegador; el servidor solo guarda un hash del token (nunca se envía a otros jugadores).
 * Una entrada se crea con la primera baja; las muertes y cabezas se acumulan desde entonces.
 */
export interface LeaderboardEntry {
  id: string;
  name: string;
  kills: number;
  deaths: number;
  headshots: number;
  first: number;
  last: number;
}

export interface BoardRow {
  rank: number;
  name: string;
  kills: number;
  deaths: number;
  headshots: number;
}

const MAX_ENTRIES = 10000;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

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

  /** Hash estable del token (null si el token no es válido → ese jugador no se persiste). */
  static idFromToken(token: unknown): string | null {
    if (typeof token !== "string" || !TOKEN_RE.test(token)) return null;
    return crypto.createHash("sha256").update(token).digest("hex").slice(0, 24);
  }

  private load(): void {
    const f = this.file!;
    try {
      if (!fs.existsSync(f)) return;
      const data = JSON.parse(fs.readFileSync(f, "utf8")) as { entries?: LeaderboardEntry[] };
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

  get size(): number {
    return this.entries.size;
  }

  private touchChange(): void {
    this.sorted = null;
    this.version++;
    this.scheduleSave();
  }

  recordKill(id: string | null, name: string, headshot: boolean): void {
    if (!id) return;
    const now = Date.now();
    let e = this.entries.get(id);
    if (!e) {
      e = { id, name, kills: 0, deaths: 0, headshots: 0, first: now, last: now };
      this.entries.set(id, e);
    }
    e.name = name;
    e.kills++;
    if (headshot) e.headshots++;
    e.last = now;
    if (this.entries.size > MAX_ENTRIES) this.prune();
    this.touchChange();
  }

  /** Las muertes solo cuentan para quien ya figura en el ranking. */
  recordDeath(id: string | null): void {
    const e = id ? this.entries.get(id) : undefined;
    if (!e) return;
    e.deaths++;
    this.touchChange();
  }

  private order(): LeaderboardEntry[] {
    if (!this.sorted) this.sorted = [...this.entries.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.first - b.first);
    return this.sorted;
  }

  top(n: number): BoardRow[] {
    return this.order()
      .slice(0, n)
      .map((e, i) => ({ rank: i + 1, name: e.name, kills: e.kills, deaths: e.deaths, headshots: e.headshots }));
  }

  /** Posición y cifras de un jugador (null si aún no tiene bajas). */
  entry(id: string | null): (BoardRow & { total: number }) | null {
    if (!id || !this.entries.has(id)) return null;
    const list = this.order();
    const i = list.findIndex((e) => e.id === id);
    const e = list[i];
    return { rank: i + 1, name: e.name, kills: e.kills, deaths: e.deaths, headshots: e.headshots, total: list.length };
  }

  private prune(): void {
    for (const e of this.order().slice(MAX_ENTRIES)) this.entries.delete(e.id);
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
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, entries: this.order() }));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error("[Ranking] No se pudo guardar:", err);
    }
  }
}
