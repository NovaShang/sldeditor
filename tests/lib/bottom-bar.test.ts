/**
 * Bottom-row fit (`hooks/bottom-bar`): the outline tab, the main toolbar and
 * the view toolbar share the bottom edge and must never overlap, whatever the
 * language or drawing type makes the main toolbar's width.
 */

import { describe, expect, it } from 'vitest';
import { barCenter, pickBarMode, rowFits, type BarMode, type BarWidths } from '../../src/hooks/bottom-bar';

// The English single-line row as measured on smartsld.com, 2026-11-04.
const FULL: BarWidths = { left: 92, bar: 649, right: 303 };
const TIGHT: BarWidths = { left: 92, bar: 488, right: 251 };
const COMPACT: BarWidths = { left: 48, bar: 488, right: 251 };

describe('rowFits', () => {
  it('needs both edges and both gaps on top of the three widths', () => {
    // 12 + 92 + 8 + 649 + 8 + 303 + 12 = 1084
    expect(rowFits(FULL, 1084)).toBe(true);
    expect(rowFits(FULL, 1083)).toBe(false);
  });

  it('centred, clears the wider side piece on both sides', () => {
    // 649 + 2 * (12 + 303 + 8) = 1295
    expect(rowFits(FULL, 1295, true)).toBe(true);
    expect(rowFits(FULL, 1294, true)).toBe(false);
  });
});

describe('pickBarMode', () => {
  const cache: Partial<Record<BarMode, BarWidths>> = { full: FULL, tight: TIGHT, compact: COMPACT };

  it('keeps labels while the toolbar fits centred', () => {
    expect(pickBarMode(cache, 1440, 'full')).toBe('full');
    expect(pickBarMode(cache, 1295, 'full')).toBe('full');
  });

  it('drops labels to stay centred before sliding the toolbar aside', () => {
    // Labels would fit at 1180 only slid ~60 px off centre.
    expect(pickBarMode(cache, 1180, 'full')).toBe('tight');
    // 1024 was a "full" width under the old fixed breakpoints, and the view
    // toolbar covered Undo / Redo / Layout there. Now: icons, slid a little.
    expect(pickBarMode(cache, 1024, 'full')).toBe('tight');
    expect(pickBarMode(cache, 860, 'full')).toBe('compact');
    expect(pickBarMode(cache, 800, 'full')).toBe('dense');
  });

  it('tries a mode it has not measured yet, so the next pass can decide', () => {
    expect(pickBarMode({ full: FULL }, 1024, 'full')).toBe('tight');
    expect(pickBarMode({ full: { left: 92, bar: 649 } }, 1024, 'full')).toBe('full');
  });

  it('steps back up when the window grows', () => {
    expect(pickBarMode(cache, 1300, 'full')).toBe('full');
  });

  it('is always dense on phone widths', () => {
    expect(pickBarMode(cache, 1440, 'dense')).toBe('dense');
  });

  it('accounts for longer labels in another language', () => {
    const german: Partial<Record<BarMode, BarWidths>> = { ...cache, full: { ...FULL, bar: 820 } };
    expect(pickBarMode(german, 1440, 'full')).toBe('tight');
  });
});

describe('barCenter', () => {
  it('is the middle of the editor when that clears both sides', () => {
    expect(barCenter(FULL, 1440)).toBe(720);
  });

  it('slides away from the wider side instead of overlapping it', () => {
    // Centred at 1100 the bar would end at 550 + 324.5 = 874.5, past the view
    // toolbar's left edge (1100 - 12 - 303 = 785).
    const c = barCenter(FULL, 1100);
    expect(c + FULL.bar! / 2).toBeLessThanOrEqual(1100 - 12 - FULL.right! - 8);
    expect(c - FULL.bar! / 2).toBeGreaterThanOrEqual(12 + FULL.left! + 8);
  });
});
