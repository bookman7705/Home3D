import * as THREE from "three";
import { CONTROL_MODE } from "./control-mode.js";

/**
 * Player / camera movement with PC (WASD + mouse look) and Mobile
 * (on-screen D-pad + device orientation) modes.
 *
 * When `usePhysicsMovement` is true, this module only gathers look + move
 * input; Rapier writes `camera.position` (see physics/player-controller.js).
 */
export function createPlayerControls({
  camera,
  worldScale,
  canvas,
  initialMode = CONTROL_MODE.PC,
  usePhysicsMovement = false,
  enableJump = false,
  onJump = null,
}) {
  const S = Math.max(0.0001, Number(worldScale) || 1);
  const cameraHeight = 1.71 * S;
  const walkSpeed = 2.7 * S;
  const lookSensitivity = 0.0022;

  let mode = initialMode === CONTROL_MODE.MOBILE ? CONTROL_MODE.MOBILE : CONTROL_MODE.PC;
  let enabled = true;
  let physicsMovement = !!usePhysicsMovement;
  let jumpEnabled = !!enableJump;
  let jumpHandler = typeof onJump === "function" ? onJump : null;

  const move = { forward: false, back: false, left: false, right: false };
  const forwardVec = new THREE.Vector3();
  const rightVec = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);

  const lookEuler = new THREE.Euler(0, 0, 0, "YXZ");
  lookEuler.setFromQuaternion(camera.quaternion);
  let pointerLocked = false;

  const controlsEl = document.getElementById("controls");
  const startBtn = document.getElementById("startBtn");
  const lookSurface = canvas || document.body;

  function clearMove() {
    heldByPointer.clear();
    move.forward = false;
    move.back = false;
    move.left = false;
    move.right = false;
    syncHeldUi();
  }

  function syncModeUi() {
    const isMobile = mode === CONTROL_MODE.MOBILE;
    if (controlsEl) {
      controlsEl.hidden = !isMobile;
      controlsEl.setAttribute("aria-hidden", isMobile ? "false" : "true");
    }
    if (startBtn) {
      startBtn.hidden = !isMobile;
      if (!isMobile) startBtn.style.display = "none";
      else if (!deviceOrientationActive) startBtn.style.display = "";
    }
  }

  const padUnbind = [];
  const heldByPointer = new Map();

  function syncHeldUi() {
    for (const key of ["forward", "back", "left", "right"]) {
      const el = document.getElementById(key);
      if (el) el.classList.toggle("is-held", !!move[key]);
    }
  }

  function applyHeld() {
    move.forward = false;
    move.back = false;
    move.left = false;
    move.right = false;
    if (mode === CONTROL_MODE.MOBILE && enabled) {
      for (const key of heldByPointer.values()) {
        if (key in move) move[key] = true;
      }
    }
    syncHeldUi();
  }

  function bindMovePad() {
    if (!controlsEl) return;

    function keyFromTarget(target) {
      const el = target?.closest?.("[data-move]");
      if (!el || !controlsEl.contains(el)) return null;
      return el.getAttribute("data-move");
    }

    function blockBrowser(e) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }

    function onPointerDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const key = keyFromTarget(e.target);
      if (!key) return;
      blockBrowser(e);
      heldByPointer.set(e.pointerId, key);
      try {
        controlsEl.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      applyHeld();
    }

    function onPointerUp(e) {
      if (!heldByPointer.has(e.pointerId)) return;
      blockBrowser(e);
      heldByPointer.delete(e.pointerId);
      applyHeld();
    }

    function setFromTouches(changedTouches, down) {
      for (const touch of changedTouches) {
        const id = `t${touch.identifier}`;
        if (down) {
          const el = document.elementFromPoint(touch.clientX, touch.clientY);
          const key = keyFromTarget(el) || keyFromTarget(touch.target);
          if (key) heldByPointer.set(id, key);
        } else {
          heldByPointer.delete(id);
        }
      }
      applyHeld();
    }

    function onTouchStart(e) {
      blockBrowser(e);
      setFromTouches(e.changedTouches, true);
    }

    function onTouchEnd(e) {
      blockBrowser(e);
      setFromTouches(e.changedTouches, false);
    }

    const optsFalse = { passive: false };
    const pairs = [
      ["pointerdown", onPointerDown, optsFalse],
      ["pointerup", onPointerUp, optsFalse],
      ["pointercancel", onPointerUp, optsFalse],
      ["lostpointercapture", onPointerUp, optsFalse],
      ["contextmenu", blockBrowser, optsFalse],
      ["selectstart", blockBrowser, optsFalse],
      ["dragstart", blockBrowser, optsFalse],
      ["touchstart", onTouchStart, optsFalse],
      ["touchend", onTouchEnd, optsFalse],
      ["touchcancel", onTouchEnd, optsFalse],
    ];

    for (const [type, handler, options] of pairs) {
      controlsEl.addEventListener(type, handler, options);
      padUnbind.push(() => controlsEl.removeEventListener(type, handler, options));
    }
  }

  bindMovePad();

  function onKeyDown(e) {
    if (!enabled || mode !== CONTROL_MODE.PC) return;
    if (e.repeat) return;
    switch (e.code) {
      case "KeyW":
        move.forward = true;
        e.preventDefault();
        break;
      case "KeyS":
        move.back = true;
        e.preventDefault();
        break;
      case "KeyA":
        move.left = true;
        e.preventDefault();
        break;
      case "KeyD":
        move.right = true;
        e.preventDefault();
        break;
      case "Space":
        if (jumpEnabled && jumpHandler) {
          e.preventDefault();
          jumpHandler();
        }
        break;
      default:
        break;
    }
  }

  function onKeyUp(e) {
    if (mode !== CONTROL_MODE.PC) return;
    switch (e.code) {
      case "KeyW":
        move.forward = false;
        break;
      case "KeyS":
        move.back = false;
        break;
      case "KeyA":
        move.left = false;
        break;
      case "KeyD":
        move.right = false;
        break;
      default:
        break;
    }
  }

  function onPointerMove(e) {
    if (!enabled || mode !== CONTROL_MODE.PC || !pointerLocked) return;
    lookEuler.y -= e.movementX * lookSensitivity;
    lookEuler.x -= e.movementY * lookSensitivity;
    const limit = Math.PI / 2 - 0.01;
    lookEuler.x = Math.max(-limit, Math.min(limit, lookEuler.x));
    camera.quaternion.setFromEuler(lookEuler);
  }

  function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === lookSurface;
  }

  function requestPointerLock() {
    if (mode !== CONTROL_MODE.PC || !enabled) return;
    if (document.pointerLockElement === lookSurface) return;
    lookSurface.requestPointerLock?.();
  }

  function exitPointerLock() {
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
  }

  function onCanvasClick() {
    if (mode === CONTROL_MODE.PC) requestPointerLock();
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  document.addEventListener("pointerlockchange", onPointerLockChange);
  document.addEventListener("mousemove", onPointerMove);
  lookSurface.addEventListener("click", onCanvasClick);

  function getMoveState() {
    return { ...move };
  }

  function updateMovement(delta) {
    if (!enabled || physicsMovement) return;

    camera.getWorldDirection(forwardVec);
    forwardVec.y = 0;
    if (forwardVec.lengthSq() < 1e-8) {
      forwardVec.set(0, 0, -1);
    } else {
      forwardVec.normalize();
    }
    rightVec.crossVectors(forwardVec, upAxis).normalize();

    const moveVec = new THREE.Vector3();
    if (move.forward) moveVec.add(forwardVec);
    if (move.back) moveVec.addScaledVector(forwardVec, -1);
    if (move.right) moveVec.add(rightVec);
    if (move.left) moveVec.addScaledVector(rightVec, -1);

    if (moveVec.lengthSq() > 0) {
      moveVec.normalize().multiplyScalar(walkSpeed * delta);
      camera.position.add(moveVec);
    }
    camera.position.y = cameraHeight;
  }

  const deviceEuler = new THREE.Euler();
  const deviceQuatTarget = new THREE.Quaternion();
  const deviceQuatSmooth = new THREE.Quaternion();
  const screenAdjustQuat = new THREE.Quaternion();
  const screenAxisZ = new THREE.Vector3(0, 0, 1);
  const deviceToCameraQuat = new THREE.Quaternion(
    -Math.sqrt(0.5),
    0,
    0,
    Math.sqrt(0.5)
  );
  let hasDeviceOrientation = false;
  let deviceOrientationActive = false;
  const rotationSmoothing = 0.12;

  function handleOrientation(e) {
    if (mode !== CONTROL_MODE.MOBILE || !enabled) return;
    if (e.alpha == null || e.beta == null || e.gamma == null) return;

    const alpha = THREE.MathUtils.degToRad(e.alpha);
    const beta = THREE.MathUtils.degToRad(e.beta);
    const gamma = THREE.MathUtils.degToRad(e.gamma);
    const screenAngleDeg = window.screen?.orientation?.angle ?? window.orientation ?? 0;
    const screenAngle = THREE.MathUtils.degToRad(screenAngleDeg);

    deviceEuler.set(beta, alpha, -gamma, "YXZ");
    deviceQuatTarget.setFromEuler(deviceEuler);
    deviceQuatTarget.multiply(deviceToCameraQuat);
    screenAdjustQuat.setFromAxisAngle(screenAxisZ, -screenAngle);
    deviceQuatTarget.multiply(screenAdjustQuat);

    if (!hasDeviceOrientation) {
      deviceQuatSmooth.copy(deviceQuatTarget);
      hasDeviceOrientation = true;
    }
  }

  function updateCameraRotation() {
    if (!enabled || mode !== CONTROL_MODE.MOBILE || !hasDeviceOrientation) return;
    deviceQuatSmooth.slerp(deviceQuatTarget, rotationSmoothing);
    camera.quaternion.copy(deviceQuatSmooth);
    lookEuler.setFromQuaternion(camera.quaternion);
  }

  async function enableDeviceOrientation(startBtnId = "startBtn") {
    if (mode !== CONTROL_MODE.MOBILE) return;
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") return;
    }
    if (!deviceOrientationActive) {
      window.addEventListener("deviceorientation", handleOrientation);
      deviceOrientationActive = true;
    }
    const btn = document.getElementById(startBtnId);
    if (btn) btn.style.display = "none";
  }

  function disableDeviceOrientation() {
    if (!deviceOrientationActive) return;
    window.removeEventListener("deviceorientation", handleOrientation);
    deviceOrientationActive = false;
    hasDeviceOrientation = false;
  }

  function setMode(nextMode) {
    const resolved = nextMode === CONTROL_MODE.MOBILE ? CONTROL_MODE.MOBILE : CONTROL_MODE.PC;
    if (resolved === mode) {
      syncModeUi();
      return;
    }

    clearMove();
    mode = resolved;

    if (mode === CONTROL_MODE.PC) {
      disableDeviceOrientation();
      lookEuler.setFromQuaternion(camera.quaternion);
      syncModeUi();
    } else {
      exitPointerLock();
      syncModeUi();
    }
  }

  function setEnabled(value) {
    enabled = !!value;
    if (!enabled) {
      clearMove();
      exitPointerLock();
    }
  }

  function setPhysicsMovement(value) {
    physicsMovement = !!value;
  }

  function setJumpEnabled(value) {
    jumpEnabled = !!value;
  }

  function setJumpHandler(handler) {
    jumpHandler = typeof handler === "function" ? handler : null;
  }

  function dispose() {
    clearMove();
    exitPointerLock();
    disableDeviceOrientation();
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("pointerlockchange", onPointerLockChange);
    document.removeEventListener("mousemove", onPointerMove);
    lookSurface.removeEventListener("click", onCanvasClick);
    while (padUnbind.length) {
      const unbind = padUnbind.pop();
      unbind();
    }
  }

  setMode(mode);

  return {
    updateMovement,
    updateCameraRotation,
    getMoveState,
    enableDeviceOrientation,
    setMode,
    getMode: () => mode,
    setEnabled,
    setPhysicsMovement,
    setJumpEnabled,
    setJumpHandler,
    dispose,
  };
}
