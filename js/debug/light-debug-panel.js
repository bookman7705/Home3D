import { getLightDisplayName, getLightTypeLabel } from "./collect-lights.js";

/**
 * LightDebug HUD: name, type, position, index, prev/next buttons.
 */
export function createLightDebugPanel({
  elementId = "lightDebug",
  decimals = 3,
  visible = true,
  onPrev = null,
  onNext = null,
} = {}) {
  let el = document.getElementById(elementId);
  let createdElement = false;

  if (!el) {
    el = document.createElement("div");
    el.id = elementId;
    document.body.appendChild(el);
    createdElement = true;
  }

  el.className = "light-debug-panel";
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `
    <div class="light-debug-header">
      <button type="button" class="light-debug-nav" data-nav="prev" aria-label="Previous light">◀</button>
      <div class="light-debug-title">LightDebug</div>
      <button type="button" class="light-debug-nav" data-nav="next" aria-label="Next light">▶</button>
    </div>
    <div class="light-debug-body"></div>
    <div class="light-debug-hint">Arrows move XZ · R/F height</div>
  `;

  const bodyEl = el.querySelector(".light-debug-body");
  const prevBtn = el.querySelector('[data-nav="prev"]');
  const nextBtn = el.querySelector('[data-nav="next"]');

  let decimalsN = Math.max(0, Number(decimals) || 3);
  let isVisible = !!visible;

  function format(n) {
    return Number(n).toFixed(decimalsN);
  }

  function setVisible(value) {
    isVisible = !!value;
    el.hidden = !isVisible;
  }

  function onClick(e) {
    const btn = e.target.closest("[data-nav]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (btn.dataset.nav === "prev") onPrev?.();
    if (btn.dataset.nav === "next") onNext?.();
  }

  el.addEventListener("click", onClick);

  function render({ light = null, index = 0, total = 0, position = null } = {}) {
    if (!isVisible) return;

    if (!light || total <= 0) {
      bodyEl.textContent = "No realtime lights";
      return;
    }

    const name = getLightDisplayName(light);
    const type = getLightTypeLabel(light);
    const idx = `${index + 1} / ${total}`;
    const pos = position || light.position;
    const intensity = Number.isFinite(light.intensity)
      ? format(light.intensity)
      : "—";

    bodyEl.innerHTML =
      `<div><span class="k">Name</span> ${escapeHtml(name)}</div>` +
      `<div><span class="k">Type</span> ${escapeHtml(type)}</div>` +
      `<div><span class="k">Index</span> ${idx}</div>` +
      `<div><span class="k">X</span> ${format(pos.x)}</div>` +
      `<div><span class="k">Y</span> ${format(pos.y)}</div>` +
      `<div><span class="k">Z</span> ${format(pos.z)}</div>` +
      `<div><span class="k">I</span> ${intensity}</div>`;
  }

  function dispose() {
    el.removeEventListener("click", onClick);
    if (createdElement && el.parentNode) {
      el.parentNode.removeChild(el);
    } else {
      el.hidden = true;
      el.innerHTML = "";
    }
  }

  setVisible(isVisible);

  return {
    el,
    prevBtn,
    nextBtn,
    render,
    setVisible,
    dispose,
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
