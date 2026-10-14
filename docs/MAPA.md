# Mapa: qué es aproximado y convenciones

> **Aviso:** no se pudo acceder a datos geográficos fiables (el servidor Overpass/OpenStreetMap devolvió errores y no
> había modelos de referencia). Todo lo siguiente es una **aproximación visual coherente basada en el conocimiento
> general del Eixample**, no una reproducción geográficamente precisa.

## Convenciones

- Unidades: metros. **X = este, Z = norte, Y = arriba.** La manzana de la basílica está centrada en el origen.
- La cuadrícula está **alineada con los ejes** de la escena. El Eixample real está girado ≈ 45° respecto al norte;
  no se ha reproducido ese giro.
- Calles (provisional, a verificar): **Provença** al norte, **Mallorca** al sur, **Marina** al este, **Sardenya** al oeste.
  Fachada del Nacimiento al este, de la Pasión al oeste, de la Gloria al sur; nave en dirección N–S.

## Valores usados (config.ts)

| Parámetro | Valor | Origen |
| --- | --- | --- |
| Distancia entre ejes de calle | 133 m | Valor típico del Eixample (aprox.) |
| Ancho de calle fachada-fachada | 20 m | Valor típico (aprox.) |
| Aceras | 4,5 m cada una; calzada 11 m (2 carriles + 2 de aparcamiento) | Estimación |
| Chaflanes (xamfrans) | 14 m de lado, a 45° | Estimación |
| Manzana (fachada a fachada) | 113 m | Derivado de lo anterior |
| Altura de edificios | 20–27 m (PB 4,6 + entresuelo 3,0 + principal 3,9 + 2–4 plantas + ático) | Estimación |
| Calles salientes | 45 m, cerradas con fachadas de remate | Decisión de diseño (mapa compacto) |

## El parque (Plaça de Gaudí) y la calle oeste

Al **oeste** de la basílica hay una segunda manzana: el parque de la Plaça de Gaudí (en la realidad, frente a la fachada de la Pasión). Es la manzana de la
basílica trasladada un paso de cuadrícula (`PARK_CX = −133`), con el mismo octógono de chaflanes. Contiene (`ParkBlock.ts` + datos en `mapLayout.ts`):
- césped, caminos de gravilla (un anillo alrededor del estanque y tres radios) y una explanada de baldosa junto a la basílica;
- el **estanque** (~46 × 50 m, contorno irregular, desplazado al este del centro como en la fotogrametría) con borde de piedra sólido (0,5 m; se puede saltar al agua, poco profunda) y reflejo del cielo;
- 30 palmeras, ~90 arbustos, bancos mirando al agua, farolas y papeleras.

Consecuencias en el mapa: desaparece la manzana lateral oeste (su sitio lo ocupa el parque); las manzanas NO y SO se alargan hasta el borde oeste del parque;
las calles transversales (z = ±66,5) siguen hasta `x = −199,5`, donde cruza una calle norte-sur cerrada al norte/sur por dos remates y al oeste por una
**fachada continua** (`WEST_WALL = −209,5`). El mundo jugable es por tanto rectangular (`WORLD` en `config.ts`: x ∈ [−217,5; 134]). Se añadieron 2 puntos de aparición en la calle oeste.
Medidas del estanque/posición tomadas a ojo de la fotogrametría; árboles, arbustos y caminos son una recreación, no un plano real.

## Aproximado / inventado

- Distribución de edificios, anchos, plantas, colores, comercios, balcones: **generados proceduralmente** (semilla fija);
  no corresponden a edificios reales.
- Mobiliario (árboles, farolas, bancos, semáforos, señales, coches, motos): colocación procedural, no real.
- Basílica provisional: volumetría esquemática (alturas aproximadas de torres; no reproduce detalles).
- La manzana real no es un solar vallado perfectamente octogonal; aquí se cierra con una verja con colisión.

## Cómo ajustar

- Escala/geometría de calles: `src/game/config.ts`.
- Distribución de cadenas de fachada, cruces, pasos de peatones, props y puntos de aparición: `src/game/world/mapLayout.ts`.
- Estilos de edificio y paletas: `src/game/world/BuildingGenerator.ts`; módulos: `FacadeModules.ts`.
- Cualquier edificio puede sustituirse por un GLB detallado: cada edificio es una unidad (`BuildingSpec`) independiente.
