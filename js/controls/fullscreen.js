export function setupFullscreen() {
  const fullscreenBtn = document.getElementById("fullscreenBtn");
  if (!fullscreenBtn) return { onResize: () => {} };

  function getFullscreenElement() {
    return (
      document.fullscreenElement ??
      document.webkitFullscreenElement ??
      document.mozFullScreenElement ??
      document.msFullscreenElement ??
      null
    );
  }

  function syncButton() {
    const active = !!getFullscreenElement();
    fullscreenBtn.textContent = active ? "Exit fullscreen" : "Fullscreen";
    fullscreenBtn.setAttribute("aria-pressed", active ? "true" : "false");
  }

  function requestFullscreen() {
    const el = document.documentElement;
    if (el.requestFullscreen) return el.requestFullscreen();
    if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
    if (el.mozRequestFullScreen) return el.mozRequestFullScreen();
    if (el.msRequestFullscreen) return el.msRequestFullscreen();
    return Promise.reject(new Error("Fullscreen not supported"));
  }

  function exitFullscreen() {
    const exit =
      document.exitFullscreen ??
      document.webkitExitFullscreen ??
      document.mozCancelFullScreen ??
      document.msExitFullscreen;
    if (!exit) return Promise.reject(new Error("Exit fullscreen not supported"));
    return exit.call(document);
  }

  fullscreenBtn.addEventListener("click", () => {
    if (getFullscreenElement()) exitFullscreen().catch(() => {});
    else requestFullscreen().catch(() => {});
  });

  for (const ev of [
    "fullscreenchange",
    "webkitfullscreenchange",
    "mozfullscreenchange",
    "MSFullscreenChange",
  ]) {
    document.addEventListener(ev, syncButton);
  }

  syncButton();
  return { onResize: syncButton };
}
