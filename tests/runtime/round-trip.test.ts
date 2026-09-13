/**
 * `tags` / `bindings` are file data: they must survive JSON round-trips
 * byte-for-byte, and their absence must not change how an old file loads.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import type { DiagramFile } from '../../src/model';

const WITH_RUNTIME: DiagramFile = {
  version: '1',
  meta: { title: 'rt' },
  elements: [{ id: 'QF1', kind: 'breaker' }],
  buses: [{ id: 'B1', layout: { at: [0, 100], span: 200 } }],
  wires: [{ id: 'w1', ends: ['B1', 'QF1.t1'] }],
  tags: [
    { path: 'QF1/health', type: 'enum', enum: ['normal', 'critical'], description: 'health' },
    { path: 'QF1/I', type: 'float', unit: 'A' },
  ],
  bindings: [
    {
      target: 'QF1',
      prop: 'alarm',
      tag: 'QF1/health',
      mapping: {
        type: 'discrete',
        cases: [{ when: 'critical', out: 'fault' }],
        default: 'none',
      },
    },
    { target: 'QF1', prop: 'value', tag: 'QF1/I', mapping: { type: 'pass' } },
    { target: 'B1', prop: 'badge', tag: 'B1/badge' },
  ],
};

describe('tags / bindings round-trip', () => {
  it('serialises and parses back identically', () => {
    const text = JSON.stringify(WITH_RUNTIME, null, 2);
    const back = JSON.parse(text) as DiagramFile;
    expect(back).toEqual(WITH_RUNTIME);
    expect(JSON.stringify(back, null, 2)).toBe(text);
  });

  it('keeps key order and the fields through a compile', () => {
    // compile() reads the file; it must neither strip nor reorder the new fields.
    const before = JSON.stringify(WITH_RUNTIME);
    compile(WITH_RUNTIME);
    expect(JSON.stringify(WITH_RUNTIME)).toBe(before);
  });

  it('an old file without the fields loads unchanged', () => {
    const old: DiagramFile = {
      version: '1',
      elements: [{ id: 'QF1', kind: 'breaker' }],
    };
    const m = compile(old);
    expect(m.elements.size).toBe(1);
    expect(m.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect('tags' in old).toBe(false);
    expect('bindings' in old).toBe(false);
  });

  it('bindings referencing an undeclared tag or unknown target still compile', () => {
    const d: DiagramFile = {
      ...WITH_RUNTIME,
      bindings: [{ target: 'ghost', prop: 'value', tag: 'not/declared' }],
    };
    const m = compile(d);
    expect(m.elements.size).toBe(1);
  });
});
