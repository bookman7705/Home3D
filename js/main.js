import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CONFIG } from "./config.js";
import {
  configureRendererToneMapping,
  configureRendererShadows,
  disableRealtimeShadowsInScene,
  createLightingSystem,
  createPostProcessing,
  setupEnvironment,
  loadBlenderLightingManifest,
  applyBlenderLightingManifest,
} from "./lighting.js";
import {
  collectLightmapBasesFromScene,
  configureBakedMapTexture,
  loadLightmapManifest,
  loadBakedMapPackFromManifest,
  loadLightmapPackForBases,
  applyBakedMapsFromManifestPack,
  applyBakedMapsFromPack,
  collectSceneMeshNames,
  countMeshUvStats,
  traverseMeshesEnsureLightmapUv,
  finalizeGltfPbrMaterials,
} from "./lightmap.js";
import { clearLightmapsFromScene, refreshLightmapRenderSettings } from "./materials.js";
import { configureKtx2Loader, getKtx2Loader } from "./textures.js";
import { createBlenderRectAreaLight } from "./blender-rect-area-light.js";
import {
  createFanPointLight,
  setupFanPointLightShadows,
  createFanAnimation,
  refreshFanShadowFlags,
} from "./fan.js";
import {
  detectControlMode,
  createPlayerControls,
  setupFullscreen,
  setupRendererResize,
} from "./controls/index.js";
import {
  createPhysics,
  createCollisionFromColMeshes,
  createPhysicsPlayer,
  stepPhysics,
} from "./physics/index.js";
import { createPerfStats } from "./debug/index.js";
import { stampGltfIdentity } from "./debug/gltf-identity.js";
import {
  createFanStateController,
  createInteractSystem,
  applyLightSwitchLeverVisibility,
} from "./interact/index.js";
import { createBackgroundMusic } from "./music.js";
import { createPerformanceSystem, pixelRatioForQuality, loadPerformanceSettings } from "./performance/index.js";

const worldScale = Math.max(0.0001, Number(CONFIG.worldScale) || 1);
const levelFeatures = CONFIG.levelFeatures ?? {};
const FIXED_DT = 1 / 60;
const MAX_PHYSICS_STEPS = 5;

const spawn = CONFIG.cameraSpawn ?? [2.11, 1.71, -0.564];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202020);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(spawn[0] * worldScale, spawn[1] * worldScale, spawn[2] * worldScale);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: "high-performance",
  stencil: false,
  depth: true,
});
renderer.setSize(window.innerWidth, window.innerHeight);
const storedPerf = loadPerformanceSettings();
renderer.setPixelRatio(pixelRatioForQuality(storedPerf.settings.renderQuality));
configureKtx2Loader(renderer);
configureRendererToneMapping(renderer, CONFIG);
configureRendererShadows(renderer, CONFIG);
document.body.appendChild(renderer.domElement);

const postFX = createPostProcessing({ renderer, scene, camera, config: CONFIG });

const lighting = createLightingSystem({
  scene,
  camera,
  config: CONFIG,
  worldScale,
});

/** Window rect area light — floor level only unless enabled per-level. */
let windowLight = null;
if (CONFIG.enableBlenderRectAreaLight !== false && levelFeatures.windowRectLight !== false) {
  windowLight = createBlenderRectAreaLight({
    scene,
    config: CONFIG,
    worldScale,
  });
  if (windowLight.light) {
    lighting.registerSceneLight(windowLight.light);
  }
}

const lightmapDebug = {
  drawPreview() {},
  renderPanel() {},
};

const fanPointLight =
  levelFeatures.scenePointLight === true
    ? createFanPointLight({ scene, config: CONFIG, worldScale })
    : { light: null, bedRoomLight: null, dispose() {} };
const initialControlMode = detectControlMode();
const usePhysics = CONFIG.enablePhysics !== false;
const player = createPlayerControls({
  camera,
  worldScale: CONFIG.worldScale,
  canvas: renderer.domElement,
  initialMode: initialControlMode,
  usePhysicsMovement: usePhysics,
  enableJump: !!CONFIG.enableJump,
});
setupFullscreen();

const clock = new THREE.Clock();
const cameraLookDir = new THREE.Vector3();

const lightDebug = {
  refreshLights() {},
  selectByName() {},
  update() {},
};

/** @type {{ RAPIER: any, world: any } | null} */
let physics = null;
/** @type {ReturnType<typeof createPhysicsPlayer> | null} */
let physicsPlayer = null;
/** @type {ReturnType<typeof createCollisionFromColMeshes> | null} */
let collisionLevel = null;
let physicsAccumulator = 0;
/** @type {ReturnType<typeof createFanStateController> | null} */
let fanState = null;
/** @type {ReturnType<typeof createInteractSystem> | null} */
let interactSystem = null;

