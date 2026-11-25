/**
 * Completed editing gestures, for host analytics (`onToolUse`).
 *
 * Tool activations are visible in the store (`activeTool`), but the circuit
 * gestures are not tools: adding a contact, the quick-insert palette,
 * dropping a symbol into a wire, pulling a branch out of a rail, placing a
 * symbol so it hangs from a rail. Each of them reports here once it has
 * actually changed the drawing (not when a menu opens or a drag starts).
 *
 * A plain listener set rather than store state: these are events, nothing
 * renders from them, and they must never cost a store update.
 */

export type GestureId =
  /** A contact of an existing device placed via "Add contact" (C). */
  | 'add_contact'
  /** A symbol placed from the quick-insert palette (/). */
  | 'quick_insert'
  /** A symbol dropped onto a conductor and put in line with it. */
  | 'insert_on_wire'
  /** A conductor pulled out of a supply rail (circuit diagrams). */
  | 'rail_branch'
  /** A symbol placed under a rail and wired up to it (circuit diagrams). */
  | 'rail_hang';

type Listener = (g: GestureId) => void;

const listeners = new Set<Listener>();

export function emitGesture(g: GestureId): void {
  for (const l of listeners) {
    try {
      l(g);
    } catch {
      // A host's analytics must never break the editor.
    }
  }
}

/** Subscribe to completed gestures; returns the unsubscribe function. */
export function onGesture(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
