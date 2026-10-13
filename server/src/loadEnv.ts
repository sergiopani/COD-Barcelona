import fs from "node:fs";
import path from "node:path";

/**
 * Carga variables de un archivo `.env` (clave=valor) de la carpeta de trabajo si existe, sin pisar las que ya estén definidas en el
 * entorno. Pensado para el desarrollo local (p. ej. GOOGLE_CLIENT_ID); en producción se usan las variables del servicio.
 */
const file = path.resolve(process.env.ENV_FILE ?? ".env");
try {
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined && v !== "") process.env[m[1]] = v;
  }
} catch {
  /* sin .env: nada que cargar */
}
