import { Color3, Mesh, PBRMaterial, Scene, TransformNode } from "@babylonjs/core";
import { F, Frame, MeshBatch, type RGBA } from "../world/MeshBatch";

/**
 * Aspecto de TODOS los personajes del juego (bots y jugadores remotos): el «amigo» con chándal azul marino, camiseta roja con
 * franja central, gorra de cuadros marrón, barba corta, pantalón con franjas laterales rojas y blancas, calcetines blancos y
 * chancletas negras. Es una figura de bloques estilizada (no un parecido facial): cada miembro es UNA malla con colores por vértice
 * (un solo material), así que cuesta lo mismo que el maniquí anterior. Dimensiones, pivotes y zonas de impacto no cambian.
 */
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

const NAVY: RGBA = [0.035, 0.055, 0.15, 1];
const NAVY2: RGBA = [0.05, 0.075, 0.19, 1];
const RED: RGBA = [0.62, 0.04, 0.07, 1];
const WHITE: RGBA = [0.9, 0.9, 0.9, 1];
const SKIN: RGBA = [0.62, 0.45, 0.36, 1];
const HAIR: RGBA = [0.045, 0.03, 0.025, 1];
const CAP: RGBA = [0.24, 0.16, 0.09, 1];
const CAP_DARK: RGBA = [0.13, 0.09, 0.055, 1];
const SLIDE: RGBA = [0.025, 0.025, 0.028, 1];
const GUN: RGBA = [0.04, 0.04, 0.05, 1];

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
const box = (b: MeshBatch, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: RGBA, skip = 0): void => b.addBox(FR, -x, y, z, sx, sy, sz, c, skip);

export function buildCharacter(scene: Scene, id: number, parent: TransformNode): CharacterParts {
  const mat = material(scene);
  const meshes: Mesh[] = [];
  const make = (name: string, b: MeshBatch, x: number, y: number, z: number, cast: boolean, casters: Mesh[]): Mesh => {
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
  const casters: Mesh[] = [];

  // ---- torso + cadera: chaqueta azul marino abierta sobre camiseta roja con franja azul central y logotipos blancos
  const t = new MeshBatch(1);
  box(t, 0, 0.0, 0, 0.46, 0.62, 0.25, NAVY);                   // chaqueta (origen del malla = centro del torso, y = 1,2)
  box(t, 0, 0.0, 0.127, 0.19, 0.6, 0.01, RED, F.BACK);        // camiseta roja entre las solapas
  box(t, 0, 0.0, 0.133, 0.05, 0.6, 0.01, NAVY2, F.BACK);      // franja central azul
  box(t, 0, 0.1, 0.139, 0.075, 0.03, 0.008, WHITE, F.BACK);   // «swoosh» blanco
  box(t, -0.15, 0.17, 0.129, 0.045, 0.045, 0.008, WHITE, F.BACK); // logotipo de la chaqueta
  box(t, 0, 0.3, 0.0, 0.2, 0.05, 0.27, NAVY2, F.DOWN);        // cuello de la chaqueta
  box(t, 0, -0.42, 0, 0.4, 0.22, 0.22, NAVY);                  // cadera (pantalón)
  const torso = make("ct", t, 0, 1.2, 0, true, casters);

  // ---- cabeza: piel, pelo, gorra de cuadros con visera y barba
  const h = new MeshBatch(1);
  h.addEllipsoid(0, 0, 0, 0.15, 0.15, 0.15, 10, 8, SKIN);
  h.addEllipsoid(0, 0.045, -0.005, 0.158, 0.125, 0.162, 10, 6, CAP);       // gorra
  h.addEllipsoid(0, 0.02, -0.03, 0.162, 0.05, 0.158, 10, 4, CAP_DARK);      // banda de la gorra
  box(h, 0, 0.035, 0.205, 0.25, 0.025, 0.15, CAP_DARK);                     // visera
  h.addEllipsoid(0, -0.075, 0.025, 0.14, 0.095, 0.125, 10, 5, HAIR);        // barba
  h.addEllipsoid(0, -0.03, -0.065, 0.14, 0.1, 0.1, 10, 5, HAIR);            // pelo de la nuca
  const head = make("ch", h, 0, 1.62, 0, false, casters);

  // ---- piernas (origen en la cadera): pantalón con franjas laterales, calcetín blanco y chancleta
  const mkLeg = (side: number): Mesh => {
    const l = new MeshBatch(1);
    box(l, 0, -0.29, 0, 0.17, 0.58, 0.2, NAVY);
    box(l, side * 0.0875, -0.29, 0, 0.012, 0.56, 0.205, RED);
    box(l, side * 0.0875, -0.29, 0.1, 0.014, 0.56, 0.02, WHITE);
    box(l, 0, -0.65, 0, 0.14, 0.14, 0.17, WHITE);        // calcetín
    box(l, 0, -0.735, 0.05, 0.15, 0.055, 0.3, SLIDE);     // chancleta
    box(l, 0, -0.705, 0.12, 0.13, 0.02, 0.06, SLIDE);     // correa
    return make(side < 0 ? "cl" : "cr", l, side * 0.11, 0.76, 0, true, casters);
  };
  const legL = mkLeg(-1), legR = mkLeg(1);

  // ---- brazos (origen en el hombro): manga azul marino con puño y mano
  const mkArm = (side: number): Mesh => {
    const a = new MeshBatch(1);
    box(a, 0, -0.22, 0, 0.12, 0.45, 0.14, NAVY);
    box(a, 0, -0.44, 0, 0.125, 0.04, 0.145, NAVY2);
    box(a, 0, -0.5, 0.01, 0.09, 0.1, 0.1, SKIN);
    return make(side < 0 ? "cal" : "car", a, side * 0.29, 1.44, 0.06, false, casters);
  };
  const armL = mkArm(-1), armR = mkArm(1);

  // ---- rifle francotirador (caja larga con visor)
  const r = new MeshBatch(1);
  box(r, 0, 0, 0, 0.06, 0.08, 1.0, GUN);
  r.addCylinder(0, 0.04, -0.05, 0.026, 0.026, 0.3, 8, GUN, true, true);
  const rifle = make("cg", r, 0.14, 1.12, 0.4, false, casters);

  return { torso, head, legL, legR, armL, armR, rifle, meshes, casters };
}
