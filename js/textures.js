import * as THREE from "three";

export function formatTextureLoadError(url, err) {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object") {
    if (typeof err.message === "string" && err.message) return err.message;
    const img = err.target;
    if (img && typeof img.src === "string") {
      return `Image failed to load: ${img.src}`;
    }
  }
  return `Failed to load: ${url}`;
}

export function loadTexture(url, colorSpace) {
  const loader = new THREE.TextureLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = colorSpace;
        tex.flipY = false;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        resolve(tex);
      },
      undefined,
      (err) => reject(new Error(formatTextureLoadError(url, err)))
    );
  });
}

/** First URL that loads; throws if none. */
export async function loadTextureFirstMatch(urls, colorSpace) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const tex = await loadTexture(url, colorSpace);
      return { tex, url };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("No texture candidates matched");
}
