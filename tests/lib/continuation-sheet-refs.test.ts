/**
 * Off-page connectors on a multi-sheet drawing say which page their partner
 * is on ("→ 2/3"), derived from the shared name — so a user who splits one
 * drawing over several pages no longer types (and retypes after every
 * reorder) each destination by hand. Display-only: nothing is written to
 * `params`, and a target the user did type always wins.
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compiler';
import { continuationSheetRefs, labelLines } from '../../src/lib/element-labels';
import type { DiagramFile } from '../../src/model';
import type { Sheet } from '../../src/model/sheet';

// A4 landscape is ≈1123 × 794 units; three sheets side by side.
const SHEETS: Sheet[] = [
  { id: 'S1', paper: 'a4', orientation: 'landscape', at: [0, 0] },
  { id: 'S2', paper: 'a4', orientation: 'landscape', at: [1200, 0] },
  { id: 'S3', paper: 'a4', orientation: 'landscape', at: [2400, 0] },
];

function refs(d: DiagramFile) {
  const m = compile(d);
  return continuationSheetRefs(m.elements.values(), m.layout, d.sheets);
}

function diagram(over: Partial<DiagramFile> = {}): DiagramFile {
  return {
    version: '1',
    elements: [
      { id: 'C1', kind: 'continuation-out', name: 'X1' },
      // Same key: names match trimmed and case-insensitively.
      { id: 'C2', kind: 'continuation-in', name: ' x1 ' },
    ],
    layout: { C1: { at: [800, 300] }, C2: { at: [1300, 300] } },
    sheets: SHEETS.slice(0, 2),
    ...over,
  };
}

describe('continuationSheetRefs', () => {
  it("labels each end with the other end's page", () => {
    const r = refs(diagram());
    expect(r.get('C1')).toBe('→ 2/2');
    expect(r.get('C2')).toBe('→ 1/2');
  });

  it('says nothing on a drawing without sheets', () => {
    expect(refs(diagram({ sheets: undefined })).size).toBe(0);
  });

  it('a typed target wins over the derived page', () => {
    const d = diagram();
    d.elements[0] = { ...d.elements[0], params: { target: '=A2/3.1' } };
    const r = refs(d);
    expect(r.has('C1')).toBe(false);
    expect(r.get('C2')).toBe('→ 1/2');
  });

  it('a blank typed target still gets the derived page', () => {
    const d = diagram();
    d.elements[0] = { ...d.elements[0], params: { target: '  ' } };
    expect(refs(d).get('C1')).toBe('→ 2/2');
  });

  it('says nothing when the partner is on the same page, or off every page', () => {
    expect(refs(diagram({ layout: { C1: { at: [100, 300] }, C2: { at: [900, 300] } } })).size).toBe(0);
    const off = refs(diagram({ layout: { C1: { at: [100, 300] }, C2: { at: [5000, 300] } } }));
    expect(off.has('C1')).toBe(false);
    // The stray one does learn where its partner is.
    expect(off.get('C2')).toBe('→ 1/2');
  });

  it('unnamed or unmatched connectors pair with nothing', () => {
    const d = diagram();
    d.elements[1] = { ...d.elements[1], name: 'X2' };
    expect(refs(d).size).toBe(0);
    d.elements[0] = { ...d.elements[0], name: '' };
    d.elements[1] = { ...d.elements[1], name: '' };
    expect(refs(d).size).toBe(0);
  });

  it('lists each other page once, in page order', () => {
    const r = refs(
      diagram({
        elements: [
          { id: 'C1', kind: 'continuation-out', name: 'L1' },
          { id: 'C2', kind: 'continuation-in', name: 'L1' },
          { id: 'C3', kind: 'continuation-in', name: 'L1' },
          { id: 'C4', kind: 'continuation-in', name: 'L1' },
        ],
        layout: {
          C1: { at: [800, 300] },
          C2: { at: [2600, 300] },
          C3: { at: [1300, 300] },
          C4: { at: [1400, 300] },
        },
        sheets: SHEETS,
      }),
    );
    expect(r.get('C1')).toBe('→ 2/3, 3/3');
    expect(r.get('C3')).toBe('→ 1/3, 3/3');
  });

  it('page numbers follow page order, not sheet ids', () => {
    const r = refs(diagram({ sheets: [SHEETS[1], SHEETS[0]] }));
    expect(r.get('C1')).toBe('→ 1/2');
    expect(r.get('C2')).toBe('→ 2/2');
  });
});

describe('labelLines with a sheet ref', () => {
  const m = compile(diagram());
  const c1 = m.elements.get('C1')!;

  it("stands in for the target param at 'all'", () => {
    expect(labelLines(c1, 'all', '→ 2/2')).toEqual(['X1', '→ 2/2']);
  });

  it("is hidden at 'id', like the param", () => {
    expect(labelLines(c1, 'id', '→ 2/2')).toEqual(['X1']);
  });

  it('is unchanged without one', () => {
    expect(labelLines(c1, 'all')).toEqual(['X1']);
  });
});
