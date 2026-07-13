/**
 * Blender area-light → Three.js RectAreaLight (glTF Y-up convention).
 *
 * Blender area lights emit along local -Z; RectAreaLight matches that.
 * RectAreaLight does not cast shadows in WebGLRenderer (matches Blender Shadows: Off).
 */
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";

/** glTF / Blender-exporter basis: Blender Z-up → Three.js Y-up. */
const _Q_BLENDER_TO_THREE = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0, "XYZ")
);

/** Blender area-light warm yellow (#FFED70). */
export const BLENDER_RECT_LIGHT_YELLOW = 0xffed70;

export const BLENDER_RECT_LIGHT_DEFAULTS = {
  enableBlenderRectAreaLight: true,
  /** Blender world position [x, y, z] (Z-up). */
  blenderRectLightPosition: [2.5, 18, 3],
  /** Blender Euler rotation (degrees). */
  blenderRectLightRotationDeg: [-57.2, 0, 0],
  blenderRectLightEulerOrder: "XYZ",
  /** Blender #FFED70 warm yellow (sRGB hex or 0xRRGGBB). */
  blenderRectLightColor: BLENDER_RECT_LIGHT_YELLOW,
  /**
   * Blender Power (W). Mapped to Three.js luminous power (lm) via RectAreaLight.power.
   * Tune blenderRectLightPowerScale if brightness does not match Cycles.
   */
  blenderRectLightPower: 70,
  blenderRectLightPowerScale: 1,
  /** Square area-light edge length in meters. */
  blenderRectLightSize: 1.8,//3.8,
};

let _uniformsInitialized = false;

/** Required once before the first RectAreaLight render. */
export function initRectAreaLightRendererSupport() {
  if (_uniformsInitialized) return;
  RectAreaLightUniformsLib.init();
  _uniformsInitialized = true;
}

/** Blender (Z-up) position → Three.js (Y-up), same as glTF export. */
export function blenderPositionToThree(position, scale = 1) {
  const S = Math.max(0.0001, Number(scale) || 1);
  const x = (Array.isArray(position) ? position[0] : 0) * S;
  const y = (Array.isArray(position) ? position[1] : 0) * S;
  const z = (Array.isArray(position) ? position[2] : 0) * S;
  return new THREE.Vector3(x, z, -y);
}

/** Blender Euler (deg) → Three.js quaternion for light/object orientation. */
export function blenderEulerDegToThreeQuaternion(xDeg, yDeg, zDeg, order = "XYZ") {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(xDeg),
    THREE.MathUtils.degToRad(yDeg),
    THREE.MathUtils.degToRad(zDeg),
    order
  );
  const qBlender = new THREE.Quaternion().setFromEuler(euler);
  const qFix = _Q_BLENDER_TO_THREE.clone();
  return qFix.multiply(qBlender).multiply(qFix.invert());
}

/** sRGB Blender lamp color → linear RGB for RectAreaLight shaders. */
export function blenderRectLightColorFromHex(value = BLENDER_RECT_LIGHT_YELLOW) {
  const color = new THREE.Color();
  if (typeof value === "number") {
    color.setHex(value);
  } else {
    const s = String(value).trim();
    color.set(s.startsWith("#") ? s : `#${s}`);
  }
  color.convertSRGBToLinear();
  return color;
}

/**
 * @param {{ scene: THREE.Scene, config: object, worldScale?: number }} opts
 */
export function createBlenderRectAreaLight({ scene, config, worldScale = 1 }) {
  const cfg = { ...BLENDER_RECT_LIGHT_DEFAULTS, ...config };
  const noop = { light: null, dispose: () => {} };

  if (!cfg.enableBlenderRectAreaLight) return noop;

  initRectAreaLightRendererSupport();

  const S = Math.max(0.0001, Number(worldScale) || 1);
  const size = Math.max(0.001, Number(cfg.blenderRectLightSize) || 3.8) * S;
  const color = blenderRectLightColorFromHex(cfg.blenderRectLightColor);

  const light = new THREE.RectAreaLight(color, 1, size, size);
  light.name = "WindowLight";

  const pos = cfg.blenderRectLightPosition;
  light.position.copy(blenderPositionToThree(pos, S));

  const rot = cfg.blenderRectLightRotationDeg;
  const rx = Array.isArray(rot) ? rot[0] : 0;
  const ry = Array.isArray(rot) ? rot[1] : 0;
  const rz = Array.isArray(rot) ? rot[2] : 0;
  light.quaternion.copy(
    blenderEulerDegToThreeQuaternion(rx, ry, rz, cfg.blenderRectLightEulerOrder || "XYZ")
  );

  const powerScale = Math.max(0, Number(cfg.blenderRectLightPowerScale) || 1);
  const blenderPower = Math.max(0, Number(cfg.blenderRectLightPower) || 0);
  light.power = blenderPower * powerScale;
  light.userData.baseIntensity = light.intensity;
  light.userData.basePower = light.power;

  scene.add(light);

  const displayColor = color.clone().convertLinearToSRGB();
  console.info(
    "[WindowLight]",
    `pos(Blender)=(${pos}) → Three=(${light.position.x.toFixed(2)}, ${light.position.y.toFixed(2)}, ${light.position.z.toFixed(2)})`,
    `size=${size.toFixed(2)}m`,
    `power=${light.power.toFixed(2)} lm`,
    `intensity=${light.intensity.toFixed(4)} nits`,
    `color=#${displayColor.getHexString()}`
  );

  return {
    light,
    dispose() {
      scene.remove(light);
    },
  };
}
