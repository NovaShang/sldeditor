/**
 * Actions the embedding app provides that the editor itself cannot implement.
 *
 * "Create a component" is the first: authoring a symbol means asking the AI
 * agent, and the agent lives in the host application, not in this package. The
 * editor owns the affordance — the button belongs in the component palette,
 * next to the symbols it will sit among — while the host owns what happens
 * when it is pressed.
 *
 * A tiny store rather than a prop threaded through EditorShell → RightPanel →
 * LibraryPopover: the callback is set once by the embedder and read in one
 * deep leaf, which is exactly the shape prop-drilling handles worst. Mirrors
 * `useLocale`, which solves the same problem for the same reason.
 */

import { create } from 'zustand';

export interface HostActions {
  /**
   * Open the host's "describe the component you need" flow. Absent means the
   * host has no agent wired up (the standalone editor, the read-only viewer),
   * and the palette simply does not offer the button.
   */
  onCreateComponent: (() => void) | null;
}

interface HostActionsState extends HostActions {
  setHostActions: (actions: Partial<HostActions>) => void;
}

export const useHostActions = create<HostActionsState>((set) => ({
  onCreateComponent: null,
  setHostActions: (actions) => set(actions),
}));
