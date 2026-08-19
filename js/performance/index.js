import { createPerformanceManager } from "./manager.js";
import { createSettingsUi } from "./ui.js";

/**
 * Settings UI + render-quality manager. Call tick() once per animation frame.
 */
export function createPerformanceSystem(opts = {}) {
  const monitorHooks = {
    setMonitorVisible: null,
    refreshMonitor: null,
    closeStats: opts.hooks?.closeStats,
  };

  const manager = createPerformanceManager({
    ...opts,
    hooks: {
      ...opts.hooks,
      setMonitorVisible: (on) => monitorHooks.setMonitorVisible?.(on),
      refreshMonitor: (snap) => monitorHooks.refreshMonitor?.(snap),
    },
  });

  const ui = createSettingsUi({
    manager,
    hooks: monitorHooks,
  });

  monitorHooks.setMonitorVisible = ui.setMonitorVisible;
  monitorHooks.refreshMonitor = ui.refreshMonitor;
  ui.setMonitorVisible(!!manager.getSettings().performanceMonitor);

  return {
    tick: (dt) => manager.tick(dt),
    handleResize: () => manager.handleResize(),
    reapplySceneSettings: () => manager.reapplySceneSettings(),
    getSettings: () => manager.getSettings(),
    getStatsExtras: () => manager.getStatsExtras(),
    getEffectivePixelRatio: () => manager.getEffectivePixelRatio(),
    capabilities: manager.capabilities,
    dispose() {
      ui.dispose();
    },
  };
}

export { pixelRatioForQuality } from "./manager.js";
export { loadPerformanceSettings } from "./store.js";
