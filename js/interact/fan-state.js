import * as THREE from "three";
import { refreshLightmapRenderSettings } from "../materials.js";
import {
  setSceneEnvMapIntensity,
  restoreSceneEnvMapIntensity,
} from "../lighting.js";

const FAN_BULB_NAME = "Fan Light Bulb";
const EMISSION_MAT_NAME = "Emission";
const LEVER_ON_NAME = "LightSwitch_Lever_On";
const LEVER_OFF_NAME = "LightSwitch_Lever_Off";

/**
 * Hide the inactive lever immediately on GLB load (before lightmaps finish).
 * Default fan state is ON → show On lever, hide Off lever.
 */
export function applyLightSwitchLeverVisibility(root, fanOn = true) {
  if (!root) return;
  const on = !!fanOn;
  root.traverse((obj) => {
    if (obj.name === LEVER_ON_NAME) obj.visible = on;
    else if (obj.name === LEVER_OFF_NAME) obj.visible = !on;
  });
}

function materialList(mesh) {
  if (!mesh?.material) return [];
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function findNamedObject(root, name) {
  if (!root) return null;
  let found = null;
  root.traverse((obj) => {
    if (found) return;
    if (obj.name === name) found = obj;
  });
  return found;
}

function makeOffBulbMaterial() {
  return new THREE.MeshStandardMaterial({
    name: "FanLightBulb_Off",
    color: 0x808080,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 0,
    toneMapped: true,
  });
}

/**
 * Collect every mesh that should follow FanState bulb emission.
 * Matches node name (and mesh children) and/or glTF material name "Emission".
 */
function collectBulbMeshes(root) {
  /** @type {THREE.Mesh[]} */
  const meshes = [];
  const seen = new Set();
  if (!root) return meshes;

  const add = (mesh) => {
    if (!mesh?.isMesh || seen.has(mesh.uuid)) return;
    seen.add(mesh.uuid);
    meshes.push(mesh);
  };

  root.traverse((obj) => {
    const name = String(obj.name ?? "");
    if (name === FAN_BULB_NAME || name.startsWith("Fan Light Bulb")) {
      if (obj.isMesh) add(obj);
      // Node may be a Group with the renderable mesh as a child.
      obj.traverse((child) => {
        if (child.isMesh) add(child);
      });
    }
  });

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (materialList(obj).some((m) => m && m.name === EMISSION_MAT_NAME)) {
      add(obj);
    }
  });

  return meshes;
}

/**
 * Room fan power state — lightmaps, point lights, bulb emission, lever meshes, RPM.
 * Default: ON.
 */