const backgroundMusic = createBackgroundMusic(CONFIG);

const startBtn = document.getElementById("startBtn");
if (startBtn) {
  startBtn.onclick = () => {
    player.enableDeviceOrientation();
    if (backgroundMusic.enabled !== false) {
      backgroundMusic.play();
    }
  };
}

const gltfLoader = new GLTFLoader();
const ktx2ForGltf = getKtx2Loader();
if (!ktx2ForGltf) {
  throw new Error("KTX2Loader was not configured before GLTFLoader.");
}
gltfLoader.setKTX2Loader(ktx2ForGltf);

/** Loaded lightmap pack + apply metadata (textures preloaded for runtime toggle). */
let lightmapRuntime = null;
let gltfScene = null;
/** @type {{ update: (dt: number) => void, dispose: () => void } | null} */
let fanAnimation = null;

const perfStats = createPerfStats({
  renderer,
  scene,
  camera,
  getPostFx: () => postFX,
  getGltfRoot: () => gltfScene,
  getExtras: () => ({
    level: CONFIG.levelId ?? "",
    lightmaps: CONFIG.enableLightMaps ? "on" : "off",
    physics: CONFIG.enablePhysics !== false ? "on" : "off",
    ...(perfSystem?.getStatsExtras() || {}),
  }),
});

const perfSystem = createPerformanceSystem({
  renderer,
  scene,
  camera,
  postFX,
  config: CONFIG,
  hooks: {
    getGltfRoot: () => gltfScene,
    syncLightmaps: () => syncLightmapApplication(),
    getShadowLight: () => fanPointLight.light,
    invalidatePerfStats: () => perfStats.invalidateStructure(),
    closeStats: () => perfStats.close(),
  },
});
setupRendererResize({ camera, onResize: () => perfSystem.handleResize() });

function stripGltfLights(root) {
  if (!root) return;
  const remove = [];
  root.traverse((obj) => {
    if (obj.isLight) remove.push(obj);
  });
  for (const light of remove) {
    light.intensity = 0;
    light.visible = false;
    light.parent?.remove(light);
  }
  if (remove.length) {
    console.info(`[Level] Stripped ${remove.length} GLB light(s)`);
  }
}

async function loadLightmapResources(root) {
  const loadConfig = { ...CONFIG, enableLightMaps: true };
  let lightmapConfig = loadConfig;
  let pack = new Map();
  let diagnostics = [];
  let usedManifest = false;
  let sharedAtlases = null;
  let manifestMeta = null;

  if (loadConfig.useLightmapManifest !== false) {
    const manifest = await loadLightmapManifest(loadConfig);
    if (manifest) {
      const manifestLoad = await loadBakedMapPackFromManifest(manifest, loadConfig);
      pack = manifestLoad.pack;
      diagnostics = manifestLoad.diagnostics;
      lightmapConfig = manifestLoad.config;
      sharedAtlases = manifestLoad.sharedAtlases;
      manifestMeta = manifestLoad.manifestMeta;
      if (pack.size > 0) {
        usedManifest = true;
        console.info(
          "[Lightmap] Manifest v" + (manifestMeta?.version ?? "?"),
          manifestMeta?.generator ? `(${manifestMeta.generator})` : "",
          "—",
          diagnostics.length,
          "entries,",
          pack.size,
          "lookup keys"
        );
        if (manifestMeta?.sharedAtlasStems?.length) {
          console.info(
            "[Lightmap] Shared profile atlas:",
            manifestMeta.sharedAtlasStems.join(", ")
          );
        }
      } else {
        console.warn(
          "[Lightmap] Manifest had no loadable textures — using stem fallback"
        );
      }
    }
  }

  if (!usedManifest) {
    const bases = collectLightmapBasesFromScene(root, loadConfig);
    const fallback = await loadLightmapPackForBases(bases, loadConfig);
    pack = fallback.pack;
    diagnostics = fallback.diagnostics;
    console.info("[Lightmap] Stem fallback bases", bases, "loaded", pack.size);
  }

  return { pack, diagnostics, lightmapConfig, usedManifest, sharedAtlases, manifestMeta };
}

