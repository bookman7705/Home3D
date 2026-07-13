import { lightmapUvAttributeForChannel } from "./lightmap.js";

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * On-screen lightmap load / apply status panel.
 */
export function createLightmapDebugUI(config) {
  const panelEl = document.getElementById("lightmapDebug");
  const bodyEl = document.getElementById("lightmapDebugBody");
  const previewEl = document.getElementById("lightmapDebugPreview");

  function setVisible(show) {
    if (!config.showLightmapDebugUI) {
      panelEl.hidden = true;
      return;
    }
    panelEl.hidden = !show;
  }

  function drawPreview(tex) {
    if (!tex?.image || !previewEl) return;
    const img = tex.image;
    if (!img.width) return;
    previewEl.classList.remove("hidden");
    const ctx = previewEl.getContext("2d");
    ctx.clearRect(0, 0, previewEl.width, previewEl.height);
    ctx.drawImage(img, 0, 0, previewEl.width, previewEl.height);
    const data = ctx.getImageData(0, 0, previewEl.width, previewEl.height).data;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      max = Math.max(max, data[i], data[i + 1], data[i + 2]);
    }
    lastPreviewMax = max;
  }

  let lastPreviewMax = 0;

  /**
   * @param {{ diagnostics: object[], anyDiffuseLoaded: boolean, apply: object|null }} state
   */
  function renderPanel(state) {
    if (!config.showLightmapDebugUI) {
      panelEl.hidden = true;
      return;
    }

    const sourceLabel = state.usedManifest
      ? state.manifestMeta?.version
        ? `Manifest v${state.manifestMeta.version} (${esc(state.manifestMeta.generator || "lightmap_manifest.json")})`
        : "Manifest (lightmap_manifest.json)"
      : "Stem fallback (mesh names / userData.lightmap_group)";

    const metaBlock = state.manifestMeta
      ? `<br/>Atlas: ${state.manifestMeta.resolution ?? "?"}×${state.manifestMeta.resolutionY ?? state.manifestMeta.resolution ?? "?"} px · UV ${esc(String(state.manifestMeta.uvLayer || "—"))} (channel ${state.manifestMeta.lightmapUvChannel ?? config.lightmapUvChannel})${
          state.manifestMeta.sharedAtlasStems?.length
            ? `<br/>Shared atlases: ${esc(state.manifestMeta.sharedAtlasStems.join(", "))}`
            : ""
        }${
          state.manifestMeta.profileNames?.length
            ? `<br/>Profiles: ${esc(state.manifestMeta.profileNames.join(", "))}`
            : ""
        }`
      : "";

    const atlasRows = (state.diagnostics || [])
      .map((r) => {
        const label = r.meshName || r.objectStem || r.baseName || "mesh";
        const profileTag = r.profileName
          ? ` · profile <em>${esc(r.profileName)}</em>`
          : "";
        const sharedTag = r.sharedAtlas
          ? ` · <span class="ok">shared atlas</span> ${esc(r.atlasStem || "")}`
          : "";
        const lmOk = r.lightmapOk ?? r.diffuseOk;
        const lmUrl = r.lightmapUrl || r.diffuseUrl || "";
        const lmErr = r.lightmapErr || r.diffuseErr || "";
        const lmFile = r.lightmapFile ? ` (${esc(r.lightmapFile)})` : "";
        const d = lmOk
          ? `<span class="ok">Lightmap OK</span>${lmFile} ${esc(lmUrl)}`
          : `<span class="err">Lightmap missing</span> <span class="warn">${esc(lmErr)}</span>`;
        const a = !config.loadAoMaps
          ? `<span class="warn">AO disabled (CONFIG.loadAoMaps)</span>`
          : r.aoOk
            ? `<span class="ok">AO OK</span> ${esc(r.aoUrl)}`
            : `<span class="warn">AO not loaded</span> ${esc(r.aoErr || "")}`;
        return `<strong>${esc(label)}</strong>${profileTag}${sharedTag}<br/>${d}<br/>${a}<br/><br/>`;
      })
      .join("");

    let applyBlock = "";
    if (state.apply) {
      const a = state.apply;
      const uvWarn =
        a.meshSkippedNoUv2 > 0
          ? `<span class="warn"> ${a.meshSkippedNoUv2} mesh(es) missing lightmap UV (uv${config.lightmapUvChannel}) — lightmap cannot apply</span>`
          : `<span class="ok"> lightmap UV present on sampled meshes</span>`;
      const skippedNoPack = a.meshSkippedNoPack ?? a.meshSkippedNoAtlas ?? 0;
      const skippedNames = Array.isArray(a.skippedMeshNames) ? a.skippedMeshNames : [];
      const atlasWarn =
        skippedNoPack > 0
          ? `<br/><span class="warn">Meshes with no matching baked map entry: ${skippedNoPack}${
              skippedNames.length
                ? ` (${esc(skippedNames.join(", "))})`
                : ""
            }</span>`
          : "";
      const meshesWithMaps = a.meshWithBakedMaps ?? a.meshWithLightMap ?? 0;
      const working =
        state.anyDiffuseLoaded &&
        meshesWithMaps > 0 &&
        a.meshSkippedNoUv2 === 0 &&
        skippedNoPack === 0;
      const statusLine = working
        ? `<span class="ok">Lightmap pipeline: OK (applied to materials)</span>`
        : !config.enableLightMaps && state.texturesLoaded
          ? `<span class="warn">Lightmaps loaded but disabled — press 1 to enable</span>`
        : state.anyDiffuseLoaded && a.meshSkippedNoUv2 > 0
          ? `<span class="warn">Lightmaps loaded but some meshes lack lightmap UV</span>`
          : state.anyDiffuseLoaded && meshesWithMaps === 0
            ? `<span class="warn">No MeshStandardMaterial meshes updated — check materials</span>`
            : !state.texturesLoaded
              ? `<span class="err">No lightmap textures loaded — check lightmaps/lightmap_manifest.json</span>`
              : `<span class="warn">Check stats below</span>`;

      const sparseBakeWarn =
        state.anyDiffuseLoaded && lastPreviewMax > 0 && lastPreviewMax < 48
          ? `<br/><span class="warn">Atlas preview is nearly black (max texel ${lastPreviewMax}/255) — re-bake in Blender with updated AutoLightmap_v6.py and re-export GLB</span>`
          : "";

      applyBlock = `
<br/><br/><strong>Scene / GLB</strong><br/>
${statusLine}${sparseBakeWarn}<br/>
Meshes (total): ${a.meshTotal}<br/>
Meshes with lightmap UV (<code>${esc(lightmapUvAttributeForChannel(config.lightmapUvChannel))}</code>): ${a.meshWithUv2}<br/>
Meshes skipped (no lightmap UV): ${a.meshSkippedNoUv2}${uvWarn}<br/>
Meshes skipped (no manifest / pack entry): ${skippedNoPack}${atlasWarn}<br/>
Meshes with baked maps applied: ${meshesWithMaps}<br/>
Materials updated: ${a.materialsUpdated ?? a.materialsWithLightMap ?? 0}<br/>
Non-standard materials skipped: ${a.meshSkippedNonStd}
`;
    }

    bodyEl.innerHTML = `
<strong>${esc(sourceLabel)}</strong>${metaBlock}<br/>
${atlasRows || '<span class="warn">No baked map entries</span>'}
${applyBlock}
`;
    setVisible(true);
  }

  return { drawPreview, renderPanel };
}
