/**
 * Preserve glTF material/mesh identity on Three.js objects.
 *
 * GLTFLoader stores parser.associations (WeakMap) from objects → { materials, meshes, primitives }.
 * Material.clone() copies userData via JSON, so stamping indices here survives lightmap clones.
 * Associations themselves are NOT copied onto clones.
 */

function materialDefName(json, index) {
  const def = json?.materials?.[index];
  const name = String(def?.name ?? "").trim();
  return name || `Material_${index}`;
}

/**
 * Stamp glTF indices/names onto loaded materials and meshes.
 * @param {import("three/addons/loaders/GLTFLoader.js").GLTF} gltf
 * @returns {{
 *   authoredMaterials: number,
 *   gltfMeshes: number,
 *   gltfPrimitives: number,
 *   materialDefs: { index: number, name: string }[],
 * }}
 */
export function stampGltfIdentity(gltf) {
  const parser = gltf?.parser;
  const json = parser?.json || {};
  const materials = Array.isArray(json.materials) ? json.materials : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const materialDefs = materials.map((m, index) => ({
    index,
    name: String(m?.name ?? "").trim() || `Material_${index}`,
  }));
  const gltfPrimitives = meshes.reduce(
    (n, mesh) => n + ((mesh.primitives || []).length || 0),
    0
  );

  const associations = parser?.associations;
  if (associations && typeof associations.forEach === "function") {
    associations.forEach((ref, obj) => {
      if (!ref || !obj) return;
      if (obj.isMaterial && ref.materials != null) {
        const index = Number(ref.materials);
        obj.userData.gltfMaterialIndex = index;
        obj.userData.gltfMaterialName = materialDefName(json, index);
        obj.userData.gltfAuthored = true;
      }
      if ((obj.isMesh || obj.isSkinnedMesh) && ref.meshes != null) {
        obj.userData.gltfMeshIndex = Number(ref.meshes);
        obj.userData.gltfPrimitiveIndex =
          ref.primitives != null ? Number(ref.primitives) : 0;
      }
      if (obj.isGroup && ref.meshes != null && ref.primitives == null) {
        obj.userData.gltfMeshIndex = Number(ref.meshes);
      }
    });
  }

  const root = gltf?.scene;
  if (root) {
    root.userData.gltfRoot = true;
    root.traverse((obj) => {
      if (!obj.isMesh && !obj.isSkinnedMesh) return;
      if (obj.userData.gltfMeshIndex == null) {
        const assoc = associations?.get?.(obj);
        if (assoc?.meshes != null) {
          obj.userData.gltfMeshIndex = Number(assoc.meshes);
          obj.userData.gltfPrimitiveIndex =
            assoc.primitives != null ? Number(assoc.primitives) : 0;
        }
      }
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (mat.userData.gltfMaterialIndex != null) continue;
        const assoc = associations?.get?.(mat);
        if (assoc?.materials != null) {
          const index = Number(assoc.materials);
          mat.userData.gltfMaterialIndex = index;
          mat.userData.gltfMaterialName = materialDefName(json, index);
          mat.userData.gltfAuthored = true;
        }
      }
    });
  }

  return {
    authoredMaterials: materials.length,
    gltfMeshes: meshes.length,
    gltfPrimitives,
    materialDefs,
  };
}

/** Authored glTF identity key — never material.uuid. */
export function authoredMaterialKey(material) {
  if (!material) return "unknown";
  if (material.userData?.gltfMaterialIndex != null) {
    return `idx:${material.userData.gltfMaterialIndex}`;
  }
  const named = String(material.userData?.gltfMaterialName || material.name || "").trim();
  if (named) return `name:${named}`;
  return `untracked:${material.type || "Material"}`;
}

export function authoredMaterialName(material, fallbackIndex = null) {
  const fromUser =
    String(material?.userData?.gltfMaterialName || "").trim() ||
    String(material?.name || "").trim();
  if (fromUser) return fromUser;
  if (material?.userData?.gltfMaterialIndex != null) {
    return `Material_${material.userData.gltfMaterialIndex}`;
  }
  if (fallbackIndex != null) return `Material_${fallbackIndex}`;
  return "(unnamed)";
}

export function markLightmapMaterialClone(clone, source) {
  if (!clone || !source) return clone;
  if (clone.userData.gltfMaterialIndex == null && source.userData?.gltfMaterialIndex != null) {
    clone.userData.gltfMaterialIndex = source.userData.gltfMaterialIndex;
  }
  if (!clone.userData.gltfMaterialName) {
    clone.userData.gltfMaterialName =
      source.userData?.gltfMaterialName || source.name || "";
  }
  clone.userData.lightmapClone = true;
  clone.userData.lightmapCloneOf =
    source.userData?.lightmapCloneOf || source.uuid;
  return clone;
}
