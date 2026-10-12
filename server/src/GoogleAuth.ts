import crypto from "node:crypto";

/**
 * Verificación en el servidor del ID token de «Iniciar sesión con Google» (Google Identity Services).
 * No se confía en nada que diga el cliente: se comprueba la firma RS256 con las claves públicas de Google (JWKS, en caché),
 * el emisor, que el token sea para ESTA aplicación (`aud` = GOOGLE_CLIENT_ID) y que no haya caducado.
 * Sin dependencias externas (node:crypto + fetch).
 */
export interface GoogleProfile {
  /** Identificador estable y único de la cuenta de Google (no cambia aunque cambie el correo). */
  sub: string;
  name: string;
  email: string;
  picture: string;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const DEFAULT_CERTS = "https://www.googleapis.com/oauth2/v3/certs";

export class GoogleAuth {
  private keys = new Map<string, crypto.KeyObject>();
  private fetchedAt = 0;
  private lastMissRefresh = 0;

  constructor(
    readonly clientId: string,
    private readonly certsUrl: string = process.env.GOOGLE_CERTS_URL || DEFAULT_CERTS,
  ) {}

  private async refreshKeys(): Promise<void> {
    const res = await fetch(this.certsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`certificados de Google: HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const next = new Map<string, crypto.KeyObject>();
    for (const k of body.keys ?? []) {
      if (k.kty !== "RSA" || !k.kid) continue;
      next.set(k.kid, crypto.createPublicKey({ key: k as unknown as crypto.JsonWebKey, format: "jwk" }));
    }
    if (next.size === 0) throw new Error("certificados de Google vacíos");
    this.keys = next;
    this.fetchedAt = Date.now();
  }

  private async keyFor(kid: string): Promise<crypto.KeyObject | null> {
    const fresh = Date.now() - this.fetchedAt < 3600_000;
    if (!fresh || this.keys.size === 0) await this.refreshKeys();
    let key = this.keys.get(kid) ?? null;
    // clave desconocida: Google rota las claves; se reintenta como mucho una vez por minuto
    if (!key && Date.now() - this.lastMissRefresh > 60_000) {
      this.lastMissRefresh = Date.now();
      await this.refreshKeys();
      key = this.keys.get(kid) ?? null;
    }
    return key;
  }

  /** Devuelve el perfil si el token es válido; lanza un Error con el motivo si no. */
  async verify(idToken: unknown): Promise<GoogleProfile> {
    if (typeof idToken !== "string" || idToken.length > 4096) throw new Error("token ausente o demasiado largo");
    const parts = idToken.split(".");
    if (parts.length !== 3) throw new Error("formato de token no válido");
    const b64 = (s: string): Buffer => Buffer.from(s, "base64url");
    let header: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(b64(parts[0]).toString("utf8"));
      claims = JSON.parse(b64(parts[1]).toString("utf8"));
    } catch {
      throw new Error("token ilegible");
    }
    if (header.alg !== "RS256" || !header.kid) throw new Error("algoritmo no admitido");
    const key = await this.keyFor(header.kid);
    if (!key) throw new Error("clave de firma desconocida");
    const ok = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, b64(parts[2]));
    if (!ok) throw new Error("firma no válida");

    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) throw new Error("emisor no válido");
    const aud = claims.aud;
    if (aud !== this.clientId && !(Array.isArray(aud) && aud.includes(this.clientId))) throw new Error("el token es de otra aplicación");
    if (typeof claims.exp !== "number" || claims.exp < now - 30) throw new Error("token caducado");
    if (typeof claims.iat === "number" && claims.iat > now + 300) throw new Error("token emitido en el futuro");
    if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 64) throw new Error("sin identificador de cuenta");

    const email = typeof claims.email === "string" ? claims.email.slice(0, 254) : "";
    const name = typeof claims.name === "string" && claims.name.trim() ? claims.name : typeof claims.given_name === "string" && claims.given_name ? claims.given_name : email.split("@")[0] || "Jugador";
    const picture = typeof claims.picture === "string" && /^https:\/\//.test(claims.picture) ? claims.picture.slice(0, 500) : "";
    return { sub: claims.sub, name, email, picture };
  }
}
