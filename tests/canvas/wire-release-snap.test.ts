/**
 * Releasing a wire just off a pin connects to the pin.
 *
 * A pin's hit circle is ~11 px across; a release 7 px off used to mint a
 * loose junction beside the pin, which looks connected and is not. Free-space
 * releases far from anything must still drop a junction — that gesture is how
 * a free wire end is drawn.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Memory localStorage for the persist middleware (plain node, no jsdom).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() {
      return mem.size;
    },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
    clear: () => {
      mem.clear();
    },
  } as Storage;
});

import { resolveDragTarget, SCREEN_TAP_TOL } from '../../src/canvas/wire-drag';
import { useEditorStore } from '../../src/store';

// World tolerance as `worldTolAt` hands it over at 100% zoom.
const TOL = SCREEN_TAP_TOL;

describe('resolveDragTarget near a connectable', () => {
  beforeEach(() => {
    // breaker-3p at (100,100): pin 2 at (80,120); a conductor from pin 6
    // (120,120) straight down to a junction at (120,300).
    useEditorStore.getState().setDiagram({
      version: '1',
      meta: { diagramType: 'circuit' },
      elements: [{ id: 'Q1', kind: 'breaker-3p' }],
      layout: { Q1: { at: [100, 100] } },
      junctions: [{ id: 'J1', layout: { at: [120, 300] } }],
      wires: [{ id: 'w1', ends: ['Q1.t6', 'J1'] }],
    });
  });

  it('a release a few px off a pin lands on the pin', () => {
    const to = resolveDragTarget(null, [85, 125], TOL);
    expect(to.spec).toEqual({ end: 'Q1.t2' });
    expect(to.world).toEqual([80, 120]);
    expect(to.create).toBe(false);
  });

  it('the nearest of two pins wins', () => {
    expect(resolveDragTarget(null, [92, 121], TOL).spec).toEqual({ end: 'Q1.t4' });
  });

  it('a near miss on a junction lands on the junction', () => {
    expect(resolveDragTarget(null, [128, 306], TOL).spec).toEqual({ end: 'J1' });
  });

  it('mid-span on a conductor still taps it', () => {
    const to = resolveDragTarget(null, [124, 210], TOL);
    expect(to.spec).toEqual({ onWire: 'w1', at: [120, 210] });
  });

  it('empty space well away from everything still drops a junction', () => {
    const to = resolveDragTarget(null, [300, 200], TOL);
    expect(to.spec).toEqual({ junctionAt: [300, 200] });
    expect(to.create).toBe(true);
  });

  it('the tolerance follows the zoom (world tol shrinks as you zoom in)', () => {
    // At 400% the 14 px pin radius is 3.5 world units: 5 off is a miss.
    expect(resolveDragTarget(null, [85, 120], TOL / 4).spec).toEqual({ junctionAt: [90, 120] });
  });
});
