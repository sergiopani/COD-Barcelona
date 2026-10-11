# La Sagrada Família del juego

## Dos modelos disponibles
| | Original (activo) | Procedural propio |
| --- | --- | --- |
| Archivo | `sagrada-familia.glb` (aportado por el usuario, 353 k triángulos tras optimizar) | `sagrada-familia-procedural.glb` (generado por `scripts/build-sagrada-procedural.mjs`, ~77 k triángulos, 2,8 MB) |
| Detalle | Alto (esculturas, texturas fotográficas) | Esquemático: volúmenes, torres, claraboyas, nichos y costillas; sin esculturas |
| Fidelidad estructural | La del modelo | Fiel a las medidas y la distribución publicadas (ver abajo) |

Capturas del modelo procedural: `docs/img/sagrada-procedural-aerea.jpg` y `docs/img/sagrada-procedural-calle.jpg`.

### Cómo cambiar de modelo
1. Genera el procedural: `npm run build:sagrada-procedural` (crea `public/assets/buildings/sagrada-familia-procedural.glb`).
2. En `public/assets/buildings/sagrada-familia.config.json` pon: `"model": "sagrada-familia-procedural.glb"`, `"rotationYDeg": 180`, `"scale": 1`, `"centerXZ": false`, `"alignToGround": false`, `"position": [0, 0.14, 0]`, `"tint": null`
   (para volver al original, borra `model` y usa la configuración de `assets-src/buildings/sagrada-familia-original.config.json`).
3. Regenera la colisión de balas del servidor (la silueta cambia): con el juego abierto, en la consola del navegador `copy(JSON.stringify(__game.dumpWorld()))` y pega el resultado en `server/data/world-colliders.json` (ver `docs/MULTIJUGADOR.md`).

## Datos reales usados (y cómo se reflejan)
Fuentes: [Wikipedia](https://en.wikipedia.org/wiki/Sagrada_Fam%C3%ADlia), [Barcelona Architecture Walks](https://barcelonarchitecturewalks.com/sagrada-familia-verticality-rules/), [Catalan News](https://www.catalannews.com/life-style/item/symbolism-and-hidden-meanings-behind-the-sagrada-familia), [aviewoncities](https://aviewoncities.com/barcelona/sagrada-familia), [Sagrada Família (web oficial)](https://sagradafamilia.org).
- Planta de cruz latina de **cinco naves**; nave de 45 m de ancho; transepto de tres naves; **malla de columnas de 7,5 m**. → naves de 7,5 m en el modelo.
- **Bóvedas**: nave central 45 m, naves laterales 30 m, crucero 60 m, ábside 75 m (hiperboloide). → alturas escalonadas del cuerpo y claraboyas hiperboloides sobre cada tramo.
- **18 torres**: 12 apóstoles (4 por fachada, 90–120 m), 4 evangelistas (135 m), María (138 m, estrella de 12 puntas) y Jesucristo (172,5 m, con cruz). → todas presentes con esas alturas; torres parabólicas con bandas y rendijas.
- **Fachadas**: Nacimiento al este/noreste (tres pórticos, 4 torres), Pasión al oeste (seis columnas inclinadas, frontón piramidal, torres de sección romboidal), Gloria al sur (cinco+siete puertas, gran pórtico de columnas, 16 claraboyas hiperboloides en dos filas de 7 y 9). Ábside con siete capillas.
- La fuente discrepa en algunos datos (altura de la torre de Jesús 170/172,5 m; el orden de los apóstoles en cada fachada); aquí se usa 172,5 m y se reparten los colores de las cúspides sin pretender identificar a cada apóstol.

## Qué NO está (limitaciones honestas)
- Sin esculturas, relieves figurativos, el árbol de la vida detallado, vidrieras ni columnas ramificadas interiores (el interior no es visitable).
- Las proporciones y la posición de cada elemento son una **interpretación** a partir de cifras publicadas y fotos descritas en texto, no un levantamiento topográfico; no he podido ver planos oficiales.
- Las torres, claraboyas y capillas son geometría paramétrica sencilla; la silueta general es reconocible pero lejos de la riqueza de un modelo escaneado.
