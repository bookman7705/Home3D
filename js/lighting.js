/**
 * Scene lighting: environment IBL, realtime lights, tone mapping, PBR normal scale, bloom.
 */
import * as THREE from "three";
import { resolveEnvMapIntensity } from "./gltf-material-props.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { assetUrl } from "asset-config";
import { BLOOM_QUALITY } from "./performance/constants.js";

const _size = new THREE.Vector2();

/** Default lighting-related CONFIG keys (spread into index.html CONFIG). */
export const LIGHTING_DEFAULTS = {
  /** When false, scene lights are off (lightmap / emissive-only look). */
  enableSceneLights: true,
  /** Ambient fill; keep low when using baked lightmaps so shadows read. */
  ambientIntensity: 0.1,
  /** When false, DirectionalLight is not created. */
  enableDirectionalLight: false,
  /** Key light — helps normal/roughness maps read. */
  directionalIntensity: 0.0,
  /**
   * Debug-only second ambient: respects enableSceneLights (see applySceneLightsEnabled).
   * Use ~0.1 to verify lightmap contribution when “real” lights are off. Set to 0 to remove.
   */
  debugAmbientIntensity: 0.0,
  /**
   * Three.js adds lightMap to indirect irradiance only; DirectionalLight + AmbientLight add
   * diffuse without shadowing, which erases dark areas baked into the lightmap.
   */
  suppressRealtimeDiffuseForBakedLightmaps: false,
  /** Used only when enableLightMaps && suppressRealtimeDiffuseForBakedLightmaps */
  bakedFillAmbient: 0.06,
  /** Toggle HDR environment lighting/reflections. */
  useHdr: true,
  /** Equirect .hdr — PMREM → scene.environment only (IBL / reflections, not sky). */
  environmentHdrUrl: assetUrl("hdr", "aerodynamics_workshop_1k.hdr"),
  /** ACES exposure (HDR + sun). */
  toneMappingExposure: 1,
  /** Scales HDRI contribution on MeshStandardMaterial (reflections / indirect spec). */
  iblEnvMapIntensity: 0.2,
  /**
   * Global multiplier for PBR normal maps (glTF normalScale × this value).
   * 1 = as exported from Blender; try 1.5–2.5 for stronger surface relief.
   */
  pbrNormalScale: 1,
  /** Camera-mounted flashlight. */
  enableFlashlight: false,
  flashlightIntensity: 50,
  /** When true, load `lightmap_lighting.json` from AutoLightmap.py for sun angle. */
  useBlenderLightingManifest: false,
  /** Fallback sun Euler (degrees) when lightmap_lighting.json is missing. */
  blenderDirectionalEulerDeg: [-28.061, 38.8838, -47.3439],
  /** Blender Euler order used for the values above. */
  blenderEulerOrder: "XYZ",
  /** Blender light forward axis ("-Z" for Sun/Spot/Area, "-Y" for some rigs). */
  blenderLightForwardAxis: "-Z",
  /** UnrealBloomPass post-processing (see createPostProcessing). */
  enableBloom: true,
  /** WebGL shadow maps + cast/receive on meshes/lights (off for baked lightmap look). */
  enableRealtimeShadows: false,
  /** Bloom intensity — try 0.2–0.5 for subtle wall highlights. */
  bloomStrength: 0.05,
  /** Bloom kernel size — higher = softer glow spread. */
  bloomRadius: 0.01,
  /** Luminance threshold — only pixels above this bloom (0–1, linear HDR). */
  bloomThreshold: 0.82,
};

export function configureRendererToneMapping(renderer, config) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = config.toneMappingExposure;
}

/** Enable or disable WebGL shadow map rendering. */
export function configureRendererShadows(renderer, config) {
  const enabled = config.enableRealtimeShadows === true;
  renderer.shadowMap.enabled = enabled;
  if (enabled) {
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = true;
  } else {
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
  }
}

