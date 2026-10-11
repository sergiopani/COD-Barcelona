# Barcelona FPS — Sagrada Família

Shooter en primera persona para navegador (TypeScript + Babylon.js + Vite), ambientado **solo** en la manzana de la
Sagrada Família y su entorno inmediato (Eixample, Barcelona).

**Estado: FASES 1–5 completadas** — escenario de la Sagrada Família, francotirador con mira, modo individual con bots, multijugador online (una sala global, ranking global
persistente de bajas, servidor autoritativo), modelos optimizados y despliegue de producción. Ver `docs/COMBATE.md`, `docs/MULTIJUGADOR.md`, `docs/GRAFICOS.md` y `docs/DESPLIEGUE.md`.

## Requisitos

- Node.js ≥ 22.0 (probado con 22.7.0). **Vite 6** se eligió a propósito: Vite 7/8 exigen Node ≥ 22.12.
- Un navegador de escritorio moderno con WebGL2 (Chrome/Edge/Firefox/Safari recientes).

## Cómo ejecutarlo

```bash
npm install
npm run dev        # solo cliente: http://localhost:5173 (modo individual)
npm run dev:all    # cliente + servidor multijugador (ws://localhost:8080)
```

Pulsa **Jugar** (el cursor solo se bloquea tras ese clic). **Esc** libera el cursor y abre la pausa.

| Tecla | Acción |
| --- | --- |
| W A S D | Moverse |
| Ratón | Mirar |
| Espacio | Saltar |
| Shift | Correr |
| Esc | Pausa / liberar cursor |

Combate: **clic izq.** disparar · **clic der.** (mantener) apuntar · **rueda** zoom 4×/8× · **Shift** (apuntando) aguantar la respiración · **R** recargar.

En el menú inicial/pausa: **Calidad gráfica** (Bajo/Medio/Alto) y **Asfalto mojado**; ver `docs/GRAFICOS.md`.

Gráficos: `docs/GRAFICOS.md` (perfiles, medidas, texturas recomendadas). HDR opcional: `public/assets/env/README.txt`.

Multijugador: `docs/MULTIJUGADOR.md`. Tests: `npm test` (servidor + interpolación; arranca el servidor de prueba solo).

Producción: `npm run build:prod && npm start` (un solo proceso que sirve cliente + multijugador en :8080). Ver `docs/DESPLIEGUE.md`.

Otros comandos: `npm run build` (typecheck + build de producción en `dist/`), `npm run preview`, `npm run typecheck`.

## La Sagrada Família (modelo 3D)

El modelo activo (`public/assets/buildings/sagrada-familia.glb`, ~11 MB, 276 k triángulos, 71 texturas WebP) es la **fotogrametría del ICGC**
(Institut Cartogràfic i Geològic de Catalunya, visor `betaserver.icgc.cat/cesium/SagradaFamilia3D.html`): son datos reales de la basílica **tal como estaba en 2015**
(sin torre central ni fachada de la Gloria terminada, con grúas y huecos de la captura). Se genera con `npm run build:sagrada` (descarga las teselas, las gira 45° para
alinearlas con la cuadrícula del Eixample, recorta a la manzana y aclara las texturas). Configuración: `rotationYDeg: 180`, tinte, posición.
El archivo está en `.gitignore` (se regenera). Ajústalo en
`public/assets/buildings/sagrada-familia.config.json` (posición, rotación, escala, altura objetivo, alineado al suelo,
colliders). Instrucciones completas en `public/assets/buildings/README.txt`. Sin el archivo, el juego muestra un error
claro en la consola y usa una **basílica provisional procedural** (solo volumetría esquemática, no es fiel).

## Estructura

