import { Color3, Mesh, PBRMaterial, Scene, TransformNode } from "@babylonjs/core";
import { SKIN_COUNT } from "../../../shared/protocol";
import { F, Frame, MeshBatch, type RGBA } from "../world/MeshBatch";

/**
 * Personajes del juego (bots y jugadores remotos). Cada jugador elige uno en el menú; son figuras de bloques estilizadas
 * (no un parecido facial con nadie) construidas a partir de la ROPA y los complementos de las imágenes de referencia:
 *   0 · Segarro      chándal azul marino, camiseta roja con franja, gorra marrón, barba, chancletas
 *   1 · La Charo     melena morada en bob con flequillo, gafas redondas, camiseta azul con cuadrado rojo, pantalón corto morado, zapatillas rosas
 *   2 · Perro flauta rastas, pañuelo verde con flor, top negro, falda de bufandas de colores, pulseras doradas, sandalias
 *   3 · Facha        traje gris oscuro, camisa blanca, pelo castaño peinado, carpeta roja, zapatos negros
 * Cada miembro es UNA malla con colores por vértice (un solo material), así que todos cuestan lo mismo. Dimensiones, pivotes y zonas de
 * impacto son idénticos para todos los personajes (la jugabilidad no cambia).
 */
export const SKIN_NAMES = ["Segarro", "La Charo", "Perro flauta", "Facha"] as const;

export interface CharacterParts {
  torso: Mesh;
  head: Mesh;
  legL: Mesh;
  legR: Mesh;
  armL: Mesh;
  armR: Mesh;
  rifle: Mesh;
  /** Todas las mallas creadas (para visibilidad / liberación). */
  meshes: Mesh[];
  /** Mallas que proyectan sombra (torso y piernas). */
  casters: Mesh[];
}

const c = (r: number, g: number, b: number): RGBA => [r, g, b, 1];
const WHITE = c(0.9, 0.9, 0.9);
const GUN = c(0.04, 0.04, 0.05);

/** Colores de un personaje. */
interface Palette {
  skin: RGBA;
  hair: RGBA;
  top: RGBA;
  top2: RGBA;
  bottom: RGBA;
  bottom2: RGBA;
  shoe: RGBA;
  sock: RGBA;
}
const PALETTES: Palette[] = [
  { skin: c(0.62, 0.45, 0.36), hair: c(0.045, 0.03, 0.025), top: c(0.035, 0.055, 0.15), top2: c(0.05, 0.075, 0.19), bottom: c(0.035, 0.055, 0.15), bottom2: c(0.62, 0.04, 0.07), shoe: c(0.025, 0.025, 0.028), sock: WHITE },
  { skin: c(0.85, 0.62, 0.52), hair: c(0.5, 0.25, 0.75), top: c(0.2, 0.62, 0.84), top2: c(0.8, 0.1, 0.1), bottom: c(0.38, 0.12, 0.5), bottom2: c(0.3, 0.09, 0.4), shoe: c(0.9, 0.28, 0.55), sock: WHITE },
  { skin: c(0.78, 0.55, 0.42), hair: c(0.5, 0.36, 0.2), top: c(0.05, 0.05, 0.06), top2: c(0.1, 0.36, 0.3), bottom: c(0.32, 0.2, 0.14), bottom2: c(0.8, 0.45, 0.1), shoe: c(0.35, 0.22, 0.12), sock: c(0.78, 0.55, 0.42) },
  { skin: c(0.82, 0.62, 0.52), hair: c(0.14, 0.085, 0.055), top: c(0.15, 0.16, 0.18), top2: c(0.9, 0.92, 0.96), bottom: c(0.16, 0.17, 0.19), bottom2: c(0.7, 0.05, 0.08), shoe: c(0.03, 0.03, 0.035), sock: c(0.04, 0.04, 0.05) },
];

