/**
 * Handler for ENV_LightSwitch — toggles room FanState.
 * Prompt text: "On" when fan is off, "Off" when fan is on.
 */
export function createLightSwitchHandler({ fanState }) {
  return {
    type: "LightSwitch",
    /** @param {object} _trigger */
    getPromptText(_trigger) {
      return fanState.fanState ? "Off" : "On";
    },
    /** @param {object} _trigger */
    canInteract(_trigger) {
      return true;
    },
    /** @param {object} _trigger */
    onInteract(_trigger) {
      fanState.toggle();
    },
  };
}