function syncLightmapApplication() {
  if (!gltfScene || !lightmapRuntime) return;

  const { pack, lightmapConfig, usedManifest, diagnostics, sharedAtlases } = lightmapRuntime;
  lightmapConfig.lightMapIntensity = CONFIG.lightMapIntensity;
  lightmapConfig.enableLightMaps = CONFIG.enableLightMaps;
  const anyDiffuseLoaded = pack.size > 0;
  let apply;

  // Always reset previously applied baked maps before re-applying.
  // Prevents stale lightmaps/AO from sticking on meshes with no current pack entry.
  clearLightmapsFromScene(gltfScene, { clearAo: true });

  if (CONFIG.enableLightMaps && anyDiffuseLoaded) {
    apply = usedManifest
      ? applyBakedMapsFromManifestPack(gltfScene, pack, lightmapConfig, { sharedAtlases })
      : applyBakedMapsFromPack(gltfScene, pack, lightmapConfig);
    const first = pack.values().next().value;
    if (first?.lightMap) lightmapDebug.drawPreview(first.lightMap);
  } else {
    clearLightmapsFromScene(gltfScene, { clearAo: true });
    apply = countMeshUvStats(gltfScene, lightmapConfig);
  }

  finalizeGltfPbrMaterials(gltfScene, lightmapConfig, (tex) =>
    configureBakedMapTexture(tex, lightmapConfig)
  );
  refreshLightmapRenderSettings(gltfScene, lightmapConfig);

  lightmapDebug.renderPanel({
    diagnostics,
    anyDiffuseLoaded: CONFIG.enableLightMaps && anyDiffuseLoaded,
    texturesLoaded: anyDiffuseLoaded,
    apply,
    usedManifest,
    manifestMeta: lightmapRuntime.manifestMeta,
  });

  lightmapRuntime.lastApply = apply;
  if (apply.skippedMeshNames?.length) {
    console.warn("[Lightmap] No manifest match for:", apply.skippedMeshNames);
  }
  if (levelFeatures.fan !== false) {
    refreshFanShadowFlags(gltfScene);
  }

  const packMaps = [];
  const seenMaps = new Set();
  for (const entry of pack.values()) {
    const tex = entry?.lightMap;
    if (tex?.isTexture && !seenMaps.has(tex.uuid)) {
      seenMaps.add(tex.uuid);
      packMaps.push(tex);
    }
  }
  perfStats.setLightmapInfo({
    atlasCount:
      Number(lightmapRuntime.manifestMeta?.atlasCount) ||
      lightmapRuntime.sharedAtlases?.size ||
      packMaps.length,
    lightMapTextures: packMaps,
  });
  perfStats.invalidateStructure();

  console.info(
    "[Lightmap] enableLightMaps =",
    CONFIG.enableLightMaps,
    apply,
    usedManifest ? "(manifest)" : "(stem fallback)"
  );
}

async function setupPhysicsForScene(root) {
  if (!usePhysics) return;

  try {
    physics = await createPhysics(CONFIG.physicsGravity);
    collisionLevel = createCollisionFromColMeshes(
      physics.RAPIER,
      physics.world,
      scene,
      root
    );
    collisionLevel.setDebugVisible(!!CONFIG.showCollisionDebug);

    const eyeHeight = (CONFIG.player?.eyeHeight ?? 1.71) * worldScale;
    const spawnPos = {
      x: camera.position.x,
      y: camera.position.y - eyeHeight,
      z: camera.position.z,
    };

    physicsPlayer = createPhysicsPlayer({
      RAPIER: physics.RAPIER,
      world: physics.world,
      scene,
      camera,
      spawn: spawnPos,
      worldScale,
      config: {
        ...CONFIG.player,
        enableJump: !!CONFIG.enableJump,
      },
    });
    physicsPlayer.setDebugVisible(!!CONFIG.showCollisionDebug);

    player.setPhysicsMovement(true);
    player.setJumpEnabled(!!CONFIG.enableJump);
    player.setJumpHandler(() => physicsPlayer?.queueJump());
  } catch (err) {
    console.error("[Physics] Failed to initialize — falling back to free movement:", err);
    physics = null;
    physicsPlayer = null;
    collisionLevel = null;
    player.setPhysicsMovement(false);
    player.setJumpEnabled(false);
    player.setJumpHandler(null);
  }
}

function setupInteractForScene(root) {
  if (CONFIG.enableInteract === false || levelFeatures.interact === false) return;

  fanState = createFanStateController({
    config: CONFIG,
    getGltfRoot: () => gltfScene,
    getLightmapConfig: () => lightmapRuntime?.lightmapConfig ?? null,
    fanPointLight: fanPointLight.light,
    bedRoomPointLight: fanPointLight.bedRoomLight,
    fanAnimation: null,
    renderer,
    getSceneRoot: () => scene,
  });

  interactSystem?.dispose();
  interactSystem = createInteractSystem({
    RAPIER: physics?.RAPIER ?? null,
    world: physics?.world ?? null,
    scene,
    camera,
    root,
    config: CONFIG,
    worldScale,
    getPlayerCollider: () => physicsPlayer?.collider ?? null,
    getPlayerPosition: () => {
      if (physicsPlayer?.body) {
        const t = physicsPlayer.body.translation();
        return new THREE.Vector3(t.x, t.y, t.z);
      }
      return camera.position;
    },
    getPlayerBody: () => physicsPlayer?.body ?? null,
    fanState,
    losRoots: () => (gltfScene ? [gltfScene] : []),
  });
}