const FR = new Frame(0, 0, 0, -1, 0, 0, 1); // u = -x, v = arriba, w = +z (delante)

let shared: PBRMaterial | null = null;
function material(scene: Scene): PBRMaterial {
  if (shared && scene.getMaterialByUniqueID(shared.uniqueId)) return shared;
  const m = new PBRMaterial("characterMat", scene);
  m.albedoColor = Color3.White(); // el color real viene de los vértices
  m.metallic = 0;
  m.roughness = 0.72;
  shared = m;
  return m;
}

/** Caja con el centro en coordenadas de personaje (x derecha, y arriba, z delante). */
const box = (b: MeshBatch, x: number, y: number, z: number, sx: number, sy: number, sz: number, col: RGBA, skip = 0): void => b.addBox(FR, -x, y, z, sx, sy, sz, col, skip);

// ------------------------------------------------------------------ torso (origen = centro del torso, y = 1,2) + cadera
function torsoBatch(skin: number, p: Palette): MeshBatch {
  const t = new MeshBatch(1);
  if (skin === 0) {
    // chaqueta azul marino abierta sobre camiseta roja con franja central y logotipos blancos
    box(t, 0, 0, 0, 0.46, 0.62, 0.25, p.top);
    box(t, 0, 0, 0.127, 0.19, 0.6, 0.01, p.bottom2, F.BACK);
    box(t, 0, 0, 0.133, 0.05, 0.6, 0.01, p.top2, F.BACK);
    box(t, 0, 0.1, 0.139, 0.075, 0.03, 0.008, WHITE, F.BACK);
    box(t, -0.15, 0.17, 0.129, 0.045, 0.045, 0.008, WHITE, F.BACK);
    box(t, 0, 0.3, 0, 0.2, 0.05, 0.27, p.top2, F.DOWN);
    box(t, 0, -0.42, 0, 0.4, 0.22, 0.22, p.bottom);
  } else if (skin === 1) {
    // camiseta azul claro con un cuadrado rojo en el pecho; pantalón corto morado
    box(t, 0, 0, 0, 0.46, 0.62, 0.25, p.top);
    box(t, 0, 0.03, 0.127, 0.17, 0.17, 0.01, p.top2, F.BACK);
    box(t, 0, 0.3, 0, 0.22, 0.04, 0.27, c(0.16, 0.5, 0.7), F.DOWN); // cuello de la camiseta
    box(t, 0, -0.42, 0, 0.42, 0.22, 0.23, p.bottom);
  } else if (skin === 2) {
    // top negro de tirantes, abdomen al aire y falda de bufandas de colores
    box(t, 0, 0.12, 0, 0.44, 0.38, 0.24, p.top);
    box(t, 0, -0.17, 0, 0.4, 0.24, 0.22, p.skin);
    box(t, 0, -0.38, 0, 0.43, 0.12, 0.25, p.top2);
    const stripes = [c(0.1, 0.5, 0.55), c(0.85, 0.45, 0.1), c(0.9, 0.75, 0.2), c(0.65, 0.12, 0.2), c(0.2, 0.45, 0.25)];
    stripes.forEach((col, i) => box(t, -0.17 + i * 0.085, -0.5, 0.0, 0.085, 0.14, 0.26, col));
    box(t, 0, 0.32, 0.05, 0.32, 0.05, 0.2, p.skin, F.DOWN); // escote
    box(t, 0, 0.02, 0.127, 0.06, 0.34, 0.008, c(0.85, 0.7, 0.2), F.BACK); // colgante dorado
  } else {
    // americana gris oscura abierta sobre camisa blanca, con carpeta roja en las manos
    box(t, 0, 0, 0, 0.46, 0.62, 0.25, p.top);
    box(t, 0, 0.02, 0.127, 0.15, 0.58, 0.01, p.top2, F.BACK);
    box(t, 0, 0.3, 0.0, 0.18, 0.05, 0.27, p.top2, F.DOWN);
    box(t, 0, -0.42, 0, 0.4, 0.22, 0.22, p.bottom);
    box(t, 0.02, -0.15, 0.17, 0.27, 0.3, 0.025, p.bottom2); // carpeta roja
    box(t, 0.02, -0.15, 0.1855, 0.17, 0.05, 0.004, WHITE, F.BACK);
  }
  return t;
}

