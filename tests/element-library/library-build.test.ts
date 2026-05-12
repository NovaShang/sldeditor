/**
 * Drift test — guarantees that `src/element-library/*.json` is exactly what the
 * build script would produce from its current MANIFEST. If hand-edits sneak
 * back into a JSON file (or someone forgets to re-run the build after editing
 * the manifest), this test fails before review.
 *
 * Manifest is the source of truth. Run `node scripts/build-element-library.mjs`
 * to regenerate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// @ts-expect-error — JS module without .d.ts; types here are local to the test.
import { MANIFEST, buildElement } from '../../scripts/build-element-library.mjs';

const __filename = fileURLToPath(import.meta.url);
// JSON fixtures live in the project's src/element-library/ — the test
// itself was moved out of src/ so embedding consumers (e.g. load-survey)
// don't compile it as part of their own app build.
const OUT_DIR = path.resolve(path.dirname(__filename), '../../src/element-library');

interface ManifestEntry {
  id: string;
}

const entries = MANIFEST as ManifestEntry[];

describe('element-library build', () => {
  it('manifest has unique ids', () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(entries.map((e) => [e.id, e]))(
    'manifest matches src/element-library/%s.json',
    (id, entry) => {
      const onDisk = fs.readFileSync(path.join(OUT_DIR, `${id}.json`), 'utf8');
      const built = buildElement(entry);
      const expected = JSON.stringify(built, null, 2) + '\n';
      expect(onDisk).toBe(expected);
    },
  );

  it('every JSON file in src/element-library/ has a manifest entry', () => {
    const onDisk = new Set(
      fs
        .readdirSync(OUT_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -'.json'.length)),
    );
    const inManifest = new Set(entries.map((e) => e.id));
    const orphans = [...onDisk].filter((id) => !inManifest.has(id));
    expect(orphans).toEqual([]);
  });
});
