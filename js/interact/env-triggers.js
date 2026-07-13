import * as THREE from "three";
import { createStaticCollider } from "../physics/physics.js";

export const ENV_PREFIX = "ENV_";

/**
 * Strip Blender numeric suffixes: "ENV_LightSwitch.001" → "ENV_LightSwitch"
 * @param {string} name
 */
export function normalizeEnvName(name) {
  return String(name ?? "")
    .trim()
    .replace(/\.\d+$/, "");
}

/**
 * Type key used by handlers: "ENV_LightSwitch" → "LightSwitch"
 * @param {string} name
 */
export function envTypeFromName(name) {
  const normalized = normalizeEnvName(name);
  if (!normalized.startsWith(ENV_PREFIX)) return normalized;
  return normalized.slice(ENV_PREFIX.length);
}

function isEnvMesh(obj) {
  if (!obj?.isMesh || !obj.geometry) return false;
  return normalizeEnvName(obj.name).startsWith(ENV_PREFIX);
}

/**
 * Build an axis-aligned cuboid sensor from a mesh's world AABB.
 * Sensors never block the character controller (EXCLUDE_SENSORS).
 * When Rapier is unavailable, returns a Box3-only trigger.
 */
function createTriggerFromMesh(RAPIER, world, mesh) {
  mesh.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(mesh);
  if (box.isEmpty()) return null;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const hx = Math.max(0.01, size.x * 0.5);
  const hy = Math.max(0.01, size.y * 0.5);
  const hz = Math.max(0.01, size.z * 0.5);

  const base = {
    body: null,
    collider: null,
    box: box.clone(),
    center: center.clone(),
    halfExtents: new THREE.Vector3(hx, hy, hz),
    name: normalizeEnvName(mesh.name),
    type: envTypeFromName(mesh.name),
    sourceName: mesh.name,
  };

  if (!RAPIER || !world) return base;

  const colliderDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setSensor(true)
    .setActiveCollisionTypes(
      RAPIER.ActiveCollisionTypes.DEFAULT |
        RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED
    );

  const { body, collider } = createStaticCollider(RAPIER, world, colliderDesc, {
    x: center.x,
    y: center.y,
    z: center.z,
  });

  base.body = body;
  base.collider = collider;
  return base;
}

/**
 * Collect ENV_* meshes from a GLB, bake Rapier sensor cuboids, then remove
 * the meshes from the render graph (invisible trigger volumes only).
 *
 * @returns {{ triggers: object[], setDebugVisible: Function, dispose: Function, getByColliderHandle: Function }}
 */
export function createEnvTriggers(RAPIER, world, scene, root) {
  const triggers = [];
  const debugHelpers = [];
  /** @type {Map<number, object>} */
  const byHandle = new Map();

  if (!root) {
    return {
      triggers,
      setDebugVisible() {},
      dispose() {},
      getByColliderHandle() {
        return null;
      },
    };
  }

  root.updateMatrixWorld(true);

  const envMeshes = [];
  root.traverse((child) => {
    if (isEnvMesh(child)) envMeshes.push(child);
  });

  for (const mesh of envMeshes) {
    const result = createTriggerFromMesh(RAPIER, world, mesh);
    if (!result) {
      console.warn("[interact] Failed sensor for", mesh.name);
      continue;
    }

    triggers.push(result);
    if (result.collider) byHandle.set(result.collider.handle, result);

    const helperGeo = new THREE.BoxGeometry(
      result.halfExtents.x * 2,
      result.halfExtents.y * 2,
      result.halfExtents.z * 2
    );
    const helper = new THREE.LineSegments(
      new THREE.EdgesGeometry(helperGeo),
      new THREE.LineBasicMaterial({ color: 0xffcc66 })
    );
    helper.position.copy(result.center);
    helper.visible = false;
    scene.add(helper);
    debugHelpers.push({ helper, helperGeo });

    // Never render ENV volumes — detach after baking the sensor.
    mesh.visible = false;
    mesh.layers.disableAll();
    if (mesh.parent) mesh.parent.remove(mesh);
  }

  if (triggers.length === 0) {
    console.warn(`[interact] No meshes named "${ENV_PREFIX}*" found.`);
  } else {
    console.info(
      `[interact] Created ${triggers.length} ENV sensor(s):`,
      triggers.map((t) => t.name)
    );
  }

  function setDebugVisible(visible) {
    for (const entry of debugHelpers) {
      entry.helper.visible = visible;
    }
  }

  function getByColliderHandle(handle) {
    return byHandle.get(handle) ?? null;
  }

  function dispose() {
    for (const entry of debugHelpers) {
      scene.remove(entry.helper);
      entry.helper.geometry?.dispose();
      entry.helper.material?.dispose();
      entry.helperGeo?.dispose();
    }
    for (const t of triggers) {
      if (t.body && world) world.removeRigidBody(t.body);
    }
    triggers.length = 0;
    byHandle.clear();
    debugHelpers.length = 0;
  }

  return {
    triggers,
    setDebugVisible,
    dispose,
    getByColliderHandle,
  };
}