// ------------------------------------------------------------------ cabeza (origen en el centro de la cabeza)
function headBatch(skin: number, p: Palette): MeshBatch {
  const h = new MeshBatch(1);
  h.addEllipsoid(0, 0, 0, 0.15, 0.15, 0.15, 10, 8, p.skin);
  const eye = c(0.05, 0.04, 0.04);
  if (skin === 0) {
    const cap = c(0.24, 0.16, 0.09), capDark = c(0.13, 0.09, 0.055);
    h.addEllipsoid(0, 0.045, -0.005, 0.158, 0.125, 0.162, 10, 6, cap);
    h.addEllipsoid(0, 0.02, -0.03, 0.162, 0.05, 0.158, 10, 4, capDark);
    box(h, 0, 0.035, 0.205, 0.25, 0.025, 0.15, capDark);
    h.addEllipsoid(0, -0.075, 0.025, 0.14, 0.095, 0.125, 10, 5, p.hair);
    h.addEllipsoid(0, -0.03, -0.065, 0.14, 0.1, 0.1, 10, 5, p.hair);
  } else if (skin === 1) {
    // melena morada en bob con flequillo, ojos grandes y gafas redondas
    h.addEllipsoid(0, 0.065, -0.04, 0.178, 0.115, 0.172, 10, 6, p.hair);
    box(h, 0, 0.065, 0.128, 0.3, 0.07, 0.05, p.hair);                        // flequillo
    box(h, -0.165, -0.025, -0.01, 0.045, 0.17, 0.27, p.hair);                 // mechones laterales (bob)
    box(h, 0.165, -0.025, -0.01, 0.045, 0.17, 0.27, p.hair);
    box(h, 0, -0.02, -0.15, 0.3, 0.17, 0.05, p.hair);                         // nuca
    for (const sx of [-1, 1]) {
      box(h, sx * 0.055, 0.0, 0.146, 0.05, 0.05, 0.008, WHITE);               // globos oculares
      box(h, sx * 0.055, 0.0, 0.151, 0.025, 0.03, 0.006, eye);
      const g = c(0.72, 0.74, 0.78);                                           // montura redonda (4 lados)
      box(h, sx * 0.055, 0.032, 0.153, 0.085, 0.01, 0.006, g);
      box(h, sx * 0.055, -0.032, 0.153, 0.085, 0.01, 0.006, g);
      box(h, sx * 0.055 - 0.0425, 0, 0.153, 0.01, 0.075, 0.006, g);
      box(h, sx * 0.055 + 0.0425, 0, 0.153, 0.01, 0.075, 0.006, g);
    }
    box(h, 0, 0, 0.153, 0.03, 0.01, 0.006, c(0.72, 0.74, 0.78));
    box(h, 0, -0.065, 0.146, 0.06, 0.012, 0.006, c(0.6, 0.25, 0.25));         // sonrisa
  } else if (skin === 2) {
    // rastas largas (castaño y rubio), pañuelo verde, flor morada y pluma
    const dl = c(0.6, 0.45, 0.24), dd = c(0.34, 0.23, 0.12);
    h.addEllipsoid(0, 0.06, -0.04, 0.168, 0.11, 0.168, 10, 6, dd);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, r = 0.155;
      if (Math.cos(a) > 0.45) continue; // sin rastas delante de la cara
      const len = 0.34 + (i % 3) * 0.06;
      box(h, Math.sin(a) * r, -0.1 - len / 2 + 0.05, Math.cos(a) * r * 0.95 - 0.015, 0.04, len, 0.04, i % 2 ? dl : dd);
    }
    box(h, 0, 0.075, 0.0, 0.34, 0.065, 0.34, c(0.1, 0.36, 0.3));              // pañuelo
    box(h, 0.1, 0.12, 0.06, 0.06, 0.04, 0.06, c(0.6, 0.35, 0.75));            // flor
    box(h, -0.11, 0.17, 0.0, 0.025, 0.1, 0.07, c(0.9, 0.9, 0.88));            // pluma
    for (const sx of [-1, 1]) {
      box(h, sx * 0.055, 0.005, 0.146, 0.04, 0.025, 0.008, c(0.85, 0.5, 0.15)); // sombra de ojos naranja
      box(h, sx * 0.055, -0.012, 0.15, 0.022, 0.012, 0.006, eye);
    }
    box(h, 0, -0.07, 0.146, 0.05, 0.012, 0.006, c(0.65, 0.25, 0.25));
  } else {
    // pelo castaño corto con raya al lado y gesto serio
    h.addEllipsoid(0, 0.075, -0.035, 0.16, 0.09, 0.16, 10, 6, p.hair);
    box(h, -0.04, 0.115, 0.07, 0.18, 0.045, 0.1, p.hair);
    box(h, 0, 0.0, -0.13, 0.28, 0.14, 0.05, p.hair);
    for (const sx of [-1, 1]) {
      box(h, sx * 0.055, 0.015, 0.146, 0.04, 0.02, 0.008, WHITE);
      box(h, sx * 0.055, 0.015, 0.151, 0.02, 0.02, 0.006, eye);
      box(h, sx * 0.055, 0.045, 0.15, 0.06, 0.01, 0.006, p.hair); // cejas
    }
    box(h, 0, -0.065, 0.146, 0.05, 0.01, 0.006, c(0.55, 0.28, 0.25));
  }
  return h;
}

