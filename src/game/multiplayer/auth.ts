/**
 * Inicio de sesión con Google (Google Identity Services). El navegador obtiene un ID token firmado por Google; el servidor lo
 * VERIFICA (firma, aplicación y caducidad) antes de aceptar al jugador como usuario guardado. Aquí solo se gestiona el botón y se
 * conserva el token (sessionStorage: dura la pestaña y, como mucho, la hora de validez del token).
 * El ID de cliente de Google lo publica el servidor en /api/config (variable GOOGLE_CLIENT_ID).
 */
export interface AuthUser {
  idToken: string;
  name: string;
  picture: string;
  /** Caducidad del token (ms desde 1970). */
  exp: number;
}

const KEY = "barcelonaFps.google";
const GSI = "https://accounts.google.com/gsi/client";

interface GoogleId {
  initialize(cfg: { client_id: string; callback: (r: { credential: string }) => void; auto_select?: boolean; cancel_on_tap_outside?: boolean }): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

let current: AuthUser | null = null;
const listeners: (() => void)[] = [];

/** Lee los datos públicos del JWT (solo para mostrar el nombre y la foto; la verificación real la hace el servidor). */
function decode(idToken: string): AuthUser | null {
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))))) as { name?: string; given_name?: string; picture?: string; exp?: number };
    if (!p.exp) return null;
    return { idToken, name: p.name || p.given_name || "Jugador", picture: p.picture ?? "", exp: p.exp * 1000 };
  } catch {
    return null;
  }
}

function emit(): void {
  listeners.forEach((l) => l());
}

export function onAuthChange(l: () => void): void {
  listeners.push(l);
}

/** Usuario con sesión válida (token no caducado) o null. */
export function getAuth(): AuthUser | null {
  if (current && current.exp > Date.now() + 30_000) return current;
  if (!current) {
    try {
      const raw = sessionStorage.getItem(KEY);
      const u = raw ? decode(raw) : null;
      if (u && u.exp > Date.now() + 30_000) current = u;
    } catch {
      /* sin almacenamiento */
    }
    if (current) return current;
  }
  current = null;
  return null;
}

export function signOut(): void {
  current = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignorar */
  }
  window.google?.accounts.id.disableAutoSelect();
  emit();
}

function loadScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GSI;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("No se pudo cargar Google Identity Services"));
    document.head.appendChild(s);
  });
}

/** Prepara el botón de Google dentro de `container`. Devuelve false si no se pudo cargar. */
export async function setupGoogleButton(clientId: string, container: HTMLElement): Promise<boolean> {
  try {
    await loadScript();
    window.google!.accounts.id.initialize({
      client_id: clientId,
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: (r) => {
        const u = decode(r.credential);
        if (!u) return;
        current = u;
        try {
          sessionStorage.setItem(KEY, r.credential);
        } catch {
          /* ignorar */
        }
        emit();
      },
    });
    window.google!.accounts.id.renderButton(container, { type: "standard", theme: "filled_blue", size: "large", text: "signin_with", shape: "pill", locale: "es", width: 260 });
    return true;
  } catch (e) {
    console.warn("[Google] No disponible:", e);
    return false;
  }
}
