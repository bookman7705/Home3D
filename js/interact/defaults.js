/**
 * Interact system defaults (spread into CONFIG).
 */
export const INTERACT_DEFAULTS = {
  enableInteract: true,
  /** Half-angle of the forward view cone (degrees). */
  interactConeHalfAngleDeg: 35,
  /** Max distance from player eye to trigger focus (world units, pre-scale). */
  interactMaxDistance: 3.5,
  /** Optional LOS raycast against solid scene meshes. */
  interactRequireLineOfSight: true,
  /** PC keyboard binding (also clickable prompt on all platforms). */
  interactKeyCode: "KeyE",
  /** Fan / light-switch ON lighting targets. */
  fanStateOnLightMapIntensity: 0.8,
  fanStateOnFanPointLightIntensity: 0.5,
  fanStateOnBedRoomPointLightIntensity: 8,
  /**
   * When FanState is OFF, multiply IBL/HDR envMapIntensity by this (0 = none).
   * ON restores each material's authored intensity.
   */
  fanStateOffIblScale: 0.45,
  /** Tone-mapping exposure while FanState is OFF (ON uses toneMappingExposure). */
  fanStateOffToneMappingExposure: 0.75,
  /** Seconds to ramp fan RPM fully on or off. */
  fanRpmRampSeconds: 1.6,
  /** Show wireframe helpers for ENV_ sensor volumes. */
  showInteractDebug: false,
};
