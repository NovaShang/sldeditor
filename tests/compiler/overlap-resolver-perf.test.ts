/**
 * The overlap resolver in auto-layout (6b / 6d) must stay fast on large,
 * fully auto-laid-out drawings. Literally, it is up to n² + 8 passes of an
 * O(n²) pair scan, and on dense fans two branches can ping-pong — sometimes
 * drifting sideways together — until the pass cap: a ~140-device drawing
 * like the one below took 30 s to several minutes per compile, and the
 * editor re-compiles on every edit.
 *
 * The drawing: a utility service feeding a gutter bus, six panels, and
 * eleven hybrid inverters, each with a PV combiner of four strings and a
 * battery bus of four batteries; three backup ports into a backup panel.
 * No explicit placements at all.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import type { DiagramFile } from '../../src/model';

const HYBRID = {
  id: 'custom:hybrid-inverter',
  name: 'Hybrid inverter with backup',
  category: 'renewable',
  viewBox: '-40 -40 80 80',
  width: 80,
  height: 80,
  svg: '<rect x="-35" y="-35" width="70" height="70" fill="none" stroke="black"/>',
  terminals: [
    { id: 'grid', x: 0, y: -40, orientation: 'n' },
    { id: 'backup', x: 40, y: 0, orientation: 'e' },
    { id: 'pv', x: -40, y: 0, orientation: 'w' },
    { id: 'battery', x: 0, y: 40, orientation: 's' },
  ],
};

function solarService(): DiagramFile {
  const elements: DiagramFile['elements'] = [
    { id: 'SRC1', kind: 'grid-source' },
    { id: 'T1', kind: 'transformer-2w' },
    { id: 'CT1', kind: 'ct' },
    { id: 'Q0', kind: 'breaker' },
    { id: 'E1', kind: 'earth' },
    { id: 'SPF', kind: 'fuse' },
    { id: 'SPD', kind: 'arrester' },
    { id: 'E2', kind: 'earth' },
    { id: 'BLD', kind: 'panelboard' },
  ];
  const buses: NonNullable<DiagramFile['buses']> = [{ id: 'GUT' }, { id: 'BK' }];
  const wires: string[][] = [
    ['SRC1.t_bottom', 'T1.t1'],
    ['T1.t2', 'CT1.t1'],
    ['CT1.t2', 'Q0.t1'],
    ['Q0.t2', 'GUT'],
    ['GUT', 'E1.t1'],
    ['GUT', 'SPF.t1'],
    ['SPF.t2', 'SPD.t1'],
    ['SPD.t2', 'E2.t1'],
    ['BK', 'BLD.t_in'],
  ];
  for (let p = 1; p <= 6; p++) {
    buses.push({ id: `P${p}` });
    wires.push(['GUT', `P${p}`]);
  }
  for (let i = 1; i <= 11; i++) {
    const panel = `P${Math.min(Math.ceil(i / 2), 6)}`;
    elements.push(
      { id: `I${i}`, kind: 'custom:hybrid-inverter' },
      { id: `Q${i}`, kind: 'breaker' },
      { id: `PV${i}`, kind: 'dc-combiner' },
      { id: `BF${i}`, kind: 'fuse-switch-disconnector' },
    );
    buses.push({ id: `BAT${i}` });
    wires.push(
      [panel, `Q${i}.t1`],
      [`Q${i}.t2`, `I${i}.grid`],
      [`PV${i}.t_dc`, `I${i}.pv`],
      [`BAT${i}`, `BF${i}.t1`],
      [`BF${i}.t2`, `I${i}.battery`],
    );
    for (const [n, s] of ['A', 'B', 'C', 'D'].entries()) {
      elements.push({ id: `BAT${i}${s}`, kind: 'battery' }, { id: `S${i}${s}`, kind: 'pv' });
      wires.push([`BAT${i}${s}.t_right`, `BAT${i}`], [`S${i}${s}.t_dc`, `PV${i}.t_s${n + 1}`]);
    }
    if (i >= 9) {
      elements.push({ id: `QB${i}`, kind: 'breaker' });
      wires.push([`I${i}.backup`, `QB${i}.t1`], [`QB${i}.t2`, 'BK']);
    }
  }
  return {
    version: '1',
    customKinds: [HYBRID],
    elements,
    buses,
    wires: wires.map((ends, k) => ({ id: `w${k + 1}`, ends })),
  } as unknown as DiagramFile;
}

describe('auto-layout overlap resolver performance', () => {
  it('lays out a ~140-device auto-placed drawing quickly', () => {
    const d = solarService();
    expect(d.elements.length).toBeGreaterThan(140);
    const t0 = performance.now();
    const m = compile(d);
    const ms = performance.now() - t0;
    // Every device placed, nothing unknown.
    expect(m.diagnostics.filter((x) => x.code === 'E003')).toEqual([]);
    for (const e of d.elements) expect(m.layout.get(e.id)).toBeTruthy();
    // Was tens of seconds or more; now well under one. Generous for slow CI.
    expect(ms).toBeLessThan(5000);
  });

  it('is deterministic', () => {
    const ser = (x: unknown) =>
      JSON.stringify(x, (_k, v) => (v instanceof Map ? [...v.entries()] : v instanceof Set ? [...v] : v));
    expect(ser(compile(solarService()))).toBe(ser(compile(solarService())));
  });
});
