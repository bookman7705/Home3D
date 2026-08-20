/**
 * Tunable performance budgets and settings metadata.
 * Values are starting points for mobile (Adreno 710-class) testing — not guarantees.
 */

export const STORAGE_KEY = "roomTest.performanceSettings";
export const STORAGE_VERSION = 1;

/** Hard cap so DPR 3 devices never automatically render at 3x. */
export const PIXEL_RATIO_HARD_CAP = 2;

export const PERFORMANCE_TARGETS = {
  60: {
    targetFrameMs: 16.67,
    goodMs: 15.5,
    warningMs: 18,
    severeMs: 22,
    preferredMaxPixelRatio: 1.5,
  },
  30: {
    targetFrameMs: 33.33,
    goodMs: 31,
    warningMs: 36,
    severeMs: 44,
    preferredMaxPixelRatio: 1.0,
  },
};

/** User-facing render quality → pixel-ratio limits. Easy to retune. */
export const RENDER_QUALITY = {
  ultra: { pixelRatio: 2.0, minPixelRatio: 0.75, label: "Ultra" },
  high: { pixelRatio: 1.5, minPixelRatio: 0.75, label: "High" },
  medium: { pixelRatio: 1.25, minPixelRatio: 0.75, label: "Medium" },
  low: { pixelRatio: 1.0, minPixelRatio: 0.625, label: "Low" },
  "very-low": { pixelRatio: 0.75, minPixelRatio: 0.5, label: "Very Low" },
};

export const BLOOM_QUALITY = {
  high: { nMips: 5, resolutionScale: 1, label: "High" },
  medium: { nMips: 3, resolutionScale: 0.65, label: "Medium" },
  low: { nMips: 2, resolutionScale: 0.45, label: "Low" },
};

export const TEXTURE_QUALITY = {
  high: { anisotropy: 8, label: "High" },
  medium: { anisotropy: 4, label: "Medium" },
  low: { anisotropy: 1, nearestMip: true, label: "Low" },
};

export const SHADOW_QUALITY = {
  high: { mapSize: 256, type: "pcfsoft", radius: 8, label: "High" },
  medium: { mapSize: 128, type: "pcf", radius: 4, label: "Medium" },
  low: { mapSize: 64, type: "basic", radius: 1, label: "Low" },
  off: { mapSize: 0, type: "basic", radius: 1, label: "Off" },
};

export const POST_PROCESSING_QUALITY = {
  high: { label: "High" },
  medium: { label: "Medium" },
  low: { label: "Low" },
  off: { label: "Off" },
};

export const PRESET_IDS = ["maximum", "balanced", "performance", "battery", "custom"];

export const PRESET_LABELS = {
  maximum: "Maximum Quality",
  balanced: "Balanced",
  performance: "Performance",
  battery: "Battery Saver",
  custom: "Custom",
};

const PRESET_SHARED = {
  autoPerformance: true,
  performanceMonitor: false,
};

export const PRESETS = {
  maximum: {
    ...PRESET_SHARED,
    performancePreset: "maximum",
    targetFPS: 60,
    renderQuality: "ultra",
    dynamicResolution: true,
    bloom: true,
    bloomQuality: "high",
    postProcessingQuality: "high",
    lightmaps: true,
    textureQuality: "high",
    shadowQuality: "high",
    autoPerformance: false,
  },
  balanced: {
    ...PRESET_SHARED,
    performancePreset: "balanced",
    targetFPS: 60,
    renderQuality: "high",
    dynamicResolution: true,
    bloom: true,
    bloomQuality: "medium",
    postProcessingQuality: "medium",
    lightmaps: true,
    textureQuality: "high",
    shadowQuality: "medium",
  },
  performance: {
    ...PRESET_SHARED,
    performancePreset: "performance",
    targetFPS: 60,
    renderQuality: "low",
    dynamicResolution: true,
    bloom: false,
    bloomQuality: "low",
    postProcessingQuality: "low",
    lightmaps: true,
    textureQuality: "medium",
    shadowQuality: "low",
  },
  battery: {
    ...PRESET_SHARED,
    performancePreset: "battery",
    targetFPS: 30,
    renderQuality: "very-low",
    dynamicResolution: true,
    bloom: false,
    bloomQuality: "low",
    postProcessingQuality: "off",
    lightmaps: true,
    textureQuality: "low",
    shadowQuality: "off",
  },
};

