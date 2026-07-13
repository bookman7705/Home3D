/**
 * TEMPORARY debug point light for testing realtime lighting.
 * Movement / orb / HUD live in debug/light-debug.js.
 */
import * as THREE from "three";
import { LIGHT_DEBUG_DEFAULTS } from "./debug/light-debug.js";

export const DEBUG_POINT_LIGHT_DEFAULTS = {
  ...LIGHT_DEBUG_DEFAULTS,
  /** Master switch — set false to disable without removing imports. */
  enableDebugPointLight: false,
  /** World-space start position [x, y, z] (scaled by worldScale). */
  debugPointLightPosition: [0, 2, 0],
  debugPointLightBrightness: 7,
  /** PointLight distance (falloff radius). 0 = no cutoff. */
  debugPointLightRadius: 0,
  /** Hex color or CSS string. */
  debugPointLightColor: 0xffffff,
};

/**
 * Creates the debug PointLight only (no movement HUD).
 * @returns {{ light: THREE.PointLight | null, dispose: () => void }}
 */
export function createDebugPointLight({ scene, config, worldScale }) {
  const S = Math.max(0.0001, Number(worldScale) || 1);
  const cfg = { ...DEBUG_POINT_LIGHT_DEFAULTS, ...config };

  const noop = { light: null, dispose: () => {} };
  if (!cfg.enableDebugPointLight) return noop;

  const lightRadius = Math.max(0, Number(cfg.debugPointLightRadius) || 0) * S;
  const brightness = Math.max(0, Number(cfg.debugPointLightBrightness) || 0);

  const startPos = cfg.debugPointLightPosition;
  const px = (Array.isArray(startPos) ? startPos[0] : 0) * S;
  const py = (Array.isArray(startPos) ? startPos[1] : 2) * S;
  const pz = (Array.isArray(startPos) ? startPos[2] : 0) * S;

  const lightColor = new THREE.Color(cfg.debugPointLightColor);

  const light = new THREE.PointLight(lightColor, brightness, lightRadius, 2);
  light.name = "DebugPointLight";
  light.castShadow = cfg.enableRealtimeShadows === true;
  if (light.castShadow) {
    const mapSize = Math.max(256, Number(cfg.pointLightShadowMapSize) || 1024);
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.bias = Number(cfg.pointLightShadowBias) || -0.001;
    light.shadow.normalBias = Number(cfg.pointLightShadowNormalBias) || 0.02;
    light.shadow.camera.near = 0.05;
    light.shadow.camera.far = Math.max(1, Number(cfg.pointLightShadowFar) || 25);
  }
  light.position.set(px, py, pz);
  scene.add(light);

  function dispose() {
    scene.remove(light);
  }

  console.info(
    "[DebugPointLight] Created at",
    [px, py, pz].map((n) => +n.toFixed(3)),
    "— use LightDebug HUD to move / cycle lights."
  );

  return { light, dispose };
}
