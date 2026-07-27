import { ASSET_CDN } from "../assets.js";

/**
 * Library remodel — work-in-progress stage (no floors, interactions, or music yet).
 * COL_* / ENV_* can be added to the GLB as the level is built out.
 */
export const LIBRARY_REMODEL_LEVEL = {
  id: "library-remodel",
  name: "Library Remodel",
  glbUrl: `${ASSET_CDN}/models/LibraryRemodel.glb`,
  lightmapTextureBasePath: `${ASSET_CDN}/LightMaps/`,
  /** Eye height 1.6 m; X/Z at origin until spawn markers are authored in Blender. */
  cameraSpawn: [0, 1.6, 0],
  features: {
    music: false,
    interact: false,
    fan: false,
    windowRectLight: false,
    bedRoomPointLight: false,
    scenePointLight: true,
  },
  player: {
    eyeHeight: 1.6,
    gravity: 0,
  },
  /** No falling until floor colliders are added. */
  physicsGravity: { x: 0, y: 0, z: 0 },
  music: {
    enabled: false,
    // oggUrl: `${ASSET_CDN}/music/LibraryRemodel.ogg`,
    // mp3Url: `${ASSET_CDN}/music/LibraryRemodel.mp3`,
  },
  lighting: {
    ambientIntensity: 0.04,
    enableDirectionalLight: true,
    directionalIntensity: 0.12,
    environmentHdrUrl: `${ASSET_CDN}/hdr/aerodynamics_workshop_1k.hdr`,
    iblEnvMapIntensity: 0.15,
    enableRealtimeShadows: false,
  },
  /** Single fill light at the player spawn (follows cameraSpawn). */
  pointLight: {
    fanPointLightPosition: [0, 1.6, 0],
    fanPointLightIntensity: 0.8,
    fanPointLightDistance: 12,
    bedRoomPointLightIntensity: 0,
  },
  rectAreaLight: {
    enableBlenderRectAreaLight: false,
  },
  interact: {
    enableInteract: false,
  },
};