// ------------------------------------------------------------------ piernas (origen en la cadera) y brazos (origen en el hombro)
function legBatch(skin: number, p: Palette, side: number): MeshBatch {
  const l = new MeshBatch(1);
  if (skin === 0) {
    box(l, 0, -0.29, 0, 0.17, 0.58, 0.2, p.bottom);
    box(l, side * 0.0875, -0.29, 0, 0.012, 0.56, 0.205, p.bottom2);
    box(l, side * 0.0875, -0.29, 0.1, 0.014, 0.56, 0.02, WHITE);
    box(l, 0, -0.65, 0, 0.14, 0.14, 0.17, p.sock);
    box(l, 0, -0.735, 0.05, 0.15, 0.055, 0.3, p.shoe);
    box(l, 0, -0.705, 0.12, 0.13, 0.02, 0.06, p.shoe);
  } else if (skin === 1) {
    box(l, 0, -0.1, 0, 0.18, 0.28, 0.21, p.bottom);              // pantalón corto
    box(l, 0, -0.43, 0, 0.13, 0.32, 0.15, p.skin);                // piernas al aire
    box(l, 0, -0.65, 0, 0.14, 0.12, 0.16, p.sock);
    box(l, 0, -0.72, 0.04, 0.16, 0.08, 0.27, p.shoe);             // zapatilla rosa
    box(l, 0, -0.745, 0.04, 0.165, 0.02, 0.275, WHITE);
  } else if (skin === 2) {
    box(l, 0, -0.29, 0, 0.17, 0.58, 0.2, p.bottom);              // pantalón holgado
    box(l, 0, -0.64, 0, 0.12, 0.1, 0.15, p.skin);                 // tobillo
    box(l, 0, -0.72, 0.04, 0.15, 0.04, 0.28, p.shoe);             // sandalia
    box(l, 0, -0.69, 0.08, 0.15, 0.015, 0.05, c(0.55, 0.35, 0.2));
  } else {
    box(l, 0, -0.29, 0, 0.17, 0.58, 0.2, p.bottom);
    box(l, 0, -0.65, 0, 0.14, 0.12, 0.17, p.sock);
    box(l, 0, -0.725, 0.05, 0.15, 0.08, 0.3, p.shoe);             // zapato negro
    box(l, 0, -0.77, 0.05, 0.16, 0.015, 0.305, c(0.01, 0.01, 0.01));
  }
  return l;
}

