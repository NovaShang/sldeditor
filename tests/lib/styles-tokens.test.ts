/**
 * Host-facing CSS contract of the stylesheet, pinned as text because jsdom
 * cannot resolve `var()` or lay out a box. The two behaviours guarded here
 * were both found by an embedding host:
 *
 *   1. the root must size itself — in the library build every Tailwind
 *      utility is scoped as a descendant of `.ole-root`, so `h-full` on the
 *      root matches nothing;
 *   2. `--ole-alarm-*` / `--ole-selection` must be overridable from ANY
 *      ancestor, so they may never be declared on `.ole-root` itself (that
 *      would shadow the host's value); use sites read them with a fallback.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

describe('styles.css host contract', () => {
  it('sizes the root at zero specificity', () => {
    expect(css).toMatch(/:where\(\.ole-root\)\s*\{[^}]*width:\s*100%[^}]*height:\s*100%[^}]*\}/);
  });

  it('never declares the host-facing runtime tokens on .ole-root', () => {
    for (const token of ['--ole-alarm-warn', '--ole-alarm-alarm', '--ole-alarm-fault', '--ole-selection']) {
      expect(css, `${token} must not be declared`).not.toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it('reads every runtime token through a fallback', () => {
    for (const lvl of ['warn', 'alarm', 'fault']) {
      const uses = css.match(new RegExp(`var\\(--ole-alarm-${lvl}[^)]*\\)?`, 'g')) ?? [];
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) {
        expect(u).toMatch(new RegExp(`^var\\(--ole-alarm-${lvl},\\s*var\\(--ole-alarm-${lvl}-default`));
      }
      expect(css).toMatch(new RegExp(`--ole-alarm-${lvl}-default:\\s*#[0-9a-f]{6}`));
    }
    const sel = css.match(/var\(--ole-selection[^)]*\)?/g) ?? [];
    expect(sel.length).toBeGreaterThan(0);
    for (const u of sel) expect(u).toMatch(/^var\(--ole-selection,\s*var\(--selection/);
  });
});