const SHADOW_TYPE = {
  pcfsoft: THREE.PCFSoftShadowMap,
  pcf: THREE.PCFShadowMap,
  basic: THREE.BasicShadowMap,
};

/**
 * Runtime shadow quality for the fan point-light path. No-op when quality is off.
 * Changing map size disposes the existing shadow render target once — not per frame.
 */
export function applyRealtimeShadowQuality({
  renderer,
  scene,
  pointLight = null,
  quality = "off",
  config = {},
} = {}) {
  if (!renderer) return;

  if (quality === "off") {
    renderer.shadowMap.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    if (pointLight?.isLight) pointLight.castShadow = false;
    scene?.traverse((o) => {
      if (o.isLight) o.castShadow = false;
    });
    return;
  }

  const spec =
    quality === "low"
      ? { mapSize: 64, type: "basic", radius: 1 }
      : quality === "medium"
        ? { mapSize: 128, type: "pcf", radius: 4 }
        : { mapSize: 256, type: "pcfsoft", radius: 8 };

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = SHADOW_TYPE[spec.type] || THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = true;

  const light = pointLight;
  if (light?.isLight) {
    const mapSize = Math.max(32, spec.mapSize);
    light.castShadow = true;
    light.shadow.mapSize.set(mapSize, mapSize);
    light.shadow.radius = spec.radius;
    if (config.pointLightShadowBias != null) {
      light.shadow.bias = Number(config.pointLightShadowBias);
    }
    if (light.shadow.map) {
      light.shadow.map.dispose();
      light.shadow.map = null;
    }
    light.shadow.needsUpdate = true;
  }

  scene?.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (m) m.needsUpdate = true;
    }
  });
}

/** Turn off cast/receive shadow flags on meshes and lights (e.g. after GLB import). */
export function disableRealtimeShadowsInScene(root) {
  if (!root) return;

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      return;
    }
    if (o.isLight) {
      o.castShadow = false;
    }
  });
}

function drawingBufferSize(renderer) {
  renderer.getSize(_size);
  const dpr = renderer.getPixelRatio();
  return { w: Math.max(1, Math.round(_size.x * dpr)), h: Math.max(1, Math.round(_size.y * dpr)) };
}

function bloomScaleFor(bloomQuality, postQuality) {
  const spec = BLOOM_QUALITY[bloomQuality] || BLOOM_QUALITY.high;
  let scale = spec.resolutionScale;
  if (postQuality === "medium") scale *= 0.85;
  if (postQuality === "low") scale *= 0.7;
  return Math.max(0.25, scale);
}

function applyBloomMipCount(bloomPass, nMips) {
  const n = Math.max(2, Math.min(5, nMips | 0));
  bloomPass.nMips = n;
  const vertical = bloomPass.renderTargetsVertical || [];
  const last = vertical[n - 1]?.texture || vertical[0]?.texture;
  if (!last) return n;
  for (let i = 0; i < 5; i++) {
    const tex = i < n && vertical[i] ? vertical[i].texture : last;
    const uniform = bloomPass.compositeMaterial?.uniforms?.[`blurTexture${i + 1}`];
    if (uniform) uniform.value = tex;
  }
  return n;
}

function emptyFrameDrawStats() {
  return {
    sceneCalls: 0,
    postFxCalls: 0,
    totalCalls: 0,
    sceneTriangles: 0,
    postFxTriangles: 0,
    totalTriangles: 0,
  };
}

function passDisplayName(pass) {
  const name = pass?.constructor?.name;
  if (name && name !== "Pass") return name;
  if (pass?.isUnrealBloomPass) return "UnrealBloomPass";
  return "Pass";
}

/**
 * Bloom pipeline — OutputPass applies renderer tone mapping after bloom.
 * Composer is always created so bloom / post-FX can be toggled at runtime.
 * Frame draw stats split scene RenderPass from fullscreen post-FX quads.
 */
