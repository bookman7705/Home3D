import * as THREE from "three";
import { lightmapUvAttributeForChannel, lightmapUvChannelIndex } from "./lightmap.js";

/**
 * Texture / UV debug overlay: L = lightmap view, Shift+L = UV checker.
 */
export function createTempLightmapDebug({ config, camera }) {
  const panelEl = document.getElementById("tempLightmapUvDebug");
  const bodyEl = document.getElementById("tempLightmapUvDebugBody");
  const raycaster = new THREE.Raycaster();
  const screenCenter = new THREE.Vector2(0, 0);

  function isEnabled() {
    return config.showTextureUvDebugUI !== false;
  }

  const state = {
    mode: "off",
    root: null,
    inspectedMesh: null,
    meshRecords: new Map(),
    checkerTexture: null,
  };

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function uvCount(geometry, name) {
    const attr = geometry?.attributes?.[name];
    return attr ? attr.count : 0;
  }

  function filenameFromTexture(tex) {
    if (!tex) return "(none)";
    const img = tex.image;
    if (img?.src) return String(img.src).replace(/^.*\//, "");
    if (typeof img?.currentSrc === "string" && img.currentSrc) {
      return img.currentSrc.replace(/^.*\//, "");
    }
    return "(loaded, no filename)";
  }

  function findLightMapTexture(material) {
    const list = Array.isArray(material) ? material : [material];
    for (const m of list) {
      if (m?.isMeshStandardMaterial && m.lightMap) {
        return m.lightMap;
      }
    }
    return null;
  }

  function lightmapInfoFromMaterial(material) {
    const tex = findLightMapTexture(material);
    if (tex) {
      return {
        filename: filenameFromTexture(tex),
        flipY: tex.flipY,
      };
    }
    return { filename: "(none)", flipY: null };
  }

  function resolveSourceMaterial(mesh) {
    const live = mesh.material;
    const liveTex = findLightMapTexture(live);
    if (liveTex) return live;

    const rec = state.meshRecords.get(mesh.uuid);
    if (rec?.originalMaterial) {
      const storedTex = findLightMapTexture(rec.originalMaterial);
      if (storedTex) return rec.originalMaterial;
      return rec.originalMaterial;
    }
    return live;
  }

  function storeMeshRecord(mesh, force = false) {
    if (state.meshRecords.has(mesh.uuid) && !force) return;
    const geo = mesh.geometry;
    state.meshRecords.set(mesh.uuid, {
      originalMaterial: mesh.material,
      originalUv: geo.attributes.uv ? geo.attributes.uv.clone() : null,
      hadUv: !!geo.attributes.uv,
    });
  }

  function applyUv2AsUv(mesh) {
    const geo = mesh.geometry;
    const lmAttr = lightmapUvAttributeForChannel(config.lightmapUvChannel);
    const lightmapUv = geo?.attributes?.[lmAttr];
    if (!lightmapUv) return false;
    geo.setAttribute("uv", lightmapUv);
    return true;
  }

  function restoreUv(mesh) {
    const rec = state.meshRecords.get(mesh.uuid);
    if (!rec) return;
    const geo = mesh.geometry;
    if (rec.originalUv) {
      geo.setAttribute("uv", rec.originalUv);
    } else if (!rec.hadUv && geo.attributes.uv) {
      geo.deleteAttribute("uv");
    }
  }

  function createCheckerTexture() {
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const tiles = 8;
    const tileSize = size / tiles;

    for (let y = 0; y < tiles; y += 1) {
      for (let x = 0; x < tiles; x += 1) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#d94a4a" : "#3a5fd9";
        ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
      }
    }

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= tiles; i += 1) {
      const p = i * tileSize;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }

    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px Consolas, monospace";
    ctx.fillText("(0,0)", 10, 28);
    ctx.fillText("(1,0)", size - 88, 28);
    ctx.fillText("(0,1)", 10, size - 12);
    ctx.fillText("(1,1)", size - 88, size - 12);
    ctx.font = "bold 28px Consolas, monospace";
    ctx.fillText(lightmapUvAttributeForChannel(lightmapUvChannelIndex(config)), size / 2 - 34, size / 2 + 10);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.needsUpdate = true;
    return tex;
  }

  function restoreAllMeshes() {
    if (!state.root) return;
    state.root.traverse((o) => {
      if (!o.isMesh) return;
      const rec = state.meshRecords.get(o.uuid);
      if (!rec) return;
      restoreUv(o);
      o.material = rec.originalMaterial;
    });
  }

  function enableLightmapMode() {
    if (!state.root) return;
    state.root.traverse((o) => {
      if (!o.isMesh) return;
      storeMeshRecord(o, true);
      if (!applyUv2AsUv(o)) {
        console.warn(
          `[LightmapDebug] ${o.name || "(mesh)"}: missing ${lightmapUvAttributeForChannel(lightmapUvChannelIndex(config))} — re-export glTF with LightMap as TEXCOORD_1`
        );
      }
      const orig = resolveSourceMaterial(o);
      const list = Array.isArray(orig) ? orig : [orig];
      const debugMats = list.map((m) => {
        const lightMap = findLightMapTexture(m) ?? findLightMapTexture(o.material);
        if (lightMap) {
          const mat = new THREE.MeshBasicMaterial({ map: lightMap });
          mat.map.colorSpace = THREE.NoColorSpace;
          mat.map.flipY = lightMap.flipY;
          mat.map.channel = 0;
          mat.toneMapped = false;
          const boost = Number(config.lightmapDebugExposure);
          mat.color.setScalar(Number.isFinite(boost) && boost > 0 ? boost : 6);
          return mat;
        }
        console.warn(
          `[LightmapDebug] ${o.name || "(mesh)"}: no lightMap on material — press L to exit, toggle lightmaps (1), or reload`
        );
        return new THREE.MeshBasicMaterial({ color: 0xff00ff });
      });
      o.material = Array.isArray(orig) ? debugMats : debugMats[0];
    });
  }

  function enableCheckerMode() {
    if (!state.root) return;
    if (!state.checkerTexture) {
      state.checkerTexture = createCheckerTexture();
    }
    state.root.traverse((o) => {
      if (!o.isMesh) return;
      storeMeshRecord(o, true);
      applyUv2AsUv(o);
      o.material = new THREE.MeshBasicMaterial({ map: state.checkerTexture });
    });
  }

  function setMode(mode) {
    if (state.mode !== "off") restoreAllMeshes();
    state.mode = mode;
    if (mode !== "off") {
      state.meshRecords.clear();
    }
    if (mode === "lightmap") enableLightmapMode();
    else if (mode === "checker") enableCheckerMode();
    updatePanel();
  }

  function toggleLightmapMode() {
    setMode(state.mode === "lightmap" ? "off" : "lightmap");
  }

  function toggleCheckerMode() {
    setMode(state.mode === "checker" ? "off" : "checker");
  }

  function updateInspectedMesh() {
    if (state.mode === "off" || !state.root) {
      state.inspectedMesh = null;
      return;
    }
    raycaster.setFromCamera(screenCenter, camera);
    const hits = raycaster.intersectObject(state.root, true);
    state.inspectedMesh = hits.length ? hits[0].object : null;
  }

  function updatePanel() {
    if (!isEnabled()) {
      panelEl.hidden = true;
      return;
    }

    const mode = state.mode;
    const modeLabel =
      mode === "lightmap"
        ? '<span class="on">ON — LIGHTMAP VIEW (L)</span>'
        : mode === "checker"
          ? '<span class="on">ON — UV CHECKER (Shift+L)</span>'
          : '<span class="off">OFF</span>';

    if (!state.root) {
      panelEl.hidden = false;
      bodyEl.innerHTML = `Debug mode: ${modeLabel}<br/>Waiting for GLB…`;
      return;
    }

    panelEl.hidden = false;

    const mesh = mode !== "off" ? state.inspectedMesh : null;
    let meshBlock = 'Mesh under crosshair: <span class="off">(enable debug mode)</span>';
    if (mode !== "off" && mesh?.isMesh) {
      const geo = mesh.geometry;
      const rec = state.meshRecords.get(mesh.uuid);
      const lm = lightmapInfoFromMaterial(rec?.originalMaterial ?? mesh.material);
      const flipYText = lm.flipY === null ? "(n/a)" : String(lm.flipY);
      meshBlock = `
Mesh under crosshair: <strong>${esc(mesh.name || "(unnamed)")}</strong><br/>
uv count: ${uvCount(geo, "uv")}<br/>
uv1 count: ${uvCount(geo, "uv1")}<br/>
uv2 count: ${uvCount(geo, "uv2")}<br/>
lightmap texture: ${esc(lm.filename)}<br/>
flipY: ${esc(flipYText)}`;
    }

    bodyEl.innerHTML = `
Debug mode: ${modeLabel}<br/>
${meshBlock}<br/>
<br/>
<em>L</em> lightmap view · <em>Shift+L</em> LightmapUV checker (${esc(lightmapUvAttributeForChannel(lightmapUvChannelIndex(config)))})
`;
  }

  function registerRoot(root) {
    state.root = root;
    updatePanel();
  }

  /** Re-apply debug overlay after lightmaps are assigned (e.g. syncLightmapApplication). */
  function refreshAfterLightmapApply() {
    if (state.mode === "off" || !state.root) return;
    state.meshRecords.clear();
    if (state.mode === "lightmap") enableLightmapMode();
    else if (state.mode === "checker") enableCheckerMode();
    updatePanel();
  }

  function updateFrame() {
    if (!isEnabled() || state.mode === "off") return;
    updateInspectedMesh();
    updatePanel();
  }

  window.addEventListener("keydown", (e) => {
    if (!isEnabled()) return;
    if (e.key !== "l" && e.key !== "L") return;
    if (!state.root) return;
    if (e.shiftKey) toggleCheckerMode();
    else toggleLightmapMode();
    e.preventDefault();
  });

  updatePanel();

  return { registerRoot, refreshAfterLightmapApply, updateFrame };
}
