import { detectControlMode, CONTROL_MODE } from "../controls/control-mode.js";
import { DEFAULT_PRESET } from "./constants.js";

function gpuInfo(gl) {
  if (!gl) return { vendor: "", renderer: "" };
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  if (!ext) {
    return {
      vendor: String(gl.getParameter(gl.VENDOR) || ""),
      renderer: String(gl.getParameter(gl.RENDERER) || ""),
    };
  }
  return {
    vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || ""),
    renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || ""),
  };
}

function isLowAdreno(renderer) {
  // Adreno 3xx–640 class is well below the current Adreno 710 target.
  return /Adreno[^0-9]*(3\d{2}|4\d{2}|5\d{2}|6[0-4]\d)\b/i.test(renderer);
}

function isMidAdreno(renderer) {
  return /Adreno[^0-9]*(650|660|675|680|690|7[0-2]\d|710)\b/i.test(renderer);
}

/**
 * Recommend a preset from GPU / memory / cores / screen — not user-agent alone.
 */
export function recommendPreset(renderer) {
  const nav = navigator;
  const gl = typeof renderer?.getContext === "function" ? renderer.getContext() : null;
  const gpu = gpuInfo(gl);
  const gpuName = `${gpu.vendor} ${gpu.renderer}`;
  const memoryGB = Number(nav.deviceMemory);
  const cores = Number(nav.hardwareConcurrency) || 0;
  const dpr = Number(window.devicePixelRatio) || 1;
  const mobile = detectControlMode() === CONTROL_MODE.MOBILE;
  const cssW = window.innerWidth || 0;
  const cssH = window.innerHeight || 0;
  const pixels = cssW * cssH * Math.min(dpr, 2);

  let preset = DEFAULT_PRESET;
  let reason = "Default Balanced preset for unknown devices.";

  const veryLowMem = Number.isFinite(memoryGB) && memoryGB > 0 && memoryGB <= 2;
  const lowMem = Number.isFinite(memoryGB) && memoryGB > 0 && memoryGB <= 3;
  const midMem = Number.isFinite(memoryGB) && memoryGB >= 4 && memoryGB <= 6;

  if (veryLowMem || isLowAdreno(gpu.renderer) || /Mali-G5[12]|Mali-G31|PowerVR/i.test(gpu.renderer)) {
    preset = "battery";
    reason = "Low GPU or ≤2 GB RAM — Battery Saver is recommended.";
  } else if (
    lowMem ||
    (mobile && cores > 0 && cores <= 4 && (!Number.isFinite(memoryGB) || memoryGB <= 4))
  ) {
    preset = "performance";
    reason = "Lower-end mobile CPU/GPU — Performance is recommended.";
  } else if (
    isMidAdreno(gpu.renderer) ||
    (mobile && (midMem || !Number.isFinite(memoryGB)))
  ) {
    preset = "balanced";
    reason =
      "Mid-range mobile GPU (Adreno 710-class / ~4 GB RAM) — Balanced is recommended.";
  } else if (!mobile && (!Number.isFinite(memoryGB) || memoryGB >= 8) && cores >= 8) {
    preset = "maximum";
    reason = "Desktop-class device — Maximum Quality is available.";
  } else if (mobile) {
    preset = "balanced";
    reason = "Mobile device — Balanced is recommended.";
  }

  return {
    preset,
    reason,
    gpuVendor: gpu.vendor || "n/a",
    gpuRenderer: gpu.renderer || "n/a",
    gpuName: gpuName.trim() || "n/a",
    memoryGB: Number.isFinite(memoryGB) ? memoryGB : null,
    cores: cores || null,
    dpr,
    mobile,
    screen: `${cssW}×${cssH}`,
    pixels,
  };
}

export function firstRunCopy(profile) {
  const label =
    profile.preset === "battery"
      ? "Battery Saver"
      : profile.preset === "performance"
        ? "Performance"
        : profile.preset === "maximum"
          ? "Maximum Quality"
          : "Balanced";
  if (profile.preset === "maximum") {
    return {
      title: "Graphics recommendation",
      body: "This device can run Maximum Quality. You can change graphics later from Settings.",
      recommendedLabel: "Use Maximum Quality",
      keepLabel: "Use Balanced",
    };
  }
  return {
    title: "Graphics recommendation",
    body: `We detected a mobile device where lower graphics settings may provide a smoother experience.\n\nRecommended: ${label}`,
    recommendedLabel: `Use ${label}`,
    keepLabel: "Keep High Quality",
  };
}