function bootstrap() {
  console.info(`[Level] Loading "${CONFIG.levelName ?? CONFIG.levelId}" from`, CONFIG.glbUrl);
  gltfLoader.load(
    CONFIG.glbUrl,
    async (gltf) => {
      try {
        gltfScene = gltf.scene;
        scene.add(gltfScene);
        gltfScene.scale.setScalar(worldScale);
        gltfScene.updateMatrixWorld(true);
        perfStats.setGltfMeta(stampGltfIdentity(gltf));
        if (levelFeatures.stripGltfLights) {
          stripGltfLights(gltfScene);
        }
        if (levelFeatures.fan !== false) {
          // Default FanState is ON — hide Off lever before slow CDN lightmap loads.
          applyLightSwitchLeverVisibility(gltfScene, true);
        }

        // Bake COL_* colliders and detach them before lightmap / material work.
        await setupPhysicsForScene(gltfScene);
        // ENV_* sensors (non-blocking) + interact prompt / FanState.
        setupInteractForScene(gltfScene);
        if (levelFeatures.fan !== false) {
          fanState?.bootstrap();
        }

        disableRealtimeShadowsInScene(gltfScene);
        lighting.applySceneLightsEnabled(CONFIG.enableSceneLights, gltfScene);

        let fan = null;
        if (levelFeatures.fan !== false && fanPointLight.light) {
          const shadowSetup = setupFanPointLightShadows({
            renderer,
            gltfRoot: gltfScene,
            pointLight: fanPointLight.light,
            directionalLight: lighting.directionalLight,
            flashlight: lighting.flashlight,
            config: CONFIG,
          });
          fan = shadowSetup.fan;
          lightDebug.refreshLights();
          lightDebug.selectByName("FanPointLightFill");
          fanAnimation?.dispose();
          fanAnimation = createFanAnimation({
            gltf,
            fanMesh: fan,
            config: CONFIG,
          });
          fanState?.setFanAnimation(fanAnimation);
          fanState?.setFanPointLight(fanPointLight.light);
          fanState?.setBedRoomPointLight(fanPointLight.bedRoomLight);
        } else {
          lightDebug.refreshLights();
        }

        lightmapRuntime = await loadLightmapResources(gltfScene);

        traverseMeshesEnsureLightmapUv(gltfScene, lightmapRuntime.lightmapConfig);
        console.info("[Lightmap] GLB mesh nodes:", collectSceneMeshNames(gltfScene));
        finalizeGltfPbrMaterials(gltfScene, lightmapRuntime.lightmapConfig, (tex) =>
          configureBakedMapTexture(tex, lightmapRuntime.lightmapConfig)
        );

        syncLightmapApplication();
        refreshLightmapRenderSettings(gltfScene, lightmapRuntime.lightmapConfig);
        perfSystem.reapplySceneSettings();
        if (levelFeatures.fan !== false) {
          // Lightmap/material passes can rebuild materials — re-assert Fan shadows.
          refreshFanShadowFlags(gltfScene);
          // Apply FanState defaults (ON) after lightmaps exist.
          fanState?.bootstrap();
          // Re-assert bulb materials after any late material passes.
          fanState?.sync();
        }
        perfStats.invalidateStructure();
      } catch (err) {
        console.error("[Lightmap] After GLB load:", err);
      }
    },
    undefined,
    (error) => console.error("Failed to load GLB:", error)
  );
}

setupEnvironment(scene, renderer, CONFIG).then(async () => {
  if (CONFIG.useBlenderLightingManifest !== false) {
    const manifest = await loadBlenderLightingManifest(CONFIG.lightmapTextureBasePath);
    if (manifest) applyBlenderLightingManifest(lighting, manifest, CONFIG, worldScale);
  }
  bootstrap();
});

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);
  player.updateCameraRotation();

  if (physics && physicsPlayer) {
    physicsAccumulator += dt;
    let steps = 0;
    while (physicsAccumulator >= FIXED_DT && steps < MAX_PHYSICS_STEPS) {
      physicsPlayer.update(FIXED_DT, player.getMoveState());
      stepPhysics(physics.world);
      physicsAccumulator -= FIXED_DT;
      steps += 1;
    }
  } else {
    player.updateMovement(dt);
  }

  if (CONFIG.enableFlashlight) {
    camera.getWorldDirection(cameraLookDir);
    lighting.updateFlashlight(camera, cameraLookDir, worldScale);
  }

  lightDebug.update(dt);
  fanAnimation?.update(dt);
  interactSystem?.update(dt);
  perfStats.beginFrame();
  postFX.render();
  perfStats.endFrame();
  perfSystem.tick(dt);
}

animate();
