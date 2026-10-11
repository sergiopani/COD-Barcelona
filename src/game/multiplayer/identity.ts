/**
 * Identidad anónima del jugador: un token aleatorio guardado en este navegador. Sin cuentas, es lo que permite al
 * servidor atribuir las bajas al mismo jugador entre sesiones (el servidor solo guarda un hash). Si se borran los
 * datos del navegador se pierde la identidad y, con ella, la posición en el ranking.
 */
const KEY = "barcelonaFps.token";

function randomToken(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "") + c.randomUUID().replace(/-/g, "").slice(0, 8);
  const bytes = new Uint8Array(20);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

let cached: string | null = null;

export function playerToken(): string {
  if (cached) return cached;
  try {
    const t = localStorage.getItem(KEY);
    if (t && /^[A-Za-z0-9_-]{16,64}$/.test(t)) return (cached = t);
  } catch {
    /* sin almacenamiento: token solo para esta sesión */
  }
  cached = randomToken();
  try {
    localStorage.setItem(KEY, cached);
  } catch {
    /* ignorar */
  }
  return cached;
}
