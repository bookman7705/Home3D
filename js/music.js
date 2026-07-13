/**
 * Background music with OGG → MP3 fallback and autoplay unlock for mobile Safari.
 * iOS/Android block audible playback until a user gesture; we retry on first input.
 */
export function createBackgroundMusic(config = {}) {
  const oggUrl =
    config.musicOggUrl ||
    "https://pub-3c9ceee935014032b48e5e145fa85eab.r2.dev/Home3D/music/Snoop.ogg";
  const mp3Url =
    config.musicMp3Url ||
    "https://pub-3c9ceee935014032b48e5e145fa85eab.r2.dev/Home3D/music/snoop.mp3";
  const volume = Number.isFinite(config.musicVolume) ? config.musicVolume : 0.55;

  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.loop = true;
  audio.volume = Math.min(1, Math.max(0, volume));
  // iOS inline playback (avoids forcing fullscreen video-style playback).
  audio.setAttribute("playsinline", "");
  audio.setAttribute("webkit-playsinline", "");
  audio.playsInline = true;

  // Browser plays the first supported format (OGG preferred; MP3 for Safari/iOS).
  const oggSource = document.createElement("source");
  oggSource.src = oggUrl;
  oggSource.type = 'audio/ogg; codecs="vorbis"';
  const mp3Source = document.createElement("source");
  mp3Source.src = mp3Url;
  mp3Source.type = "audio/mpeg";
  audio.appendChild(oggSource);
  audio.appendChild(mp3Source);
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

  start();

  return {
    audio,
    play,
    start,
    dispose,
    get started() {
      return started;
    },
  };
}
