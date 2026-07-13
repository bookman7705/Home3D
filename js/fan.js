import * as THREE from "three";

const FAN_MESH_NAME = "Fan";
const FAN_POINT_LIGHT_NAME = "FanPointLightFill";
const BEDROOM_POINT_LIGHT_NAME = "PointLight_BedRoom";

function forEachMaterial(mesh, fn) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const m of mats) {
    if (m) fn(m);
  }
}

function readVec3(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) {
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  }
  return fallback;
}

/**
 * Place the point light under the Fan hub so blades cast onto the ceiling.
 * (Do not parent to the Fan — it would spin with the blades.)
 */
export function placePointLightUnderFan(pointLight, fan, config = {}) {
  if (!pointLight || !fan) return null;

  fan.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(fan);
  if (box.isEmpty()) return null;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const down = Math.max(0.02, Number(config.fanLightOffsetY) || size.y * 0.15);

  pointLight.position.set(center.x, center.y - down, center.z);
  return center;
}

/**
 * Independent bedroom fill light (no shadows). Own intensity / distance / color / position.
 */
export function createBedRoomPointLight({ scene, config = {}, worldScale = 1 }) {
  const S = Math.max(0.0001, Number(worldScale) || 1);
  const fanFallback = readVec3(config.fanPointLightPosition, [-0.071, 2.371, -6.159]);
  const startPos = readVec3(config.bedRoomPointLightPosition, fanFallback);
  const px = startPos[0] * S;
  const py = startPos[1] * S;
  const pz = startPos[2] * S;

  const color = new THREE.Color(config.bedRoomPointLightColor ?? 0xffffff);
  const distance = Math.max(0, Number(config.bedRoomPointLightDistance) || 0) * S;
  const decay = Number.isFinite(Number(config.bedRoomPointLightDecay))
    ? Number(config.bedRoomPointLightDecay)
    : 2;
  const intensity = Math.max(0, Number(config.bedRoomPointLightIntensity) || 0);

  const light = new THREE.PointLight(color, intensity, distance, decay);
  light.name = BEDROOM_POINT_LIGHT_NAME;
  light.castShadow = false;
  light.position.set(px, py, pz);
  light.userData.baseIntensity = intensity;
  scene.add(light);

  console.info(
    `[${BEDROOM_POINT_LIGHT_NAME}] Created at`,
    [px, py, pz].map((n) => +n.toFixed(3)),
    `I=${intensity} dist=${distance} (no shadows)`
  );

  return {
    light,
    dispose() {
      scene.remove(light);
    },
  };
}

/**
 * Fan shadow-casting PointLight + independent PointLight_BedRoom (no shadows).
 */
export function createFanPointLight({ scene, config = {}, worldScale = 1 }) {
  const S = Math.max(0.0001, Number(worldScale) || 1);
  const startPos = readVec3(
    config.fanPointLightPosition ?? config.debugPointLightPosition,
    [-0.071, 2.371, -6.159]
  );
  const px = startPos[0] * S;
  const py = startPos[1] * S;
  const pz = startPos[2] * S;

  const color = new THREE.Color(config.fanPointLightColor ?? 0xffffff);
  const distance = Math.max(0, Number(config.fanPointLightDistance) || 0) * S;
  const decay = Number.isFinite(Number(config.fanPointLightDecay))
    ? Number(config.fanPointLightDecay)
    : 2;
  const intensity = Math.max(
    0,
    Number(config.fanPointLightIntensity ?? config.fanPointLightFillIntensity) || 0
  );

  const light = new THREE.PointLight(color, intensity, distance, decay);
  light.name = FAN_POINT_LIGHT_NAME;
  light.position.set(px, py, pz);
  light.userData.baseIntensity = intensity;
  scene.add(light);

  // Detach any legacy child bedroom light from older builds.
  const legacyChild = light.getObjectByName(BEDROOM_POINT_LIGHT_NAME);
  if (legacyChild) light.remove(legacyChild);

  const bedRoom = createBedRoomPointLight({ scene, config, worldScale });

  console.info(
    `[${FAN_POINT_LIGHT_NAME}] Created at`,
    [px, py, pz].map((n) => +n.toFixed(3)),
    `I=${intensity}`
  );

  return {
    light,
    bedRoomLight: bedRoom.light,
    noShadowLight: bedRoom.light,
    dispose() {
      bedRoom.dispose();
      scene.remove(light);
    },
  };
}

