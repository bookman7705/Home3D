import * as THREE from "three";
import { loadTextureFirstMatch } from "./textures.js";
import {
  applyBakedMapsToMaterial,
  finalizeGltfPbrMaterials,
} from "./materials.js";

/** Non-color data maps (lightmap, AO, normals) — linear irradiance / tangent-space data. */
const LINEAR_SPACE = THREE.NoColorSpace;
const SRGB_SPACE = THREE.SRGBColorSpace;

const LIGHTMAP_UV_SOURCE_ATTRS = ["uv1", "uv2", "uv3"];

export function lightmapUvAttributeForChannel(channel) {
  const ch = Number(channel) || 0;
  return ch === 0 ? "uv" : `uv${ch}`;
}

export function lightmapUvChannelIndex(config) {
  const ch = Number(config?.lightmapUvChannel);
  return Number.isFinite(ch) ? ch : 1;
}

export function resolveLightmapUvAttributeName(geometry, config) {
  if (!geometry?.attributes) return null;

  const targetAttr = lightmapUvAttributeForChannel(lightmapUvChannelIndex(config));
  if (geometry.attributes[targetAttr]) return targetAttr;

  for (const srcAttr of LIGHTMAP_UV_SOURCE_ATTRS) {
    if (srcAttr === targetAttr) continue;
    const src = geometry.attributes[srcAttr];
    if (!src) continue;
    geometry.setAttribute(targetAttr, src.clone());
    console.info(
      `[BakedMaps] Mapped geometry.attributes.${srcAttr} → ${targetAttr}`
    );
    return targetAttr;
  }

  return null;
}

export function geometryHasLightmapUv(geometry, config) {
  const channel = typeof config === "object" ? lightmapUvChannelIndex(config) : Number(config) || 1;
  return !!geometry?.attributes?.[lightmapUvAttributeForChannel(channel)];
}

/**
 * Lightmap / AO sampling — no mipmaps (avoids grain from noisy mips), clamp edges.
 * Nearest filter optional (config.disableLightmapEdgeBleeding) to avoid island bleed.
 * Cycles bakes are linear irradiance (Non-Color); flipY false for glTF.
 */
export function configureBakedMapTexture(tex, config) {
  if (!tex) return tex;
  tex.channel = lightmapUvChannelIndex(config);
  tex.colorSpace = LINEAR_SPACE;
  tex.flipY = false;
  tex.generateMipmaps = false;
  const nearest = config?.disableLightmapEdgeBleeding !== false;
  tex.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  const aniso = Number(config?.lightmapAnisotropy);
  if (Number.isFinite(aniso) && aniso > 0) {
    tex.anisotropy = aniso;
  }
  tex.needsUpdate = true;
  return tex;
}

function configureUv0(tex, config) {
  if (!tex) return tex;
  tex.channel = 0;
  const aniso = Number(config.textureAnisotropy) || 0;
  if (aniso > 0) tex.anisotropy = aniso;
  return tex;
}

export function usesGlobalLightmapAtlas(config) {
  return !!String(config.lightmapBaseStem ?? "").trim();
}

export function sanitizeName(name) {
  const s = String(name).trim().replace(/[^A-Za-z0-9_-]+/g, "_");
  return s || "Group";
}

export function lightmapGroupKeyForMesh(mesh) {
  const g = mesh.userData?.lightmap_group;
  if (typeof g === "string" && g.trim()) {
    return sanitizeName(g.trim());
  }
  return `__solo_${sanitizeName(mesh.name)}`;
}

function stemOverride(mesh, map) {
  if (!map || typeof map !== "object") return "";
  const name = String(mesh?.name ?? "").trim();
  if (!name) return "";
  const hit = map[name] ?? map[name.toLowerCase()];
  return String(hit ?? "").trim();
}

/** AutoLightmapv2 object stem: Cube → "Cube", Wall.004 → "Wall004". */
export function bakedObjectStemForMesh(mesh, config) {
  const globalStem = String(config.lightmapBaseStem ?? "").trim();
  if (globalStem) return globalStem.replace(/_Lightmap$/i, "");

  const baked = stemOverride(mesh, config.bakedMeshStems);
  if (baked) return baked;

  const legacy = stemOverride(mesh, config.lightmapMeshStems);
  if (legacy) return legacy.replace(/_Lightmap$/i, "");

  const group = mesh.userData?.lightmap_group;
  if (typeof group === "string" && group.trim()) {
    return `${config.IMAGE_NAME}_${lightmapGroupKeyForMesh(mesh)}`;
  }

  return String(mesh.name ?? "").trim() || "Mesh";
}

