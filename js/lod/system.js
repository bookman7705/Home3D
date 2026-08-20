import * as THREE from "three";
import { LOD_DEFAULTS } from "./constants.js";
import { collectLodNodes, groupLodNodes } from "./parse.js";
import { createLodDebugHud } from "./debug-hud.js";

const _camPos = new THREE.Vector3();
const _worldCenter = new THREE.Vector3();
const _box = new THREE.Box3();
const _sphere = new THREE.Sphere();
const _scale = new THREE.Vector3();

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function mergeSettings(base, extra) {
  const out = { ...base, ...(extra || {}) };
  if (extra?.distances) out.distances = extra.distances.slice();
  if (extra?.ignoreNamePrefixes) {
    out.ignoreNamePrefixes = extra.ignoreNamePrefixes.slice();
  }
  if (extra?.overrides) out.overrides = { ...base.overrides, ...extra.overrides };
  return out;
}

function buildThresholds(distances, switchCount, distanceScale, worldScale) {
  const src = Array.isArray(distances) ? distances : [];
  const scale = Math.max(1.01, Number(distanceScale) || 1.85);
  const ws = Math.max(0.0001, Number(worldScale) || 1);
  const out = [];
  let last = (Number(src[0]) > 0 ? Number(src[0]) : 3.5) * ws;
  for (let i = 0; i < switchCount; i++) {
    const raw = Number(src[i]);
    if (Number.isFinite(raw) && raw > 0) last = raw * ws;
    else last *= scale;
    out.push(last);
  }
  return out;
}

function computeLocalBounds(object) {
  object.updateWorldMatrix(true, true);
  _box.setFromObject(object);
  if (_box.isEmpty()) {
    return { localCenter: new THREE.Vector3(), radius: 0 };
  }
  _box.getBoundingSphere(_sphere);
  const localCenter = _sphere.center.clone();
  object.worldToLocal(localCenter);
  return { localCenter, radius: _sphere.radius };
}

function setTreeVisible(object, visible) {
  if (object) object.visible = !!visible;
}

function resolveCullDistance(raw, worldScale) {
  if (raw == null || raw === false || raw === Infinity) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n * Math.max(0.0001, Number(worldScale) || 1);
}

function shouldCull(dist, cullDistance, currentlyCulled, hysteresis) {
  if (cullDistance == null) return false;
  const h = clamp(Number(hysteresis) || 0, 0, 0.45);
  if (currentlyCulled) return dist > cullDistance * (1 - h);
  return dist > cullDistance * (1 + h);
}

function pickAllowedLod(dist, current, allowed, thresholds, hysteresis) {
  const h = clamp(Number(hysteresis) || 0, 0, 0.45);
  let idx = allowed.indexOf(current);
  if (idx < 0) idx = 0;
  while (idx < allowed.length - 1) {
    const t = thresholds[idx];
    if (t == null) break;
    if (dist > t * (1 + h)) idx += 1;
    else break;
  }
  while (idx > 0) {
    const t = thresholds[idx - 1];
    if (t == null) break;
    if (dist < t * (1 - h)) idx -= 1;
    else break;
  }
  return allowed[idx];
}

/**
 * @param {{
 *   root: import("three").Object3D,
 *   camera: import("three").Camera,
 *   config?: Record<string, unknown>,
 *   worldScale?: number,
 *   hooks?: { onChange?: () => void },
 * }} opts
 */