export function createPostProcessing({ renderer, scene, camera, config }) {
  const frameDrawStats = emptyFrameDrawStats();
  let sceneCalls = 0;
  let sceneTriangles = 0;
  let composerEnabled = true;
  let bloomQuality = "high";
  let postQuality = "high";

  function captureComposerFrame(drawFn) {
    const info = renderer.info;
    const prevAuto = info.autoReset;
    info.autoReset = false;
    const c0 = info.render.calls;
    const t0 = info.render.triangles;
    sceneCalls = 0;
    sceneTriangles = 0;
    drawFn();
    const totalCalls = info.render.calls - c0;
    const totalTriangles = info.render.triangles - t0;
    frameDrawStats.sceneCalls = sceneCalls;
    frameDrawStats.sceneTriangles = sceneTriangles;
    frameDrawStats.totalCalls = totalCalls;
    frameDrawStats.totalTriangles = totalTriangles;
    frameDrawStats.postFxCalls = Math.max(0, totalCalls - sceneCalls);
    frameDrawStats.postFxTriangles = Math.max(0, totalTriangles - sceneTriangles);
    info.autoReset = prevAuto;
    if (prevAuto) info.reset();
  }

  function wrapRenderPass(renderPass) {
    const inner = renderPass.render.bind(renderPass);
    renderPass.render = (glRenderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
      const c0 = glRenderer.info.render.calls;
      const t0 = glRenderer.info.render.triangles;
      inner(glRenderer, writeBuffer, readBuffer, deltaTime, maskActive);
      sceneCalls = glRenderer.info.render.calls - c0;
      sceneTriangles = glRenderer.info.render.triangles - t0;
    };
  }

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  wrapRenderPass(renderPass);
  composer.addPass(renderPass);

  const initialSize = drawingBufferSize(renderer);
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(initialSize.w, initialSize.h),
    Number(config.bloomStrength) || 0.35,
    Number(config.bloomRadius) || 0.42,
    Number(config.bloomThreshold) ?? 0.82
  );
  bloomPass.enabled = config.enableBloom !== false;
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  function resizeBloomTargets() {
    const buf = drawingBufferSize(renderer);
    const scale = bloomPass.enabled ? bloomScaleFor(bloomQuality, postQuality) : 1;
    const bw = Math.max(1, Math.round(buf.w * scale));
    const bh = Math.max(1, Math.round(buf.h * scale));
    bloomPass.setSize(bw, bh);
    bloomPass.resolution.set(bw, bh);
  }

  function resize() {
    renderer.getSize(_size);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(_size.x, _size.y);
    resizeBloomTargets();
  }

  function setBloomQuality(nextBloomQuality, nextPostQuality) {
    if (nextBloomQuality) bloomQuality = nextBloomQuality;
    if (nextPostQuality) postQuality = nextPostQuality;
    const spec = BLOOM_QUALITY[bloomQuality] || BLOOM_QUALITY.high;
    applyBloomMipCount(bloomPass, spec.nMips);
    resizeBloomTargets();
  }

  console.info(
    "[Bloom]",
    `strength=${bloomPass.strength}`,
    `radius=${bloomPass.radius}`,
    `threshold=${bloomPass.threshold}`
  );

  return {
    composer,
    bloomPass,
    render() {
      if (!composerEnabled) {
        captureComposerFrame(() => {
          const c0 = renderer.info.render.calls;
          const t0 = renderer.info.render.triangles;
          renderer.render(scene, camera);
          sceneCalls = renderer.info.render.calls - c0;
          sceneTriangles = renderer.info.render.triangles - t0;
        });
        return;
      }
      captureComposerFrame(() => composer.render());
    },
    resize,
    dispose: () => composer.dispose(),
    setComposerEnabled(on) {
      composerEnabled = !!on;
    },
    isComposerEnabled() {
      return composerEnabled;
    },
    setBloomEnabled(on) {
      bloomPass.enabled = !!on;
    },
    getBloomEnabled() {
      return !!bloomPass.enabled && composerEnabled;
    },
    setBloomQuality,
    setBloomStrength(value) {
      bloomPass.strength = Math.max(0, Number(value) || 0);
    },
    getBloomStrength() {
      return bloomPass.strength;
    },
    getFrameDrawStats() {
      return { ...frameDrawStats };
    },
    getPostFxInfo() {
      const bloomOn = !!bloomPass.enabled && composerEnabled;
      const nMips = bloomOn ? Number(bloomPass.nMips) || 0 : 0;
      const passNames = composerEnabled
        ? (composer.passes || [])
            .filter((p) => p.enabled !== false)
            .map(passDisplayName)
        : [];
      return {
        enabled: composerEnabled,
        passCount: passNames.length,
        passNames,
        bloom: bloomOn,
        bloomMips: nMips,
        bloomFullscreenDraws: bloomOn ? 1 + nMips * 2 + 1 + 1 : 0,
        outputPass: composerEnabled && passNames.includes("OutputPass"),
      };
    },
  };
}