/** @deprecated use bakedObjectStemForMesh */
export function lightmapImageBaseForMesh(mesh, config) {
  const stem = bakedObjectStemForMesh(mesh, config);
  if (usesGlobalLightmapAtlas(config)) {
    return String(config.lightmapBaseStem).trim();
  }
  return `${stem}_Lightmap`;
}

const GLTF_GENERIC_PARENT_NAMES = new Set(["", "Scene", "Root", "Armature"]);

export function collectMeshStemsFromScene(root, config) {
  const globalStem = String(config.lightmapBaseStem ?? "").trim();
  if (globalStem) return [globalStem.replace(/_Lightmap$/i, "")];
  const set = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const meshStem = bakedObjectStemForMesh(o, config);
    const parentName = String(o.parent?.name ?? "").trim();
    // Multi-primitive glTF: child meshes are Cube001 / Cube001_1; bakes use parent node name.
    if (parentName && !GLTF_GENERIC_PARENT_NAMES.has(parentName) && parentName !== meshStem) {
      set.add(parentName);
    } else {
      set.add(meshStem);
    }
    const ud = o.userData?.name;
    if (typeof ud === "string" && ud.trim()) set.add(ud.trim());
  });
  return Array.from(set).filter(Boolean).sort();
}

/** @deprecated */
export function collectLightmapBasesFromScene(root, config) {
  return collectMeshStemsFromScene(root, config).map((s) => `${s}_Lightmap`);
}

export function normalizeLightmapBasePath(config) {
  let folder = String(config?.lightmapTextureBasePath ?? "./").replace(/\\/g, "/");
  folder = folder.replace(/\/+$/, "");
  return folder.length ? `${folder}/` : "";
}

function candidateUrlsForStem(stem, config) {
  const prefix = normalizeLightmapBasePath(config);
  return config.textureExtensions.map((ext) => `${prefix}${stem}${ext}`);
}

export function textureUrlFromManifestFile(filename, config) {
  const name = String(filename ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!name) return "";
  return `${normalizeLightmapBasePath(config)}${name}`;
}

export function lightmapManifestUrl(config) {
  const file = String(config?.lightmapManifestFilename ?? "lightmap_manifest.json").replace(
    /^\/+/,
    ""
  );
  return `${normalizeLightmapBasePath(config)}${file}`;
}

/** True when manifest lists at least one mesh → baked-map link. */
export function manifestHasMeshEntries(manifest) {
  if (Array.isArray(manifest?.lightmaps) && manifest.lightmaps.length > 0) return true;
  if (Array.isArray(manifest?.meshes) && manifest.meshes.length > 0) return true;
  if (manifest?.meshesByName && typeof manifest.meshesByName === "object") {
    return Object.keys(manifest.meshesByName).length > 0;
  }
  return false;
}

/** Load AutoLightmapv2 mesh → baked-map manifest. */
export async function loadLightmapManifest(config) {
  const url = lightmapManifestUrl(config);
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      console.warn(`[BakedMaps] Manifest not found: ${url} (${res.status})`);
      return null;
    }
    const manifest = await res.json();
    if (!manifestHasMeshEntries(manifest)) {
      console.warn("[BakedMaps] Manifest loaded but contains no mesh entries:", url);
      return null;
    }
    console.info(
      "[BakedMaps] Loaded manifest:",
      url,
      manifest.version ? `(v${manifest.version})` : "",
      manifest.generator ? `[${manifest.generator}]` : ""
    );
    return manifest;
  } catch (err) {
    console.warn("[BakedMaps] Failed to load manifest:", url, err);
    return null;
  }
}

function normalizeManifestLookupName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(/_/g, "");
}

function manifestLookupKeys(...values) {
  const keys = new Set();
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    keys.add(raw);
    keys.add(raw.toLowerCase());
    keys.add(normalizeManifestLookupName(raw));
  }
  return Array.from(keys).filter(Boolean);
}

