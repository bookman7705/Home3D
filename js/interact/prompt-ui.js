/**
 * Bottom-center interact prompt — sized for PC + mobile.
 */
export function createInteractPrompt() {
  let root = document.getElementById("interactPrompt");
  let label = document.getElementById("interactPromptLabel");
  let hint = document.getElementById("interactPromptHint");
  let owned = false;

  if (!root) {
    owned = true;
    root = document.createElement("button");
    root.id = "interactPrompt";
    root.type = "button";
    root.className = "interact-prompt";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");

    hint = document.createElement("span");
    hint.id = "interactPromptHint";
    hint.className = "interact-prompt-hint";
    hint.textContent = "E";

    label = document.createElement("span");
    label.id = "interactPromptLabel";
    label.className = "interact-prompt-label";
    label.textContent = "";

    root.appendChild(hint);
    root.appendChild(label);
    document.body.appendChild(root);
  }

  let visible = false;
  let onActivate = null;

  function setVisible(next, text = "") {
    const show = !!next;
    if (label && text) label.textContent = text;
    if (show === visible && (!show || !text)) {
      if (show && text && label) label.textContent = text;
      return;
    }
    visible = show;
    root.hidden = !show;
    root.setAttribute("aria-hidden", show ? "false" : "true");
    if (show) root.classList.add("is-visible");
    else root.classList.remove("is-visible");
  }

  function setHint(text) {
    if (hint) hint.textContent = text;
  }

  function setActivateHandler(handler) {
    onActivate = typeof handler === "function" ? handler : null;
  }

  function handleActivate(e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    onActivate?.();
  }

  root.addEventListener("click", handleActivate);
  root.addEventListener(
    "touchend",
    (e) => {
      e.preventDefault();
      handleActivate(e);
    },
    { passive: false }
  );

  function dispose() {
    root.removeEventListener("click", handleActivate);
    if (owned && root.parentNode) root.parentNode.removeChild(root);
  }

  return {
    el: root,
    setVisible,
    setHint,
    setActivateHandler,
    isVisible: () => visible,
    dispose,
  };
}