```
src/main.ts                       arranque
src/game/Game.ts                  motor, escena, bucle, estados, hooks de depuración
src/game/config.ts                escala del mapa y parámetros del jugador
src/game/player/                  InputManager (Pointer Lock), PlayerController (movimiento + colisiones)
src/game/world/mapLayout.ts       datos puros: cadenas de fachada, cruces, pasos de peatones, props, spawns
src/game/world/BarcelonaMap.ts    orquesta la construcción del mapa
src/game/world/StreetGenerator.ts calzada, aceras, bordillos, cebras, marcas viales
src/game/world/BuildingGenerator.ts + FacadeModules.ts   edificios modulares del Eixample
src/game/world/VehicleSet.ts      coches aparcados desde public/assets/props/car-pack.glb (thin instances)
src/game/multiplayer/             cliente de red, interpolación de jugadores remotos y sesión (ver docs/MULTIJUGADOR.md)
server/ · shared/                 servidor autoritativo (Node) y código compartido (protocolo, reglas de combate, colisión)
src/game/weapons/ · combat/ · audio/   sistema de combate (ver docs/COMBATE.md)
src/game/world/StreetFurniture.ts farolas, bancos, semáforos, señales, coches, motos
src/game/world/PalmTrees.ts       palmeras desde public/assets/props/palm-tree.glb (thin instances)
src/game/world/SagradaFamilia*.ts carga del GLB + basílica provisional
src/game/world/CollisionManager.ts colliders invisibles (geometría física separada de la visual)
src/game/world/Materials.ts       materiales PBR con texturas procedurales
src/game/world/Lighting.ts        sol, sombras en cascada, post-proceso, SSAO2/SSR, aplicación de perfiles
src/game/graphics/               perfiles gráficos (GraphicsSettings) y cielo + IBL (Environment)
src/game/world/WetSurfaces.ts     asfalto mojado con charcos (opcional)
src/game/world/SagradaShadowProxy.ts  proxy de sombra de la basílica
src/game/world/MeshBatch.ts       acumulador de geometría por material (pocos draw calls)
src/game/debug/selfTest.ts        pruebas automáticas de colisión (ver abajo)
docs/MAPA.md                      qué es aproximado y convenciones del mapa
```

## Pruebas de movimiento y colisión

Con el juego abierto, en la consola del navegador:

```js
__game.combatTest()        // 14 pruebas de combate (disparo, ADS, recarga, muerte…)
__game.selfTest()          // 19 pruebas: suelo, bordillos, verja, salto, 16 pasos de peatones,
                           // calles salientes, empuje en 16 direcciones y 275 recorridos aleatorios
__game.stats()             // FPS, draw calls, edificios, colliders…
__game.tp(x, z, yawGrados) // teletransporte para inspeccionar zonas
```

## Limitaciones conocidas (Fase 1)

- La geometría urbana es una **aproximación** (ver `docs/MAPA.md`); no se ha podido contrastar con datos geográficos.
- La basílica provisional es esquemática; el modelo real se carga desde el GLB.
- El interior de la manzana de la basílica no es transitable (verja con colisión).
- Texturas 100 % procedurales; sustituibles más adelante por texturas PBR reales.
- El bundle de Babylon (~7,6 MB, 1,7 MB gzip) aún no está optimizado con imports profundos (Fase 4/5).

## Casa Batlló en los edificios

Todos los edificios del Eixample usan la fachada de la **Casa Batlló** (modelo 3D aportado por el usuario) por encima de la planta baja, que sigue siendo procedural (tiendas, rótulos, portales).
Como el modelo original tiene 1,9 M de triángulos, `npm run bake:batllo` lo hornea a una textura frontal con silueta alfa en **4 paletas** (mosaico azul/verde, dorado, verde, rosado)
y a un mapa de relieve; el juego genera de ahí una malla de ~5 k triángulos por edificio (`src/game/world/BatlloFacade.ts`) donde los balcones sobresalen de verdad.
Cada edificio varía paleta, espejo, remate (tejado completo con dragón y torre, o cortado con cornisa), proporciones y brillo según su semilla.
Sin los archivos `casa-batllo-*` el juego vuelve a las fachadas procedurales antiguas. Limitaciones: el relieve es una elevación frontal (no un modelo completo: de lado se ve como una lámina con profundidad),
las proporciones se estiran para adaptarse al ancho de cada edificio y las sombras proyectadas no incluyen el relieve.

## Créditos de datos

Ver `CREDITOS.md` (ICGC para la basílica; MiniWorld3D para la maqueta alternativa).
