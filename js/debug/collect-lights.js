import * as THREE from "three";

const SKIP_TYPES = new Set(["AmbientLight", "HemisphereLight", "LightProbe"]);

/**
 * Collect spatial realtime lights under a root (skips ambient / hemi / probes).
 * @param {THREE.Object3D} root
 * @returns {THREE.Light[]}
 */
export function collectRealtimeLights(root) {
  const lights = [];
  if (!root) return lights;

  root.traverse((obj) => {
    if (!obj.isLight) return;
    if (SKIP_TYPES.has(obj.type)) return;
    if (obj.userData?.excludeFromLightDebug === true) return;
    lights.push(obj);
  });

  return lights;
}

/** Human-readable light type label. */
export function getLightTypeLabel(light) {
  if (!light) return "(none)";
  if (light.isPointLight) return "PointLight";
  if (light.isDirectionalLight) return "DirectionalLight";
  if (light.isSpotLight) return "SpotLight";
  if (light.isRectAreaLight) return "RectAreaLight";
  if (light.isAmbientLight) return "AmbientLight";
  if (light.isHemisphereLight) return "HemisphereLight";
  return light.type || "Light";
}

export function getLightDisplayName(light) {
  if (!light) return "(none)";
  const name = String(light.name ?? "").trim();
  return name || "(unnamed)";
}
