import {
  STORAGE_KEY,
  STORAGE_VERSION,
  DEFAULT_SETTINGS,
  PRESET_IDS,
  RENDER_QUALITY,
  BLOOM_QUALITY,
  POST_PROCESSING_QUALITY,
  TEXTURE_QUALITY,
  SHADOW_QUALITY,
  cloneSettings,
  inferPreset,
} from "./constants.js";

function isBool(value) {
  return value === true || value === false;
}

function pickEnum(value, table, fallback) {
  return value in table ? value : fallback;
}

function sanitize(raw) {
  const base = cloneSettings(DEFAULT_SETTINGS);
  if (!raw || typeof raw !== "object") return base;

  const preset = PRESET_IDS.includes(raw.performancePreset)
    ? raw.performancePreset
    : base.performancePreset;

  const targetFPS = raw.targetFPS === 30 || raw.targetFPS === 60 ? raw.targetFPS : 60;

  return {
    performancePreset: preset,
    targetFPS,
    renderQuality: pickEnum(raw.renderQuality, RENDER_QUALITY, base.renderQuality),
    dynamicResolution: isBool(raw.dynamicResolution)
      ? raw.dynamicResolution
      : base.dynamicResolution,
    bloom: isBool(raw.bloom) ? raw.bloom : base.bloom,
    bloomQuality: pickEnum(raw.bloomQuality, BLOOM_QUALITY, base.bloomQuality),
    postProcessingQuality: pickEnum(
      raw.postProcessingQuality,
      POST_PROCESSING_QUALITY,
      base.postProcessingQuality
    ),
    lightmaps: isBool(raw.lightmaps) ? raw.lightmaps : base.lightmaps,
    textureQuality: pickEnum(raw.textureQuality, TEXTURE_QUALITY, base.textureQuality),
    shadowQuality: pickEnum(raw.shadowQuality, SHADOW_QUALITY, base.shadowQuality),
    autoPerformance: isBool(raw.autoPerformance)
      ? raw.autoPerformance
      : base.autoPerformance,
    performanceMonitor: isBool(raw.performanceMonitor)
      ? raw.performanceMonitor
      : base.performanceMonitor,
    firstRunSeen: isBool(raw.firstRunSeen) ? raw.firstRunSeen : false,
  };
}

export function loadPerformanceSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { settings: cloneSettings(DEFAULT_SETTINGS), firstRun: true, ok: true };
    }
    const parsed = JSON.parse(raw);
    const settings = sanitize(parsed?.settings ?? parsed);
    settings.performancePreset = inferPreset(settings);
    if (parsed?.version != null && parsed.version !== STORAGE_VERSION) {
      console.info("[PerfSettings] Migrated stored settings from version", parsed.version);
    }
    return { settings, firstRun: !settings.firstRunSeen, ok: true };
  } catch (err) {
    console.warn("[PerfSettings] Ignored invalid stored settings:", err);
    return { settings: cloneSettings(DEFAULT_SETTINGS), firstRun: true, ok: false };
  }
}

export function savePerformanceSettings(settings) {
  const sanitized = sanitize(settings);
  sanitized.performancePreset = inferPreset(sanitized);
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STORAGE_VERSION,
        settings: sanitized,
      })
    );
  } catch (err) {
    console.warn("[PerfSettings] Failed to persist settings:", err);
  }
  return sanitized;
}

export function presetExists(id) {
  return id in PRESETS;
}