function armBatch(skin: number, p: Palette, side: number): MeshBatch {
  const a = new MeshBatch(1);
  void side;
  if (skin === 0) {
    box(a, 0, -0.22, 0, 0.12, 0.45, 0.14, p.top);
    box(a, 0, -0.44, 0, 0.125, 0.04, 0.145, p.top2);
    box(a, 0, -0.5, 0.01, 0.09, 0.1, 0.1, p.skin);
  } else if (skin === 1) {
    box(a, 0, -0.1, 0, 0.13, 0.2, 0.15, p.top);                   // manga corta
    box(a, 0, -0.32, 0, 0.1, 0.27, 0.12, p.skin);
    box(a, 0, -0.5, 0.01, 0.09, 0.1, 0.1, p.skin);
  } else if (skin === 2) {
    box(a, 0, -0.25, 0, 0.1, 0.5, 0.12, p.skin);                  // brazos desnudos
    box(a, 0, -0.43, 0, 0.115, 0.05, 0.135, c(0.9, 0.75, 0.25));  // pulseras doradas
    box(a, 0, -0.36, 0, 0.113, 0.03, 0.133, c(0.2, 0.55, 0.45));
    box(a, 0, -0.5, 0.01, 0.09, 0.1, 0.1, p.skin);
  } else {
    box(a, 0, -0.22, 0, 0.12, 0.45, 0.14, p.top);
    box(a, 0, -0.45, 0, 0.115, 0.03, 0.135, p.top2);              // puño de la camisa
    box(a, 0, -0.5, 0.01, 0.09, 0.1, 0.1, p.skin);
  }
  return a;
}

export function buildCharacter(scene: Scene, id: number, parent: TransformNode, skinRaw = 0): CharacterParts {
  const skin = Number.isInteger(skinRaw) && skinRaw >= 0 && skinRaw < SKIN_COUNT ? skinRaw : 0;
  const p = PALETTES[skin];
  const mat = material(scene);
  const meshes: Mesh[] = [];
  const casters: Mesh[] = [];
  const make = (name: string, b: MeshBatch, x: number, y: number, z: number, cast: boolean): Mesh => {
    const m = b.toMesh(`${name}${id}`, scene)!;
    m.material = mat;
    m.parent = parent;
    m.position.set(x, y, z);
    m.isPickable = false;
    m.receiveShadows = true;
    meshes.push(m);
    if (cast) casters.push(m);
    return m;
  };

  const torso = make("ct", torsoBatch(skin, p), 0, 1.2, 0, true);
  const head = make("ch", headBatch(skin, p), 0, 1.62, 0, false);
  const legL = make("cl", legBatch(skin, p, -1), -0.11, 0.76, 0, true);
  const legR = make("cr", legBatch(skin, p, 1), 0.11, 0.76, 0, true);
  const armL = make("cal", armBatch(skin, p, -1), -0.29, 1.44, 0.06, false);
  const armR = make("car", armBatch(skin, p, 1), 0.29, 1.44, 0.06, false);

  // rifle francotirador (caja larga con visor)
  const r = new MeshBatch(1);
  box(r, 0, 0, 0, 0.06, 0.08, 1.0, GUN);
  r.addCylinder(0, 0.04, -0.05, 0.026, 0.026, 0.3, 8, GUN, true, true);
  const rifle = make("cg", r, 0.14, 1.12, 0.4, false);

  return { torso, head, legL, legR, armL, armR, rifle, meshes, casters };
}