/**
 * Point-light shadows + Fan-only casting.
 * Expects the sole FanPointLightFill instance (no other point lights).
 */
export function setupFanPointLightShadows({
  renderer,
  gltfRoot,
  pointLight,
  directionalLight = null,
  flashlight = null,
  config = {},
}) {
  if (!gltfRoot) return { fan: null };

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;

  if (directionalLight) directionalLight.castShadow = false;
  if (flashlight) flashlight.castShadow = false;

  let fan = null;
  gltfRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    const isFan = obj.name === FAN_MESH_NAME;
    obj.castShadow = isFan;
    obj.receiveShadow = true;
    if (isFan) {
      fan = obj;
      forEachMaterial(obj, (m) => {
        m.shadowSide = THREE.DoubleSide;
        m.needsUpdate = true;
      });
    }
  });

  if (!fan) {
    console.warn(`[Fan] Mesh named "${FAN_MESH_NAME}" not found — no shadow caster.`);
  } else {
    console.info(`[Fan] Shadow casting enabled on "${FAN_MESH_NAME}" only.`);
  }

  if (pointLight?.isLight) {
    const mapSize = Math.max(256, Number(config.pointLightShadowMapSize) || 1024);
    const far = Math.max(1, Number(config.pointLightShadowFar) || 20);
    const near = Math.max(0.01, Number(config.pointLightShadowNear) || 0.02);

    pointLight.name = FAN_POINT_LIGHT_NAME;
    pointLight.castShadow = true;
    pointLight.shadow.mapSize.set(mapSize, mapSize);
    pointLight.shadow.bias = Number.isFinite(config.pointLightShadowBias)
      ? config.pointLightShadowBias
      : -0.0005;
    pointLight.shadow.normalBias = Number.isFinite(config.pointLightShadowNormalBias)
      ? config.pointLightShadowNormalBias
      : 0.02;
    pointLight.shadow.radius = Math.max(1, Number(config.pointLightShadowRadius) || 8);
    pointLight.shadow.camera.near = near;
    pointLight.shadow.camera.far = far;
    if (pointLight.shadow.map) {
      pointLight.shadow.map.dispose();
      pointLight.shadow.map = null;
    }
    pointLight.shadow.needsUpdate = true;

    if (config.attachPointLightToFan !== false && fan) {
      const hub = placePointLightUnderFan(pointLight, fan, config);
      if (hub) {
        console.info(
          `[Fan] Point light placed under hub at`,
          pointLight.position.toArray().map((n) => +n.toFixed(3))
        );
      }
    }

    if (config.fanPointLightDistance != null) {
      pointLight.distance = Math.max(0, Number(config.fanPointLightDistance));
    }
    const intensity = Number(
      config.fanPointLightIntensity ?? config.fanPointLightFillIntensity
    );
    if (Number.isFinite(intensity)) {
      pointLight.intensity = Math.max(0, intensity);
      pointLight.userData.baseIntensity = pointLight.intensity;
    }
  }

  return { fan };
}

/** Re-apply Fan-only cast flags after material / lightmap passes. */
export function refreshFanShadowFlags(gltfRoot) {
  if (!gltfRoot) return;
  gltfRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    const isFan = obj.name === FAN_MESH_NAME;
    obj.castShadow = isFan;
    obj.receiveShadow = true;
    if (isFan) {
      forEachMaterial(obj, (m) => {
        m.shadowSide = THREE.DoubleSide;
        m.needsUpdate = true;
      });
    }
  });
}

