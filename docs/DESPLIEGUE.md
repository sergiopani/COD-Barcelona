# Despliegue (Fase 5)

El juego se publica como **un solo proceso Node** que sirve el cliente compilado (estáticos con Brotli/gzip y caché) **y** el WebSocket del multijugador en el mismo puerto.

## 1. Requisitos
- Node.js ≥ 20 (probado con 22.7). Un navegador de escritorio con **WebGL 2** (Chrome/Edge 94+, Firefox 92+, Safari 15+).
- **Los GLB no están en git** (son grandes): colócalos en `public/assets/` antes de compilar. Si faltan, el juego avisa en consola y usa sustitutos procedurales
  (basílica, palmeras, coches y rifle provisionales), pero sin los modelos reales.
  - `assets-src/` (fuera de git) guarda los originales; `npm run optimize:models` genera las versiones ligeras en `public/assets/`
    (simplificación de malla + texturas WebP; **108 MB → 21 MB**: basílica 12,7 MB / 353 k triángulos, rifle 5 MB / 60 k, coches 3,2 MB, palmera 0,3 MB).

## 2. Compilar y ejecutar
```bash
npm ci
npm run build:prod     # tsc + vite build → dist/ (+ .br/.gz), y empaqueta el servidor → dist-server/index.mjs
npm start              # node dist-server/index.mjs  →  http://localhost:8080
```
Comprobación: `curl localhost:8080/health` → `{"ok":true,"rooms":1,"players":0,"maxPlayers":32,"ranked":0,"protocol":2}`. El cliente usa **el mismo origen** para el WebSocket (`ws(s)://<host>`), sin configurar nada.

Variables de entorno del servidor: ver `.env.example` (`PORT`, `HOST`, `ALLOWED_ORIGINS`, `STATIC_DIR`, `KILL_LIMIT`, `MAX_PLAYERS`, `DATA_DIR`).
**El ranking global se guarda en `DATA_DIR` (`./data/leaderboard.json`): monta esa carpeta en un volumen persistente** o se perderá al recrear el contenedor/servidor.
Variables del build del cliente: `VITE_SERVER_URL` (servidor de juego en otro origen, p. ej. `wss://juego.midominio.com`) y `VITE_BASE` (subruta, p. ej. `/barcelona-fps/`).

## 3. Docker
```bash
docker build -t barcelona-fps .
docker run -d --name bfps -p 8080:8080 -v bfps-data:/app/data -e ALLOWED_ORIGINS=https://juego.midominio.com barcelona-fps
```
> **Sin probar:** el Dockerfile está escrito y revisado pero el daemon de Docker no estaba en marcha en la máquina de desarrollo, así que la imagen no se ha construido ni ejecutado.

## 4. Detrás de un proxy inverso con HTTPS (recomendado)
Los navegadores exigen `wss://` si la página es `https://`. Ejemplo **nginx** (certificado con Let's Encrypt/certbot):

```nginx
server {
  listen 443 ssl http2;
  server_name juego.midominio.com;
  # ssl_certificate / ssl_certificate_key …

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;       # necesario para WebSocket
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;                      # no cortar WebSockets inactivos
  }
}
```
Con proxy, define `ALLOWED_ORIGINS=https://juego.midominio.com` para que el WebSocket solo acepte tu web.

## 5. Mantener el proceso vivo
**systemd** (`/etc/systemd/system/barcelona-fps.service`):
```ini
[Service]
WorkingDirectory=/opt/barcelona-fps
ExecStart=/usr/bin/node dist-server/index.mjs
Environment=PORT=8080 ALLOWED_ORIGINS=https://juego.midominio.com
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
```
o **pm2**: `pm2 start dist-server/index.mjs --name barcelona-fps && pm2 save`.

## 6. Dimensionado y limitaciones de producción
- El servidor es de **un solo proceso y la sala global vive en memoria**: unas decenas de jugadores simultáneos caben de sobra (20 instantáneas/s de ~1 KB por jugador),
  pero no hay escalado horizontal; solo el ranking persiste (archivo JSON en `DATA_DIR`). Reiniciar el proceso expulsa a los jugadores.
- Descarga inicial del cliente: **~23 MB** (Babylon 1,2 MB en Brotli + 21 MB de modelos WebP). Los GLB se cachean un día; los archivos con hash, un año.
- Sin autenticación ni cuentas, sin reconexión automática, anti-trampas básico (ver `docs/MULTIJUGADOR.md`).
- Sin CSP configurada (Babylon necesita permisos de blobs/WebGL); si la añades, prueba que cargan los GLB y los shaders.

## 7. Compatibilidad de navegadores
| Navegador | Estado |
| --- | --- |
| Chromium (navegador integrado de la herramienta de desarrollo) | **Probado**: carga de producción, modo individual, multijugador, pruebas de combate y colisión |
| Chrome/Edge de escritorio | Mismo motor que lo probado; **no verificado** con Pointer Lock real ni sonido |
| Firefox | **No probado** |
| Safari | **No probado** (se abrió la build en Safari, pero la herramienta no puede capturar pantalla ni automatizarlo). Requiere Safari 15+ por WebGL2/ES2022 |
| Móviles/tablets | No soportado (necesita ratón y teclado) |

Si el navegador no soporta WebGL2 el juego lo indica en el menú. **Lista de comprobación manual** para quien lo pruebe: 1) la pantalla carga hasta «Jugar»; 2) clic en Jugar bloquea el cursor y Esc lo libera;
3) WASD/ratón/salto/correr; 4) clic derecho apunta con mira y la rueda cambia 4×/8×; 5) disparo con sonido; 6) en multijugador, dos pestañas en la sala global se ven y se pueden eliminar; 7) cambiar la calidad en el menú.

## 8. Actualizar modelos o mapa
- Modelos nuevos: copia el original a `assets-src/<ruta>.glb`, ajusta el trabajo en `scripts/optimize-models.mjs` y ejecuta `npm run optimize:models`.
- Cambios en el mapa: regenera la colisión del servidor (`docs/MULTIJUGADOR.md`) y recompila con `npm run build:prod`.

## 9. Despliegue en AWS EC2 (el que se usa)
- Instancia Ubuntu 26.04 (x86_64, 2 vCPU, 2 GB) en `eu-north-1` (Estocolmo). Node 22 de los paquetes de Ubuntu; servicio systemd `barcelona-fps` (usuario `bfps`) que sirve cliente + WebSocket en el **puerto 80** (HTTP) y guarda el ranking en `/opt/barcelona-fps/data`.
- Redespliegue: `KEY=/ruta/clave.pem HOST=ubuntu@<dns> ./scripts/deploy-aws.sh` (compila, sincroniza `dist/` y `dist-server/`, reinicia). Primera vez en otra máquina: `SETUP=1`.
- Estado/registro: `ssh … sudo systemctl status barcelona-fps` y `sudo journalctl -u barcelona-fps -f`.
- **Sin HTTPS** todavía (no hay dominio): el juego funciona por `http://` y `ws://`. Para HTTPS hace falta un dominio apuntando a la IP, abrir el puerto 443 en el grupo de seguridad y poner Caddy/nginx por delante (sección 4); entonces añade `ALLOWED_ORIGINS`.
- La IP/DNS público cambia si se para y arranca la instancia: asigna una **Elastic IP** para fijarla.
