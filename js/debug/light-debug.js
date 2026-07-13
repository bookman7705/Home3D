import * as THREE from "three";
import { collectRealtimeLights } from "./collect-lights.js";
import { createLightDebugPanel } from "./light-debug-panel.js";
import { createLightMover } from "./light-mover.js";
import { createLightDebugOrb } from "./light-orb.js";

export const LIGHT_DEBUG_DEFAULTS = {
  /** Master switch for LightDebug HUD + selection movement. */
  enableLightDebug: false,
  /** Emissive orb at the selected light. */
  showDebugPointLightOrb: true,
  debugPointLightOrbRadius: 0.08,
  /** Units/sec for Arrow / R / F movement of the selected light. */
  debugPointLightMoveSpeed: 3,
};

/**
 * Modular realtime-light debugger:
 * - HUD (name, type, world position, intensity)
 * - ◀ / ▶ cycle all spatial lights in the scene
 * - Arrow / R / F move the selected light
 * - Optional orb at selection
 */
export function createLightDebug({ scene, config = {}, worldScale = 1 } = {}) {
  const cfg = { ...LIGHT_DEBUG_DEFAULTS, ...config };
  const enabled = cfg.enableLightDebug !== false;
  const S = Math.max(0.0001, Number(worldScale) || 1);

  const worldPos = new THREE.Vector3();
  let lights = [];
  let index = 0;

  const panel = createLightDebugPanel({
    elementId: "lightDebug",
    visible: enabled,
    onPrev: () => selectRelative(-1),
    onNext: () => selectRelative(1),
  });

  const mover = createLightMover({
    getTarget: () => getSelected(),
    worldScale: S,
    moveSpeed: cfg.debugPointLightMoveSpeed,
  });

  const showOrb = enabled && cfg.showDebugPointLightOrb !== false;
  const orb = createLightDebugOrb({
    scene,
    radius: (Number(cfg.debugPointLightOrbRadius) || 0.08) * S,
    visible: showOrb,
  });

  function refreshLights() {
    const selected = getSelected();
    lights = collectRealtimeLights(scene);

    if (lights.length === 0) {
      index = 0;
      render();
      return getSelected();
    }

    if (selected) {
      const found = lights.indexOf(selected);
      index = found >= 0 ? found : Math.min(index, lights.length - 1);
    } else {
      index = Math.min(index, lights.length - 1);
    }

    // Prefer FanPointLightFill on first refresh if present.
    if (!selected) {
      const prefer = lights.findIndex((l) => l.name === "FanPointLightFill");
      if (prefer >= 0) index = prefer;
    }

    render();
    return getSelected();
  }

  function getSelected() {
    if (!lights.length) return null;
    return lights[index] || null;
  }

  function selectRelative(delta) {
    if (!lights.length) {
      refreshLights();
      if (!lights.length) return null;
    }
    index = (index + delta + lights.length) % lights.length;
    render();
    return getSelected();
  }

  function selectByName(name) {
    refreshLights();
    const i = lights.findIndex((l) => l.name === name);
    if (i >= 0) {
      index = i;
      render();
    }
    return getSelected();
  }

  function selectLight(light) {
    refreshLights();
    const i = lights.indexOf(light);
    if (i >= 0) {
      index = i;
      render();
    }
    return getSelected();
  }

  function render() {
    if (!enabled) {
      panel.setVisible(false);
      orb.setVisible(false);
      return;
    }

    panel.setVisible(true);
    const light = getSelected();
    if (light) {
      light.getWorldPosition(worldPos);
      panel.render({
        light,
        index,
        total: lights.length,
        position: worldPos,
      });
      orb.setVisible(cfg.showDebugPointLightOrb !== false);
      orb.syncToLight(light);
    } else {
      panel.render({ light: null, index: 0, total: 0 });
      orb.setVisible(false);
    }
  }

  function setEnabled(value) {
    cfg.enableLightDebug = !!value;
    if (!cfg.enableLightDebug) {
      panel.setVisible(false);
      orb.setVisible(false);
    } else {
      refreshLights();
    }
  }

  function update(dt) {
    if (cfg.enableLightDebug === false) return;

    // Lights may be added after GLB / fan setup.
    if (lights.length === 0) refreshLights();

    mover.update(dt);
    render();
  }

  function dispose() {
    mover.dispose();
    orb.dispose();
    panel.dispose();
    lights = [];
  }

  if (enabled) refreshLights();
  else {
    panel.setVisible(false);
    orb.setVisible(false);
  }

  console.info(
    "[LightDebug]",
    enabled ? "ON — ◀/▶ cycle lights, Arrows/R/F move selection." : "OFF",
    cfg.showDebugPointLightOrb !== false ? "Orb visible." : "Orb hidden."
  );

  return {
    update,
    refreshLights,
    getSelected,
    selectRelative,
    selectByName,
    selectLight,
    setEnabled,
    dispose,
    get lights() {
      return lights.slice();
    },
    get index() {
      return index;
    },
  };
}
