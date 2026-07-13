/** Control mode: PC (WASD + mouse) or Mobile (on-screen arrows + device tilt). */

export const CONTROL_MODE = {
  PC: "pc",
  MOBILE: "mobile",
};

/**
 * Pick PC vs Mobile from touch / pointer / UA (no manual toggle).
 * @returns {typeof CONTROL_MODE[keyof typeof CONTROL_MODE]}
 */
export function detectControlMode() {
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches === true;
  const noHover = window.matchMedia?.("(hover: none)")?.matches === true;
  const touchPoints = Number(navigator.maxTouchPoints) || 0;
  const ua = String(navigator.userAgent || "");
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  // iPadOS 13+ often reports as Macintosh with touch.
  const iPadDesktopUa = touchPoints > 0 && /Macintosh/i.test(ua);

  if (uaMobile || iPadDesktopUa || coarse || (touchPoints > 0 && noHover)) {
    return CONTROL_MODE.MOBILE;
  }
  return CONTROL_MODE.PC;
}

const STORAGE_KEY = "lightTest.controlMode";

export function readStoredControlMode(fallback = CONTROL_MODE.PC) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === CONTROL_MODE.PC || raw === CONTROL_MODE.MOBILE) return raw;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function storeControlMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

/**
 * @deprecated Manual PC/Mobile toggle removed — use detectControlMode().
 * @returns {{ getMode: () => string, setMode: (mode: string) => void, dispose: () => void }}
 */
export function createControlModeToggle({
  initialMode = CONTROL_MODE.PC,
  onModeChange,
  buttonId = "controlModeBtn",
} = {}) {
  let mode = initialMode === CONTROL_MODE.MOBILE ? CONTROL_MODE.MOBILE : CONTROL_MODE.PC;
  const btn = document.getElementById(buttonId);

  function syncUi() {
    if (!btn) return;
    const isMobile = mode === CONTROL_MODE.MOBILE;
    btn.textContent = isMobile ? "Mode: Mobile" : "Mode: PC";
    btn.setAttribute("aria-pressed", isMobile ? "true" : "false");
    btn.dataset.mode = mode;
  }

  function setMode(next) {
    const resolved = next === CONTROL_MODE.MOBILE ? CONTROL_MODE.MOBILE : CONTROL_MODE.PC;
    if (resolved === mode) {
      syncUi();
      return;
    }
    mode = resolved;
    storeControlMode(mode);
    syncUi();
    onModeChange?.(mode);
  }

  function onClick() {
    setMode(mode === CONTROL_MODE.PC ? CONTROL_MODE.MOBILE : CONTROL_MODE.PC);
  }

  if (btn) {
    btn.addEventListener("click", onClick);
  }

  syncUi();
  onModeChange?.(mode);

  return {
    getMode: () => mode,
    setMode,
    dispose: () => {
      if (btn) btn.removeEventListener("click", onClick);
    },
  };
}
