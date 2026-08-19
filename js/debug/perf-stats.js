/**
 * Performance / mobile debug stats overlay for the Three.js scene.
 *
 * Cheap per-frame counters (draw split, FPS, renderer.info) update while open.
 * Structural metrics (authored materials, mesh classes, texture estimates)
 * refresh on GLB/lightmap changes or every ~1.5s — not every frame.
 */

import { collectStructuralStats } from "./scene-metrics.js";

const UI_HIDE_SELECTORS = [
  "#startBtn",
  "#fullscreenBtn",
  "#controls",
  "#interactPrompt",
  "#settingsBtn",
];

const CHEAP_REFRESH_MS = 250;
const STRUCTURAL_REFRESH_MS = 1500;

function esc(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "n/a";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatCount(n) {
  if (n == null || !Number.isFinite(Number(n))) return "n/a";
  return Number(n).toLocaleString();
}

function detectGpuRenderer(gl) {
  if (!gl) return { vendor: "n/a", renderer: "n/a" };
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  if (!ext) {
    return {
      vendor: gl.getParameter(gl.VENDOR) || "n/a",
      renderer: gl.getParameter(gl.RENDERER) || "n/a",
    };
  }
  return {
    vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || "n/a",
    renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || "n/a",
  };
}

function drawingBufferSize(renderer) {
  let drawingW = 0;
  let drawingH = 0;
  try {
    renderer.getDrawingBufferSize?.({
      set(w, h) {
        drawingW = w;
        drawingH = h;
      },
    });
  } catch {
    /* ignore */
  }
  if (!drawingW || !drawingH) {
    const canvas = renderer.domElement;
    drawingW = canvas?.width || 0;
    drawingH = canvas?.height || 0;
  }
  return { drawingW, drawingH };
}

/**
 * @param {{
 *   renderer: import("three").WebGLRenderer,
 *   scene: import("three").Scene,
 *   camera?: import("three").Camera,
 *   getPostFx?: () => any,
 *   getGltfRoot?: () => import("three").Object3D | null,
 *   getExtras?: () => Record<string, string | number | boolean>,
 * }} opts
 */
export function createPerfStats({
  renderer,
  scene,
  camera = null,
  getPostFx = null,
  getGltfRoot = null,
  getExtras = null,
} = {}) {
  const openBtn = document.getElementById("statsBtn");
  const overlay = document.getElementById("statsOverlay");
  const bodyEl = document.getElementById("statsOverlayBody");
  const closeBtn = document.getElementById("statsCloseBtn");
  const copyBtn = document.getElementById("statsCopyBtn");

  const noop = {
    beginFrame() {},
    endFrame() {},
    isOpen: () => false,
    setGltfMeta() {},
    setLightmapInfo() {},
    invalidateStructure() {},
    dispose() {},
  };

  if (!openBtn || !overlay || !bodyEl) {
    console.warn("[PerfStats] Missing #statsBtn / #statsOverlay markup");
    return noop;
  }

  /** @type {Map<Element, { hidden: boolean, disabled: boolean | null, pointerEvents: string, ariaHidden: string | null }>} */
  const uiSnapshot = new Map();
  let open = false;
  let prevAutoReset = true;
  let lastText = "";
  let frames = 0;
  let fps = 0;
  let fpsAccum = 0;
  let lastFpsSample = performance.now();
  let frameMs = 0;
  let lastFrameTime = performance.now();
  let copyResetTimer = 0;
  let lastCheapRefresh = 0;
  let lastStructuralRefresh = 0;
  let structuralDirty = true;
  /** @type {ReturnType<typeof collectStructuralStats> | null} */
  let structural = null;
  /** @type {object | null} */
  let gltfMeta = null;
  /** @type {{ atlasCount?: number, lightMapTextures?: any[] }} */
  let lightmapInfo = {};

  const gl =
    typeof renderer.getContext === "function" ? renderer.getContext() : null;
  const gpu = detectGpuRenderer(gl);

  function postFx() {
    return typeof getPostFx === "function" ? getPostFx() : null;
  }

  function gltfRoot() {
    return typeof getGltfRoot === "function" ? getGltfRoot() : null;
  }

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
    openBtn.hidden = true;
    openBtn.setAttribute("aria-hidden", "true");
    openBtn.disabled = true;
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
    openBtn.hidden = false;
    openBtn.removeAttribute("aria-hidden");
    openBtn.disabled = false;
  }

  function cheapSnapshot() {
    const info = renderer.info || {};
    const render = info.render || {};
    const memory = info.memory || {};
    const fx = postFx();
    const draws =
      typeof fx?.getFrameDrawStats === "function"
        ? fx.getFrameDrawStats()
        : {
            sceneCalls: render.calls ?? 0,
            postFxCalls: 0,
            totalCalls: render.calls ?? 0,
            sceneTriangles: render.triangles ?? 0,
            postFxTriangles: 0,
            totalTriangles: render.triangles ?? 0,
          };
    const { drawingW, drawingH } = drawingBufferSize(renderer);
    const canvas = renderer.domElement;
    const cssW = canvas?.clientWidth || window.innerWidth;
    const cssH = canvas?.clientHeight || window.innerHeight;
    const dpr = renderer.getPixelRatio?.() ?? window.devicePixelRatio ?? 1;
    const extras = typeof getExtras === "function" ? getExtras() || {} : {};
    const heap = performance.memory
      ? {
          used: performance.memory.usedJSHeapSize,
          total: performance.memory.totalJSHeapSize,
          limit: performance.memory.jsHeapSizeLimit,
        }
      : null;
    const nav = navigator;
    const connection =
      nav.connection || nav.mozConnection || nav.webkitConnection || null;
    const cam = camera;

    return {
      time: new Date().toISOString(),
      fps: Number(fps.toFixed(1)),
      frameMs: Number(frameMs.toFixed(2)),
      draws,
      raw: {
        calls: render.calls ?? 0,
        triangles: render.triangles ?? 0,
        points: render.points ?? 0,
        lines: render.lines ?? 0,
        frame: render.frame ?? 0,
        geometries: memory.geometries ?? 0,
        textures: memory.textures ?? 0,
        programs: Array.isArray(info.programs) ? info.programs.length : "n/a",
      },
      display: {
        css: `${cssW}x${cssH}`,
        drawingBuffer: `${drawingW}x${drawingH}`,
        pixelRatio: Number(Number(dpr).toFixed(3)),
        devicePixelRatio: Number((window.devicePixelRatio || 1).toFixed(3)),
        pixels: drawingW * drawingH,
      },
      device: {
        platform: nav.platform || "n/a",
        userAgent: nav.userAgent || "n/a",
        hardwareConcurrency: nav.hardwareConcurrency ?? "n/a",
        deviceMemoryGB: nav.deviceMemory ?? "n/a",
        maxTouchPoints: nav.maxTouchPoints ?? 0,
        connection: connection
          ? `${connection.effectiveType || "?"} · downlink ${connection.downlink ?? "?"} Mbps`
          : "n/a",
        gpuVendor: gpu.vendor,
        gpuRenderer: gpu.renderer,
      },
      jsHeap: heap,
      camera: cam
        ? {
            fov: "fov" in cam ? cam.fov : "n/a",
            near: cam.near,
            far: cam.far,
            position: {
              x: Number(cam.position.x.toFixed(3)),
              y: Number(cam.position.y.toFixed(3)),
              z: Number(cam.position.z.toFixed(3)),
            },
          }
        : null,
      extras,
    };
  }

  function refreshStructural() {
    structural = collectStructuralStats({
      scene,
      camera,
      renderer,
      gltfRoot: gltfRoot(),
      gltfMeta,
      postFx: postFx(),
      lightmapInfo,
    });
    structuralDirty = false;
    lastStructuralRefresh = performance.now();
  }

  function formatPlain(cheap, struct) {
    const d = cheap.draws;
    const s = struct;
    const lines = [
      "=== Room Test — Performance Stats ===",
      `Captured: ${cheap.time}`,
      "",
      "MOBILE PERFORMANCE SUMMARY",
      `Scene draw calls:       ${d.sceneCalls}`,
      `Rendered triangles:     ${formatCount(d.sceneTriangles)}  (scene pass; excludes PostFX quads)`,
      `Visible meshes:         ${formatCount(s?.graphVisibleMeshes)} / ${formatCount(s?.threeMeshes)}  (scene-graph visible / THREE.Mesh objects)`,
      `Authored GLTF materials:${formatCount(s?.authoredMaterials)}`,
      `Material instances:     ${formatCount(s?.materialInstances)}  (Three.js objects, not authored materials)`,
      `Lightmap atlases:       ${formatCount(s?.lightmapAtlases)}`,
      `GPU textures:           ${formatCount(cheap.raw.textures)}`,
      `Estimated texture MB:   ${s ? formatBytes(s.textures.estimatedBytes) : "n/a"}  (estimate, not exact VRAM)`,
      `PostFX draws:           ${d.postFxCalls}`,
      `Framebuffer pixels:     ${formatCount(cheap.display.pixels)}`,
      `Pixel ratio:            ${cheap.display.pixelRatio}`,
      "",
      "[Frame]",
      `FPS: ${cheap.fps}`,
      `Frame time: ${cheap.frameMs} ms`,
      "",
      "[Draw calls — scene vs PostFX]",
      `Scene draw calls:  ${d.sceneCalls}`,
      `PostFX draw calls: ${d.postFxCalls}`,
      `Total GPU draws:   ${d.totalCalls}`,
      "Scene draws are objects submitted in RenderPass. PostFX draws are fullscreen quads (bloom/output), not scene meshes.",
      "",
      "[Triangles]",
      `Scene geometry triangles:   ${formatCount(s?.geometryTriangles)}  (sum of mesh geometry)`,
      `Visible geometry triangles: ${formatCount(s?.visibleGeometryTriangles)}  (visible in scene graph, not necessarily drawn)`,
      `Rendered triangles:         ${formatCount(d.sceneTriangles)}  (submitted this frame, scene pass)`,
      `PostFX triangles:           ${formatCount(d.postFxTriangles)}  (fullscreen quads)`,
      `Raw renderer triangles:     ${formatCount(cheap.raw.triangles)}  (scene + PostFX)`,
      `Geometry vertices:          ${formatCount(s?.geometryVertices)}`,
      "",
      "[Meshes]",
      `GLTF meshes:          ${formatCount(s?.gltfMeshes)}  (glTF mesh definitions)`,
      `GLTF primitives:      ${formatCount(s?.gltfPrimitives)}  (glTF primitives → usually one THREE.Mesh each)`,
      `THREE.Mesh objects:   ${formatCount(s?.threeMeshes)}`,
      `Imported meshes:      ${formatCount(s?.importedMeshes)}`,
      `Debug/helper meshes:  ${formatCount(s?.debugHelperMeshes)}`,
      `Physics meshes:       ${formatCount(s?.physicsMeshes)}`,
      `Line helpers:         ${formatCount(s?.lineObjects)}`,
      `Visible in graph:     ${formatCount(s?.graphVisibleMeshes)}`,
      `In frustum (est.):    ${formatCount(s?.inFrustumEstimate)}  (bounding-sphere vs camera; not exact GPU submit)`,
      `Frustum culled (est.):${formatCount(s?.frustumCulledEstimate)}`,
      `frustumCulled=false:  ${formatCount(s?.frustumCulledDisabled)}`,
      "",
      "[Materials]",
      `Authored GLTF materials:     ${formatCount(s?.authoredMaterials)}`,
      `Three.js material instances: ${formatCount(s?.materialInstances)}`,
      `Lightmap-cloned materials:   ${formatCount(s?.lightmapClonedMaterials)}  (clones for per-mesh lightMap, not extra authored mats)`,
      "",
    ];

    if (s?.authoredRows?.length) {
      lines.push("Material usage (by primitives):");
      for (const row of s.authoredRows) {
        const idx = row.gltfIndex != null ? `gltf[${row.gltfIndex}]` : "no-index";
        lines.push(
          `  ${row.name}  ${idx}  primitives=${row.primitives}  meshes=${row.meshes}  instances=${row.instances}  lightmapVariants=${row.lightmapVariants}`
        );
      }
      lines.push("");
    }

    lines.push(
      "[Geometry / GPU resources]",
      `Geometry objects:  ${formatCount(s?.geometryObjects)}  (unique BufferGeometry in scene)`,
      `GPU geometries:    ${formatCount(cheap.raw.geometries)}  (renderer.info.memory.geometries)`,
      `GPU textures:      ${formatCount(cheap.raw.textures)}  (renderer.info.memory.textures, includes render targets)`,
      `Material textures: ${formatCount(s?.textures.material)}`,
      `Lightmap textures: ${formatCount(s?.textures.lightmap)}`,
      `PostFX/RT textures:${formatCount(s?.textures.postFx)}`,
      `Largest texture:   ${s?.textures.largest?.label ?? "n/a"}`,
      `Estimated texture memory: ${s ? formatBytes(s.textures.estimatedBytes) : "n/a"}`,
      `Three.js/WebGL programs: ${cheap.raw.programs}  (not equal to material count)`,
      `Program reuse: ${s?.programReuse ?? "n/a"}`,
      ""
    );

    const fx = s?.postFx;
    lines.push("[PostFX]");
    if (fx) {
      lines.push(
        `Enabled: ${fx.enabled ? "Yes" : "No"}`,
        `Passes: ${fx.passCount}${fx.passNames?.length ? ` (${fx.passNames.join(" → ")})` : ""}`
      );
      if (fx.bloom) {
        lines.push(
          `Bloom: ON`,
          `Bloom mip levels: ${fx.bloomMips}`,
          `Bloom fullscreen draws: ${fx.bloomFullscreenDraws}  (instrumented PostFX draws: ${d.postFxCalls})`
        );
      } else {
        lines.push("Bloom: OFF");
      }
      lines.push(`OutputPass: ${fx.outputPass ? "Yes" : "No"}`);
    } else {
      lines.push("n/a");
    }
    lines.push("");

    lines.push(
      "[Raw THREE.WebGLRenderer.info]",
      `render.calls: ${cheap.raw.calls}`,
      `render.triangles: ${cheap.raw.triangles}`,
      `render.points: ${cheap.raw.points}`,
      `render.lines: ${cheap.raw.lines}`,
      `memory.geometries: ${cheap.raw.geometries}`,
      `memory.textures: ${cheap.raw.textures}`,
      `programs: ${cheap.raw.programs}`,
      "",
      "[Display / mobile]",
      `CSS size: ${cheap.display.css}`,
      `Drawing buffer: ${cheap.display.drawingBuffer}`,
      `Pixel ratio (renderer): ${cheap.display.pixelRatio}`,
      `Device pixel ratio: ${cheap.display.devicePixelRatio}`,
      `Framebuffer pixels: ${formatCount(cheap.display.pixels)}`,
      "",
      "[Device]",
      `Platform: ${cheap.device.platform}`,
      `CPU cores: ${cheap.device.hardwareConcurrency}`,
      `Device memory: ${cheap.device.deviceMemoryGB} GB`,
      `Touch points: ${cheap.device.maxTouchPoints}`,
      `Network: ${cheap.device.connection}`,
      `GPU vendor: ${cheap.device.gpuVendor}`,
      `GPU renderer: ${cheap.device.gpuRenderer}`,
      `User agent: ${cheap.device.userAgent}`,
      ""
    );

    if (cheap.jsHeap) {
      lines.push(
        "[JS Heap]",
        `Used: ${formatBytes(cheap.jsHeap.used)}`,
        `Total: ${formatBytes(cheap.jsHeap.total)}`,
        `Limit: ${formatBytes(cheap.jsHeap.limit)}`,
        ""
      );
    }

    if (cheap.camera) {
      const p = cheap.camera.position;
      lines.push(
        "[Camera]",
        `FOV: ${cheap.camera.fov}`,
        `Near/Far: ${cheap.camera.near} / ${cheap.camera.far}`,
        `Position: ${p.x}, ${p.y}, ${p.z}`,
        ""
      );
    }

    const extraKeys = Object.keys(cheap.extras || {});
    if (extraKeys.length) {
      lines.push("[App]");
      for (const key of extraKeys) lines.push(`${key}: ${cheap.extras[key]}`);
      lines.push("");
    }

    return lines.join("\n");
  }

  function openDetailsSet() {
    return new Set(
      [...overlay.querySelectorAll("details[data-stats-id][open]")].map(
        (el) => el.getAttribute("data-stats-id")
      )
    );
  }

  function details(id, title, inner, openSet) {
    const isOpen = openSet.has(id) ? " open" : "";
    return `<details class="stats-details" data-stats-id="${esc(id)}"${isOpen}><summary>${esc(
      title
    )}</summary><div class="stats-details-body">${inner}</div></details>`;
  }

  function row(k, v, { highlight = false, wide = false, muted = false } = {}) {
    return `<div class="stats-row${highlight ? " highlight" : ""}"><span class="k${
      wide ? " wide" : ""
    }">${esc(k)}</span><span class="v${muted ? " muted" : ""}">${v}</span></div>`;
  }

  function renderCheapHtml(cheap, struct) {
    const d = cheap.draws;
    const s = struct;
    return `
      <div class="stats-section stats-summary">
        <h4>Mobile performance summary</h4>
        ${row("Scene draws", esc(d.sceneCalls), { highlight: true, wide: true })}
        ${row("Rendered tris", esc(formatCount(d.sceneTriangles)), { highlight: true, wide: true })}
        ${row(
          "Visible meshes",
          `${esc(formatCount(s?.graphVisibleMeshes))} <span class="muted">/ ${esc(
            formatCount(s?.threeMeshes)
          )} THREE.Mesh</span>`,
          { wide: true }
        )}
        ${row("Authored mats", esc(formatCount(s?.authoredMaterials)), { wide: true })}
        ${row(
          "Mat instances",
          `${esc(formatCount(s?.materialInstances))} <span class="muted">Three.js objects</span>`,
          { wide: true }
        )}
        ${row("Lightmap atlases", esc(formatCount(s?.lightmapAtlases)), { wide: true })}
        ${row("GPU textures", esc(formatCount(cheap.raw.textures)), { wide: true })}
        ${row(
          "Est. texture MB",
          `${esc(s ? formatBytes(s.textures.estimatedBytes) : "n/a")} <span class="muted">estimate</span>`,
          { wide: true }
        )}
        ${row("PostFX draws", esc(d.postFxCalls), { wide: true })}
        ${row("FB pixels", esc(formatCount(cheap.display.pixels)), { wide: true })}
        ${row("Pixel ratio", esc(cheap.display.pixelRatio), { wide: true })}
      </div>
      <div class="stats-section">
        <h4>Frame</h4>
        ${row("FPS", esc(cheap.fps), { highlight: true })}
        ${row("Frame", `${esc(cheap.frameMs)} ms`)}
      </div>
      <div class="stats-section">
        <h4>Draw calls</h4>
        ${row("Scene draw calls", esc(d.sceneCalls), { highlight: true, wide: true })}
        ${row("PostFX draw calls", esc(d.postFxCalls), { highlight: true, wide: true })}
        ${row("Total GPU draws", esc(d.totalCalls), { wide: true })}
        <p class="stats-note">Scene = objects in the RenderPass. PostFX = bloom/output fullscreen quads, not scene geometry.</p>
      </div>
      <div class="stats-section">
        <h4>Triangles this frame</h4>
        ${row("Rendered (scene)", esc(formatCount(d.sceneTriangles)), { highlight: true, wide: true })}
        ${row("PostFX quads", esc(formatCount(d.postFxTriangles)), { wide: true })}
        ${row("Raw renderer.info", esc(formatCount(cheap.raw.triangles)), { wide: true })}
      </div>
    `;
  }

  function renderStructuralHtml(cheap, struct, openSet) {
    const s = struct;
    if (!s) {
      return `<div class="stats-section"><p class="stats-note">Structural stats not collected yet.</p></div>`;
    }

    const matList = s.authoredRows
      .map(
        (row) =>
          `<div class="stats-mat-row"><span class="stats-mat-name">${esc(
            row.name
          )}</span><span class="stats-mat-count">${esc(row.primitives)} prim</span></div>`
      )
      .join("");

    const diagRows = s.authoredRows
      .map(
        (row) => `<tr>
          <td>${esc(row.name)}</td>
          <td>${row.gltfIndex != null ? esc(row.gltfIndex) : "—"}</td>
          <td>${esc(row.instances)}</td>
          <td>${esc(row.primitives)}</td>
          <td>${esc(row.meshes)}</td>
          <td>${esc(row.lightmapVariants)}</td>
          <td>${esc(row.textures)}</td>
        </tr>`
      )
      .join("");

    const fx = s.postFx;
    const fxInner = fx
      ? `${row("Enabled", fx.enabled ? "Yes" : "No")}
         ${row("Passes", esc(fx.passCount))}
         ${row("Pass list", esc((fx.passNames || []).join(" → ") || "—"), { wide: true })}
         ${row("Bloom", fx.bloom ? "ON" : "OFF")}
         ${fx.bloom ? row("Bloom mips", esc(fx.bloomMips)) : ""}
         ${fx.bloom ? row("Bloom FS draws", `~${esc(fx.bloomFullscreenDraws)}`, { wide: true }) : ""}
         ${row("OutputPass", fx.outputPass ? "Yes" : "No")}
         ${row("Measured PostFX draws", esc(cheap.draws.postFxCalls), { wide: true })}`
      : `<p class="stats-note">No PostFX info.</p>`;

    const extraRows = Object.entries(cheap.extras || {})
      .map(([k, v]) => row(k, esc(v)))
      .join("");

    const cam = cheap.camera;
    const camBlock = cam
      ? `<div class="stats-section"><h4>Camera</h4>
          ${row("FOV", esc(cam.fov))}
          ${row("Clip", `${esc(cam.near)} – ${esc(cam.far)}`)}
          ${row("Pos", `${esc(cam.position.x)}, ${esc(cam.position.y)}, ${esc(cam.position.z)}`)}
        </div>`
      : "";

    const heapRow = cheap.jsHeap
      ? row(
          "JS heap",
          `${esc(formatBytes(cheap.jsHeap.used))} / ${esc(formatBytes(cheap.jsHeap.total))} (limit ${esc(
            formatBytes(cheap.jsHeap.limit)
          )})`,
          { wide: true }
        )
      : row("JS heap", "n/a", { wide: true, muted: true });

    return `
      <div class="stats-section">
        <h4>Geometry (asset vs graph)</h4>
        ${row("Scene geom tris", esc(formatCount(s.geometryTriangles)), { wide: true })}
        ${row("Visible geom tris", esc(formatCount(s.visibleGeometryTriangles)), { wide: true })}
        ${row("Geometry vertices", esc(formatCount(s.geometryVertices)), { wide: true })}
        <p class="stats-note">Geometry totals are mesh buffers. “Rendered triangles” above is what the GPU submitted this frame.</p>
      </div>
      <div class="stats-section">
        <h4>Meshes</h4>
        ${row("GLTF meshes", esc(formatCount(s.gltfMeshes)), { wide: true })}
        ${row("GLTF primitives", esc(formatCount(s.gltfPrimitives)), { wide: true })}
        ${row("THREE.Mesh objects", esc(formatCount(s.threeMeshes)), { wide: true })}
        ${row("Imported meshes", esc(formatCount(s.importedMeshes)), { wide: true })}
        ${row("Debug/helper meshes", esc(formatCount(s.debugHelperMeshes)), { wide: true })}
        ${row("Physics meshes", esc(formatCount(s.physicsMeshes)), { wide: true })}
        ${s.runtimeMeshes ? row("Other runtime meshes", esc(formatCount(s.runtimeMeshes)), { wide: true }) : ""}
        ${row("Line helpers", esc(formatCount(s.lineObjects)), { wide: true })}
        ${row("Visible in graph", esc(formatCount(s.graphVisibleMeshes)), { wide: true })}
        ${row("In frustum (est.)", esc(formatCount(s.inFrustumEstimate)), { wide: true })}
        ${row("Frustum culled (est.)", esc(formatCount(s.frustumCulledEstimate)), { wide: true })}
        ${row("frustumCulled=false", esc(formatCount(s.frustumCulledDisabled)), { wide: true })}
        <p class="stats-note">Frustum figures are bounding-sphere estimates, not an exact GPU submit count. Scene draw calls are the reliable submitted-draw metric. GLTFLoader creates one THREE.Mesh per primitive.</p>
      </div>
      ${details(
        "materials",
        `Materials — ${s.authoredMaterials} authored · ${s.materialInstances} Three.js instances`,
        `${row("Authored GLTF materials", esc(formatCount(s.authoredMaterials)), { wide: true })}
         ${row("Three.js material instances", esc(formatCount(s.materialInstances)), { wide: true })}
         ${row("Lightmap-cloned materials", esc(formatCount(s.lightmapClonedMaterials)), { wide: true })}
         <p class="stats-note">Instances are per-mesh clones so each can sample a different lightMap. They are not extra authored materials.</p>
         <div class="stats-mat-list">${matList}</div>`,
        openSet
      )}
      ${details(
        "matdiag",
        "Material diagnostics",
        `<div class="stats-table-wrap"><table class="stats-table">
          <thead><tr>
            <th>Authored material</th><th>GLTF</th><th>Instances</th>
            <th>Prims</th><th>Meshes</th><th>LM variants</th><th>Textures</th>
          </tr></thead>
          <tbody>${diagRows}</tbody>
        </table></div>
        <p class="stats-note">Lightmap variants = distinct lightMap textures on instances of that authored material.</p>`,
        openSet
      )}
      <div class="stats-section">
        <h4>GPU resources</h4>
        ${row("Geometry objects", esc(formatCount(s.geometryObjects)), { wide: true })}
        ${row("GPU geometries", esc(formatCount(cheap.raw.geometries)), { wide: true })}
        ${row("GPU textures", esc(formatCount(cheap.raw.textures)), { wide: true })}
        ${row("Material textures", esc(formatCount(s.textures.material)), { wide: true })}
        ${row("Lightmap textures", esc(formatCount(s.textures.lightmap)), { wide: true })}
        ${row("PostFX/RT textures", esc(formatCount(s.textures.postFx)), { wide: true })}
        ${row("Largest texture", esc(s.textures.largest?.label ?? "n/a"), { wide: true })}
        ${row("Est. texture memory", esc(formatBytes(s.textures.estimatedBytes)), { wide: true })}
        ${row("WebGL programs", esc(cheap.raw.programs), { wide: true })}
        ${row("Program reuse", esc(s.programReuse), { wide: true })}
        <p class="stats-note">GPU geometries/textures are renderer.info.memory (uploaded resources, including render targets). Estimated texture memory is CPU-side image size, not exact VRAM. Program count is shader variants, not material count.</p>
      </div>
      <div class="stats-section">
        <h4>PostFX</h4>
        ${fxInner}
      </div>
      <div class="stats-section">
        <h4>Display / mobile</h4>
        ${row("CSS", esc(cheap.display.css))}
        ${row("Buffer", esc(cheap.display.drawingBuffer))}
        ${row("DPR", `${esc(cheap.display.pixelRatio)} <span class="muted">(device ${esc(
          cheap.display.devicePixelRatio
        )})</span>`)}
        ${row("Pixels", esc(formatCount(cheap.display.pixels)))}
        ${heapRow}
      </div>
      <div class="stats-section">
        <h4>Device</h4>
        ${row("Cores", esc(cheap.device.hardwareConcurrency))}
        ${row("RAM", `${esc(cheap.device.deviceMemoryGB)} GB`)}
        ${row("Touch", esc(cheap.device.maxTouchPoints))}
        ${row("Net", esc(cheap.device.connection), { wide: true })}
        ${row("GPU", esc(cheap.device.gpuRenderer), { wide: true })}
        ${row("Vendor", esc(cheap.device.gpuVendor), { wide: true })}
      </div>
      ${camBlock}
      ${extraRows ? `<div class="stats-section"><h4>App</h4>${extraRows}</div>` : ""}
      ${details(
        "raw",
        "Raw THREE.WebGLRenderer.info",
        `${row("render.calls", esc(cheap.raw.calls), { wide: true })}
         ${row("render.triangles", esc(cheap.raw.triangles), { wide: true })}
         ${row("render.points", esc(cheap.raw.points), { wide: true })}
         ${row("render.lines", esc(cheap.raw.lines), { wide: true })}
         ${row("memory.geometries", esc(cheap.raw.geometries), { wide: true })}
         ${row("memory.textures", esc(cheap.raw.textures), { wide: true })}
         ${row("programs", esc(cheap.raw.programs), { wide: true })}
         <p class="stats-note">render.calls includes PostFX quads. Prefer “Scene draw calls” / “PostFX draw calls” above.</p>`,
        openSet
      )}
    `;
  }

  function ensureShell() {
    if (bodyEl.querySelector("#statsCheap")) return;
    bodyEl.innerHTML = `<div id="statsCheap"></div><div id="statsStructure"></div>`;
  }

  function refreshCheapUi() {
    const cheap = cheapSnapshot();
    lastText = formatPlain(cheap, structural);
    ensureShell();
    const cheapEl = bodyEl.querySelector("#statsCheap");
    if (cheapEl) cheapEl.innerHTML = renderCheapHtml(cheap, structural);
  }

  function refreshStructuralUi() {
    const cheap = cheapSnapshot();
    const openSet = openDetailsSet();
    lastText = formatPlain(cheap, structural);
    ensureShell();
    const structEl = bodyEl.querySelector("#statsStructure");
    if (structEl) structEl.innerHTML = renderStructuralHtml(cheap, structural, openSet);
  }

  function openStats() {
    if (open) return;
    open = true;
    prevAutoReset = renderer.info?.autoReset !== false;
    if (renderer.info) renderer.info.autoReset = false;
    hideOtherUi();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("stats-open");
    frames = 0;
    fpsAccum = 0;
    lastFpsSample = performance.now();
    lastFrameTime = performance.now();
    refreshStructural();
    ensureShell();
    refreshCheapUi();
    refreshStructuralUi();
  }

  function closeStats() {
    if (!open) return;
    open = false;
    if (renderer.info) renderer.info.autoReset = prevAutoReset;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("stats-open");
    restoreOtherUi();
  }

  async function copyStats() {
    const cheap = cheapSnapshot();
    const text = formatPlain(cheap, structural);
    lastText = text;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      if (copyBtn) {
        const prev = copyBtn.textContent;
        copyBtn.textContent = "Copied";
        clearTimeout(copyResetTimer);
        copyResetTimer = window.setTimeout(() => {
          copyBtn.textContent = prev || "Copy";
        }, 1200);
      }
    } catch (err) {
      console.warn("[PerfStats] Clipboard copy failed:", err);
      if (copyBtn) copyBtn.textContent = "Copy failed";
    }
  }

  function beginFrame() {
    if (!open || !renderer.info) return;
    renderer.info.reset();
  }

  function endFrame() {
    if (!open) return;
    const now = performance.now();
    const dt = Math.max(0.0001, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    frameMs = dt * 1000;
    frames += 1;
    fpsAccum += dt;
    if (now - lastFpsSample >= 500) {
      fps = frames / Math.max(fpsAccum, 1e-6);
      frames = 0;
      fpsAccum = 0;
      lastFpsSample = now;
    }
    if (now - lastCheapRefresh >= CHEAP_REFRESH_MS) {
      lastCheapRefresh = now;
      refreshCheapUi();
    }
    if (structuralDirty || now - lastStructuralRefresh >= STRUCTURAL_REFRESH_MS) {
      refreshStructural();
      refreshStructuralUi();
    }
  }

  function onKeyDown(e) {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeStats();
    }
  }

  openBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openStats();
  });
  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    closeStats();
  });
  copyBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    copyStats();
  });
  window.addEventListener("keydown", onKeyDown);

  return {
    beginFrame,
    endFrame,
    open: openStats,
    close: closeStats,
    isOpen: () => open,
    setGltfMeta(meta) {
      gltfMeta = meta || null;
      structuralDirty = true;
    },
    setLightmapInfo(info) {
      lightmapInfo = info || {};
      structuralDirty = true;
    },
    invalidateStructure() {
      structuralDirty = true;
    },
    dispose() {
      closeStats();
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(copyResetTimer);
    },
  };
}
