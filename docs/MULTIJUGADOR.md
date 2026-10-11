# Multijugador (Fase 3)

Partidas online de **hasta 8 jugadores** por sala, todos contra todos, solo con el francotirador. **Servidor autoritativo** en Node.js + WebSockets (`ws`).

## Cómo probarlo en local

```bash
npm run dev:all        # cliente (http://localhost:5173) + servidor (ws://localhost:8080)
# o en dos terminales:  npm run dev   y   npm run server
```

En el menú elige **Multijugador online**, escribe un nombre y (opcional) un **código de sala** para jugar con amigos; sin código te asigna la primera sala pública con hueco
(si hay 8, crea otra). Abre varias pestañas/ordenadores para probar. Si el servidor no está en la misma máquina, escribe su dirección en el campo «Servidor»
(`ws://IP:8080`, o `wss://…` detrás de HTTPS). Valor por defecto: `ws://<host de la página>:8080` o la variable `VITE_SERVER_URL` en el build del cliente.

**Tab** muestra el marcador. La partida termina al llegar a **20 bajas** (ganador anunciado) y se reinicia sola a los 8 s.
En multijugador la pausa (Esc) NO congela el juego: el servidor sigue en marcha.

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

JSON sobre WebSocket; tipos en `shared/protocol.ts`. Cliente → servidor: `join`, `state` (20 Hz), `fire`, `reload`, `ping`. Servidor → cliente: `welcome` (id, sala, posición de aparición),
`snap` (20 Hz: jugadores + tu estado autoritativo), `shot`, `hit`, `damaged`, `kill`, `died`, `respawn`, `correct`, `score`, `match`, `joined`, `left`, `pong`, `error`.

## Variables de entorno del servidor

| Variable | Defecto | Uso |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | Dirección de escucha |
| `ALLOWED_ORIGINS` | (vacío = cualquiera) | Lista de orígenes permitidos para WebSocket, separados por comas |
| `STATIC_DIR` | (ninguno) | Si se define (p. ej. `dist`), el mismo servidor sirve el cliente compilado |
| `KILL_LIMIT` | `20` | Bajas para ganar (útil en pruebas) |
| `ALLOW_DEBUG` | (apagado) | Solo pruebas: habilita el teletransporte de depuración |

`GET /health` devuelve `{ok, rooms, players, protocol}`.

## Regenerar la colisión del servidor

Si cambias el mapa (edificios, mobiliario, coches), el servidor debe conocer las cajas nuevas: con el juego abierto, en la consola del navegador,
`copy(JSON.stringify(__game.dumpWorld()))` y pega el resultado en `server/data/world-colliders.json` (la basílica va como mapa de alturas grueso de 2 m).

## Pruebas

```bash
npm run test:server   # 26 pruebas de integración: salas (8+1), validación de movimiento, impactos, cadencia, recarga, bajas, respawn,
                      # compensación de latencia, fin/reinicio de partida, desconexión
npm run test:interp   # interpolación con jitter de red simulado (error de posición y saltos por fotograma)
```

## Limitaciones conocidas

- **No probado con varios navegadores/ordenadores reales ni con latencia real de Internet**: se probó con el servidor local, clientes Node y un cliente en el navegador integrado
  (que no permite Pointer Lock ni sonido; el ratón/teclado se simularon). La fluidez de la interpolación se verificó con simulación de jitter, no a ojo en pantalla.
- La colisión del jugador la decide el cliente (predicción); el servidor solo detecta penetraciones > 35 cm y velocidades imposibles, no hace una simulación de física completa.
- Sin reconexión automática, sin autenticación/cuentas ni listado de salas; una desconexión devuelve al menú.
- Las salas viven en memoria de un único proceso (no hay escalado horizontal).
- Anti-trampas básico (validación + límites): no protege contra aimbots ni lectura de posiciones de enemigos (el servidor envía todas las posiciones).
