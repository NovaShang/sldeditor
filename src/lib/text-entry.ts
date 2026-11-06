/**
 * "Is the user typing?" — the one question every global key handler and the
 * canvas focus guard must agree on. Single-key shortcuts (M mirrors, R
 * rotates, Backspace deletes) are destructive, so a name typed into any field
 * must never reach them, wherever that field lives (property panel, in-canvas
 * name editor, annotation editor, a host's own input).
 */

/** A focused node that takes typed text: input, textarea, select, contenteditable. */
export function isTextEntry(node: EventTarget | null | undefined): boolean {
  if (typeof HTMLElement === 'undefined' || !(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    node.isContentEditable
  );
}

/**
 * True when a key event belongs to text entry rather than to the editor.
 * Checks the event target AND the focused element (a key event can be
 * retargeted, e.g. when it starts on <body> while an editor still holds
 * focus), and treats IME composition as typing — the Enter that picks a
 * Chinese candidate is not a command.
 */
export function isTypingKeyEvent(e: KeyboardEvent): boolean {
  if (e.isComposing) return true;
  if (isTextEntry(e.target)) return true;
  return typeof document !== 'undefined' && isTextEntry(document.activeElement);
}
