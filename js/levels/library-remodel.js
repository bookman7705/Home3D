import { assetUrl, lightmapBasePath } from "asset-config";

/**
 * Library remodel — same stage as source model-mobile.glb, served as library.glb.
 * COL_* / ENV_* can be added to the GLB as the level is built out.
 */
export const LIBRARY_REMODEL_LEVEL = {
  id: "library-remodel",
  name: "Library Remodel",
  glbUrl: assetUrl("models", "library.glb"),
  lightmapTextureBasePath: lightmapBasePath("library"),
  /** Matches the source library spawn. */
  cameraSpawn: [-3.3, 1.6, -1.4],
  features: {
    music: true,
    interact: false,
    fan: false,
    windowRectLight: false,
    bedRoomPointLight: false,
    scenePointLight: false,
    stripGltfLights: true,
  },
  player: {
    eyeHeight: 1.6,
    gravity: -20.0,
  },
  physicsGravity: { x: 0, y: -9.81, z: 0 },
  music: {
    enabled: true,
    mp3Url: assetUrl("music", "track01.mp3"),
  },
  lighting: {
    ambientIntensity: 0.2,
    enableDirectionalLight: true,
    directionalIntensity: 0.12,
    blenderDirectionalEulerDeg: [73.5116, -20.454, -86.677],
    blenderEulerOrder: "XYZ",
    environmentHdrUrl: assetUrl("hdr", "aerodynamics_workshop_1k.hdr"),
    iblEnvMapIntensity: 0.2,
    enableRealtimeShadows: false,
    enableDebugPointLight: false,
    lightMapIntensity: 1,
    /** Linear filter — nearest makes thin T-bar lightmap islands look broken. */
    disableLightmapEdgeBleeding: false,
  },
  pointLight: {
    fanPointLightIntensity: 0,
    bedRoomPointLightIntensity: 0,
  },
  rectAreaLight: {
    enableBlenderRectAreaLight: false,
  },
  interact: {
    enableInteract: false,
  },
  /**
   * Table1_LOD0..2 and Table2_LOD0..2 in library.glb.
   * Debug HUD is on so you can watch the swap while walking the room.
   */
  lod: {
    enabled: true,
    debug: true,
    distances: [3.5, 8],
    cullDistance: 22,
    hysteresis: 0.2,
    dwellMs: 180,
    overrides: {
      Table1: {
        distances: [10, 15],
        cullDistance: 25,
      },
      Table2: {
        distances: [10, 15],
        cullDistance: 25,
      },
    },
  },
};
