/**
 * Public Cloudflare R2 bucket `3d-assets` → https://pub-3c9ceee935014032b48e5e145fa85eab.r2.dev
 * Object keys under Home3D/: models, hdr, music, LightMaps
 *
 * Mapped as the "asset-config" specifier in index.html. The offline HTML remaps
 * that specifier to a local module — this file is CDN-only and never reads disk.
 */
export const R2_PUBLIC = "https://pub-3c9ceee935014032b48e5e145fa85eab.r2.dev";
export const ASSET_CDN = `${R2_PUBLIC}/Home3D`;

export const ASSET_PATHS = {
  models: `${ASSET_CDN}/models`,
  lightmaps: `${ASSET_CDN}/LightMaps`,
  music: `${ASSET_CDN}/music`,
  hdr: `${ASSET_CDN}/hdr`,
};

/** Join an R2 asset folder + filename with forward slashes. */
export function assetUrl(folderKey, filename) {
  const base = ASSET_PATHS[folderKey] || `${ASSET_CDN}/${folderKey}`;
  const name = String(filename || "").replace(/^\/+/, "");
  return `${base}/${name}`;
}

/** Per-level lightmap folder on R2, e.g. Home3D/LightMaps/library/ */
export function lightmapBasePath(levelFolder) {
  const folder = String(levelFolder || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return `${ASSET_PATHS.lightmaps}/${folder}/`;
}