/** AutoLightmapv4/v5: objectName is the glTF node key; meshName may be Blender mesh data name. */
export function normalizeManifestMeshEntry(entry) {
  const objectName = String(entry?.objectName ?? entry?.threeName ?? "").trim();
  const rawMeshName = String(
    entry?.meshName ?? entry?.threeMeshName ?? entry?.threeName ?? ""
  ).trim();
  const blenderMeshDataName = String(entry?.blenderMeshDataName ?? "").trim() || rawMeshName;
  const blenderObjectName = String(entry?.blenderObjectName ?? "").trim() || objectName;
  const threeName = String(entry?.threeName ?? objectName ?? rawMeshName).trim();
  const threeMeshName = String(entry?.threeMeshName ?? rawMeshName ?? threeName).trim();
  const lookupName = threeName || objectName || rawMeshName;
  let lightmapFile = String(entry?.lightmap ?? "").trim();
  if (!lightmapFile && entry?.lightmapPath) {
    lightmapFile = String(entry.lightmapPath).replace(/^.*[/\\]/, "");
  }
  let aoFile = String(entry?.ao ?? "").trim();
  if (!aoFile && entry?.aoPath) {
    aoFile = String(entry.aoPath).replace(/^.*[/\\]/, "");
  }
  return {
    ...entry,
    objectName: threeName || objectName || lookupName,
    meshName: threeName || lookupName,
    threeName,
    threeMeshName,
    rawMeshName,
    blenderObjectName,
    blenderMeshDataName,
    objectStem: String(entry?.objectStem ?? threeName ?? objectName).trim() || lookupName,
    lightmap: lightmapFile,
    ao: aoFile,
    sharedAtlas: entry?.sharedAtlas === true,
    atlasStem: String(entry?.atlasStem ?? "").trim(),
    profileName: String(entry?.profileName ?? "").trim(),
    profileUuid: String(entry?.profileUuid ?? "").trim(),
    resolution: Number(entry?.resolution) || undefined,
    resolutionY: Number(entry?.resolutionY ?? entry?.resolution) || undefined,
  };
}

function manifestEntryNameAliases(entry = {}) {
  return [
    entry?.threeName,
    entry?.threeMeshName,
    entry?.objectName,
    entry?.meshName,
    entry?.blenderObjectName,
    entry?.blenderMeshDataName,
    entry?.rawMeshName,
    entry?.objectStem,
  ];
}

function lookupManifestEntryByName(pack, name) {
  const lookup = manifestLookupKeys(name);
  for (const key of lookup) {
    const direct = pack.get(key);
    if (direct) return direct;
  }
  return null;
}

/** Resolve manifest entry using Three.js mesh/node names from glTF. */
export function resolveManifestPackEntry(mesh, pack) {
  if (!mesh || !(pack instanceof Map)) return null;

  const parentName = String(mesh.parent?.name ?? "").trim();
  const candidates = [mesh.name, mesh.userData?.name, parentName];
  const seen = new Set();
  for (const name of candidates) {
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const hit = lookupManifestEntryByName(pack, name);
    if (hit) return hit;
  }
  return null;
}

function registerManifestPackEntry(pack, entry) {
  for (const key of manifestLookupKeys(...manifestEntryNameAliases(entry))) {
    pack.set(key, entry);
  }
}

function firstManifestSampleEntry(manifest) {
  if (Array.isArray(manifest?.lightmaps) && manifest.lightmaps.length) {
    return manifest.lightmaps[0];
  }
  if (Array.isArray(manifest?.meshes) && manifest.meshes.length) {
    return manifest.meshes[0];
  }
  if (manifest?.meshesByName && typeof manifest.meshesByName === "object") {
    const values = Object.values(manifest.meshesByName);
    if (values.length) return values[0];
  }
  return null;
}

/** Merge top-level bakeSettings with v5 per-entry profile bakeSettings. */
function resolveManifestBakeSettings(manifest) {
  const top = manifest?.bakeSettings;
  if (top && typeof top === "object" && Object.keys(top).length > 0) {
    return top;
  }
  const sample = firstManifestSampleEntry(manifest);
  return sample?.bakeSettings && typeof sample.bakeSettings === "object"
    ? sample.bakeSettings
    : {};
}

