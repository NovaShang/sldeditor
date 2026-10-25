/**
 * Groups of library kinds that are the same device drawn differently, so the
 * property panel can switch one into another in place — same id, name,
 * position and wires, no delete-and-redraw.
 *
 * Every member of a family must declare the same terminal ids at the same
 * coordinates — or, for a `mirrorOnSwap` family, at mirrored coordinates
 * (x → −x), and the swap toggles the placement's `mirror` to compensate.
 * Either way the terminals land on the same spot and the wiring is
 * untouched. tests/lib/kind-families.test.ts holds every family to it.
 *
 * Contacts come first because of a real support question: a user looking for
 * a normally-closed contact under "Switching" concluded the library had none
 * (it lives under "Control"). From any placed contact, the panel now offers
 * all six.
 */

export interface KindFamily {
  id: 'contact' | 'continuation';
  kinds: readonly string[];
  /**
   * Members are mirror images of each other. The outgoing and incoming
   * continuation arrows both keep QET's natural orientation — out at a
   * sheet's right edge with the wire arriving from the left, in at the left
   * edge with the wire leaving to the right — so neither needs rotating when
   * placed; switching between them flips `mirror` to keep the terminal put.
   */
  mirrorOnSwap?: true;
}

export const KIND_FAMILIES: readonly KindFamily[] = [
  {
    id: 'contact',
    kinds: [
      'make-contact',
      'break-contact',
      'on-delay-make-contact',
      'on-delay-break-contact',
      'off-delay-make-contact',
      'off-delay-break-contact',
    ],
  },
  { id: 'continuation', kinds: ['continuation-out', 'continuation-in'], mirrorOnSwap: true },
];

export function familyOf(kind: string): KindFamily | undefined {
  return KIND_FAMILIES.find((f) => f.kinds.includes(kind));
}

/** Continuation (off-page) connectors pair up by name. */
export function isContinuation(kind: string): boolean {
  return familyOf(kind)?.id === 'continuation';
}

/**
 * The key two continuations must share to count as one conductor: the name,
 * trimmed, case-insensitive. Unnamed connectors pair with nothing — an empty
 * name is "not filled in yet", not a shared label.
 */
export function continuationKey(name: string | undefined): string | null {
  const k = (name ?? '').trim().toLowerCase();
  return k === '' ? null : k;
}
