export function setupRendererResize({ camera, renderer, onResize }) {
  function refresh() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    onResize?.();
  }

  window.addEventListener("resize", refresh);
  for (const ev of [
    "fullscreenchange",
    "webkitfullscreenchange",
    "mozfullscreenchange",
    "MSFullscreenChange",
  ]) {
    document.addEventListener(ev, refresh);
  }

  return refresh;
}