export function createLodSystem({
  root,
  camera,
  config = {},
  worldScale = 1,
  hooks = {},
} = {}) {
  const settings = mergeSettings(LOD_DEFAULTS, config.lod);
  const nodes = collectLodNodes(root, settings.ignoreNamePrefixes);
  const grouped = groupLodNodes(nodes);
  const groups = [];
  const lastCam = new THREE.Vector3();
  let hudElapsed = 0;
  let disposed = false;

  const hud = createLodDebugHud({
    onForceLod(level) {
      settings.forceLod = level;
      if (config.lod) config.lod.forceLod = level;
    },
  });
  hud.setVisible(!!settings.debug);

  for (const [base, raw] of grouped) {
    const available = [...raw.levels.keys()].sort((a, b) => a - b);
    if (available.length === 0) continue;
    const override = settings.overrides?.[base] || {};
    const local = mergeSettings(settings, override);
    const discoveredMax = available[available.length - 1];
    const configuredMax =
      local.maxLod == null || local.maxLod === ""
        ? discoveredMax
        : Number(local.maxLod);
    const maxLod = clamp(
      Number.isFinite(configuredMax) ? configuredMax : discoveredMax,
      available[0],
      discoveredMax
    );
    const allowed = available.filter((n) => n <= maxLod);
    const switchCount = Math.max(0, allowed.length - 1);
    const thresholds = buildThresholds(
      local.distances,
      switchCount,
      local.distanceScale,
      worldScale
    );
    const refLevel = allowed[0];
    const refObject = raw.levels.get(refLevel);
    const bounds = computeLocalBounds(refObject);
    const cullDistance = resolveCullDistance(local.cullDistance, worldScale);

    for (const [level, object] of raw.levels) {
      object.userData.lodBase = base;
      object.userData.lodLevel = level;
      setTreeVisible(object, level === refLevel);
    }

    groups.push({
      base,
      levels: raw.levels,
      available,
      allowed,
      maxLod,
      thresholds,
      cullDistance,
      hysteresis: local.hysteresis,
      dwellMs: local.dwellMs,
      upgradeMoveDelayMs: local.upgradeMoveDelayMs,
      distanceBias: Number(local.distanceBias) || 0,
      useBoundingSphere: local.useBoundingSphere !== false,
      useSurfaceDistance: !!local.useSurfaceDistance,
      refObject,
      localCenter: bounds.localCenter,
      radius: bounds.radius,
      current: refLevel,
      pending: null,
      pendingSince: 0,
      lastDistance: 0,
    });
  }

  if (groups.length) {
    const summary = groups
      .map((g) => {
        const lv = g.allowed.map((n) => `LOD${n}`).join(",");
        const th = g.thresholds.map((d) => `${d.toFixed(2)}m`).join(" / ");
        const cull =
          g.cullDistance != null ? ` cull ${g.cullDistance.toFixed(2)}m` : "";
        return `${g.base} [${lv}] thresholds ${th || "none"}${cull}`;
      })
      .join("; ");
    console.info(
      `[LOD] ${groups.length} group(s): ${summary}. Hysteresis ${(
        settings.hysteresis * 100
      ).toFixed(0)}%, dwell ${settings.dwellMs}ms.`
    );
    console.info(
      "[LOD] Walk toward/away from a grouped object to test. Debug HUD:",
      settings.debug ? "on" : "off (`config.lod.debug = true`)"
    );
  } else {
    console.info("[LOD] No `_LODX` meshes found in this GLB.");
  }

  function measureDistance(group) {
    camera.getWorldPosition(_camPos);
    if (group.useBoundingSphere) {
      _worldCenter.copy(group.localCenter).applyMatrix4(group.refObject.matrixWorld);
    } else {
      group.refObject.getWorldPosition(_worldCenter);
    }
    let dist = _camPos.distanceTo(_worldCenter) + group.distanceBias;
    if (group.useSurfaceDistance) {
      group.refObject.getWorldScale(_scale);
      const worldRadius = group.radius * Math.max(_scale.x, _scale.y, _scale.z);
      dist = Math.max(0, dist - worldRadius);
    }
    return dist;
  }

  function setActiveLod(group, level) {
    if (group.current === level) {
      group.pending = null;
      return;
    }
    for (const [n, object] of group.levels) {
      setTreeVisible(object, level != null && n === level);
    }
    group.current = level;
    group.pending = null;
    hooks.onChange?.();
  }

  function applyForceOrTarget(group, target, now, speed) {
    if (target === group.current) {
      group.pending = null;
      return;
    }
    let wait = group.dwellMs;
    if (
      target != null &&
      group.current != null &&
      target < group.current &&
      speed > settings.fastMoveSpeed
    ) {
      wait += group.upgradeMoveDelayMs;
    }
    if (group.pending !== target) {
      group.pending = target;
      group.pendingSince = now;
      return;
    }
    if (now - group.pendingSince < wait) return;
    setActiveLod(group, target);
  }

  function updateGroup(group, now, speed) {
    const dist = measureDistance(group);
    group.lastDistance = dist;
    if (!settings.enabled) {
      setActiveLod(group, group.allowed[0]);
      return;
    }
    const forced = settings.forceLod;
    let target;
    if (forced != null && Number.isFinite(Number(forced))) {
      const want = Number(forced);
      target = group.allowed.reduce((best, n) =>
        Math.abs(n - want) < Math.abs(best - want) ? n : best
      );
    } else if (
      shouldCull(dist, group.cullDistance, group.current == null, group.hysteresis)
    ) {
      target = null;
    } else {
      const from =
        group.current == null
          ? group.allowed[group.allowed.length - 1]
          : group.current;
      target = pickAllowedLod(
        dist,
        from,
        group.allowed,
        group.thresholds,
        group.hysteresis
      );
    }
    applyForceOrTarget(group, target, now, speed);
  }

  function getSnapshot() {
    return {
      enabled: !!settings.enabled,
      forceLod: settings.forceLod,
      groupCount: groups.length,
      groups: groups.map((g) => {
        const culled = g.current == null;
        const idx = culled ? -1 : g.allowed.indexOf(g.current);
        const nextThreshold =
          idx >= 0 && idx < g.thresholds.length ? g.thresholds[idx] : null;
        return {
          base: g.base,
          current: g.current,
          available: g.allowed.slice(),
          distance: g.lastDistance,
          nextThreshold,
          cullDistance: g.cullDistance,
          maxLod: g.maxLod,
          thresholds: g.thresholds.slice(),
        };
      }),
    };
  }

  if (camera) camera.getWorldPosition(lastCam);
  hud.render(getSnapshot());

  return {
    groups,
    getSettings: () => ({ ...settings, distances: settings.distances.slice() }),
    getSnapshot,
    setForceLod(level) {
      settings.forceLod = level;
      if (config.lod) config.lod.forceLod = level;
    },
    update(dt) {
      if (disposed || !camera) return;
      const now = performance.now();
      camera.getWorldPosition(_camPos);
      const moved = _camPos.distanceTo(lastCam);
      const speed = dt > 1e-4 ? moved / dt : 0;
      lastCam.copy(_camPos);
      for (const group of groups) updateGroup(group, now, speed);
      hudElapsed += dt;
      if (settings.debug && hudElapsed > 0.12) {
        hudElapsed = 0;
        hud.render(getSnapshot());
      }
    },
    dispose() {
      disposed = true;
      for (const group of groups) setActiveLod(group, group.current);
      hud.dispose();
    },
  };
}