export function parseManifestMeta(manifest) {
  const bakeSettings = resolveManifestBakeSettings(manifest);
  const lightmaps = Array.isArray(manifest?.lightmaps) ? manifest.lightmaps : [];
  const sharedAtlasStems = [
    ...new Set(
      lightmaps
        .filter((entry) => entry?.sharedAtlas === true && entry?.atlasStem)
        .map((entry) => String(entry.atlasStem).trim())
        .filter(Boolean)
    ),
  ];

  return {
    version: Number(manifest?.version) || 0,
    generator: String(manifest?.generator ?? "").trim(),
    scene: String(manifest?.scene ?? "").trim(),
    resolution: Number(manifest?.resolution) || undefined,
    resolutionY: Number(manifest?.resolutionY ?? manifest?.resolution) || undefined,
    uvLayer: String(manifest?.uvLayer ?? bakeSettings?.uv_channel_name ?? "").trim(),
    lightmapUvChannel: Number(
      manifest?.lightmapUvChannel ?? bakeSettings?.uv_channel_index
    ),
    outputFolder: String(manifest?.outputFolder ?? bakeSettings?.output_directory ?? "").trim(),
    textureFormat: String(manifest?.textureFormat ?? "png").trim(),
    colorSpace: String(manifest?.colorSpace ?? "Non-Color").trim(),
    sharedAtlasStems,
    aoBakedIntoLightmap: manifestAoBakedIntoLightmap(manifest),
    profileNames: [
      ...new Set(
        lightmaps.map((entry) => String(entry?.profileName ?? "").trim()).filter(Boolean)
      ),
    ],
    bakeSettings,
  };
}

function manifestHasAoEntries(manifest) {
  const check = (entry) => Boolean(String(entry?.ao ?? "").trim() || entry?.aoPath);
  if (Array.isArray(manifest?.lightmaps) && manifest.lightmaps.some(check)) return true;
  if (manifest?.meshesByName && typeof manifest.meshesByName === "object") {
    return Object.values(manifest.meshesByName).some(check);
  }
  return false;
}

function manifestAoBakedIntoLightmap(manifest) {
  if (manifest?.aoBakedIntoLightmap === true) return true;
  const gen = String(manifest?.generator ?? "");
  return /^AutoLightmap_v6/i.test(gen);
}

function effectiveConfigFromManifest(config, manifest) {
  const bakeSettings = resolveManifestBakeSettings(manifest);
  const updates = {};

  const channel = Number(
    manifest?.lightmapUvChannel ??
      bakeSettings?.uv_channel_index ??
      bakeSettings?.lightmapUvChannel
  );
  if (Number.isFinite(channel)) updates.lightmapUvChannel = channel;

  const bakedIntensity = Number(bakeSettings?.indirect_intensity);
  if (Number.isFinite(bakedIntensity)) {
    updates.lightMapIntensity = bakedIntensity;
  }

  const aoBakedIn = manifestAoBakedIntoLightmap(manifest);
  if (aoBakedIn) {
    updates.loadAoMaps = false;
  } else if (manifestHasAoEntries(manifest) && config.loadAoMaps !== false) {
    updates.loadAoMaps = true;
    const aoStrength = Number(bakeSettings?.ao_strength);
    if (Number.isFinite(aoStrength) && aoStrength > 0) {
      updates.aoMapIntensity = aoStrength;
    }
  }

  const meta = parseManifestMeta(manifest);
  if (meta.sharedAtlasStems.length > 0) {
    updates.manifestSharedAtlas = true;
  }

  return Object.keys(updates).length ? { ...config, ...updates } : config;
}

