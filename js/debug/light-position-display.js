import * as THREE from "three";

/**
 * On-screen HUD that tracks a Three.js light's world position.
 * Retarget with setTarget() / setTargetGetter() without recreating the panel.
 *
 * @example
 * const hud = createLightPositionDisplay({ label: "Fan Light" });
 * hud.setTarget(pointLight);
 * // each frame:
 * hud.update();
 */
export function createLightPositionDisplay({
  elementId = "lightPosDebug",
  label = "Light",
  target = null,
  getTarget = null,
  decimals = 3,
  visible = true,
  className = "debug-pos-hud light-pos-debug",
} = {}) {
  let el = document.getElementById(elementId);
  let createdElement = false;

  if (!el) {
    el = document.createElement("div");
    el.id = elementId;
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
    createdElement = true;
  }

  el.className = className;

  let title = String(label || "Light");
  let decimalsN = Math.max(0, Number(decimals) || 3);
  let targetRef = target ?? null;
  let targetGetter = typeof getTarget === "function" ? getTarget : null;
  const worldPos = new THREE.Vector3();

  function resolveTarget() {
    if (targetGetter) {
      try {
        return targetGetter() || null;
      } catch {
        return null;
      }
    }
    return targetRef;
  }

  function format(n) {
    return Number(n).toFixed(decimalsN);
  }

  function setVisible(value) {
    visible = !!value;
    el.hidden = !visible;
    if (!visible) el.textContent = "";
  }

  function setLabel(next) {
    title = String(next || "Light");
  }

  function setDecimals(n) {
    decimalsN = Math.max(0, Number(n) || 3);
  }

  /** Track a light (or Object3D) directly. */
  function setTarget(lightOrObject) {
    targetGetter = null;
    targetRef = lightOrObject ?? null;
  }

  /** Track via getter (e.g. () => debugPointLight.light). */
  function setTargetGetter(fn) {
    targetRef = null;
    targetGetter = typeof fn === "function" ? fn : null;
  }

  function update() {
    if (!visible) return;

    const obj = resolveTarget();
    if (!obj) {
      el.textContent = `${title}\n(no target)`;
      return;
    }

    if (typeof obj.getWorldPosition === "function") {
      obj.getWorldPosition(worldPos);
    } else if (obj.position) {
      worldPos.copy(obj.position);
    } else {
      el.textContent = `${title}\n(invalid target)`;
      return;
    }

    const intensity =
      obj.isLight && Number.isFinite(obj.intensity)
        ? `\nI ${format(obj.intensity)}`
        : "";

    el.textContent =
      `${title}\n` +
      `X ${format(worldPos.x)}\n` +
      `Y ${format(worldPos.y)}\n` +
      `Z ${format(worldPos.z)}` +
      intensity;
  }

  function dispose() {
    if (createdElement && el?.parentNode) {
      el.parentNode.removeChild(el);
    } else if (el) {
      el.textContent = "";
      el.hidden = true;
    }
    targetRef = null;
    targetGetter = null;
  }

  setVisible(visible);
  update();

  return {
    el,
    update,
    setTarget,
    setTargetGetter,
    setLabel,
    setDecimals,
    setVisible,
    getTarget: resolveTarget,
    dispose,
  };
}
