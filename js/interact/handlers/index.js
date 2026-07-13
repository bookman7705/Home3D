import { createLightSwitchHandler } from "./light-switch.js";

/**
 * Build the interact handler registry. Add new ENV_* types here.
 * @param {{ fanState: ReturnType<import("../fan-state.js").createFanStateController> }} deps
 */
export function createInteractHandlers(deps) {
  /** @type {Map<string, { type: string, getPromptText: Function, canInteract: Function, onInteract: Function }>} */
  const byType = new Map();

  const lightSwitch = createLightSwitchHandler(deps);
  byType.set(lightSwitch.type, lightSwitch);

  function get(type) {
    return byType.get(type) ?? null;
  }

  function register(handler) {
    if (!handler?.type) return;
    byType.set(handler.type, handler);
  }

  return { get, register, byType };
}
