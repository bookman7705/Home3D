import { refreshLightmapRenderSettings } from "./materials.js";

function isPlusKey(e) {
  return (
    e.key === "+" ||
    e.code === "NumpadAdd" ||
    (e.code === "Equal" && e.shiftKey)
  );
}

function isMinusKey(e) {
  return e.key === "-" || e.code === "NumpadSubtract" || e.code === "Minus";
}

function isEditableTarget(e) {
  const tag = e.target?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function readLightMapIntensity(config) {
  const value = Number(config?.lightMapIntensity);
  return Number.isFinite(value) ? value : 1;
}

/**
 * Debug HUD + keyboard adjust for CONFIG.lightMapIntensity (+ / - keys).
 */
export function createLightmapIntensityDebug({
  config,
  getRoot = () => null,
  getLightmapConfig = () => null,
  step = 1,
}) {
  const el = document.getElementById("lightmapIntensityDebug");
  const delta = Math.abs(Number(step)) || 1;

  function render() {
    if (!el) return;
    const value = readLightMapIntensity(config);
    el.innerHTML = `Lightmap intensity: <strong>${value.toFixed(1)}</strong> · <kbd>+</kbd> / <kbd>-</kbd>`;
  }

  function adjust(amount) {
    const next = Math.max(0, readLightMapIntensity(config) + amount);
    config.lightMapIntensity = Math.round(next * 10) / 10;

    const runtimeConfig = getLightmapConfig();
    if (runtimeConfig) {
      runtimeConfig.lightMapIntensity = config.lightMapIntensity;
    }

    const root = getRoot();
    if (root) {
      refreshLightmapRenderSettings(root, runtimeConfig ?? config);
    }

    render();
  }

  function handleKeyDown(e) {
    if (e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditableTarget(e)) return;

    if (isPlusKey(e)) {
      e.preventDefault();
      adjust(delta);
      return;
    }
    if (isMinusKey(e)) {
      e.preventDefault();
      adjust(-delta);
    }
  }

  window.addEventListener("keydown", handleKeyDown);
  render();

  return {
    render,
    dispose() {
      window.removeEventListener("keydown", handleKeyDown);
    },
  };
}
