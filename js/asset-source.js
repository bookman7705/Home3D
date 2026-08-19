/**
 * Chooses CDN vs local-disk asset URLs.
 *
 * js/assets.js stays CDN-only. offline/assets.js stays disk-only.
 * Local/LAN defaults to disk because the R2 bucket does not send CORS
 * headers for localhost, which leaves the scene empty (black screen).
 *
 * Override: ?assets=local  or  ?assets=cdn
 */
const params = new URLSearchParams(location.search);
const host = location.hostname;
const forceCdn = params.get("assets") === "cdn";
const forceLocal =
  params.get("assets") === "local" ||
  /\/offline\/?$/.test(location.pathname);

function isPrivateHost(value) {
  if (!value) return false;
  if (value === "localhost" || value === "127.0.0.1" || value === "[::1]") return true;
  if (/^192\.168\./.test(value)) return true;
  if (/^10\./.test(value)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  return false;
}

const useLocal = forceLocal || (isPrivateHost(host) && !forceCdn);
const mod = await import(useLocal ? "../offline/assets.js" : "./assets.js");

console.info(`[Assets] ${useLocal ? "local disk" : "CDN"}`);

export const assetUrl = mod.assetUrl;
export const lightmapBasePath = mod.lightmapBasePath;
export const ASSET_PATHS = mod.ASSET_PATHS;
export const ASSET_CDN = mod.ASSET_CDN;
export const R2_PUBLIC = mod.R2_PUBLIC;
export const ASSET_ROOT = mod.ASSET_ROOT;
