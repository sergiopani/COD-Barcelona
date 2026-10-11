# Multijugador (Fase 3) · sala única global y ranking de bajas

Hay **una sola sala en todo el juego**: todos los jugadores que entran comparten la misma partida (todos contra todos, solo francotirador), hasta `MAX_PLAYERS` a la vez (32 por defecto; si está llena, «Servidor lleno»).
Es una partida **continua** (sin límite de bajas por defecto) y existe un **ranking global de bajas persistente**. **Servidor autoritativo** en Node.js + WebSockets (`ws`).

## Cómo probarlo en local

```bash
npm run dev:all        # cliente (http://localhost:5173) + servidor (ws://localhost:8080)
# o en dos terminales:  npm run dev   y   npm run server
```

En el menú elige **Multijugador online** y escribe un nombre (no hay códigos de sala: todos entran en la misma). El menú muestra el top 10 del ranking global. Abre varias pestañas/ordenadores para probar. Si el servidor no está en la misma máquina, escribe su dirección en el campo «Servidor»
(`ws://IP:8080`, o `wss://…` detrás de HTTPS). Valor por defecto: `ws://<host de la página>:8080` o la variable `VITE_SERVER_URL` en el build del cliente.

**Tab** muestra los jugadores conectados y el top 10 del ranking global (con tu posición). Con `KILL_LIMIT>0` la partida termina al llegar a ese número de bajas (ganador anunciado) y se reinicia sola a los 8 s;
por defecto es `0` (sin final). En multijugador la pausa (Esc) NO congela el juego: el servidor sigue en marcha.

## Ranking global de bajas

- **Cada baja se guarda**: al matar a otro jugador, el servidor suma una baja (y, si fue a la cabeza, un «headshot») al jugador que la hizo, y una muerte a la víctima si ya figura en el ranking.
  Quien aún no tiene ninguna baja no aparece en el ranking. El ranking ordena por bajas (desempate: menos muertes, y quien llegó antes).
- **Identidad sin cuentas**: no hay registro ni contraseñas. El navegador genera un **token aleatorio** (se guarda en `localStorage`, clave `barcelonaFps.token`) y lo envía al entrar;
  el servidor guarda **solo un hash** (SHA-256 truncado) y el último nombre usado. Consecuencia: el puesto pertenece a *ese navegador*; si borras los datos del sitio o cambias de navegador/dispositivo, empiezas de cero.
  Quien conozca tu token podría hacerse pasar por ti (no se muestra en ningún sitio, solo viaja en el `join`).
- **Persistencia**: archivo JSON en `DATA_DIR` (por defecto `./data/leaderboard.json`), escritura atómica con guardado diferido (2 s) y al apagar con SIGTERM/SIGINT. Un archivo corrupto se aparta como copia (`*.corrupt-…`) y se arranca vacío. Máx. 10 000 jugadores guardados (se descartan los de menos bajas).
- **API pública**: `GET /api/leaderboard?limit=N` → `{total, top:[{rank,name,kills,deaths,headshots}]}` (CORS abierto, sin caché; nunca incluye tokens). Por WebSocket el servidor envía `board` (top 10 + tu puesto) al entrar y como máximo 1 vez por segundo cuando cambia.
- **Anti-abuso básico**: matarte a ti mismo con el mismo token (dos pestañas) no cuenta; un token inválido/ausente permite jugar pero no puntuar. **No se impide la colusión** (dos personas que se matan por turnos, o una con dos navegadores distintos), ni hay limitación por jugador ni por IP; eso necesitaría cuentas.

## Qué decide el servidor (el cliente no puede hacer trampas con esto)

| Cosa | Quién |
| --- | --- |
| Salud, daño, muertes, reapariciones, marcador | **Servidor** |
| Munición, cargador, recarga, cadencia del cerrojo | **Servidor** (el cliente solo las predice para el audio/animación y se corrige con cada instantánea) |
| Si un disparo acierta y dónde (cabeza/torso/piernas) | **Servidor**: el origen del tiro es SU posición validada + altura de ojos; la dispersión también la calcula él |
| Movimiento | Cliente propone, **servidor valida**: velocidad máxima (7,2 m/s × tolerancia), límites del mapa y que no se meta en sólidos; si no, **corrige** (`correct`) |
| Bloqueo de balas | El servidor usa las mismas cajas de colisión del mapa (`server/data/world-colliders.json`); la verja no detiene balas, la basílica sí |

