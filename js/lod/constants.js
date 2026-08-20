/**
 * Modular GLB LOD (level of detail).
 *
 * How it works
 * ------------
 * After a GLB loads, every object whose name ends with `_LODX` (X = 0, 1, 2, …)
 * is grouped by the name in front of that suffix:
 *
 *   Table1_LOD0, Table1_LOD1, Table1_LOD2  →  group "Table1"
 *
 * LOD0 is the high-detail mesh. Higher numbers are cheaper stand-ins. Exactly
 * one level is visible at a time — switches are instant visibility swaps.
 * Beyond `cullDistance`, every level is hidden (nothing in the group is drawn).
 * The camera distance to the group's bounding-sphere center picks the level.
 *
 * Pop reduction (why switches do not flicker)
 * -------------------------------------------
 * 1. Hysteresis — switch-down and switch-up use different distances, so walking
 *    along a threshold does not flicker.
 * 2. Dwell — the camera must stay on the far side of a threshold for dwellMs
 *    before a switch happens.
 * 3. Upgrade delay — while the camera is moving quickly, promotions to a
 *    higher-detail LOD wait a bit longer (downgrades still happen).
 *
 * Any mesh (or parent node) in any GLB is picked up automatically if it follows
 * the `_LODX` suffix. COL_* and ENV_* names are ignored.
 *
 * Tune the object exported below, or override per level (`level.lod`) / per
 * group (`overrides.Table1`). Distances are meters at worldScale 1.
 */

export const LOD_NAME_RE = /^(.*)_LOD(\d+)$/i;

export const LOD_DEFAULTS = {
  /** Master switch. When false, only the lowest discovered LOD is shown. */
  enabled: true,

  /**
   * Highest LOD index allowed (0 = always high detail).
   * null / undefined = use every level found on the object.
   */
  maxLod: null,

  /**
   * Distances (meters) at which we leave each LOD for the next cheaper one.
   * distances[0] = leave LOD0, distances[1] = leave LOD1, …
   * Extra discovered levels without a slot use the last value × distanceScale.
   */
  distances: [3.5, 8],

  /** Multiplier used to invent missing distance slots. */
  distanceScale: 1.85,

  /**
   * Meters at which the whole group is hidden (no LOD drawn).
   * null / 0 / Infinity = never cull. Uses the same hysteresis / dwell as LOD
   * switches so the object does not flicker at the cutoff.
   */
  cullDistance: 24,

  /**
   * Band around each threshold, 0–0.45.
   * 0.2 and a 3.5 m switch means: go to LOD1 after 4.2 m, return to LOD0
   * inside 2.8 m.
   */
  hysteresis: 0.2,

  /** Milliseconds the camera must stay past a threshold before switching. */
  dwellMs: 180,

  /** Extra wait (ms) before upgrading LOD while moving faster than fastMoveSpeed. */
  upgradeMoveDelayMs: 240,

  /** Camera speed (m/s) treated as “fast” for upgrade delay. */
  fastMoveSpeed: 1.5,

  /** Added to measured distance (positive → cheaper LODs sooner). */
  distanceBias: 0,

  /** Measure to bounding-sphere center (true) or the node origin (false). */
  useBoundingSphere: true,

  /** Subtract sphere radius so large objects switch based on the near surface. */
  useSurfaceDistance: false,

  /**
   * null = automatic from distance.
   * 0 / 1 / 2 / … = lock every group to that LOD (clamped to what exists).
   */
  forceLod: null,

  /** On-screen test HUD + Shift+0/1/2/3 to force a level (0 = auto). */
  debug: false,

  /** Name prefixes that are never treated as visual LODs. */
  ignoreNamePrefixes: ["COL_", "ENV_"],

  /**
   * Optional per-group overrides, keyed by the name before `_LODX`.
   * Example: { Table1: { distances: [2.8, 6.5], cullDistance: 18 } }
   */
  overrides: {},
};
