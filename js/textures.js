import * as THREE from "three";
import { decode as decodePng } from "fast-png";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

/** Must match the three version in index.html's import map. */
const THREE_BASIS_VERSION = "0.160.0";
const KTX2_TRANSCODER_PATH = `https://cdn.jsdelivr.net/npm/three@${THREE_BASIS_VERSION}/examples/jsm/libs/basis/`;

/** Shared KTX2 loader — configured once with the app WebGLRenderer. */
let ktx2Loader = null;

export function configureKtx2Loader(renderer) {
  if (ktx2Loader || !renderer) return ktx2Loader;
  ktx2Loader = new KTX2Loader();
  ktx2Loader.setTranscoderPath(KTX2_TRANSCODER_PATH);
  ktx2Loader.detectSupport(renderer);
  return ktx2Loader;
}

export function getKtx2Loader() {
  return ktx2Loader;
}

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

function isPngUrl(url) {
  return /\.png($|\?)/i.test(String(url || ""));
}

function isKtx2Url(url) {
  return /\.ktx2($|\?)/i.test(String(url || ""));
}

async function loadKtx2Texture(url, colorSpace) {
  if (!ktx2Loader) {
    throw new Error(
      `KTX2Loader not configured (needed for ${url}). Call configureKtx2Loader(renderer) first.`
    );
  }
  const tex = await ktx2Loader.loadAsync(url);
  tex.colorSpace = colorSpace;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.userData.isKtx2 = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Decode 16-bit PNG to a float DataTexture.
 * Browser Image()/TextureLoader always quantize PNG to 8-bit — bypass that.
 */
async function loadPng16AsFloatTexture(url, colorSpace) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const decoded = decodePng(bytes);
  const depth = Number(decoded.depth) || 8;
  if (depth < 16) {
    throw new Error(`PNG is ${depth}-bit (want 16-bit)`);
  }

  const width = decoded.width;
  const height = decoded.height;
  const channels = decoded.channels || 3;
  const src = decoded.data;
  const rgba = new Float32Array(width * height * 4);
  const scale = 1 / 65535;

  for (let i = 0, p = 0; i < width * height; i++) {
    const base = i * channels;
    const r = src[base] * scale;
    const g = src[base + Math.min(1, channels - 1)] * scale;
    const b = src[base + Math.min(2, channels - 1)] * scale;
    const a = channels > 3 ? src[base + 3] * scale : 1;
    rgba[p++] = r;
    rgba[p++] = g;
    rgba[p++] = b;
    rgba[p++] = a;
  }

  const tex = new THREE.DataTexture(rgba, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.colorSpace = colorSpace;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.userData.pngBitDepth = depth;
  return tex;
}

function loadTextureViaImageElement(url, colorSpace) {
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

export async function loadTexture(url, colorSpace) {
  if (isKtx2Url(url)) {
    return loadKtx2Texture(url, colorSpace);
  }
  if (isPngUrl(url)) {
    try {
      return await loadPng16AsFloatTexture(url, colorSpace);
    } catch (err) {
      // 8-bit PNG or decode failure — fall back to browser image path.
      console.info(
        `[Textures] 16-bit PNG path skipped for ${url}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return loadTextureViaImageElement(url, colorSpace);
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
