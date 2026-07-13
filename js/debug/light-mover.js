import * as THREE from "three";

/**
 * Arrow keys / R / F move the currently selected light in world space
 * (works for parented lights like camera flashlight).
 */
export function createLightMover({ getTarget, worldScale = 1, moveSpeed = 3 } = {}) {
  const S = Math.max(0.0001, Number(worldScale) || 1);
  let speed = Math.max(0, Number(moveSpeed) || 0) * S;

  const keys = {
    up: false,
    down: false,
    left: false,
    right: false,
    rise: false,
    fall: false,
  };

  const worldPos = new THREE.Vector3();
  const localPos = new THREE.Vector3();
  const delta = new THREE.Vector3();

  function onKeyDown(e) {
    if (e.repeat) return;
    switch (e.code) {
      case "ArrowUp":
        keys.up = true;
        e.preventDefault();
        break;
      case "ArrowDown":
        keys.down = true;
        e.preventDefault();
        break;
      case "ArrowLeft":
        keys.left = true;
        e.preventDefault();
        break;
      case "ArrowRight":
        keys.right = true;
        e.preventDefault();
        break;
      case "KeyR":
        keys.rise = true;
        e.preventDefault();
        break;
      case "KeyF":
        keys.fall = true;
        e.preventDefault();
        break;
      default:
        break;
    }
  }

  function onKeyUp(e) {
    switch (e.code) {
      case "ArrowUp":
        keys.up = false;
        break;
      case "ArrowDown":
        keys.down = false;
        break;
      case "ArrowLeft":
        keys.left = false;
        break;
      case "ArrowRight":
        keys.right = false;
        break;
      case "KeyR":
        keys.rise = false;
        break;
      case "KeyF":
        keys.fall = false;
        break;
      default:
        break;
    }
  }

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  function setMoveSpeed(next, worldScaleNext = S) {
    const scale = Math.max(0.0001, Number(worldScaleNext) || S);
    speed = Math.max(0, Number(next) || 0) * scale;
  }

  function update(dt) {
    const light = typeof getTarget === "function" ? getTarget() : null;
    if (!light?.isObject3D) return;

    delta.set(0, 0, 0);
    const step = speed * dt;
    if (keys.left) delta.x -= step;
    if (keys.right) delta.x += step;
    if (keys.up) delta.z -= step;
    if (keys.down) delta.z += step;
    if (keys.rise) delta.y += step;
    if (keys.fall) delta.y -= step;
    if (delta.lengthSq() === 0) return;

    light.getWorldPosition(worldPos);
    worldPos.add(delta);

    if (light.parent) {
      localPos.copy(worldPos);
      light.parent.worldToLocal(localPos);
      light.position.copy(localPos);
    } else {
      light.position.copy(worldPos);
    }

    light.updateMatrixWorld(true);
  }

  function dispose() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  }

  return { update, setMoveSpeed, dispose };
}
