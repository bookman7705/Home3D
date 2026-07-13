import * as THREE from "three";
import { createEnvTriggers } from "./env-triggers.js";
import { createInteractPrompt } from "./prompt-ui.js";
import { createInteractHandlers } from "./handlers/index.js";

const DEG = Math.PI / 180;
const _toFocus = new THREE.Vector3();
const _look = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();

/**
 * Cascaded focus selection (cheap → expensive):
 * 1) Distance to trigger center
 * 2) Player ∩ ENV_ Rapier sensor (or Box3 fallback)
 * 3) View cone from camera look
 * 4) Optional LOS raycast against solid meshes
 *
 * Only one trigger is active at a time (best cone score among survivors).
 */
export function createInteractSystem({
  RAPIER,
  world,
  scene,
  camera,
  root,
  config = {},
  worldScale = 1,
  getPlayerCollider = () => null,
  getPlayerPosition = () => camera.position,
  getPlayerBody = () => null,
  fanState,
  losRoots = null,
}) {
  const S = Math.max(0.0001, Number(worldScale) || 1);
  const maxDist =
    Math.max(0.25, Number(config.interactMaxDistance) || 3.5) * S;
  const maxDistSq = maxDist * maxDist;
  const coneCos = Math.cos(
    (Math.max(1, Number(config.interactConeHalfAngleDeg) || 35) * DEG)
  );
  const requireLos = config.interactRequireLineOfSight !== false;
  const interactKey = String(config.interactKeyCode || "KeyE");

  const env = createEnvTriggers(RAPIER, world, scene, root);
  env.setDebugVisible(!!config.showInteractDebug);

  const handlers = createInteractHandlers({ fanState });
  const prompt = createInteractPrompt();
  prompt.setHint(interactKey.replace(/^Key/, ""));

  const raycaster = new THREE.Raycaster();
  raycaster.far = maxDist;

  /** @type {object | null} */
  let active = null;
  let disposed = false;

  function handlerFor(trigger) {
    return handlers.get(trigger.type);
  }

  function playerInsideTrigger(trigger, playerCollider, playerPos) {
    if (playerCollider && world && trigger.collider) {
      let inside = false;
      world.intersectionPairsWith(playerCollider, (other) => {
        if (other.handle === trigger.collider.handle) inside = true;
      });
      if (inside) return true;
    }
    // AABB fallback (also covers missing Rapier / one-frame lag).
    return trigger.box.containsPoint(playerPos);
  }

  function inViewCone(focus) {
    camera.getWorldDirection(_look);
    _toFocus.copy(focus).sub(camera.position);
    const dist = _toFocus.length();
    if (dist < 1e-5) return { ok: true, score: 1, dist: 0 };
    _toFocus.multiplyScalar(1 / dist);
    const dot = _look.dot(_toFocus);
    return { ok: dot >= coneCos, score: dot, dist };
  }

  function hasLineOfSight(focus, margin = 0.35) {
    if (!requireLos) return true;

    _rayOrigin.copy(camera.position);
    _rayDir.copy(focus).sub(_rayOrigin);
    const dist = _rayDir.length();
    if (dist < 1e-4) return true;
    _rayDir.multiplyScalar(1 / dist);

    // Prefer Rapier solid cast (sensors ignored by EXCLUDE_SENSORS).
    if (RAPIER && world) {
      const ray = new RAPIER.Ray(
        { x: _rayOrigin.x, y: _rayOrigin.y, z: _rayOrigin.z },
        { x: _rayDir.x, y: _rayDir.y, z: _rayDir.z }
      );
      const excludeBody = getPlayerBody?.() ?? null;
      const hit = world.castRay(
        ray,
        Math.max(0, dist - margin),
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        excludeBody ?? undefined
      );
      // Hit before the focus (minus margin) ⇒ blocked.
      return !hit;
    }

    // Fallback: Three.js mesh raycast against visual roots.
    const roots = losRoots?.() ?? (root ? [root] : []);
    raycaster.set(_rayOrigin, _rayDir);
    raycaster.far = Math.max(0.01, dist - margin);
    const hits = raycaster.intersectObjects(roots, true);
    return hits.length === 0;
  }

  /**
   * Pick at most one interactable trigger.
   * @returns {object | null}
   */
  function findBestTrigger() {
    const playerCollider = getPlayerCollider?.() ?? null;
    const playerPos = getPlayerPosition?.() ?? camera.position;
    let best = null;
    let bestScore = -Infinity;

    for (let i = 0; i < env.triggers.length; i++) {
      const trigger = env.triggers[i];
      const handler = handlerFor(trigger);
      if (!handler || !handler.canInteract(trigger)) continue;

      // 1) Distance
      const dx = trigger.center.x - playerPos.x;
      const dy = trigger.center.y - playerPos.y;
      const dz = trigger.center.z - playerPos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > maxDistSq) continue;

      // 2) Interaction volume
      if (!playerInsideTrigger(trigger, playerCollider, playerPos)) continue;

      // 3) View cone
      const cone = inViewCone(trigger.center);
      if (!cone.ok) continue;

      // 4) Raycast LOS (margin ≈ trigger size so wall-adjacent cubes still work)
      const margin = Math.max(
        0.25,
        trigger.halfExtents.x,
        trigger.halfExtents.y,
        trigger.halfExtents.z
      );
      if (!hasLineOfSight(trigger.center, margin)) continue;

      if (cone.score > bestScore) {
        bestScore = cone.score;
        best = trigger;
      }
    }

    return best;
  }

  function refreshPrompt() {
    if (!active) {
      prompt.setVisible(false);
      return;
    }
    const handler = handlerFor(active);
    const text = handler?.getPromptText(active) ?? "Interact";
    prompt.setVisible(true, text);
  }

  function tryActivate() {
    if (!active) return false;
    const handler = handlerFor(active);
    if (!handler) return false;
    handler.onInteract(active);
    refreshPrompt();
    return true;
  }

  prompt.setActivateHandler(() => tryActivate());

  function onKeyDown(e) {
    if (disposed) return;
    if (e.code !== interactKey) return;
    if (e.repeat) return;
    if (tryActivate()) e.preventDefault();
  }

  window.addEventListener("keydown", onKeyDown);

  function update(_dt) {
    if (disposed) return;
    const next = findBestTrigger();
    const changed =
      (next?.collider?.handle ?? next?.name) !==
        (active?.collider?.handle ?? active?.name) ||
      (!!next !== !!active);
    active = next;
    if (changed) refreshPrompt();
    else if (active) refreshPrompt(); // keep On/Off label in sync with FanState
  }

  function dispose() {
    disposed = true;
    window.removeEventListener("keydown", onKeyDown);
    prompt.dispose();
    env.dispose();
    active = null;
  }

  return {
    update,
    tryActivate,
    dispose,
    env,
    handlers,
    get active() {
      return active;
    },
    setDebugVisible: env.setDebugVisible,
  };
}