function manifestMeshEntries(manifest) {
  const seen = new Set();
  const out = [];

  const add = (raw) => {
    const entry = normalizeManifestMeshEntry(raw);
    if (!entry.meshName || !entry.lightmap) return;
    const dedupeKey = `${entry.objectName || entry.meshName}:${entry.lightmap}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push(entry);
  };

  if (Array.isArray(manifest?.lightmaps) && manifest.lightmaps.length) {
    for (const entry of manifest.lightmaps) add(entry);
    if (out.length) return out;
  }

  if (Array.isArray(manifest?.meshes) && manifest.meshes.length) {
    for (const entry of manifest.meshes) add(entry);
    if (out.length) return out;
  }

  if (manifest?.meshesByName && typeof manifest.meshesByName === "object") {
    for (const entry of Object.values(manifest.meshesByName)) add(entry);
  }

  return out;
}

function candidateStemVariants(stem) {
  const set = new Set([stem]);
  const m = String(stem).match(/^(.*?)([A-Za-z]+)(\d{3})$/);
  if (m) {
    const [, prefix, head, digits] = m;
    set.add(`${prefix}${head}.${digits}`);
    set.add(`${prefix}${head}_${digits}`);
    set.add(`${prefix}${head}${digits}`);
    set.add(`${prefix}${head}`);
  }
  const dotForm = stem.match(/^(.+)\.(\d+)$/);
  if (dotForm) {
    set.add(`${dotForm[1]}${dotForm[2]}`);
    set.add(`${dotForm[1]}_${dotForm[2]}`);
  }
  return Array.from(set);
}

function stemFromUrl(url) {
  return String(url).replace(/^.*\//, "").replace(/\.[^./?#]+(?:[?#].*)?$/, "");
}

export function traverseMeshesEnsureLightmapUv(root, config) {
  let resolved = 0;
  let missing = 0;

  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const attr = resolveLightmapUvAttributeName(o.geometry, config);
    if (attr) resolved += 1;
    else missing += 1;
  });

  const targetAttr = lightmapUvAttributeForChannel(lightmapUvChannelIndex(config));
  console.info(
    `[BakedMaps] Lightmap UV (${targetAttr}): ${resolved} ready, ${missing} missing`
  );
}

async function tryLoadMap(stemSuffix, colorSpace, config, channel) {
  const aniso = Number(config.textureAnisotropy) || 0;
  const urls = candidateStemVariants(stemSuffix).flatMap((s) =>
    candidateUrlsForStem(s, config)
  );
  try {
    const r = await loadTextureFirstMatch(urls, colorSpace, {
      channel,
      anisotropy: channel === 0 ? aniso : 0,
    });
    return { tex: r.tex, url: r.url, ok: true, err: "" };
  } catch (e) {
    return {
      tex: null,
      url: "",
      ok: false,
      err: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Try AutoLightmap naming variants plus exact/global stems (e.g. Tecxutre_LightMap.png). */
async function tryLoadLightmapTexture(objectStem, config) {
  const stem = String(objectStem ?? "").trim().replace(/\.png$/i, "");
  const candidates = [`${stem}_Lightmap`, `${stem}_LightMap`, stem];
  if (usesGlobalLightmapAtlas(config)) {
    const globalStem = String(config.lightmapBaseStem ?? "")
      .trim()
      .replace(/\.png$/i, "")
      .replace(/_Lightmap$/i, "");
    if (globalStem) {
      candidates.unshift(
        globalStem,
        `${globalStem}_Lightmap`,
        `${globalStem}_LightMap`
      );
    }
  }
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const result = await tryLoadMap(
      candidate,
      LINEAR_SPACE,
      config,
      lightmapUvChannelIndex(config)
    );
    if (result.ok) return result;
  }
  return {
    tex: null,
    url: "",
    ok: false,
    err: `No lightmap found for stem '${stem}'`,
  };
}

/**
 * Load AutoLightmapv2 map set per object stem.
 * @returns {Promise<{ pack: Map<string, object>, diagnostics: object[] }>}
 */
export async function loadBakedMapPack(stems, config) {
  const bakeUv1 = (tex) => configureBakedMapTexture(tex, config);
  const bakeUv0 = (tex) => configureUv0(tex, config);
  const pack = new Map();
  const diagnostics = [];

  for (const objectStem of stems) {
    const entry = {
      lightMap: null,
      aoMap: null,
      normalMap: null,
      albedoMap: null,
      lightmapUrl: "",
      aoUrl: "",
      normalUrl: "",
      albedoUrl: "",
    };

    const diag = {
      objectStem,
      lightmapOk: false,
      lightmapUrl: "",
      lightmapErr: "",
      aoOk: false,
      aoUrl: "",
      aoErr: "disabled",
      normalOk: false,
      normalUrl: "",
      normalErr: "disabled",
      albedoOk: false,
      albedoUrl: "",
      albedoErr: "disabled",
    };

    if (config.enableLightMaps) {
      const lm = await tryLoadLightmapTexture(objectStem, config);
      diag.lightmapOk = lm.ok;
      diag.lightmapUrl = lm.url;
      diag.lightmapErr = lm.err;
      if (lm.ok) {
        entry.lightMap = bakeUv1(lm.tex);
        entry.lightmapUrl = lm.url;
      }
    } else {
      diag.lightmapErr = "disabled";
    }

    if (config.loadAoMaps && entry.lightMap) {
      const resolvedStem = stemFromUrl(entry.lightmapUrl).replace(/_Lightmap$/i, "");
      const ao = await tryLoadMap(`${resolvedStem}_AO`, LINEAR_SPACE, config, lightmapUvChannelIndex(config));
      diag.aoOk = ao.ok;
      diag.aoUrl = ao.url;
      diag.aoErr = ao.err || "optional AO missing";
      if (ao.ok) {
        entry.aoMap = bakeUv1(ao.tex);
        entry.aoUrl = ao.url;
      }
    }

    if (config.loadNormalMaps) {
      const nm = await tryLoadMap(`${objectStem}_Normal`, LINEAR_SPACE, config, 0);
      diag.normalOk = nm.ok;
      diag.normalUrl = nm.url;
      diag.normalErr = nm.err || "optional normal missing";
      if (nm.ok) {
        entry.normalMap = bakeUv0(nm.tex);
        entry.normalUrl = nm.url;
      }
    }

    if (config.loadAlbedoMaps) {
      const ab = await tryLoadMap(`${objectStem}_Albedo`, SRGB_SPACE, config, 0);
      diag.albedoOk = ab.ok;
      diag.albedoUrl = ab.url;
      diag.albedoErr = ab.err || "optional albedo missing";
      if (ab.ok) {
        entry.albedoMap = bakeUv0(ab.tex);
        entry.albedoUrl = ab.url;
      }
    }

    if (entry.lightMap || entry.albedoMap || entry.normalMap) {
      pack.set(objectStem, entry);
      if (usesGlobalLightmapAtlas(config)) {
        pack.set("__global__", entry);
      }
    }

    diagnostics.push(diag);
  }

  return { pack, diagnostics };
}

/** @deprecated use loadBakedMapPack */
export async function loadLightmapPackForBases(bases, config) {
  const stems = bases.map((b) => String(b).replace(/_Lightmap$/i, ""));
  return loadBakedMapPack(stems, config);
}

/**
 * Load baked maps using lightmap_manifest.json (keyed by glTF mesh name).
 * AutoLightmapv5: shared profile atlases, per-entry bakeSettings, explicit AO paths.
 * @returns {Promise<{ pack: Map, diagnostics: object[], config: object, sharedAtlases: Map, manifestMeta: object }>}
 */
export async function loadBakedMapPackFromManifest(manifest, config) {
  const effectiveConfig = effectiveConfigFromManifest(config, manifest);
  const manifestMeta = parseManifestMeta(manifest);
  const bakeUv1 = (tex) => configureBakedMapTexture(tex, effectiveConfig);
  const pack = new Map();
  const sharedAtlases = new Map();
  const diagnostics = [];
  const textureCache = new Map();

  async function loadManifestTexture(filename, colorSpace, configureFn) {
    const url = textureUrlFromManifestFile(filename, effectiveConfig);
    if (!url) {
      return { tex: null, url: "", ok: false, err: "missing filename" };
    }

    try {
      if (!textureCache.has(url)) {
        textureCache.set(url, loadTextureFirstMatch([url], colorSpace));
      }
      const { tex, url: loadedUrl } = await textureCache.get(url);
      return { tex: configureFn(tex), url: loadedUrl, ok: true, err: "" };
    } catch (e) {
      return {
        tex: null,
        url,
        ok: false,
        err: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const loadedEntries = [];

  for (const meshEntry of manifestMeshEntries(manifest)) {
    const meshName = meshEntry.meshName;
    if (!meshName) continue;

    const entry = {
      lightMap: null,
      aoMap: null,
      normalMap: null,
      albedoMap: null,
      lightmapUrl: "",
      aoUrl: "",
      normalUrl: "",
      albedoUrl: "",
      meshName,
      objectName: meshEntry.objectName || meshName,
      objectStem: meshEntry.objectStem || meshName,
      rawMeshName: meshEntry.rawMeshName || "",
      blenderMeshDataName: meshEntry.blenderMeshDataName || meshEntry.rawMeshName || "",
      sharedAtlas: meshEntry.sharedAtlas === true,
      atlasStem: meshEntry.atlasStem || "",
      profileName: meshEntry.profileName || "",
      profileUuid: meshEntry.profileUuid || "",
      resolution: meshEntry.resolution,
      resolutionY: meshEntry.resolutionY,
    };

    const diag = {
      meshName,
      objectStem: entry.objectStem,
      objectName: entry.objectName,
      profileName: entry.profileName,
      sharedAtlas: entry.sharedAtlas,
      atlasStem: entry.atlasStem,
      lightmapFile: meshEntry.lightmap,
      resolution: entry.resolution,
      lightmapOk: false,
      lightmapUrl: "",
      lightmapErr: "",
      aoOk: false,
      aoUrl: "",
      aoErr: effectiveConfig.loadAoMaps ? "optional AO missing" : "disabled",
      normalOk: false,
      normalUrl: "",
      normalErr: "disabled",
      albedoOk: false,
      albedoUrl: "",
      albedoErr: "disabled",
    };

    if (effectiveConfig.enableLightMaps && meshEntry?.lightmap) {
      const lm = await loadManifestTexture(
        meshEntry.lightmap,
        LINEAR_SPACE,
        bakeUv1
      );
      diag.lightmapOk = lm.ok;
      diag.lightmapUrl = lm.url;
      diag.lightmapErr = lm.err;
      if (lm.ok) {
        entry.lightMap = lm.tex;
        entry.lightmapUrl = lm.url;
      }
    } else if (!effectiveConfig.enableLightMaps) {
      diag.lightmapErr = "disabled";
    } else {
      diag.lightmapErr = "missing lightmap path in manifest";
    }

    if (effectiveConfig.loadAoMaps && entry.lightMap && meshEntry?.ao) {
      const ao = await loadManifestTexture(meshEntry.ao, LINEAR_SPACE, bakeUv1);
      diag.aoOk = ao.ok;
      diag.aoUrl = ao.url;
      diag.aoErr = ao.err || "optional AO missing";
      if (ao.ok) {
        entry.aoMap = ao.tex;
        entry.aoUrl = ao.url;
      }
    }

    if (entry.lightMap || entry.albedoMap || entry.normalMap) {
      loadedEntries.push(entry);
    }

    diagnostics.push(diag);
  }

  for (const entry of loadedEntries) {
    registerManifestPackEntry(pack, entry);
    if (entry.sharedAtlas && entry.atlasStem && !sharedAtlases.has(entry.atlasStem)) {
      sharedAtlases.set(entry.atlasStem, entry);
    }
  }

  return { pack, diagnostics, config: effectiveConfig, sharedAtlases, manifestMeta };
}

function collectSharedGeometryGroups(root) {
  const byUuid = new Map();
  root.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const id = child.geometry.uuid;
    if (!byUuid.has(id)) byUuid.set(id, []);
    byUuid.get(id).push(child);
  });
  return [...byUuid.values()].filter((group) => group.length > 1);
}

function manifestEntryKey(entry) {
  if (!entry) return "";
  return String(entry.objectName || entry.objectStem || entry.meshName || "").trim();
}

/** glTF may reference one geometry from multiple nodes — split when manifest regions differ. */
function splitSharedGeometryForManifest(root, pack, config, options = {}) {
  const resolve =
    options.resolveEntry ??
    ((mesh, manifestPack) => resolveManifestPackEntry(mesh, manifestPack));

  for (const group of collectSharedGeometryGroups(root)) {
    const entries = group.map((mesh) => resolve(mesh, pack, config));
    const keys = new Set(entries.map((entry) => manifestEntryKey(entry)).filter(Boolean));
    if (keys.size <= 1) continue;

    console.warn(
      "[BakedMaps] Shared geometry across glTF instances with different lightmap regions — cloning:",
      group.map((mesh) => mesh.name).join(", ")
    );

    for (let i = 1; i < group.length; i += 1) {
      const mesh = group[i];
      const clone = mesh.geometry.clone();
      resolveLightmapUvAttributeName(clone, config);
      mesh.geometry = clone;
    }
  }
}

export function applyBakedMapsFromPack(root, pack, config, options = {}) {
  const bakeUv1 = (tex) => configureBakedMapTexture(tex, config);
  const cloneFor = new Map();
  let warnedNoUv2 = false;
  const globalAtlas = usesGlobalLightmapAtlas(config);

  splitSharedGeometryForManifest(root, pack, config, options);

  const stats = {
    meshTotal: 0,
    meshWithUv2: 0,
    meshSkippedNoUv2: 0,
    meshSkippedNonStd: 0,
    meshWithBakedMaps: 0,
    meshSkippedNoPack: 0,
    skippedMeshNames: [],
    materialsUpdated: 0,
    withLightmap: 0,
    withAo: 0,
    withNormal: 0,
    withAlbedo: 0,
  };

  root.traverse((child) => {
    if (!child.isMesh) return;
    stats.meshTotal += 1;

    const geo = child.geometry;
    const needsLightmap = config.enableLightMaps;
    if (needsLightmap && !geometryHasLightmapUv(geo, config)) {
      stats.meshSkippedNoUv2 += 1;
      if (!warnedNoUv2) {
        console.warn(
          `[BakedMaps] Missing ${lightmapUvAttributeForChannel(lightmapUvChannelIndex(config))} — export LightmapUV as TEXCOORD_1.`
        );
        warnedNoUv2 = true;
      }
      if (!config.loadAlbedoMaps && !config.loadNormalMaps) return;
    } else if (needsLightmap) {
      stats.meshWithUv2 += 1;
    }

    const objectStem = bakedObjectStemForMesh(child, config);
    const entry = options.resolveEntry
      ? options.resolveEntry(child, pack, config)
      : pack.get(objectStem)
        ?? (globalAtlas ? pack.get("__global__") : null);
    if (!entry) {
      stats.meshSkippedNoPack += 1;
      stats.skippedMeshNames.push(String(child.name ?? "(unnamed)"));
      // Clone materials so meshes without a manifest entry never share a lightmapped
      // material instance with a matched sibling in the glTF.
      if (options.resolveEntry) {
        const orig = child.material;
        const list = Array.isArray(orig) ? orig : [orig];
        const cleared = list.map((m) => {
          if (!m?.isMeshStandardMaterial) return m;
          const nm = m.clone();
          nm.lightMap = null;
          if (config.loadAoMaps) nm.aoMap = null;
          return nm;
        });
        child.material = Array.isArray(orig) ? cleared : cleared[0];
      }
      return;
    }

    const orig = child.material;
    const list = Array.isArray(orig) ? orig : [orig];
    let appliedThisMesh = false;

    const next = list.map((m, slotIndex) => {
      if (!m?.isMeshStandardMaterial) return m;

      const apply = (mat) => {
        applyBakedMapsToMaterial(mat, entry, config, bakeUv1, child);
        stats.materialsUpdated += 1;
        if (entry.lightMap && config.enableLightMaps) stats.withLightmap += 1;
        if (entry.aoMap && config.loadAoMaps) stats.withAo += 1;
        if (entry.normalMap && config.loadNormalMaps) stats.withNormal += 1;
        if (entry.albedoMap && config.loadAlbedoMaps) stats.withAlbedo += 1;
      };

      if (globalAtlas) {
        apply(m);
        appliedThisMesh = true;
        return m;
      }

      const mapKey = `${child.uuid}:${slotIndex}:${objectStem}`;
      let nm = cloneFor.get(mapKey);
      if (!nm) {
        nm = m.clone();
        apply(nm);
        cloneFor.set(mapKey, nm);
      }
      appliedThisMesh = true;
      return nm;
    });

    if (!appliedThisMesh) stats.meshSkippedNonStd += 1;
    else stats.meshWithBakedMaps += 1;

    child.material = Array.isArray(orig) ? next : next[0];
  });

  return stats;
}

/** Apply baked maps using manifest pack entries keyed by glTF mesh.name. */
export function applyBakedMapsFromManifestPack(root, pack, config, options = {}) {
  return applyBakedMapsFromPack(root, pack, config, {
    resolveEntry: (mesh, manifestPack) => resolveManifestPackEntry(mesh, manifestPack),
  });
}

export function collectSceneMeshNames(root) {
  const rows = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    rows.push({
      name: o.name,
      userDataName: o.userData?.name ?? "",
      parent: o.parent?.name ?? "",
      materials: Array.isArray(o.material) ? o.material.length : 1,
    });
  });
  return rows;
}

export function countMeshUvStats(root, config) {
  const stats = {
    meshTotal: 0,
    meshWithUv2: 0,
    meshSkippedNoUv2: 0,
    meshSkippedNonStd: 0,
    meshWithBakedMaps: 0,
    meshSkippedNoPack: 0,
    materialsUpdated: 0,
  };
  root.traverse((child) => {
    if (!child.isMesh) return;
    stats.meshTotal += 1;
    if (geometryHasLightmapUv(child.geometry, config)) stats.meshWithUv2 += 1;
    else stats.meshSkippedNoUv2 += 1;
  });
  return stats;
}

export { finalizeGltfPbrMaterials };
