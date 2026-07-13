import * as THREE from "three";
import { applyMaterialLighting } from "./lighting.js";

const GLTF_PBR_MAP_KEYS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "emissiveMap",
  "alphaMap",
  "bumpMap",
];

const SRGB_MAP_KEYS = new Set(["map", "emissiveMap"]);
const LINEAR_MAP_KEYS = new Set([
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "alphaMap",
  "bumpMap",
]);

/** Remove baked lightmaps (and optional AO maps) from all MeshStandard materials. */
export function clearLightmapsFromScene(root, { clearAo = false } = {}) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m?.isMeshStandardMaterial) continue;
      if (m.lightMap) {
        m.lightMap = null;
        m.needsUpdate = true;
      }
      if (clearAo && m.aoMap) {
        m.aoMap = null;
        m.needsUpdate = true;
      }
    }
  });
}

function readLightMapIntensity(config) {
  const value = Number(config?.lightMapIntensity);
  return Number.isFinite(value) ? value : 1;
}

/** Built-in Three.js lightmap path: irradiance += lightMap × lightMapIntensity (indirect diffuse only). */
export function applyLightmapRenderSettings(material, config) {
  if (!material?.isMeshStandardMaterial || !config.enableLightMaps || !material.lightMap) return;
  material.lightMapIntensity = readLightMapIntensity(config);
}

/** Push CONFIG.lightMapIntensity to all materials under root (live tuning). */
export function refreshLightmapRenderSettings(root, config) {
  if (!root || !config?.enableLightMaps) return;
  const intensity = readLightMapIntensity(config);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m?.isMeshStandardMaterial || !m.lightMap) continue;
      m.lightMapIntensity = intensity;
    }
  });
}

function configureGltfPbrMapTexture(tex, key, anisotropy) {
  if (!tex) return tex;
  tex.channel = 0;
  if (SRGB_MAP_KEYS.has(key)) {
    tex.colorSpace = THREE.SRGBColorSpace;
  } else if (LINEAR_MAP_KEYS.has(key)) {
    tex.colorSpace = THREE.NoColorSpace;
  }
  if (anisotropy > 0) tex.anisotropy = anisotropy;
  return tex;
}

export function isColorOnlyMaterial(material) {
  if (!material?.isMeshStandardMaterial) return false;
  if (material.userData?.lightmap_color_only === true) return true;
  return !material.map;
}

export function applyBackfaceCulling(material, config) {
  if (config?.forceBackfaceCulling === false || !material || material.side === undefined) return;
  material.side = THREE.FrontSide;
}

export function finalizeGltfPbrMaterial(material, config, configureBakedMapTexture, mesh = null) {
  if (!material?.isMeshStandardMaterial) return;
  const aniso = Number(config.textureAnisotropy) || 0;
  for (const key of GLTF_PBR_MAP_KEYS) {
    configureGltfPbrMapTexture(material[key], key, aniso);
  }
  if (material.lightMap) configureBakedMapTexture(material.lightMap);
  if (material.aoMap) configureBakedMapTexture(material.aoMap);
  applyLightmapRenderSettings(material, config);
  applyMaterialLighting(material, config, mesh);
}

export function finalizeGltfPbrMaterials(root, config, configureBakedMapTexture) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      applyBackfaceCulling(m, config);
      finalizeGltfPbrMaterial(m, config, configureBakedMapTexture, o);
    }
  });
}

/**
 * Apply full AutoLightmapv2 bake set: albedo + normal (UV0), lightmap + AO (UV1).
 */
export function applyBakedMapsToMaterial(
  material,
  maps,
  config,
  configureBakedMapTexture,
  mesh = null
) {
  if (!material?.isMeshStandardMaterial) return material;

  const { lightMap, aoMap, normalMap, albedoMap } = maps;

  if (config.loadAlbedoMaps && albedoMap) {
    if (config.preferBakedAlbedo || !material.map) {
      material.map = albedoMap;
      material.color.setRGB(1, 1, 1);
    }
  }

  if (config.loadNormalMaps && normalMap) {
    if (config.preferBakedNormal || !material.normalMap) {
      material.normalMap = normalMap;
    }
  }

  if (config.enableLightMaps && lightMap) {
    material.lightMap = configureBakedMapTexture(lightMap);
  }

  if (config.loadAoMaps && aoMap) {
    material.aoMap = configureBakedMapTexture(aoMap);
    material.aoMapIntensity = config.aoMapIntensity;
  }

  preserveAuthoredPbrSurface(material);

  finalizeGltfPbrMaterial(material, config, configureBakedMapTexture, mesh);
  return material;
}

/** Keep glTF normal/roughness/metal — do not flatten to matte defaults. */
export function preserveAuthoredPbrSurface(material) {
  if (!material?.isMeshStandardMaterial) return;
  material.roughness = THREE.MathUtils.clamp(Number(material.roughness) || 0.5, 0.04, 1);
  material.metalness = THREE.MathUtils.clamp(Number(material.metalness) || 0, 0, 1);
}

/** @deprecated use applyBakedMapsToMaterial */
export function applyLightmapToMaterial(material, lightMap, aoMap, config, configureBakedMapTexture) {
  return applyBakedMapsToMaterial(
    material,
    { lightMap, aoMap, normalMap: null, albedoMap: null },
    config,
    configureBakedMapTexture
  );
}