export const DEFAULT_PRESET = "balanced";

export const DEFAULT_SETTINGS = {
  ...PRESETS[DEFAULT_PRESET],
  firstRunSeen: false,
};

/**
 * Per-setting metadata used by the UI and apply path.
 * requiresRestart is the extension point — current graphics controls are runtime-safe.
 */
export const SETTING_META = {
  performancePreset: {
    requiresRestart: false,
    label: "Preset",
    description: "Applies a bundle of graphics options. Switching to Custom after you tweak a value.",
  },
  targetFPS: {
    requiresRestart: false,
    label: "Target FPS",
    description: "Budget for dynamic resolution and auto performance. Does not cap the frame rate.",
  },
  renderQuality: {
    requiresRestart: false,
    label: "Render Quality",
    description: "Lower resolution improves GPU performance. Capped by your device pixel ratio (never forced to 3x).",
  },
  dynamicResolution: {
    requiresRestart: false,
    label: "Dynamic Resolution",
    description: "Smoothly lowers internal render resolution when frame time is high, without exceeding the selected quality.",
  },
  bloom: {
    requiresRestart: false,
    label: "Bloom",
    description: "Fullscreen glow pass. Disabling it removes the bloom draws entirely.",
  },
  bloomQuality: {
    requiresRestart: false,
    label: "Bloom Quality",
    description: "Fewer mip levels and a smaller bloom buffer cost less GPU fill rate.",
  },
  postProcessingQuality: {
    requiresRestart: false,
    label: "Post Processing",
    description: "Composer / bloom resolution. Off renders the scene directly (tone mapping stays on the renderer).",
  },
  lightmaps: {
    requiresRestart: false,
    label: "Lightmaps",
    description: "Baked lighting textures. Turning off uses only realtime / IBL lighting.",
  },
  textureQuality: {
    requiresRestart: false,
    label: "Texture Quality",
    description: "Anisotropy and mip filtering. Does not reload assets.",
  },
  shadowQuality: {
    requiresRestart: false,
    label: "Shadows",
    description: "Realtime shadow map size and filter. Hidden when this level does not use shadows.",
  },
  autoPerformance: {
    requiresRestart: false,
    label: "Auto Performance",
    description: "If frame time stays high after resolution scaling, reduces bloom and post-processing.",
  },
  performanceMonitor: {
    requiresRestart: false,
    label: "Performance Monitor",
    description: "Lightweight on-screen FPS / resolution / draw stats.",
  },
};

export const SETTING_KEYS = [
  "performancePreset",
  "targetFPS",
  "renderQuality",
  "dynamicResolution",
  "bloom",
  "bloomQuality",
  "postProcessingQuality",
  "lightmaps",
  "textureQuality",
  "shadowQuality",
  "autoPerformance",
  "performanceMonitor",
];

export const DYN_RES = {
  stepDown: 0.125,
  stepDownSevere: 0.25,
  stepUp: 0.1,
  cooldownDownMs: 450,
  cooldownUpMs: 900,
  minIntervalMs: 400,
};

export const AUTO_PERF = {
  cooldownMs: 2800,
  recoverMs: 5500,
  minSamples: 45,
};

export function cloneSettings(settings) {
  const out = {};
  for (const key of SETTING_KEYS) out[key] = settings[key];
  out.firstRunSeen = !!settings.firstRunSeen;
  return out;
}

export function diffSettings(a, b) {
  return SETTING_KEYS.filter((key) => a[key] !== b[key]);
}

export function settingsEqual(a, b) {
  return diffSettings(a, b).length === 0;
}

export function applyPresetToSettings(presetId, current) {
  const preset = PRESETS[presetId];
  if (!preset || presetId === "custom") {
    return { ...cloneSettings(current), performancePreset: "custom" };
  }
  const next = cloneSettings(current);
  for (const key of SETTING_KEYS) {
    if (key in preset) next[key] = preset[key];
  }
  next.performancePreset = presetId;
  return next;
}

export function inferPreset(settings) {
  for (const id of PRESET_IDS) {
    if (id === "custom") continue;
    const preset = PRESETS[id];
    let match = true;
    for (const key of SETTING_KEYS) {
      if (key === "performancePreset" || key === "performanceMonitor") continue;
      if (preset[key] !== settings[key]) {
        match = false;
        break;
      }
    }
    if (match) return id;
  }
  return "custom";
}
