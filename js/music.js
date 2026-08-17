import { assetUrl } from "asset-config";

/**
 * Background music with optional OGG + MP3 sources and autoplay unlock for mobile Safari.
 * iOS/Android block audible playback until a user gesture; we retry on first input.
 * A level may supply only MP3 (Safari/iOS) — do not fall back to another track's OGG.
 */
export function createBackgroundMusic(config = {}) {
  const enabled = config.enableMusic !== false;

  const oggUrl = config.musicOggUrl || "";
  const mp3Url = config.musicMp3Url || "";
  const volume = Number.isFinite(config.musicVolume) ? config.musicVolume : 0.55;

  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.loop = true;
  audio.volume = Math.min(1, Math.max(0, volume));
  // iOS inline playback (avoids forcing fullscreen video-style playback).
  audio.setAttribute("playsinline", "");
  audio.setAttribute("webkit-playsinline", "");
  audio.playsInline = true;

  function addSource(src, type) {
    if (!src) return;
    const source = document.createElement("source");
    source.src = src;
    source.type = type;
    audio.appendChild(source);
  }

  // Explicit URLs only — otherwise default Snoop OGG → MP3.
  if (oggUrl || mp3Url) {
    addSource(oggUrl, 'audio/ogg; codecs="vorbis"');
    addSource(mp3Url, "audio/mpeg");
  } else {
    addSource(assetUrl("music", "Snoop.ogg"), 'audio/ogg; codecs="vorbis"');
    addSource(assetUrl("music", "snoop.mp3"), "audio/mpeg");
  }
  audio.load();

  let started = false;
  let gestureBound = false;

  const GESTURE_EVENTS = ["pointerdown", "touchstart", "click", "keydown"];

  function onEnded() {
    // Some mobile browsers ignore `loop`; restart manually.
    if (!started) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  audio.addEventListener("ended", onEnded);

  async function play() {
    try {
      await audio.play();
      started = true;
      unbindGestureUnlock();
      return true;
    } catch {
      return false;
    }
  }

  function onGesture() {
    play();
  }

  function unbindGestureUnlock() {
    if (!gestureBound) return;
    gestureBound = false;
    for (const type of GESTURE_EVENTS) {
      document.removeEventListener(type, onGesture, true);
    }
  }

  function bindGestureUnlock() {
    if (gestureBound || started) return;
    gestureBound = true;
    for (const type of GESTURE_EVENTS) {
      document.addEventListener(type, onGesture, { capture: true, passive: true });
    }
  }

  /** Try autoplay; if blocked, wait for the first user gesture (required on iOS/Android). */
  function start() {
    play().then((ok) => {
      if (!ok) bindGestureUnlock();
    });
  }

  function dispose() {
    unbindGestureUnlock();
    audio.removeEventListener("ended", onEnded);
    audio.pause();
    while (audio.firstChild) audio.removeChild(audio.firstChild);
    audio.removeAttribute("src");
    audio.load();
  }

  if (enabled) {
    start();
  }

  return {
    audio,
    play,
    start,
    dispose,
    enabled,
    get started() {
      return started;
    },
  };
}
