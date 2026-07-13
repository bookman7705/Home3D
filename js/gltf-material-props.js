/**
 * Blender glTF material extras → Three.js MeshStandardMaterial overrides.
 *
 * Blender custom properties exported on materials land in material.userData via
 * GLTFLoader (glTF material.extras). Mesh/node extras can override per instance.
 */

/** @typedef {{ gltfKey: string, materialKey: string, configKey: string, defaultValue?: number }} GltfMaterialFloatBinding */

/** Float bindings: glTF extras key → Three.js material property + CONFIG fallback. */
export const GLTF_MATERIAL_FLOAT_BINDINGS = [
  {
    gltfKey: "threejs_envMapIntensity",
    materialKey: "envMapIntensity",
    configKey: "iblEnvMapIntensity",
    defaultValue: 1,
  },
];

/**
 * Parse a Blender-exported numeric custom property.
 * @returns {number | undefined}
 */
export function parseGltfCustomFloat(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Read a custom property from mesh then material userData (mesh wins).
 */
export function readGltfCustomProp(mesh, material, key) {
  if (mesh?.userData && key in mesh.userData) {
    return mesh.userData[key];
  }
  if (material?.userData && key in material.userData) {
    return material.userData[key];
  }
  return undefined;
}

/**
 * Resolve a float override: mesh extras → material extras → CONFIG → default.
 */
export function resolveGltfBoundFloat(mesh, material, config, binding) {
  const raw = readGltfCustomProp(mesh, material, binding.gltfKey);
  const fromGltf = parseGltfCustomFloat(raw);
  if (fromGltf !== undefined) return fromGltf;

  const fromConfig = parseGltfCustomFloat(config?.[binding.configKey]);
  if (fromConfig !== undefined) return fromConfig;

  return binding.defaultValue ?? 0;
}

/** Resolve env map intensity for one material (iblEnvMapIntensity / envMapIntensity). */
export function resolveEnvMapIntensity(mesh, material, config) {
  const binding = GLTF_MATERIAL_FLOAT_BINDINGS.find(
    (b) => b.materialKey === "envMapIntensity"
  );
  return resolveGltfBoundFloat(mesh, material, config, binding);
}

/**
 * Apply all registered glTF material custom properties onto a MeshStandardMaterial.
 * @returns {string[]} applied glTF keys
 */
export function applyGltfMaterialCustomProps(mesh, material, config) {
  if (!material?.isMeshStandardMaterial) return [];

  const applied = [];

  for (const binding of GLTF_MATERIAL_FLOAT_BINDINGS) {
    const raw = readGltfCustomProp(mesh, material, binding.gltfKey);
    const parsed = parseGltfCustomFloat(raw);
    if (parsed === undefined) continue;

    material[binding.materialKey] = parsed;
    applied.push(binding.gltfKey);
  }

  if (applied.length) {
    material.needsUpdate = true;
  }

  return applied;
}

/**
 * Walk a loaded glTF scene and apply per-material custom property overrides.
 * @returns {{ materials: number, overrides: number }}
 */
export function applyGltfMaterialCustomPropsToScene(root, config) {
  const stats = { materials: 0, overrides: 0 };
  const seen = new Set();

  if (!root) return stats;

  root.traverse((o) => {
    if (!o.isMesh) return;

    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const material of mats) {
      if (!material || seen.has(material)) continue;
      seen.add(material);
      stats.materials += 1;

      const keys = applyGltfMaterialCustomProps(o, material, config);
      if (keys.length) stats.overrides += 1;
    }
  });

  if (stats.overrides) {
    console.info(
      "[GltfMaterialProps]",
      `${stats.overrides}/${stats.materials} material(s) using glTF custom overrides`
    );
  }

  return stats;
}
