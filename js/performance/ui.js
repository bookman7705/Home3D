import {
  BLOOM_QUALITY,
  POST_PROCESSING_QUALITY,
  PRESET_IDS,
  PRESET_LABELS,
  RENDER_QUALITY,
  SETTING_META,
  SHADOW_QUALITY,
  TEXTURE_QUALITY,
} from "./constants.js";
import { firstRunCopy } from "./device.js";

const UI_HIDE_SELECTORS = [
  "#startBtn",
  "#fullscreenBtn",
  "#controls",
  "#interactPrompt",
  "#statsBtn",
];

function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function optionList(table, selected) {
  return Object.entries(table)
    .map(
      ([id, spec]) =>
        `<option value="${esc(id)}"${id === selected ? " selected" : ""}>${esc(
          spec.label || id
        )}</option>`
    )
    .join("");
}

function restartBadge(key) {
  return SETTING_META[key]?.requiresRestart
    ? `<span class="settings-restart">Requires restart</span>`
    : "";
}

function desc(key) {
  return SETTING_META[key]?.description
    ? `<p class="settings-desc">${esc(SETTING_META[key].description)}</p>`
    : "";
}

export function createSettingsUi({ manager, hooks = {} } = {}) {
  const openBtn = document.getElementById("settingsBtn");
  const overlay = document.getElementById("settingsOverlay");
  const bodyEl = document.getElementById("settingsBody");
  const closeBtn = document.getElementById("settingsCloseBtn");
  const restartModal = document.getElementById("settingsRestartModal");
  const firstRunModal = document.getElementById("settingsFirstRunModal");
  const hud = document.getElementById("perfMonitorHud");

  if (!openBtn || !overlay || !bodyEl) {
    console.warn("[PerfSettings] Missing settings markup");
    return { dispose() {} };
  }

  const uiSnapshot = new Map();
  let open = false;
  const fpsEl = hud?.querySelector("[data-hud=fps]");
  const msEl = hud?.querySelector("[data-hud=ms]");
  const resEl = hud?.querySelector("[data-hud=res]");
  const prEl = hud?.querySelector("[data-hud=pr]");
  const drawsEl = hud?.querySelector("[data-hud=draws]");
  const fxEl = hud?.querySelector("[data-hud=fx]");
  const triEl = hud?.querySelector("[data-hud=tris]");

  function collectUiElements() {
    const els = [];
    for (const sel of UI_HIDE_SELECTORS) {
      document.querySelectorAll(sel).forEach((el) => els.push(el));
    }
    return els;
  }

  function hideOtherUi() {
    uiSnapshot.clear();
    for (const el of collectUiElements()) {
      if (el === openBtn || overlay.contains(el)) continue;
      const isFormControl = "disabled" in el;
      uiSnapshot.set(el, {
        hidden: el.hasAttribute("hidden"),
        disabled: isFormControl ? !!el.disabled : null,
        pointerEvents: el.style.pointerEvents || "",
        ariaHidden: el.getAttribute("aria-hidden"),
      });
      el.setAttribute("hidden", "");
      el.setAttribute("aria-hidden", "true");
      if (isFormControl) el.disabled = true;
      el.style.pointerEvents = "none";
    }
  }

  function restoreOtherUi() {
    for (const [el, snap] of uiSnapshot) {
      if (!snap.hidden) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
      if (snap.ariaHidden == null) el.removeAttribute("aria-hidden");
      else el.setAttribute("aria-hidden", snap.ariaHidden);
      if (snap.disabled != null && "disabled" in el) el.disabled = snap.disabled;
      el.style.pointerEvents = snap.pointerEvents;
    }
    uiSnapshot.clear();
  }

  function setMonitorVisible(on) {
    if (!hud) return;
    hud.hidden = !on;
    hud.setAttribute("aria-hidden", on ? "false" : "true");
  }

  function refreshMonitor(snap) {
    if (!hud || hud.hidden || !snap) return;
    if (fpsEl) fpsEl.textContent = snap.fps.toFixed(0);
    if (msEl) msEl.textContent = `${snap.frameMs.toFixed(1)} ms`;
    if (resEl) resEl.textContent = `${snap.width}×${snap.height}`;
    if (prEl) prEl.textContent = Number(snap.pixelRatio).toFixed(2);
    if (drawsEl) drawsEl.textContent = String(snap.sceneCalls);
    if (fxEl) fxEl.textContent = String(snap.postFxCalls);
    if (triEl) triEl.textContent = Number(snap.triangles).toLocaleString();
  }

  hooks.setMonitorVisible = setMonitorVisible;
  hooks.refreshMonitor = refreshMonitor;

  function renderForm() {
    const s = manager.getPending();
    const caps = manager.capabilities;
    const postOff = s.postProcessingQuality === "off";
    const bloomLocked = postOff;
    const bloomQualityLocked = bloomLocked || !s.bloom;
    const scrollTop = bodyEl.scrollTop;
    const presetOptions = PRESET_IDS.map(
      (id) =>
        `<option value="${esc(id)}"${s.performancePreset === id ? " selected" : ""}>${esc(
          PRESET_LABELS[id]
        )}</option>`
    ).join("");

    bodyEl.innerHTML = `
      <p class="settings-note">Changes apply when you close this screen.</p>

      <section class="settings-section">
        <h3>Performance</h3>
        <label class="settings-field">
          <span class="settings-label">${esc(SETTING_META.performancePreset.label)} ${restartBadge(
            "performancePreset"
          )}</span>
          <select data-key="performancePreset">${presetOptions}</select>
        </label>
        ${desc("performancePreset")}

        <div class="settings-field">
          <span class="settings-label">${esc(SETTING_META.targetFPS.label)}</span>
          <div class="settings-segmented" role="group" aria-label="Target FPS">
            <button type="button" class="settings-seg${s.targetFPS === 60 ? " is-active" : ""}" data-key="targetFPS" data-value="60">60 FPS</button>
            <button type="button" class="settings-seg${s.targetFPS === 30 ? " is-active" : ""}" data-key="targetFPS" data-value="30">30 FPS</button>
          </div>
        </div>
        ${desc("targetFPS")}

        <label class="settings-field settings-field-row">
          <span class="settings-label">${esc(SETTING_META.dynamicResolution.label)}</span>
          <input type="checkbox" data-key="dynamicResolution" ${s.dynamicResolution ? "checked" : ""} />
        </label>
        ${desc("dynamicResolution")}
      </section>

      <section class="settings-section">
        <h3>Graphics</h3>
        <label class="settings-field">
          <span class="settings-label">${esc(SETTING_META.renderQuality.label)}</span>
          <select data-key="renderQuality">${optionList(RENDER_QUALITY, s.renderQuality)}</select>
        </label>
        ${desc("renderQuality")}

        <label class="settings-field settings-field-row">
          <span class="settings-label">${esc(SETTING_META.bloom.label)}</span>
          <input type="checkbox" data-key="bloom" ${s.bloom ? "checked" : ""} ${
            bloomLocked ? "disabled" : ""
          } />
        </label>
        ${desc("bloom")}

        <label class="settings-field">
          <span class="settings-label">${esc(SETTING_META.bloomQuality.label)}</span>
          <select data-key="bloomQuality" ${bloomQualityLocked ? "disabled" : ""}>${optionList(
            BLOOM_QUALITY,
            s.bloomQuality
          )}</select>
        </label>
        ${desc("bloomQuality")}

        <label class="settings-field">
          <span class="settings-label">${esc(SETTING_META.postProcessingQuality.label)}</span>
          <select data-key="postProcessingQuality">${optionList(
            POST_PROCESSING_QUALITY,
            s.postProcessingQuality
          )}</select>
        </label>
        ${desc("postProcessingQuality")}

        ${
          caps.textureQuality
            ? `<label class="settings-field">
          <span class="settings-label">${esc(SETTING_META.textureQuality.label)}</span>
          <select data-key="textureQuality">${optionList(TEXTURE_QUALITY, s.textureQuality)}</select>
        </label>
        ${desc("textureQuality")}`
            : ""
        }

        ${
          caps.lightmaps
            ? `<label class="settings-field settings-field-row">
          <span class="settings-label">${esc(SETTING_META.lightmaps.label)}</span>
          <input type="checkbox" data-key="lightmaps" ${s.lightmaps ? "checked" : ""} />
        </label>
        ${desc("lightmaps")}`
            : ""
        }

        ${
          caps.shadows
            ? `<label class="settings-field">
          <span class="settings-label">${esc(SETTING_META.shadowQuality.label)}</span>
          <select data-key="shadowQuality">${optionList(SHADOW_QUALITY, s.shadowQuality)}</select>
        </label>
        ${desc("shadowQuality")}`
            : ""
        }
      </section>

      <section class="settings-section">
        <h3>Advanced</h3>
        <label class="settings-field settings-field-row">
          <span class="settings-label">${esc(SETTING_META.autoPerformance.label)}</span>
          <input type="checkbox" data-key="autoPerformance" ${s.autoPerformance ? "checked" : ""} />
        </label>
        ${desc("autoPerformance")}

        <label class="settings-field settings-field-row">
          <span class="settings-label">${esc(SETTING_META.performanceMonitor.label)}</span>
          <input type="checkbox" data-key="performanceMonitor" ${
            s.performanceMonitor ? "checked" : ""
          } />
        </label>
        ${desc("performanceMonitor")}
      </section>
    `;
    bodyEl.scrollTop = scrollTop;
  }

  function parseControl(el) {
    const key = el.dataset.key;
    if (!key) return null;
    if (el.matches("input[type=checkbox]")) return { key, value: el.checked };
    if (el.dataset.value != null) {
      const raw = el.dataset.value;
      return { key, value: key === "targetFPS" ? Number(raw) : raw };
    }
    if (el.tagName === "SELECT") {
      const raw = el.value;
      return { key, value: key === "targetFPS" ? Number(raw) : raw };
    }
    return null;
  }

  function openSettings() {
    if (open) return;
    hooks.closeStats?.();
    open = true;
    manager.setUiOpen(true);
    hideOtherUi();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("settings-open");
    renderForm();
  }

  function applyClose() {
    const result = manager.commitPending();
    if (!result.applied) {
      showRestartModal(result.restartKeys);
      return false;
    }
    closeSettings();
    return true;
  }

  function closeSettings() {
    if (!open) return;
    open = false;
    manager.setUiOpen(false);
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("settings-open");
    restoreOtherUi();
    setMonitorVisible(!!manager.getSettings().performanceMonitor);
  }

  function showRestartModal(keys) {
    if (!restartModal) {
      closeSettings();
      return;
    }
    const list = restartModal.querySelector("#settingsRestartList");
    if (list) {
      list.textContent = keys
        .map((k) => SETTING_META[k]?.label || k)
        .join(", ");
    }
    restartModal.hidden = false;
    restartModal.setAttribute("aria-hidden", "false");
  }

  function hideRestartModal() {
    if (!restartModal) return;
    restartModal.hidden = true;
    restartModal.setAttribute("aria-hidden", "true");
  }

  function showFirstRun() {
    if (!firstRunModal || !manager.firstRun) return;
    const profile = manager.deviceProfile;
    const copy = firstRunCopy(profile);
    const title = firstRunModal.querySelector("#settingsFirstRunTitle");
    const body = firstRunModal.querySelector("#settingsFirstRunBody");
    const useBtn = firstRunModal.querySelector("#settingsFirstRunUse");
    const keepBtn = firstRunModal.querySelector("#settingsFirstRunKeep");
    if (title) title.textContent = copy.title;
    if (body) body.textContent = copy.body;
    if (useBtn) useBtn.textContent = copy.recommendedLabel;
    if (keepBtn) keepBtn.textContent = copy.keepLabel;
    firstRunModal.hidden = false;
    firstRunModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("settings-modal-open");
  }

  function hideFirstRun() {
    if (!firstRunModal) return;
    firstRunModal.hidden = true;
    firstRunModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("settings-modal-open");
    manager.markFirstRunSeen();
  }

  bodyEl.addEventListener("change", (e) => {
    const parsed = parseControl(e.target);
    if (!parsed) return;
    manager.setPending(parsed.key, parsed.value);
    renderForm();
  });

  bodyEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-key][data-value]");
    if (!btn || !bodyEl.contains(btn)) return;
    const parsed = parseControl(btn);
    if (!parsed) return;
    manager.setPending(parsed.key, parsed.value);
    renderForm();
  });

  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) applyClose();
  });

  openBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openSettings();
  });
  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    applyClose();
  });

  restartModal?.querySelector("#settingsRestartCancel")?.addEventListener("click", (e) => {
    e.preventDefault();
    hideRestartModal();
  });
  restartModal?.querySelector("#settingsRestartConfirm")?.addEventListener("click", (e) => {
    e.preventDefault();
    manager.persistAndReload();
  });

  firstRunModal?.querySelector("#settingsFirstRunUse")?.addEventListener("click", (e) => {
    e.preventDefault();
    manager.applyRecommendedPreset(manager.deviceProfile.preset);
    hideFirstRun();
    setMonitorVisible(!!manager.getSettings().performanceMonitor);
  });
  firstRunModal?.querySelector("#settingsFirstRunKeep")?.addEventListener("click", (e) => {
    e.preventDefault();
    if (manager.deviceProfile.preset === "maximum") {
      manager.applyRecommendedPreset("balanced");
    } else {
      manager.applyMaximumQuality();
    }
    hideFirstRun();
    setMonitorVisible(!!manager.getSettings().performanceMonitor);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (restartModal && !restartModal.hidden) {
      e.preventDefault();
      hideRestartModal();
      return;
    }
    if (firstRunModal && !firstRunModal.hidden) return;
    if (!open) return;
    e.preventDefault();
    applyClose();
  });

  setMonitorVisible(!!manager.getSettings().performanceMonitor);
  if (manager.firstRun) showFirstRun();

  return {
    open: openSettings,
    close: closeSettings,
    setMonitorVisible,
    refreshMonitor,
    dispose() {
      closeSettings();
      hideFirstRun();
      hideRestartModal();
    },
  };
}
