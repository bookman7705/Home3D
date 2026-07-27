import { FLOOR_LEVEL } from "./floor.js";
import { LIBRARY_REMODEL_LEVEL } from "./library-remodel.js";

/** Change this to switch the active stage without touching scene code. */
export const ACTIVE_LEVEL_ID = "library-remodel";

export const LEVELS = {
  [FLOOR_LEVEL.id]: FLOOR_LEVEL,
  [LIBRARY_REMODEL_LEVEL.id]: LIBRARY_REMODEL_LEVEL,
};

/**
 * @param {string} [levelId]
 * @returns {typeof FLOOR_LEVEL}
 */
export function getLevel(levelId = ACTIVE_LEVEL_ID) {
  const level = LEVELS[levelId];
  if (!level) {
    throw new Error(`[Levels] Unknown level id "${levelId}". Available: ${Object.keys(LEVELS).join(", ")}`);
  }
  return level;
}

export function getActiveLevel() {
  return getLevel(ACTIVE_LEVEL_ID);
}

/**
 * Merge a level definition into the shared CONFIG object.
 * @param {Record<string, unknown>} base
 * @param {typeof FLOOR_LEVEL} level
 */
export function applyLevelToConfig(base, level) {
  const config = { ...base };

  config.levelId = level.id;
  config.levelName = level.name;
  config.levelFeatures = { ...level.features };
  config.glbUrl = level.glbUrl;

  if (level.lightmapTextureBasePath) {
    config.lightmapTextureBasePath = level.lightmapTextureBasePath;
  }
  if (level.cameraSpawn) {
    config.cameraSpawn = [...level.cameraSpawn];
  }
  if (level.player) {
    config.player = { ...config.player, ...level.player };
  }
  if (level.physicsGravity) {
    config.physicsGravity = { ...level.physicsGravity };
  }

  if (level.music) {
    config.enableMusic = level.music.enabled !== false;
    if (level.music.oggUrl) config.musicOggUrl = level.music.oggUrl;
    if (level.music.mp3Url) config.musicMp3Url = level.music.mp3Url;
  }

  if (level.lighting) Object.assign(config, level.lighting);
  if (level.pointLight) Object.assign(config, level.pointLight);
  if (level.rectAreaLight) Object.assign(config, level.rectAreaLight);
  if (level.interact) Object.assign(config, level.interact);

  return config;
}
