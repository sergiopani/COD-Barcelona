# Barcelona FPS — imagen de producción (cliente compilado + servidor de juego en un solo contenedor)
# Construcción:  docker build -t barcelona-fps .      Ejecución:  docker run -p 8080:8080 barcelona-fps
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Requiere que los GLB ya estén en public/assets (ver docs/DESPLIEGUE.md); el build los copia a dist/
RUN npm run build:prod

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.mjs"]