/** Apply config.pbrNormalScale on top of each material's authored glTF normalScale. */
export function applyPbrNormalScale(material, config) {
  if (!material?.isMeshStandardMaterial || !material.normalMap) return;
  if (!material.userData._authoredNormalScale) {
    material.userData._authoredNormalScale = material.normalScale.clone();
  }
  const base = material.userData._authoredNormalScale;
  const scale = Number(config.pbrNormalScale);
  const mul = Number.isFinite(scale) ? scale : 1;
  material.normalScale.set(base.x * mul, base.y * mul);
}

/** IBL intensity + normal scale for MeshStandardMaterial. */
export function applyMaterialLighting(material, config, mesh = null) {
  if (!material?.isMeshStandardMaterial) return;
  material.envMapIntensity = resolveEnvMapIntensity(mesh, material, config);
  applyPbrNormalScale(material, config);
  material.needsUpdate = true;
}

/**
 * Push an envMapIntensity (IBL / HDR contribution) to all standard materials under root.
 * Stores each material's first-seen intensity as the restore baseline.
 */
export function setSceneEnvMapIntensity(root, intensity, { scaleFromAuthored = false } = {}) {
  if (!root) return;
  const value = Math.max(0, Number(intensity) || 0);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m?.isMeshStandardMaterial) continue;
      if (m.userData._authoredEnvMapIntensity === undefined) {
        m.userData._authoredEnvMapIntensity = Number.isFinite(m.envMapIntensity)
          ? m.envMapIntensity
          : 1;
      }
      m.envMapIntensity = scaleFromAuthored
        ? m.userData._authoredEnvMapIntensity * value
        : value;
    }
  });
}

/** Restore envMapIntensity values captured by setSceneEnvMapIntensity. */
export function restoreSceneEnvMapIntensity(root) {
  if (!root) return;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m?.isMeshStandardMaterial) continue;
      if (m.userData._authoredEnvMapIntensity !== undefined) {
        m.envMapIntensity = m.userData._authoredEnvMapIntensity;
      }
    }
  });
}

function blenderEulerDegToThreeQuaternion(xDeg, yDeg, zDeg, order = "XYZ") {
  const eulerThree = new THREE.Euler(
    THREE.MathUtils.degToRad(xDeg),
    THREE.MathUtils.degToRad(yDeg),
    THREE.MathUtils.degToRad(zDeg),
    order
  );
  return new THREE.Quaternion().setFromEuler(eulerThree).normalize();
}

/** DirectionalLight points along local -Z in Three.js. */
export function blenderLightDirectionToThree(eulerDeg, order = "XYZ") {
  const [xDeg, yDeg, zDeg] = eulerDeg;
  const qThree = blenderEulerDegToThreeQuaternion(xDeg, yDeg, zDeg, order);
  return new THREE.Vector3(0, 0, -1).applyQuaternion(qThree).normalize();
}

