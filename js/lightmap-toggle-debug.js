function isDigitOneKey(e) {
  return e.key === "1" || e.code === "Digit1" || e.code === "Numpad1";
}

/**
 * Debug HUD + keyboard toggle for CONFIG.enableLightMaps (1 key).
 */
export function createLightmapToggleDebug({ config, onToggle }) {
  const el = document.getElementById("lightmapToggleDebug");

  function render() {
    if (!el) return;
    const on = !!config.enableLightMaps;
    el.innerHTML = `Lightmaps: <strong class="${on ? "on" : "off"}">${
      on ? "ON" : "OFF"
    }</strong> · press <kbd>1</kbd>`;
  }

  function handleKeyDown(e) {
    if (e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!isDigitOneKey(e)) return;

    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    e.preventDefault();
    config.enableLightMaps = !config.enableLightMaps;
    onToggle(config.enableLightMaps);
    render();
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
