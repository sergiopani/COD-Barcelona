#!/usr/bin/env bash
# Despliega el juego en un servidor Linux (probado en Ubuntu 26.04 / EC2) por SSH + rsync y reinicia el servicio systemd.
# Uso:  KEY=/ruta/clave.pem HOST=ubuntu@ec2-xx.region.compute.amazonaws.com ./scripts/deploy-aws.sh
# Primera vez (instala Node y crea el servicio): añade SETUP=1
# El servicio escucha en el puerto 80 (HTTP; sin dominio no hay HTTPS), guarda el ranking en /opt/barcelona-fps/data y corre como usuario `bfps`.
set -euo pipefail
: "${KEY:?Falta KEY (ruta a la clave .pem)}"
: "${HOST:?Falta HOST (usuario@servidor)}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new)
cd "$(dirname "$0")/.."

npm run build:prod

if [ "${SETUP:-0}" = "1" ]; then
  "${SSH[@]}" "$HOST" 'sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs npm rsync && sudo mkdir -p /opt/barcelona-fps/data && sudo chown -R "$USER":"$USER" /opt/barcelona-fps'
fi

rsync -az --delete -e "ssh -i $KEY" dist dist-server "$HOST":/opt/barcelona-fps/

if [ "${SETUP:-0}" = "1" ]; then
  "${SSH[@]}" "$HOST" 'cd /opt/barcelona-fps && mkdir -p run && echo "{\"name\":\"bfps-runtime\",\"private\":true,\"dependencies\":{\"ws\":\"^8.18.0\"}}" > run/package.json && (cd run && npm install --omit=dev --no-audit --no-fund) && rm -rf node_modules && mv run/node_modules ./node_modules && rm -rf run
id bfps >/dev/null 2>&1 || sudo useradd --system --home /opt/barcelona-fps --shell /usr/sbin/nologin bfps
sudo chown -R bfps:bfps /opt/barcelona-fps/data
sudo tee /etc/systemd/system/barcelona-fps.service >/dev/null <<UNIT
[Unit]
Description=Barcelona FPS (cliente + servidor multijugador)
After=network.target

[Service]
User=bfps
Group=bfps
WorkingDirectory=/opt/barcelona-fps
ExecStart=/usr/bin/node dist-server/index.mjs
Environment=NODE_ENV=production
Environment=PORT=80
Environment=HOST=0.0.0.0
Environment=DATA_DIR=/opt/barcelona-fps/data
Environment=MAX_PLAYERS=32
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/barcelona-fps/data

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload && sudo systemctl enable barcelona-fps'
fi

# reinicio (el ranking se guarda al apagar con SIGTERM y vive en data/, que rsync no toca)
"${SSH[@]}" "$HOST" 'sudo systemctl restart barcelona-fps && sleep 2 && systemctl is-active barcelona-fps && curl -s localhost/health && echo'
