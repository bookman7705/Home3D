import { assetUrl, lightmapBasePath } from "asset-config";

/** Original floor.glb level — fan, light switch, baked lightmaps, bedroom fill. */
export const FLOOR_LEVEL = {
  id: "floor",
  name: "Room Test",
  glbUrl: assetUrl("models", "room_test.glb"),
  lightmapTextureBasePath: lightmapBasePath("room_test"),
  cameraSpawn: [2.11, 1.71, -0.564],
  features: {
    music: true,
    interact: true,
    fan: true,
    windowRectLight: true,
    bedRoomPointLight: true,
    scenePointLight: true,
    stripGltfLights: false,
  },
  player: {
    eyeHeight: 1.71,
    gravity: -20.0,
  },
  physicsGravity: { x: 0, y: -9.81, z: 0 },
  music: {
    enabled: true,
    oggUrl: assetUrl("music", "Snoop.ogg"),
    mp3Url: assetUrl("music", "snoop.mp3"),
  },
  lighting: {
    ambientIntensity: 0.1,
    enableDirectionalLight: false,
    directionalIntensity: 0.0,
    environmentHdrUrl: assetUrl("hdr", "aerodynamics_workshop_1k.hdr"),
    enableRealtimeShadows: true,
    lightMapIntensity: 0.8,
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