export function createFanStateController({
  config,
  getGltfRoot,
  getLightmapConfig,
  fanPointLight = null,
  bedRoomPointLight = null,
  fanAnimation = null,
  renderer = null,
  getSceneRoot = null,
}) {
  let fanState = true;

  /**
   * Per-mesh on/off material pairs. Swapping materials (not mutating) so bloom
   * cannot keep showing the KHR emissiveStrength=50 material.
   * @type {{ mesh: THREE.Mesh, onMaterial: THREE.Material | THREE.Material[], offMaterial: THREE.Material | THREE.Material[] }[]}
   */
  let bulbEntries = [];
  /** @type {THREE.Object3D | null} */
  let leverOn = null;
  /** @type {THREE.Object3D | null} */
  let leverOff = null;

  const onLightMap = () =>
    Number(config.fanStateOnLightMapIntensity ?? 0.8);
  const onFanPoint = () =>
    Number(
      config.fanStateOnFanPointLightIntensity ?? config.fanPointLightIntensity ?? 0.5
    );
  const onBedRoomPoint = () =>
    Number(
      config.fanStateOnBedRoomPointLightIntensity ??
        config.bedRoomPointLightIntensity ??
        8
    );
  const peakRpm = () => Math.max(0, Number(config.fanSpinRpm) || 0);

  const baseToneExposure = () =>
    Number.isFinite(Number(config.toneMappingExposure))
      ? Number(config.toneMappingExposure)
      : 1;

  function disposeEntryMaterials(entry) {
    const lists = [entry.onMaterial, entry.offMaterial];
    for (const list of lists) {
      const mats = Array.isArray(list) ? list : [list];
      for (const m of mats) {
        // Only dispose materials we created for OFF / clones for ON.
        if (m?.userData?.__fanStateOwned) m.dispose?.();
      }
    }
  }

  function bindBulbMeshes(root) {
    for (const entry of bulbEntries) disposeEntryMaterials(entry);
    bulbEntries = [];

    const meshes = collectBulbMeshes(root);
    if (meshes.length === 0) {
      console.warn(
        `[FanState] No bulb mesh found (expected "${FAN_BULB_NAME}" or material "${EMISSION_MAT_NAME}").`
      );
      return;
    }

    for (const mesh of meshes) {
      const srcMats = materialList(mesh);
      const onMats = srcMats.map((m) => {
        if (!m?.clone) return m;
        const clone = m.clone();
        clone.userData = { ...clone.userData, __fanStateOwned: true };
        // Preserve authored KHR emissive strength on the ON clone.
        if (Number.isFinite(m.emissiveIntensity)) {
          clone.emissiveIntensity = m.emissiveIntensity;
        }
        if (m.emissive) clone.emissive.copy(m.emissive);
        if (m.color) clone.color.copy(m.color);
        return clone;
      });
      const offMats = onMats.map(() => {
        const off = makeOffBulbMaterial();
        off.userData.__fanStateOwned = true;
        return off;
      });

      const entry = {
        mesh,
        onMaterial: onMats.length === 1 ? onMats[0] : onMats,
        offMaterial: offMats.length === 1 ? offMats[0] : offMats,
      };
      bulbEntries.push(entry);

      console.info(`[FanState] Bound bulb mesh "${mesh.name}"`, {
        emissiveIntensity: onMats[0]?.emissiveIntensity,
        emissive: onMats[0]?.emissive
          ? `#${onMats[0].emissive.getHexString()}`
          : null,
        materialName: onMats[0]?.name,
      });
    }
  }

  function captureSceneBindings(root) {
    if (!root) return;
    bindBulbMeshes(root);
    leverOn = findNamedObject(root, LEVER_ON_NAME);
    leverOff = findNamedObject(root, LEVER_OFF_NAME);
    if (!leverOn) console.warn(`[FanState] Mesh "${LEVER_ON_NAME}" not found.`);
    if (!leverOff) console.warn(`[FanState] Mesh "${LEVER_OFF_NAME}" not found.`);
  }

  function applyLighting() {
    const intensity = fanState ? onLightMap() : 0;
    config.lightMapIntensity = intensity;

    const runtime = getLightmapConfig?.();
    if (runtime) runtime.lightMapIntensity = intensity;

    const root = getGltfRoot?.();
    if (root) {
      refreshLightmapRenderSettings(root, runtime ?? config);
    }

    const fanI = fanState ? onFanPoint() : 0;
    config.fanPointLightIntensity = fanI;
    if (fanPointLight?.isLight) {
      fanPointLight.intensity = fanI;
      fanPointLight.userData.baseIntensity = fanI;
    }

    const bedI = fanState ? onBedRoomPoint() : 0;
    config.bedRoomPointLightIntensity = bedI;
    if (bedRoomPointLight?.isLight) {
      bedRoomPointLight.intensity = bedI;
      bedRoomPointLight.userData.baseIntensity = bedI;
    }
  }

  function applyHdrContribution() {
    const root = getGltfRoot?.() ?? getSceneRoot?.();
    const offIblScale = Math.max(0, Number(config.fanStateOffIblScale) ?? 0.45);
    const offExposure = Math.max(
      0,
      Number(config.fanStateOffToneMappingExposure) ?? 0.75
    );

    if (fanState) {
      if (root) restoreSceneEnvMapIntensity(root);
      if (renderer) {
        renderer.toneMappingExposure = baseToneExposure();
      }
    } else {
      // Scale authored IBL per material — greatly reduces HDR reflections/fill.
      if (root) setSceneEnvMapIntensity(root, offIblScale, { scaleFromAuthored: true });
      if (renderer) {
        renderer.toneMappingExposure = offExposure;
      }
    }
  }

  function applyBulbEmission() {
    // Re-resolve if materials were replaced by lightmap/debug passes.
    if (bulbEntries.length === 0) {
      const root = getGltfRoot?.();
      if (root) bindBulbMeshes(root);
    }

    for (const entry of bulbEntries) {
      const { mesh } = entry;
      if (!mesh) continue;

      // If something replaced the mesh material out from under us, rebind this mesh.
      const current = mesh.material;
      const owned =
        current === entry.onMaterial ||
        current === entry.offMaterial ||
        (Array.isArray(current) &&
          (current === entry.onMaterial || current === entry.offMaterial));

      if (!owned) {
        // Mesh still exists but material was swapped externally — rebuild pairs from live mat.
        const srcMats = materialList(mesh);
        const onMats = srcMats.map((m) => {
          if (!m?.clone) return m;
          const clone = m.clone();
          clone.userData = { ...clone.userData, __fanStateOwned: true };
          return clone;
        });
        const offMats = onMats.map(() => {
          const off = makeOffBulbMaterial();
          off.userData.__fanStateOwned = true;
          return off;
        });
        disposeEntryMaterials(entry);
        entry.onMaterial = onMats.length === 1 ? onMats[0] : onMats;
        entry.offMaterial = offMats.length === 1 ? offMats[0] : offMats;
      }

      mesh.material = fanState ? entry.onMaterial : entry.offMaterial;

      // Belt-and-suspenders: force zero emission on whatever is assigned when OFF.
      if (!fanState) {
        for (const m of materialList(mesh)) {
          if (!m) continue;
          if (m.color) m.color.setHex(0x808080);
          if (m.emissive) m.emissive.setHex(0x000000);
          if ("emissiveIntensity" in m) m.emissiveIntensity = 0;
          if ("emissiveMap" in m) m.emissiveMap = null;
          if ("envMapIntensity" in m) m.envMapIntensity = 0;
          m.needsUpdate = true;
        }
      }
    }
  }

  function applyLeverVisibility() {
    // Prefer bound refs; fall back to a full traverse if bindings are stale.
    if (leverOn || leverOff) {
      if (leverOn) leverOn.visible = fanState;
      if (leverOff) leverOff.visible = !fanState;
      return;
    }
    applyLightSwitchLeverVisibility(getGltfRoot?.(), fanState);
  }

  function applyFanSpeed() {
    fanAnimation?.setTargetRpm?.(fanState ? peakRpm() : 0);
  }

  function sync() {
    applyLighting();
    applyHdrContribution();
    applyBulbEmission();
    applyLeverVisibility();
    applyFanSpeed();
  }

  function setFanState(next) {
    const value = !!next;
    if (value === fanState) {
      sync();
      return fanState;
    }
    fanState = value;
    sync();
    console.info(`[FanState] ${fanState ? "ON" : "OFF"}`, {
      bulbMeshes: bulbEntries.map((e) => e.mesh?.name),
    });
    return fanState;
  }

  function toggle() {
    return setFanState(!fanState);
  }

  /** Call once after lightmaps + materials exist so bulb defaults are correct. */
  function bootstrap() {
    captureSceneBindings(getGltfRoot?.());
    sync();
  }

  return {
    get fanState() {
      return fanState;
    },
    setFanState,
    toggle,
    sync,
    bootstrap,
    setFanAnimation(anim) {
      fanAnimation = anim;
      applyFanSpeed();
    },
    setFanPointLight(light) {
      fanPointLight = light;
      applyLighting();
    },
    setBedRoomPointLight(light) {
      bedRoomPointLight = light;
      applyLighting();
    },
  };
}