/** Load sun rotation exported by AutoLightmap.py (`lightmap_lighting.json`). */
export async function loadBlenderLightingManifest(basePath = "./") {
  let folder = String(basePath ?? "./").replace(/\\/g, "/").replace(/\/+$/, "");
  const prefix = folder.length ? `${folder}/` : "";
  const url = `${prefix}lightmap_lighting.json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Align runtime DirectionalLight with Blender's baked sun / key light. */
export function applyBlenderLightingManifest(lightingSystem, manifest, config, worldScale = 1) {
  if (!manifest?.blenderDirectionalEulerDeg?.length) return false;
  const { directionalLight } = lightingSystem;
  if (!directionalLight) return false;
  const euler = manifest.blenderDirectionalEulerDeg;
  const order = manifest.blenderEulerOrder || config.blenderEulerOrder || "XYZ";
  const sunDirection = blenderLightDirectionToThree(euler, order);
  const S = Math.max(0.0001, Number(worldScale) || 1);
  const sunDistance = 50 * S;
  directionalLight.position.copy(sunDirection).multiplyScalar(-sunDistance);
  directionalLight.target.position.set(0, 0, 0);
  if (Array.isArray(manifest.blenderColor) && manifest.blenderColor.length >= 3) {
    directionalLight.color.setRGB(
      manifest.blenderColor[0],
      manifest.blenderColor[1],
      manifest.blenderColor[2]
    );
  }
  console.info("[Lighting] Sun rotation from lightmap_lighting.json:", euler);
  return true;
}

function resolveDiffuseLightLevels(config) {
  if (config.enableLightMaps && config.suppressRealtimeDiffuseForBakedLightmaps) {
    return {
      ambient: Math.max(0, Number(config.bakedFillAmbient) || 0),
      directional: 0,
      debug: 0,
    };
  }
  return {
    ambient: config.ambientIntensity,
    directional: config.directionalIntensity,
    debug: config.debugAmbientIntensity,
  };
}

/** Push CONFIG.ambientIntensity to the scene ambient light (live debug tuning). */
export function applyAmbientIntensityFromConfig(lighting, config) {
  if (!lighting?.ambientLight) return;
  const value = Math.max(0, Number(config.ambientIntensity) ?? 0);
  config.ambientIntensity = value;
  lighting.ambientLight.userData.baseIntensity = value;
  const enabled = config.enableSceneLights !== false;
  lighting.ambientLight.visible = enabled;
  lighting.ambientLight.intensity = enabled ? value : 0;
}

/**
 * Load HDR environment into scene.environment (optional).
 * @returns {Promise<void>}
 */
export function setupEnvironment(scene, renderer, config) {
  if (!config.useHdr) return Promise.resolve();
  const url = String(config.environmentHdrUrl || "").trim();
  if (!url) return Promise.resolve();

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader();

  return new Promise((resolve) => {
    new RGBELoader().load(
      url,
      (hdrTexture) => {
        hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = pmremGenerator.fromEquirectangular(hdrTexture).texture;
        scene.background = new THREE.Color(0x202020);
        //scene.background = new THREE.Color(0x000000);
        hdrTexture.dispose();
        pmremGenerator.dispose();
        resolve();
      },
      undefined,
      (err) => {
        console.warn("[HDR] environment load failed:", err);
        pmremGenerator.dispose();
        resolve();
      }
    );
  });
}

/**
 * Create ambient, directional, debug fill, and camera flashlight.
 * @returns {import('./lighting.js').LightingSystem}
 */
export function createLightingSystem({ scene, camera, config, worldScale }) {
  const S = Math.max(0.0001, Number(worldScale) || 1);
  const L0 = resolveDiffuseLightLevels(config);

  const ambientLight = new THREE.AmbientLight(0xffffff, L0.ambient);
  ambientLight.userData.baseIntensity = L0.ambient;
  scene.add(ambientLight);

  let directionalLight = null;
  if (config.enableDirectionalLight !== false) {
    directionalLight = new THREE.DirectionalLight(0xffffff, L0.directional);
    directionalLight.name = "DirectionalLight";
    directionalLight.userData.baseIntensity = L0.directional;
    directionalLight.castShadow = config.enableRealtimeShadows === true;
    const sunDirection = blenderLightDirectionToThree(
      config.blenderDirectionalEulerDeg,
      config.blenderEulerOrder
    );
    const sunDistance = 50 * S;
    directionalLight.position.copy(sunDirection).multiplyScalar(-sunDistance);
    directionalLight.target.position.set(0, 0, 0);
    scene.add(directionalLight);
    scene.add(directionalLight.target);
  }

  const flashlight = new THREE.SpotLight(
    0xffffff,
    config.flashlightIntensity,
    35 * S,
    Math.PI / 9,
    0.35,
    1.2
  );
  flashlight.name = "Flashlight";
  flashlight.visible = !!config.enableFlashlight;
  flashlight.castShadow = config.enableRealtimeShadows === true;
  flashlight.position.set(0, 0, 0);
  camera.add(flashlight);
  const flashlightTarget = new THREE.Object3D();
  scene.add(flashlightTarget);
  flashlight.target = flashlightTarget;

  const debugAmbientLight = new THREE.AmbientLight(0xffffff, L0.debug);
  debugAmbientLight.userData.baseIntensity = L0.debug;
  debugAmbientLight.name = "DebugAmbientFill";
  scene.add(debugAmbientLight);

  const sceneLights = [ambientLight, debugAmbientLight];
  if (directionalLight) sceneLights.push(directionalLight);

  function registerSceneLight(light) {
    if (!light) return;
    if (light.userData.baseIntensity === undefined) {
      light.userData.baseIntensity = light.intensity;
    }
    light.castShadow = config.enableRealtimeShadows === true;
    if (!sceneLights.includes(light)) {
      sceneLights.push(light);
    }
    applySceneLightsEnabled(config.enableSceneLights !== false);
  }

  function applySceneLightsEnabled(enabled, root = null) {
    const applyOne = (light) => {
      if (light.userData.baseIntensity === undefined) {
        light.userData.baseIntensity = light.intensity;
      }
      light.visible = enabled;
      light.intensity = enabled ? light.userData.baseIntensity : 0;
      if (config.enableRealtimeShadows !== true) {
        light.castShadow = false;
      }
    };

    for (const light of sceneLights) applyOne(light);

    if (root) {
      root.traverse((o) => {
        if (o.isLight) applyOne(o);
      });
      if (config.enableRealtimeShadows !== true) {
        disableRealtimeShadowsInScene(root);
      }
    }
  }

  function suppressGltfRealtimeDiffuse(root) {
    if (!config.enableLightMaps || !config.suppressRealtimeDiffuseForBakedLightmaps) return;
    root.traverse((o) => {
      if (!o.isLight) return;
      if (o.userData.baseIntensity === undefined) {
        o.userData.baseIntensity = o.intensity;
      }
      o.intensity = 0;
      o.visible = false;
    });
  }

  function updateFlashlight(camera, lookDirection, scale = S) {
    if (!config.enableFlashlight) return;
    flashlightTarget.position
      .copy(camera.position)
      .add(lookDirection.clone().multiplyScalar(12 * scale));
    flashlightTarget.updateMatrixWorld();
  }

  applySceneLightsEnabled(config.enableSceneLights);

  return {
    ambientLight,
    directionalLight,
    debugAmbientLight,
    flashlight,
    flashlightTarget,
    applySceneLightsEnabled,
    suppressGltfRealtimeDiffuse,
    updateFlashlight,
    registerSceneLight,
  };
}
