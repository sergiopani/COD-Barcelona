# Gráficos: qué hace cada parte y qué falta

## Perfiles (menú → «Calidad gráfica»; se guardan en localStorage)

| Opción real | Bajo | Medio | Alto |
| --- | --- | --- | --- |
| Resolución interna | DPR ≤ 1 × 0,8 | DPR ≤ 1,5 | DPR ≤ 2 |
| Antialiasing | FXAA | MSAA ×2 | MSAA ×4 |
| Sombras (mapa / cascadas / alcance) | 1024 / 2 / 120 m | 2048 / 3 / 180 m | 4096 / 4 / 260 m |
| Filtrado de sombras (PCF) | bajo | medio | alto |
| Sombra de la basílica (proxy) | no | sí | sí |
| Balcones y cornisas proyectan sombra | no | no | sí |
| Oclusión ambiental (SSAO2) | no | media resolución | alta calidad |
| Bloom / sharpen / viñeta | no | sí | sí |
| Filtrado anisotrópico | 4× | 8× | 16× |
| Distancia de dibujado | 500 m | 700 m | 900 m |
| SSR (solo con asfalto mojado) | no | no | sí |

Si los FPS bajan de 30 de forma sostenida durante 4 s, el juego baja un escalón de perfil (sin guardarlo como preferencia).

## Iluminación y entorno

- Sol direccional (desde el sureste, ~40° de altura), sombras en cascada, relleno hemisférico suave e **IBL**.
- **IBL sin archivo externo:** cubemap procedural (cielo con nubes + «cañón urbano» en el horizonte para que reflejos y
  ambiente sean coherentes con la calle) prefiltrado al arrancar con `EnvironmentTextureTools`. Consola: `[Entorno] IBL: procedural-prefiltrado`.
- **HDR real (opcional):** ver `public/assets/env/README.txt`. **No hay ningún HDR en el proyecto.**
- Tone mapping ACES, exposición 1,2, contraste 1,1, corrección de color sutil (saturación +22, sombras frías / luces cálidas).

## Materiales

- Texturas procedurales con color + normales + ORM (AO / rugosidad / metal) para estuco, piedra, hormigón, panot, asfalto y bordillo.
- Cristal dieléctrico (IOR 1,52) con Fresnel en lugar de espejo; pintura de coche con clear coat; rejas con alpha test.
- Basílica: tinte cálido configurable (`tint` en `sagrada-familia.config.json`), anisotropía 16×, sin recibir sombras (ver limitaciones).
- Anti-repetición: desplazamiento de UV aleatorio por edificio y franjas tonales (suciedad en la base y bajo la cornisa).

## Asfalto mojado (opcional)

Casilla «Asfalto mojado» del menú. Se crea al activarlo por primera vez. Máscara de charcos a escala de mundo (UV2) que sigue
cunetas, centros de carril y cruces; rugosidad 0,64 en el asfalto húmedo y 0,04 en los charcos. Con perfil ALTO se activa además SSR.

## Rendimiento (medido)

Equipo de prueba: Apple M1 Pro, navegador integrado de la app, 1024×768. Tiempo de CPU por fotograma (SceneInstrumentation),
60 FPS (límite de sincronización vertical): **Medio ≈ 5,3 ms, Alto ≈ 6,5 ms**, 305–384 draw calls. No se pudo medir el tiempo de GPU
(el panel del navegador integrado no ejecuta `requestAnimationFrame` con la ventana oculta y no hay timer queries), ni el perfil Bajo con fiabilidad.
**Otros equipos y navegadores no están probados.**

## Texturas: auditoría y recomendaciones

| Recurso | Estado | Recomendación |
| --- | --- | --- |
| Basílica (GLB) | Albedo a **4096² WebP afilado** + normal/ORM a 2048² (≈ 130 MB de VRAM con mipmaps) y un **mapa de detalle de piedra** repetible (`stone-detail.webp`, `scripts/make-detail-map.mjs`) que añade granulado y relieve fino al acercarse (`detail` en `sagrada-familia.config.json`; `null` lo desactiva). El normal del modelo original es casi plano y las texturas son suaves (modelo generado), así que el detalle real que se puede añadir es limitado. | Convertir a KTX2/Basis (−75 % VRAM) con `gltf-transform`; bajar el albedo a 2048 en equipos con poca VRAM (`texBase` en `scripts/optimize-models.mjs`). |
| Palmeras (GLB) | 1 textura PNG 2048², 1 812 triángulos. Correcta. | Añadir variante de palmera seca/otra especie para variedad. |
| Fachadas, calzada, aceras | 512² procedurales con tile de 2,4–6 m: nítidas y con ORM, pero con patrón reconocible a corta distancia. | Sustituir por texturas PBR reales (albedo/normal/ORM, 1–2K) de estuco, asfalto y baldosa panot. |
| Coches y mobiliario | Geometría de cajas/prismas sin textura. Es lo más débil visualmente. | Modelos GLB de coches y mobiliario (low-poly PBR). |
| HDR | No existe. | Un .hdr/.env de calle diurna soleada (ver `public/assets/env/README.txt`). |

## Fase 4: optimización y detalle urbano

- **Modelos optimizados** (`npm run optimize:models`, `scripts/optimize-models.mjs`): simplificación de malla con meshoptimizer y texturas a WebP
  (basílica 930 k → 353 k triángulos y 4096² → 2048²; rifle 274 k → 60 k; coches 41 PNG → 1024² WebP). 108 MB → 21 MB sin cambio visible apreciable en las capturas.
  Los originales se conservan en `assets-src/` (fuera de git).
- **Rótulos de comercios con texto real** (atlas de 16 nombres: FARMÀCIA, PANADERIA, ESTANC…) y **placas con el número del portal**.
- Texturas con filtrado anisotrópico, sombras con proxy y perfiles gráficos (ver arriba).

## Limitaciones conocidas

- **WebGPU:** no se ha migrado. El cielo usa un shader GLSL propio y WebGL2 cumple todos los efectos usados; no hay beneficio claro.
- **Reflejos:** sin SSR (perfiles Bajo/Medio) los charcos reflejan solo el IBL, no los edificios reales. Los cristales reflejan el IBL (no el entorno exacto).
- **Sombra de la basílica:** es un proxy de columnas de 0,75 m (≈ 50 k triángulos), no el modelo; por eso el modelo no recibe sombras (si las recibiera, el proxy lo oscurecería).
- **Vegetación:** las palmeras no tienen LOD ni viento.
- **Cielo:** las nubes del cielo visible se animan; el IBL (generado una vez) no.
- El tiempo hasta «Jugar» aumenta ~1–2 s por la generación y el prefiltrado del IBL.

## Cielo con foto real y fondo del menú

`src/game/graphics/Environment.ts` (`setPhotoSky`) añade una cúpula (de −13° bajo el horizonte al cénit) con el panorama de Barcelona como hija del cielo procedural; este sigue calculando la iluminación/IBL y solo se oculta su esfera visible. Material sin iluminación con `emissiveColor = 0,13` (la canalización HDR con exposición 1,2 y ACES quemaba la foto LDR). Orientación: la torre Glòries/mar al sureste. Se desactiva desde el menú («Cielo con foto real»).
