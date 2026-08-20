import {
  AUTO_PERF,
  DYN_RES,
  PERFORMANCE_TARGETS,
  PIXEL_RATIO_HARD_CAP,
  RENDER_QUALITY,
  SETTING_META,
  applyPresetToSettings,
  cloneSettings,
  diffSettings,
  inferPreset,
} from "./constants.js";
import { loadPerformanceSettings, savePerformanceSettings } from "./store.js";
import { recommendPreset } from "./device.js";
import { applyTextureQualityToScene } from "../materials.js";
import { applyRealtimeShadowQuality } from "../lighting.js";

function qualitySpec(id) {
  return RENDER_QUALITY[id] || RENDER_QUALITY.high;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function pixelRatioForQuality(renderQuality, devicePixelRatio = window.devicePixelRatio) {
  const spec = qualitySpec(renderQuality);
  const dpr = Number(devicePixelRatio) || 1;
  return clamp(spec.pixelRatio, spec.minPixelRatio, Math.min(dpr, PIXEL_RATIO_HARD_CAP));
}

function minPixelRatioForQuality(renderQuality, devicePixelRatio = window.devicePixelRatio) {
  const spec = qualitySpec(renderQuality);
  const dpr = Number(devicePixelRatio) || 1;
  const max = Math.min(spec.pixelRatio, dpr, PIXEL_RATIO_HARD_CAP);
  return clamp(spec.minPixelRatio, 0.5, max);
}

/**
 * Central owner of renderer pixel ratio, composer size, bloom, and adaptive quality.
 * Dynamic resolution scales EffectComposer targets only — never the canvas buffer.
 */
export function createPerformanceManager({
  renderer,
  scene,
  camera,
  postFX,
  config,
  hooks = {},
} = {}) {
  const loaded = loadPerformanceSettings();
  const deviceProfile = recommendPreset(renderer);
  let current = cloneSettings(loaded.settings);
  if (loaded.firstRun) {
    current = applyPresetToSettings(deviceProfile.preset, current);
  }
  let pending = cloneSettings(current);
  let uiOpen = false;
  let effectivePixelRatio = pixelRatioForQuality(current.renderQuality);
  let lastCssW = window.innerWidth;
  let lastCssH = window.innerHeight;
  let lastDynChangeAt = 0;
  let lastAutoChangeAt = 0;
  let autoStep = 0;

  const frameTimes = new Float32Array(120);
  const sortedScratch = new Float32Array(120);
  let ftWrite = 0;
  let ftCount = 0;
  let ftSum = 0;
  let worstFrameMs = 0;
  let hudFps = 0;
  let onePercentLow = 0;
  let avgFrameMs = 16.67;
  let lastHudCompute = 0;

  const capabilities = {
    shadows:
      config.enableRealtimeShadows === true && config.levelFeatures?.fan !== false,
    lightmaps: true,
    textureQuality: true,
    physics: false,
  };

  function emit(name, detail) {
    hooks.onEvent?.(name, detail);
  }

  function maxPixelRatio() {
    return pixelRatioForQuality(current.renderQuality);
  }

  function minPixelRatio() {
    return minPixelRatioForQuality(current.renderQuality);
  }

  function syncConfigFlags(settings) {
    config.enableLightMaps = !!settings.lightmaps;
    config.enableBloom =
      !!settings.bloom && settings.postProcessingQuality !== "off";
  }

  function applyPixelRatio(nextPR, { force = false } = {}) {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    const lo = minPixelRatio();
    const hi = maxPixelRatio();
    const pr = clamp(Number(nextPR) || hi, lo, hi);
    const sizeChanged = cssW !== lastCssW || cssH !== lastCssH;
    const displayPR = hi;
    const canvas = renderer.domElement;
    const nextBufW = Math.max(1, Math.floor(cssW * displayPR));
    const nextBufH = Math.max(1, Math.floor(cssH * displayPR));
    const bufferChanged = canvas.width !== nextBufW || canvas.height !== nextBufH;
    const renderChanged = Math.abs(pr - effectivePixelRatio) > 0.001;
    if (!force && !sizeChanged && !bufferChanged && !renderChanged) return false;

    camera.aspect = cssW / Math.max(1, cssH);
    camera.updateProjectionMatrix();

    // Keep the canvas drawing buffer at the quality cap. Changing canvas.width
    // (setPixelRatio / setSize) clears the bitmap and blinks on mobile browsers.
    // Dynamic resolution only scales composer render targets, then blits up.
    if (sizeChanged || bufferChanged) {
      const displayChanged = Math.abs(renderer.getPixelRatio() - displayPR) > 0.001;
      if (displayChanged) renderer.setPixelRatio(displayPR);
      if (sizeChanged || canvas.width !== nextBufW || canvas.height !== nextBufH) {
        renderer.setSize(cssW, cssH, sizeChanged);
      }
    }

    effectivePixelRatio = pr;
    lastCssW = cssW;
    lastCssH = cssH;
    postFX.resize(pr);
    return true;
  }

  function applyBloomAndPost(settings) {
    const composerOn = settings.postProcessingQuality !== "off";
    const bloomOn = composerOn && !!settings.bloom;
    postFX.setComposerEnabled(composerOn);
    postFX.setBloomEnabled(bloomOn);
    if (composerOn && bloomOn) {
      postFX.setBloomQuality(settings.bloomQuality, settings.postProcessingQuality);
    } else if (composerOn) {
      postFX.setBloomQuality("low", settings.postProcessingQuality);
    }
    postFX.resize(effectivePixelRatio);
  }

  function applyLightmaps(settings) {
    syncConfigFlags(settings);
    hooks.syncLightmaps?.();
  }

  function applyTextures(settings) {
    const root = hooks.getGltfRoot?.() || scene;
    const maxAniso = renderer.capabilities?.getMaxAnisotropy?.() || 1;
    applyTextureQualityToScene(root, settings.textureQuality, maxAniso);
  }

  function applyShadows(settings) {
    if (!capabilities.shadows) return;
    applyRealtimeShadowQuality({
      renderer,
      scene,
      pointLight: hooks.getShadowLight?.() || null,
      quality: settings.shadowQuality,
      config,
    });
  }

  function applySettings(next, { persist = true, reason = "apply" } = {}) {
    const settings = cloneSettings(next);
    settings.performancePreset = inferPreset(settings);
    settings.firstRunSeen = !!(next.firstRunSeen || current.firstRunSeen);
    const changed = diffSettings(current, settings);
    current = settings;
    pending = cloneSettings(current);
    autoStep = 0;
    syncConfigFlags(current);
    applyPixelRatio(pixelRatioForQuality(current.renderQuality), { force: true });
    applyBloomAndPost(current);
    applyShadows(current);
    if (changed.includes("lightmaps") && hooks.getGltfRoot?.()) {
      applyLightmaps(current);
    }
    applyTextures(current);
    if (persist) savePerformanceSettings(current);
    hooks.invalidatePerfStats?.();
    hooks.setMonitorVisible?.(!!current.performanceMonitor);
    emit("applied", { settings: cloneSettings(current), changed, reason });
    console.info("[PerfSettings] Applied", reason, {
      preset: current.performancePreset,
      quality: current.renderQuality,
      pixelRatio: Number(effectivePixelRatio.toFixed(3)),
      bloom: current.bloom,
      bloomQuality: current.bloomQuality,
      postFX: current.postProcessingQuality,
      lightmaps: current.lightmaps,
    });
    return current;
  }

  function requiresRestart(keys) {
    return keys.filter((key) => SETTING_META[key]?.requiresRestart);
  }

  function setPending(key, value) {
    if (key === "performancePreset") {
      pending = applyPresetToSettings(value, pending);
      return pending;
    }
    if (!(key in pending)) return pending;
    pending[key] = value;
    pending.performancePreset = inferPreset(pending);
    return pending;
  }

  function commitPending() {
    const changed = diffSettings(current, pending);
    if (changed.length === 0) {
      return { applied: true, restartKeys: [], changed };
    }
    const restartKeys = requiresRestart(changed);
    if (restartKeys.length) {
      return { applied: false, restartKeys, changed };
    }
    applySettings(pending, { reason: "close" });
    return { applied: true, restartKeys: [], changed };
  }

  function persistAndReload() {
    current = cloneSettings(pending);
    current.firstRunSeen = true;
    savePerformanceSettings(current);
    window.location.reload();
  }

  function markFirstRunSeen() {
    current.firstRunSeen = true;
    pending.firstRunSeen = true;
    savePerformanceSettings(current);
  }

  function drawingBuffer() {
    return {
      w: Math.max(1, Math.round(lastCssW * effectivePixelRatio)),
      h: Math.max(1, Math.round(lastCssH * effectivePixelRatio)),
    };
  }

  function computeOnePercentLow() {
    if (ftCount < 20) return 0;
    for (let i = 0; i < ftCount; i++) sortedScratch[i] = frameTimes[i];
    const slice = sortedScratch.subarray(0, ftCount);
    slice.sort();
    const idx = Math.min(ftCount - 1, Math.max(0, Math.floor(ftCount * 0.01)));
    const ms = slice[ftCount - 1 - idx];
    return ms > 0 ? 1000 / ms : 0;
  }

  function recordFrame(dtMs) {
    const ms = Math.min(100, Math.max(0.01, dtMs));
    if (ftCount === frameTimes.length) {
      ftSum -= frameTimes[ftWrite];
    } else {
      ftCount += 1;
    }
    frameTimes[ftWrite] = ms;
    ftSum += ms;
    ftWrite = (ftWrite + 1) % frameTimes.length;
    if (ms > worstFrameMs) worstFrameMs = ms;
    avgFrameMs = ftSum / ftCount;
    hudFps = 1000 / Math.max(avgFrameMs, 0.01);
  }

  function applyDynamicResolution(now) {
    if (!current.dynamicResolution || uiOpen) return;
    if (ftCount < 20) return;
    if (now - lastDynChangeAt < DYN_RES.minIntervalMs) return;
    const target = PERFORMANCE_TARGETS[current.targetFPS] || PERFORMANCE_TARGETS[60];
    const hi = maxPixelRatio();
    const lo = minPixelRatio();
    let next = effectivePixelRatio;
    let cooldown = DYN_RES.cooldownDownMs;
    if (avgFrameMs > target.severeMs) {
      next = effectivePixelRatio - DYN_RES.stepDownSevere;
      cooldown = DYN_RES.cooldownDownMs;
    } else if (avgFrameMs > target.warningMs) {
      next = effectivePixelRatio - DYN_RES.stepDown;
      cooldown = DYN_RES.cooldownDownMs;
    } else if (avgFrameMs < target.goodMs) {
      next = effectivePixelRatio + DYN_RES.stepUp;
      cooldown = DYN_RES.cooldownUpMs;
    } else {
      return;
    }
    if (now - lastDynChangeAt < cooldown) return;
    next = Math.round(next * 8) / 8;
    next = clamp(next, lo, hi);
    if (Math.abs(next - effectivePixelRatio) < 0.05) return;
    if (applyPixelRatio(next)) lastDynChangeAt = now;
  }

  function runtimeHasBloom() {
    return current.postProcessingQuality !== "off" && current.bloom;
  }

  function applyAutoPerformance(now) {
    if (!current.autoPerformance || uiOpen) return;
    if (ftCount < AUTO_PERF.minSamples) return;
    const target = PERFORMANCE_TARGETS[current.targetFPS] || PERFORMANCE_TARGETS[60];
    const atMinPR = effectivePixelRatio <= minPixelRatio() + 0.02;
    const since = now - lastAutoChangeAt;

    if (avgFrameMs > target.warningMs && atMinPR && since > AUTO_PERF.cooldownMs) {
      if (autoStep === 0 && current.bloomQuality === "high" && runtimeHasBloom()) {
        postFX.setBloomQuality("medium", current.postProcessingQuality);
        postFX.resize(effectivePixelRatio);
        autoStep = 1;
        lastAutoChangeAt = now;
        emit("auto", { step: autoStep, action: "bloom-medium" });
      } else if (autoStep <= 1 && runtimeHasBloom()) {
        postFX.setBloomEnabled(false);
        postFX.resize(effectivePixelRatio);
        autoStep = 2;
        lastAutoChangeAt = now;
        emit("auto", { step: autoStep, action: "bloom-off" });
      } else if (autoStep <= 2 && current.postProcessingQuality === "high") {
        postFX.setBloomQuality("low", "low");
        postFX.setComposerEnabled(true);
        postFX.resize(effectivePixelRatio);
        autoStep = 3;
        lastAutoChangeAt = now;
        emit("auto", { step: autoStep, action: "postfx-low" });
      } else if (
        autoStep <= 3 &&
        current.postProcessingQuality !== "off" &&
        avgFrameMs > target.severeMs
      ) {
        postFX.setComposerEnabled(false);
        postFX.setBloomEnabled(false);
        autoStep = 4;
        lastAutoChangeAt = now;
        emit("auto", { step: autoStep, action: "postfx-off" });
      }
      return;
    }

    if (avgFrameMs < target.goodMs && autoStep > 0 && since > AUTO_PERF.recoverMs) {
      if (autoStep >= 4 && current.postProcessingQuality !== "off") {
        postFX.setComposerEnabled(true);
        autoStep = 3;
      } else if (autoStep >= 3) {
        applyBloomAndPost(current);
        autoStep = 2;
      } else if (autoStep >= 2 && current.bloom) {
        postFX.setBloomEnabled(true);
        postFX.setBloomQuality(
          current.bloomQuality === "high" ? "medium" : current.bloomQuality,
          current.postProcessingQuality
        );
        postFX.resize(effectivePixelRatio);
        autoStep = 1;
      } else if (autoStep >= 1) {
        applyBloomAndPost(current);
        autoStep = 0;
      }
      lastAutoChangeAt = now;
      emit("auto", { step: autoStep, action: "recover" });
    }
  }

  function tick(dt) {
    const now = performance.now();
    recordFrame(dt * 1000);
    applyDynamicResolution(now);
    applyAutoPerformance(now);
    if (now - lastHudCompute > 500) {
      lastHudCompute = now;
      onePercentLow = computeOnePercentLow();
      if (current.performanceMonitor) hooks.refreshMonitor?.(getMonitorSnapshot());
    }
  }

  function getMonitorSnapshot() {
    const draws =
      typeof postFX.getFrameDrawStats === "function"
        ? postFX.getFrameDrawStats()
        : { sceneCalls: 0, postFxCalls: 0, sceneTriangles: 0 };
    const buf = drawingBuffer();
    return {
      fps: hudFps,
      frameMs: avgFrameMs,
      pixelRatio: effectivePixelRatio,
      width: buf.w,
      height: buf.h,
      sceneCalls: draws.sceneCalls,
      postFxCalls: draws.postFxCalls,
      triangles: draws.sceneTriangles,
      targetFPS: current.targetFPS,
    };
  }

  function getStatsExtras() {
    const buf = drawingBuffer();
    return {
      perfPreset: current.performancePreset,
      renderQuality: current.renderQuality,
      pixelRatio: Number(effectivePixelRatio.toFixed(3)),
      dynRes: current.dynamicResolution ? "on" : "off",
      autoPerf: current.autoPerformance ? "on" : "off",
      bloom: postFX.getBloomEnabled?.() ? "on" : "off",
      postFX: current.postProcessingQuality,
      avgFps: Number(hudFps.toFixed(1)),
      avgFrameMs: Number(avgFrameMs.toFixed(2)),
      worstFrameMs: Number(worstFrameMs.toFixed(2)),
      onePercentLowFps: Number(onePercentLow.toFixed(1)),
      framebuffer: `${buf.w}x${buf.h}`,
    };
  }

  function handleResize() {
    applyPixelRatio(effectivePixelRatio, { force: true });
  }

  function reapplySceneSettings() {
    syncConfigFlags(current);
    applyTextures(current);
    applyShadows(current);
    hooks.invalidatePerfStats?.();
  }

  function setUiOpen(open) {
    uiOpen = !!open;
    if (open) pending = cloneSettings(current);
  }

  applySettings(current, { persist: !loaded.firstRun, reason: "init" });

  return {
    capabilities,
    deviceProfile,
    firstRun: loaded.firstRun,
    getSettings: () => cloneSettings(current),
    getPending: () => cloneSettings(pending),
    setPending,
    resetPending() {
      pending = cloneSettings(current);
      return pending;
    },
    commitPending,
    persistAndReload,
    markFirstRunSeen,
    applyRecommendedPreset(presetId) {
      pending = applyPresetToSettings(presetId, current);
      pending.firstRunSeen = true;
      return applySettings(pending, { reason: "first-run" });
    },
    applyMaximumQuality() {
      pending = applyPresetToSettings("maximum", current);
      pending.firstRunSeen = true;
      return applySettings(pending, { reason: "first-run-keep-high" });
    },
    requiresRestart,
    setUiOpen,
    tick,
    handleResize,
    reapplySceneSettings,
    getMonitorSnapshot,
    getStatsExtras,
    getEffectivePixelRatio: () => effectivePixelRatio,
    SETTING_META,
  };
}