/**
 * Plays glTF clips that touch the Fan when present; otherwise spins the Fan
 * around its local spin axis (floor.glb has no animation clips).
 *
 * Fan is FBX-converted (−90° X): local Z aligns with world Y (hub axis).
 */
export function createFanAnimation({ gltf, fanMesh, config = {} }) {
  const peakRpm = Math.max(0, Number(config.fanSpinRpm) ?? 420);
  const rampSeconds = Math.max(0.05, Number(config.fanRpmRampSeconds) || 1.6);
  const axisKey = String(config.fanSpinAxis || "z").toLowerCase();
  const localAxis =
    axisKey === "x"
      ? new THREE.Vector3(1, 0, 0)
      : axisKey === "y"
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);

  let mixer = null;
  const actions = [];
  /** Current / target RPM for smooth ramp (procedural spin). */
  let currentRpm = peakRpm;
  let targetRpm = peakRpm;

  if (gltf?.animations?.length && fanMesh) {
    mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) {
      const touchesFan = clip.tracks.some((t) => {
        const root = t.name.split(".")[0];
        return root === FAN_MESH_NAME || t.name.startsWith(`${FAN_MESH_NAME}.`);
      });
      if (!touchesFan && gltf.animations.length > 1) continue;
      const action = mixer.clipAction(clip);
      action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      actions.push(action);
    }
    if (actions.length === 0) {
      for (const clip of gltf.animations) {
        const action = mixer.clipAction(clip);
        action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        actions.push(action);
      }
    }
  }

  const useProceduralSpin = actions.length === 0 && !!fanMesh;
  if (useProceduralSpin) {
    console.info(
      `[Fan] No glTF clips for "${FAN_MESH_NAME}" — spinning on local ${axisKey.toUpperCase()} at ${peakRpm} RPM.`
    );
  } else if (actions.length) {
    console.info(`[Fan] Playing ${actions.length} glTF animation clip(s).`);
  }

  function setTargetRpm(rpm) {
    targetRpm = Math.max(0, Number(rpm) || 0);
  }

  /** Snap immediately (e.g. bootstrap). */
  function setRpmImmediate(rpm) {
    const value = Math.max(0, Number(rpm) || 0);
    currentRpm = value;
    targetRpm = value;
    if (mixer && actions.length) {
      const scale = peakRpm > 0 ? value / peakRpm : 0;
      for (const action of actions) action.setEffectiveTimeScale(scale);
    }
  }

  function update(dt) {
    if (mixer) {
      // Scale clip playback toward target RPM.
      if (actions.length && peakRpm > 0) {
        const step = (peakRpm / rampSeconds) * dt;
        if (currentRpm < targetRpm) {
          currentRpm = Math.min(targetRpm, currentRpm + step);
        } else if (currentRpm > targetRpm) {
          currentRpm = Math.max(targetRpm, currentRpm - step);
        }
        const scale = currentRpm / peakRpm;
        for (const action of actions) action.setEffectiveTimeScale(scale);
      }
      mixer.update(dt);
    }

    if (useProceduralSpin && fanMesh) {
      const step = (peakRpm / rampSeconds) * dt;
      if (currentRpm < targetRpm) {
        currentRpm = Math.min(targetRpm, currentRpm + step);
      } else if (currentRpm > targetRpm) {
        currentRpm = Math.max(targetRpm, currentRpm - step);
      }
      if (currentRpm > 1e-4) {
        const radPerSec = (currentRpm * Math.PI * 2) / 60;
        fanMesh.rotateOnAxis(localAxis, radPerSec * dt);
      }
    }
  }

  function dispose() {
    for (const action of actions) action.stop();
    mixer?.stopAllAction();
    mixer = null;
  }

  return {
    update,
    dispose,
    mixer,
    procedural: useProceduralSpin,
    setTargetRpm,
    setRpmImmediate,
    get currentRpm() {
      return currentRpm;
    },
    get targetRpm() {
      return targetRpm;
    },
  };
}
