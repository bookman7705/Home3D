import * as THREE from "three";
import { createStaticCollider } from "./physics.js";

const COL_PREFIX = "COL_";

/**
 * Builds a Rapier trimesh from a Three.js mesh, baking world transforms
 * into the vertex buffer so the collider matches the authored geometry.
 */
function createTrimeshFromMesh(RAPIER, world, mesh) {
  mesh.updateWorldMatrix(true, false);

  const geometry = mesh.geometry.index
    ? mesh.geometry.clone()
    : mesh.geometry.clone().toNonIndexed();

  geometry.applyMatrix4(mesh.matrixWorld);

  const position = geometry.getAttribute("position");
  if (!position) {
    geometry.dispose();
    return null;
  }

  const vertices = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    vertices[i * 3] = position.getX(i);
    vertices[i * 3 + 1] = position.getY(i);
    vertices[i * 3 + 2] = position.getZ(i);
  }

  let indices;
  if (geometry.index) {
    indices = new Uint32Array(geometry.index.array);
  } else {
    indices = new Uint32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      indices[i] = i;
    }
  }

  const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
  if (!colliderDesc) {
    console.warn(
      "[collision] Failed to create trimesh for mesh:",
      mesh.name || "(unnamed)"
    );
    geometry.dispose();
    return null;
  }

  // Vertices are already in world space.
  const { body, collider } = createStaticCollider(RAPIER, world, colliderDesc, {
    x: 0,
    y: 0,
    z: 0,
  });

  return {
    body,
    collider,
    debugGeo: geometry,
    name: mesh.name || "(unnamed)",
    vertexCount: position.count,
    indexCount: indices.length,
  };
}

function isCollisionMesh(obj) {
  if (!obj?.isMesh || !obj.geometry) return false;
  const name = String(obj.name ?? "").trim();
  return name.startsWith(COL_PREFIX);
}

/**
 * Finds COL_* meshes in a loaded GLB scene graph, builds fixed trimesh
 * colliders, then removes those meshes from rendering (same role as a
 * separate COL_Stage.glb — invisible, collision-only).
 *
 * Call after the visual root is parented and scaled so world matrices match.
 */
export function createCollisionFromColMeshes(RAPIER, world, scene, root) {
  const debugHelpers = [];
  const collisionBodies = [];
  const colMeshes = [];

  if (!root) {
    return {
      colliderCount: 0,
      setDebugVisible() {},
      dispose() {},
    };
  }

  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if (isCollisionMesh(child)) colMeshes.push(child);
  });

  for (const mesh of colMeshes) {
    const result = createTrimeshFromMesh(RAPIER, world, mesh);
    if (!result) continue;

    collisionBodies.push(result);

    const edges = new THREE.EdgesGeometry(result.debugGeo);
    const wire = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x66ffcc })
    );
    wire.visible = false;
    scene.add(wire);
    debugHelpers.push({ helper: wire, geometry: result.debugGeo, edges });

    // Never render collision volumes — detach after baking world verts.
    mesh.visible = false;
    if (mesh.parent) {
      mesh.parent.remove(mesh);
    }
  }

  const colliderCount = collisionBodies.length;
  if (colliderCount === 0) {
    console.warn(
      `[collision] No meshes named "${COL_PREFIX}*" found for colliders.`
    );
  } else {
    console.log(
      `[collision] Created ${colliderCount} trimesh collider(s) from ${COL_PREFIX}* meshes:`,
      collisionBodies.map((b) => b.name)
    );
  }

  function setDebugVisible(visible) {
    for (const entry of debugHelpers) {
      entry.helper.visible = visible;
    }
  }

  function dispose() {
    for (const entry of debugHelpers) {
      scene.remove(entry.helper);
      entry.helper.geometry?.dispose();
      entry.helper.material?.dispose();
      entry.edges?.dispose();
      entry.geometry?.dispose();
    }

    for (const entry of collisionBodies) {
      if (entry.body) world.removeRigidBody(entry.body);
    }

    debugHelpers.length = 0;
    collisionBodies.length = 0;
  }

  return {
    colliderCount,
    setDebugVisible,
    dispose,
  };
}
