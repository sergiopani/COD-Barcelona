import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { MAX_PLAYERS, PROTOCOL_VERSION, type ClientMsg } from "../../shared/protocol";
import { WorldCollision, type WorldData } from "../../shared/world";
import { Room, ServerPlayer } from "./Room";

/**
 * Servidor de Barcelona FPS: HTTP (salud + estáticos opcionales de `dist/`) y WebSocket (juego).
 * Variables de entorno: PORT (8080), HOST (0.0.0.0), ALLOWED_ORIGINS (lista separada por comas; vacío = cualquiera),
 * STATIC_DIR (carpeta de build para servir el cliente; opcional).
 */
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const HERE = import.meta.dirname ?? ".";
// por defecto sirve ./dist si existe (STATIC_DIR=none lo desactiva)
const DEFAULT_STATIC = path.resolve(HERE, "../dist/index.html");
const STATIC_DIR =
  process.env.STATIC_DIR === "none"
    ? null
    : process.env.STATIC_DIR
      ? path.resolve(process.env.STATIC_DIR)
      : fs.existsSync(path.resolve("dist/index.html"))
        ? path.resolve("dist")
        : fs.existsSync(DEFAULT_STATIC)
          ? path.dirname(DEFAULT_STATIC)
          : null;

// los datos de colisión están en server/data (desarrollo) o dist-server/data (build empaquetado)
const worldFile = [path.resolve(HERE, "../data/world-colliders.json"), path.resolve(HERE, "data/world-colliders.json")].find((f) => fs.existsSync(f)) ?? "";
if (!worldFile) throw new Error("No se encuentra world-colliders.json");
const world = new WorldCollision(JSON.parse(fs.readFileSync(worldFile, "utf8")) as WorldData);
log(`Mundo cargado: ${world.boxes.length} cajas de colisión`);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
};

const rooms = new Map<string, Room>();
let autoRoomCounter = 0;

function log(msg: string): void {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function findRoom(code?: string): Room {
  if (code) {
    const clean = code.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 12) || "SALA";
    let r = rooms.get(clean);
    if (!r) {
      r = new Room(clean, world, true);
      rooms.set(clean, r);
      log(`Sala privada creada: ${clean}`);
    }
    return r;
  }
  for (const r of rooms.values()) if (!r.isPrivate && !r.full) return r;
  const id = `P${++autoRoomCounter}`;
  const r = new Room(id, world, false);
  rooms.set(id, r);
  log(`Sala pública creada: ${id}`);
  return r;
}

const server = http.createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0];
  if (url === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.players.size, 0), protocol: PROTOCOL_VERSION }));
    return;
  }
  if (!STATIC_DIR) {
    res.statusCode = 404;
    res.end("Barcelona FPS server (WebSocket). Usa /health para el estado.");
    return;
  }
  serveStatic(req, res, url);
});

/** Servidor de estáticos de producción: precomprimidos (.br/.gz), caché por tipo y 304 con ETag. */
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: string): void {
  let rel: string;
  try {
    rel = decodeURIComponent(url);
  } catch {
    res.statusCode = 400;
    res.end();
    return;
  }
  let file = path.normalize(path.join(STATIC_DIR!, rel === "/" ? "index.html" : rel));
  if (!file.startsWith(STATIC_DIR!)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  const isFile = (f: string): boolean => fs.existsSync(f) && fs.statSync(f).isFile();
  if (!isFile(file)) {
    // los recursos con extensión que no existen → 404 real (el cliente detecta GLB ausentes); el resto → index.html
    if (path.extname(rel)) {
      res.statusCode = 404;
      res.end("No encontrado");
      return;
    }
    file = path.join(STATIC_DIR!, "index.html");
  }
  const ext = path.extname(file);
  const headers: Record<string, string> = {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Accept-Encoding",
  };
  const name = path.basename(file);
  if (ext === ".html") headers["Cache-Control"] = "no-cache";
  else if (/-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(name)) headers["Cache-Control"] = "public, max-age=31536000, immutable"; // archivos con hash de Vite
  else headers["Cache-Control"] = "public, max-age=86400"; // GLB, textos de config…
  // precomprimido si el navegador lo acepta
  let send = file;
  const accept = String(req.headers["accept-encoding"] ?? "");
  if (accept.includes("br") && isFile(file + ".br")) {
    send = file + ".br";
    headers["Content-Encoding"] = "br";
  } else if (accept.includes("gzip") && isFile(file + ".gz")) {
    send = file + ".gz";
    headers["Content-Encoding"] = "gzip";
  }
  const st = fs.statSync(send);
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  headers.ETag = etag;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  headers["Content-Length"] = String(st.size);
  res.writeHead(200, headers);
  if (req.method === "HEAD") res.end();
  else fs.createReadStream(send).pipe(res);
}

const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on("connection", (ws: WebSocket, req) => {
  const origin = req.headers.origin;
  if (ALLOWED.length > 0 && (!origin || !ALLOWED.includes(origin))) {
    ws.close(1008, "origen no permitido");
    return;
  }
  let room: Room | null = null;
  let player: ServerPlayer | null = null;
  let alive = true;
  ws.on("pong", () => (alive = true));
  const hb = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 15000);

  ws.on("message", (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data.toString()) as ClientMsg;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
    if (msg.t === "join") {
      if (player) return; // ya unido
      if (msg.v !== PROTOCOL_VERSION) {
        ws.send(JSON.stringify({ t: "error", msg: "Versión de protocolo incompatible" }));
        ws.close();
        return;
      }
      room = findRoom(typeof msg.room === "string" ? msg.room : undefined);
      if (room.full) {
        ws.send(JSON.stringify({ t: "error", msg: `Sala llena (${MAX_PLAYERS}/${MAX_PLAYERS})` }));
        ws.close();
        return;
      }
      player = room.join(ws, msg.name);
      log(`${player.name} (#${player.id}) entra en ${room.code} (${room.players.size}/${MAX_PLAYERS})`);
      return;
    }
    if (room && player) room.handle(player, msg);
  });

  ws.on("close", () => {
    clearInterval(hb);
    if (room && player) {
      room.leave(player);
      log(`${player.name} (#${player.id}) sale de ${room.code} (${room.players.size}/${MAX_PLAYERS})`);
      if (room.empty) {
        room.dispose();
        rooms.delete(room.code);
        log(`Sala ${room.code} vacía: eliminada`);
      }
    }
  });
  ws.on("error", () => ws.close());
});

server.listen(PORT, HOST, () => log(`Servidor escuchando en ${HOST}:${PORT}${STATIC_DIR ? ` (estáticos: ${STATIC_DIR})` : ""}`));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log(`Cerrando (${sig})…`);
    for (const r of rooms.values()) r.dispose();
    // cierra las conexiones abiertas (si no, server.close() esperaría indefinidamente) y sale
    for (const c of wss.clients) c.close(1001, "servidor cerrándose");
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