**Compensación de latencia:** el cliente dibuja a los demás ~100 ms en el pasado (interpolación) y envía con cada disparo el instante de servidor que está viendo (`rt`);
el servidor **rebobina** a los demás jugadores a ese instante (máx. 400 ms) antes de trazar el rayo, así aciertas donde veías al enemigo.

**Defensas básicas:** límite de 120 mensajes/s por conexión, mensajes ≤ 4 KB, JSON y campos validados, nombres saneados (sin `<>`/control, ≤ 16), versión de protocolo,
`ALLOWED_ORIGINS` opcional, latido ping/pong (se expulsa a clientes colgados). El mensaje de depuración `dbg` (teletransporte) está desactivado salvo con `ALLOW_DEBUG=1` (solo pruebas).

## Protocolo

JSON sobre WebSocket; tipos en `shared/protocol.ts`. Cliente → servidor: `join` (nombre + token), `state` (20 Hz), `fire`, `reload`, `ping`. Servidor → cliente: `welcome` (id, sala, posición de aparición, aforo, tu puesto global), `board` (ranking global),
`snap` (20 Hz: jugadores + tu estado autoritativo), `shot`, `hit`, `damaged`, `kill`, `died`, `respawn`, `correct`, `score`, `match`, `joined`, `left`, `pong`, `error`.

## Variables de entorno del servidor

| Variable | Defecto | Uso |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Dirección de escucha |
| `ALLOWED_ORIGINS` | (vacío = cualquiera) | Lista de orígenes permitidos para WebSocket, separados por comas |
| `STATIC_DIR` | (ninguno) | Si se define (p. ej. `dist`), el mismo servidor sirve el cliente compilado |
| `KILL_LIMIT` | `0` (sin final) | Bajas para ganar la partida y reiniciarla (útil en pruebas) |
| `MAX_PLAYERS` | `32` | Aforo de la sala global (2–128) |
| `DATA_DIR` | `./data` | Carpeta del ranking (`leaderboard.json`); `none` = solo en memoria |
| `ALLOW_DEBUG` | (apagado) | Solo pruebas: habilita el teletransporte de depuración |

`GET /health` devuelve `{ok, rooms (siempre 1), players, maxPlayers, ranked, protocol}`.

## Regenerar la colisión del servidor

Si cambias el mapa (edificios, mobiliario, coches), el servidor debe conocer las cajas nuevas: con el juego abierto, en la consola del navegador,
`copy(JSON.stringify(__game.dumpWorld()))` y pega el resultado en `server/data/world-colliders.json` (la basílica va como mapa de alturas grueso de 2 m).

## Pruebas

```bash
npm run test:server   # 41 pruebas de integración: sala única y aforo, ranking global (bajas, cabezas, API, persistencia tras reiniciar, archivo corrupto, anti-autokill, token inválido), validación de movimiento, impactos, cadencia, recarga, bajas, respawn,
                      # compensación de latencia, fin/reinicio de partida, desconexión
npm run test:interp   # interpolación con jitter de red simulado (error de posición y saltos por fotograma)
```

## Limitaciones conocidas

- **No probado con varios navegadores/ordenadores reales ni con latencia real de Internet**: se probó con el servidor local, clientes Node y un cliente en el navegador integrado
  (que no permite Pointer Lock ni sonido; el ratón/teclado se simularon). La fluidez de la interpolación se verificó con simulación de jitter, no a ojo en pantalla.
- La colisión del jugador la decide el cliente (predicción); el servidor solo detecta penetraciones > 35 cm y velocidades imposibles, no hace una simulación de física completa.
- Sin reconexión automática ni cuentas; una desconexión devuelve al menú.
- La sala vive en un único proceso (no hay escalado horizontal; el ranking es un archivo local, no una base de datos compartida).
- Anti-trampas básico (validación + límites): no protege contra aimbots ni lectura de posiciones de enemigos (el servidor envía todas las posiciones).
