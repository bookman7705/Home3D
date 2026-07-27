import { ASSET_CDN } from "../assets.js";

/** Original floor.glb level — fan, light switch, baked lightmaps, bedroom fill. */
export const FLOOR_LEVEL = {
  id: "floor",
  name: "Floor",
  glbUrl: `${ASSET_CDN}/models/floor.glb`,
  lightmapTextureBasePath: `${ASSET_CDN}/LightMaps/`,
  cameraSpawn: [2.11, 1.71, -0.564],
  features: {
    music: true,
    interact: true,
    fan: true,
    windowRectLight: true,
    bedRoomPointLight: true,
    scenePointLight: true,
  },
  player: {
    eyeHeight: 1.71,
    gravity: -20.0,
  },
  physicsGravity: { x: 0, y: -9.81, z: 0 },
  music: {
    enabled: true,
    oggUrl: `${ASSET_CDN}/music/Snoop.ogg`,
    mp3Url: `${ASSET_CDN}/music/snoop.mp3`,
  },
  lighting: {
    ambientIntensity: 0.1,
    enableDirectionalLight: false,
    directionalIntensity: 0.0,
    environmentHdrUrl: `${ASSET_CDN}/hdr/aerodynamics_workshop_1k.hdr`,
    enableRealtimeShadows: true,
  },
  pointLight: {
    fanPointLightPosition: [-0.071, 2.371, -6.159],
    fanPointLightIntensity: 0.5,
    bedRoomPointLightPosition: [-0.071, 2.371, -6.159],
    bedRoomPointLightIntensity: 8,
  },
  rectAreaLight: {
    enableBlenderRectAreaLight: true,
  },
  interact: {
    enableInteract: true,
  },
};
