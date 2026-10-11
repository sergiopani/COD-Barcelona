import { ImportMeshAsync, Mesh, Quaternion, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import { assetUrl } from "../assets";
import { glbExists } from "./assetUtil";
import type { LightingRig } from "./Lighting";

/**
 * Helicópteros de policía que sobrevuelan la ciudad (decorativos: sin colisión ni daño).
 * El modelo (public/assets/props/police-helicopter.glb, 13 k triángulos) se carga una vez y se clona por helicóptero.
 * Cada uno sigue una trayectoria paramétrica en función del reloj de pared (Date.now), así que en multijugador todos
 * los clientes ven los helicópteros casi en el mismo sitio sin enviar nada por la red. Rotor principal girando,
 * alabeo en las curvas y un ligero cabeceo.
 */
const URL = assetUrl("assets/props/police-helicopter.glb");
const LENGTH_M = 13; // longitud real aproximada de un helicóptero ligero de policía

interface Route {
  /** Centro de la trayectoria en planta. */
  cx: number;
  cz: number;
  /** Semiejes (m). */
  rx: number;
  rz: number;
  /** Velocidad angular (rad/s); el signo da el sentido. */
  w: number;
  phase: number;
  /** "orbit" = elipse; "eight" = ocho (Lissajous 1:2). */
  kind: "orbit" | "eight";
  alt: number;
  /** Oscilación vertical suave. */
  bob: number;
}

const ROUTES: Route[] = [
  { cx: 0, cz: 0, rx: 150, rz: 115, w: 0.13, phase: 0.0, kind: "orbit", alt: 88, bob: 3 },
  { cx: 10, cz: -5, rx: 215, rz: 175, w: -0.095, phase: 2.1, kind: "orbit", alt: 125, bob: 4 },
  { cx: 0, cz: 0, rx: 175, rz: 95, w: 0.1, phase: 4.0, kind: "eight", alt: 108, bob: 3 },
  { cx: 0, cz: 0, rx: 85, rz: 85, w: -0.2, phase: 1.0, kind: "orbit", alt: 152, bob: 2 },
];

interface Heli {
  node: TransformNode;
  pivot: TransformNode;
  meshes: Mesh[];
  route: Route;
  spin: number;
  enabled: boolean;
}

export interface HeliSet {
  /** Cuántos helicópteros se dibujan (según el perfil gráfico). */
  setCount(n: number): void;
  update(dt: number, camera: Vector3): void;
  /** Distancia al helicóptero más cercano y su dirección horizontal relativa a la cámara (para el sonido). */
  nearest(camera: Vector3, right: Vector3): { dist: number; pan: number } | null;
  dispose(): void;
}

function position(r: Route, t: number): { x: number; y: number; z: number } {
  const a = r.w * t + r.phase;
  if (r.kind === "orbit") return { x: r.cx + r.rx * Math.cos(a), y: r.alt + r.bob * Math.sin(a * 2.3), z: r.cz + r.rz * Math.sin(a) };
  return { x: r.cx + r.rx * Math.sin(a), y: r.alt + r.bob * Math.sin(a * 2.3), z: r.cz + r.rz * Math.sin(2 * a) };
}

export async function loadHelicopters(scene: Scene, lighting: LightingRig, count: number): Promise<HeliSet | null> {
  if (!(await glbExists(URL))) {
    console.warn(`[Helicópteros] No se encontró ${URL}: no habrá helicópteros.`);
    return null;
  }
  try {
    const result = await ImportMeshAsync(URL, scene);
    const template = new TransformNode("heliTemplate", scene);
    for (const n of result.meshes.filter((m) => !m.parent)) n.parent = template;
    template.computeWorldMatrix(true);
    const all = result.meshes.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    const rotorM = all.find((m) => /rotor/i.test(m.name));
    const bodyM = all.find((m) => /body/i.test(m.name) && !/rotor/i.test(m.name));
    const tailM = all.find((m) => /tail/i.test(m.name));
    if (!rotorM || !bodyM) throw new Error("el GLB no tiene las piezas rotor/cuerpo esperadas");

    const centre = (m: Mesh): Vector3 => {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      return Vector3.Center(bb.minimumWorld, bb.maximumWorld);
    };
    // dirección "hacia delante" = de la cola al cuerpo (en planta)
    const fwd = tailM ? centre(bodyM).subtract(centre(tailM)) : new Vector3(0, 0, 1);
    fwd.y = 0;
    const noseYaw = Math.atan2(fwd.x, fwd.z);
    const b = template.getHierarchyBoundingVectors(true);
    const scale = LENGTH_M / Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 0.001);
    const rotorCentre = centre(rotorM);
    const groundY = b.min.y;
    template.setEnabled(false);

    const helis: Heli[] = [];
    const n = Math.min(ROUTES.length, Math.max(1, count));
    for (let i = 0; i < ROUTES.length; i++) {
      const node = new TransformNode(`heli${i}`, scene);
      node.rotationQuaternion = Quaternion.Identity();
      const body = template.clone(`heliBody${i}`, node, false)!;
      body.setEnabled(true);
      body.rotation.y = -noseYaw; // el morro del modelo queda hacia +Z local
      body.scaling.setAll(scale);
      // el eje del rotor queda en el origen del nodo (se tiene en cuenta el giro del cuerpo)
      const th = -noseYaw, c = Math.cos(th), s = Math.sin(th);
      body.position.set(-(rotorCentre.x * c + rotorCentre.z * s) * scale, -groundY * scale, -(-rotorCentre.x * s + rotorCentre.z * c) * scale);
      node.computeWorldMatrix(true);
      const meshes = body.getChildMeshes().filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
      const rotor = meshes.find((m) => /rotor/i.test(m.name));
      // pivote del rotor: se recoloca sobre su centro y se hace girar alrededor de la vertical del helicóptero
      const pivot = new TransformNode(`heliRotor${i}`, scene);
      pivot.parent = node;
      if (rotor) {
        rotor.computeWorldMatrix(true);
        const bb = rotor.getBoundingInfo().boundingBox;
        const c = Vector3.Center(bb.minimumWorld, bb.maximumWorld);
        pivot.position = Vector3.TransformCoordinates(c, node.getWorldMatrix().clone().invert());
        pivot.computeWorldMatrix(true);
        rotor.setParent(pivot);
      }
      for (const m of meshes) {
        m.isPickable = false;
        m.receiveShadows = false;
        m.alwaysSelectAsActiveMesh = true; // se mueve mucho y es pequeño: evita el coste/saltos del frustum culling
        if (m !== rotor) lighting.addShadowCaster(m, "detail");
      }
      node.setEnabled(i < n);
      helis.push({ node, pivot, meshes, route: ROUTES[i], spin: Math.random() * 6, enabled: i < n });
    }
    console.info(`[Helicópteros] ${n} activos (${all.length} piezas, ${Math.round(all.reduce((a, m) => a + m.getTotalIndices() / 3, 0)).toLocaleString()} triángulos por unidad, escala ×${scale.toFixed(2)}).`);

    return {
      setCount(k) {
        helis.forEach((h, i) => {
          h.enabled = i < k;
          h.node.setEnabled(h.enabled);
        });
      },
      update(dt) {
        const t = Date.now() / 1000;
        for (const h of helis) {
          if (!h.enabled) continue;
          const p = position(h.route, t);
          const q = position(h.route, t + 0.25);
          const dx = q.x - p.x, dz = q.z - p.z;
          const yaw = Math.atan2(dx, dz);
          // alabeo hacia el interior de la curva (según el giro del rumbo) y cabeceo con la velocidad
          const q2 = position(h.route, t + 0.75);
          const yaw2 = Math.atan2(q2.x - q.x, q2.z - q.z);
          let dyaw = yaw2 - yaw;
          while (dyaw > Math.PI) dyaw -= Math.PI * 2;
          while (dyaw < -Math.PI) dyaw += Math.PI * 2;
          const roll = Math.max(-0.4, Math.min(0.4, dyaw * 3.2));
          const pitch = 0.09 + 0.02 * Math.sin(t * 0.7 + h.route.phase);
          h.node.position.set(p.x, p.y, p.z);
          h.node.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, pitch, roll);
          h.spin += dt * 38; // rotor principal ≈ 6 vueltas/s
          h.pivot.rotation.y = h.spin;
        }
      },
      nearest(camera, right) {
        let best: { dist: number; pan: number } | null = null;
        for (const h of helis) {
          if (!h.enabled) continue;
          const d = h.node.position.subtract(camera);
          const dist = d.length();
          if (!best || dist < best.dist) best = { dist, pan: dist > 0.1 ? Math.max(-1, Math.min(1, Vector3.Dot(d, right) / Math.hypot(d.x, d.z, 1))) : 0 };
        }
        return best;
      },
      dispose() {
        for (const h of helis) h.node.dispose(false, true);
        template.dispose(false, true);
      },
    };
  } catch (e) {
    console.error("[Helicópteros] No se pudieron cargar:", e);
    return null;
  }
}
