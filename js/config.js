/**
 * App configuration — lightmap paths + lighting defaults (see lighting.js).
 */
import { LIGHTING_DEFAULTS } from "./lighting.js";
import { DEBUG_POINT_LIGHT_DEFAULTS } from "./debug-point-light.js";
import { BLENDER_RECT_LIGHT_DEFAULTS } from "./blender-rect-area-light.js";
import { INTERACT_DEFAULTS } from "./interact/defaults.js";

/**
 * AutoLightmapv5: per-object entries in lightmaps/lightmap_manifest.json
 * (written by AutoLightmapv5.py). Supports shared profile atlases, per-entry
 * bakeSettings, and AO paths. Stem/global-atlas fallbacks apply when the
 * manifest is missing or useLightmapManifest is false.
 */
/** Cloudflare R2 public base for heavy assets (models, HDR, lightmaps, music). */
const ASSET_CDN = "https://pub-3c9ceee935014032b48e5e145fa85eab.r2.dev/Home3D";

export const CONFIG = {
  glbUrl: `${ASSET_CDN}/models/floor.glb`,
  /** Global world/model scale (1 = authored size). */
  worldScale: 1,
  /** Same as AutoLightmap.py IMAGE_NAME (grouped atlases only). */
  IMAGE_NAME: "LightmapAtlas",
  /** Shared atlas stem — leave empty when using lightmap_manifest.json per mesh. */
  lightmapBaseStem: "",
  /** glTF node name → baked PNG stem (no extension). Fallback when manifest is off. */
  lightmapMeshStems: {},
  /** Folder containing baked PNGs and lightmap_manifest.json */
  lightmapTextureBasePath: `${ASSET_CDN}/lightmaps/`,
  /** Background music (OGG preferred; MP3 fallback for Safari / iOS). */
  musicOggUrl: `${ASSET_CDN}/music/Snoop.ogg`,
  musicMp3Url: `${ASSET_CDN}/music/snoop.mp3`,
  musicVolume: 0.55,
  /** Load AutoLightmapv5 lightmap_manifest.json (lightmaps / meshes / meshesByName). */
  useLightmapManifest: true,
  lightmapManifestFilename: "lightmap_manifest.json",
  /** Blender LightMap UV → glTF TEXCOORD_1 → three.js geometry `uv1` + lightMap.channel 1 */
  lightmapUvChannel: 1,
  /** Tried in order per base name */
  textureExtensions: [".png", ".jpg", ".jpeg", ".webp"],
  /** Toggle baked GI lightmap loading/application. */
  enableLightMaps: true,
  /** Auto-enabled when manifest entries include AO filenames (v5+). v6 bakes AO into the lightmap PNG. */
  loadAoMaps: false,
  /** Default; FanState ON uses fanStateOnLightMapIntensity (see interact/). */
  lightMapIntensity: 0.8,
  /** false = LinearFilter on lightmaps (softer); true = Nearest (default, avoids UV bleed). */
  disableLightmapEdgeBleeding: false,
  aoMapIntensity: 0.1,
  /** On-screen panel: load status, UV2 stats, lightmap thumbnail. */
  showLightmapDebugUI: false,
  /** Multiplier for L-key lightmap debug view (linear bake values are often very dark). */
  lightmapDebugExposure: 6,
  /** Force FrontSide on glTF materials (culls back faces; overrides doubleSided exports). */
  forceBackfaceCulling: true,
  /**
   * Rapier character / collision (see physics/).
   * COL_* meshes in the GLB become invisible trimesh colliders.
   */
  enablePhysics: true,
  /** Jump logic is implemented; leave false until jump is enabled in-game. */
  enableJump: false,
  showCollisionDebug: false,
  /** LightDebug HUD: cycle/move any realtime light (see debug/light-debug.js). */
  enableLightDebug: false,
  showDebugPointLightOrb: false,
  player: {
    radius: 0.4,
    halfHeight: 0.5,
    eyeHeight: 1.71,
    moveSpeed: 2.7,
    jumpSpeed: 7.0,
    gravity: -20.0,
  },
  ...LIGHTING_DEFAULTS,
  /** Equirect HDR — served from Cloudflare R2. */
  environmentHdrUrl: `${ASSET_CDN}/hdr/aerodynamics_workshop_1k.hdr`,
  ...DEBUG_POINT_LIGHT_DEFAULTS,
  ...BLENDER_RECT_LIGHT_DEFAULTS,
  ...INTERACT_DEFAULTS,
  /** Directional sun disabled — WindowLight + FanPointLightFill only. */
  enableDirectionalLight: false,
  enableDebugPointLight: false,
  /** PointLight shadow maps (Fan is the only caster — see fan.js). */
  enableRealtimeShadows: true,
  /** FanPointLightFill start (world space). */
  fanPointLightPosition: [-0.071, 2.371, -6.159],
  debugPointLightPosition: [-0.071, 2.371, -6.159],
  /** Keep false when using an explicit start position above. */
  attachPointLightToFan: false,
  fanLightOffsetY: 0.12,
  /** Shadow-casting FanPointLightFill. */
  fanPointLightIntensity: 0.5,
  fanPointLightDistance: 10,
  fanPointLightColor: 0xffffff,
  fanPointLightDecay: 2,
  /** Independent PointLight_BedRoom (no shadows). */
  bedRoomPointLightPosition: [-0.071, 2.371, -6.159],
  bedRoomPointLightIntensity: 8,
  bedRoomPointLightDistance: 10,
  bedRoomPointLightColor: 0xffffff,
  bedRoomPointLightDecay: 2,
  pointLightShadowMapSize: 128,
  pointLightShadowFar: 16,
  pointLightShadowNear: 0.02,
  pointLightShadowBias: -0.0005,
  pointLightShadowNormalBias: 0.02,
  /** PCF soft radius (higher = softer fan blade penumbra). */
  pointLightShadowRadius: 8,
  /** Procedural Fan spin when the GLB has no animation clips. */
  fanSpinRpm: 20,
  /** Local axis: "x" | "y" | "z" (FBX Fan hub is local Z). */
  fanSpinAxis: "z",
};
