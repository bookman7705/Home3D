function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Compact on-screen LOD tester. Shift+0 = auto, Shift+1/2/3 = force that LOD.
 * Chrome is built once so mobile taps on Auto/0/1/2 are not destroyed each refresh.
 */
export function createLodDebugHud({ onForceLod } = {}) {
  const el = document.getElementById("lodDebugHud");
  let visible = false;
  let built = false;
  let modeEl = null;
  let rowsEl = null;

  function build() {
    if (!el || built) return;
    el.innerHTML = `
      <header>
        <span>LOD</span>
        <span class="lod-debug-mode" data-lod-mode>auto</span>
      </header>
      <div class="lod-debug-rows" data-lod-rows></div>
      <p class="lod-debug-hint">Walk toward / away from Table1 or Table2 · Shift+0 auto · Shift+1/2/3 force LOD</p>
      <div class="lod-debug-actions">
        <button type="button" data-lod="auto">Auto</button>
        <button type="button" data-lod="0">0</button>
        <button type="button" data-lod="1">1</button>
        <button type="button" data-lod="2">2</button>
      </div>
    `;
    modeEl = el.querySelector("[data-lod-mode]");
    rowsEl = el.querySelector("[data-lod-rows]");
    built = true;
  }

  function setVisible(on) {
    visible = !!on;
    if (!el) return;
    if (visible) build();
    el.hidden = !visible;
    el.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function render(snapshot) {
    if (!el || !visible) return;
    build();
    const rows = snapshot?.groups || [];
    const force = snapshot?.forceLod;
    if (modeEl) modeEl.textContent = force == null ? "auto" : `LOD${force}`;
    if (!rowsEl) return;
    if (rows.length === 0) {
      rowsEl.innerHTML = `<p class="lod-debug-empty">No _LODX meshes found in this GLB.</p>`;
      return;
    }
    rowsEl.innerHTML = rows
      .map((g) => {
        const levels = g.available.map((n) => `LOD${n}`).join(" / ");
        const hidden = g.current == null;
        let next;
        if (hidden) {
          next =
            g.cullDistance != null
              ? `in < ${g.cullDistance.toFixed(1)}m`
              : "hidden";
        } else if (g.nextThreshold != null) {
          next = `next ${g.nextThreshold.toFixed(1)}m`;
        } else if (g.cullDistance != null) {
          next = `cull ${g.cullDistance.toFixed(1)}m`;
        } else {
          next = "max LOD";
        }
        return `<div class="lod-debug-row">
          <strong>${esc(g.base)}</strong>
          <span>${hidden ? "hidden" : `LOD${g.current}`}</span>
          <span>${g.distance.toFixed(2)}m</span>
          <span>${esc(next)}</span>
          <span class="lod-debug-levels">${esc(levels)}</span>
        </div>`;
      })
      .join("");
  }

  function onClick(e) {
    const btn = e.target?.closest?.("[data-lod]");
    if (!btn || !el?.contains(btn)) return;
    const raw = btn.getAttribute("data-lod");
    if (raw === "auto") onForceLod?.(null);
    else onForceLod?.(Number(raw));
  }

  function onKeyDown(e) {
    if (!visible) return;
    if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    let next = undefined;
    if (e.code === "Digit0" || e.code === "Numpad0") next = null;
    else if (e.code === "Digit1" || e.code === "Numpad1") next = 0;
    else if (e.code === "Digit2" || e.code === "Numpad2") next = 1;
    else if (e.code === "Digit3" || e.code === "Numpad3") next = 2;
    if (next === undefined) return;
    e.preventDefault();
    onForceLod?.(next);
  }

  el?.addEventListener("click", onClick);
  window.addEventListener("keydown", onKeyDown);

  return {
    setVisible,
    render,
    dispose() {
      el?.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
