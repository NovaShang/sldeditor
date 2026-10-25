/**
 * Offline evaluation of the health check over a folder of real diagram.json
 * files. Prints per-code totals, the share of drawings with a warning, and a
 * JSONL of every issue for manual review. Never commit the input data.
 *
 *   npx vite-node scripts/eval/health-eval.ts -- <dir> <out.jsonl>
 */
import fs from 'node:fs';
import path from 'node:path';
import { compile } from '../../src/compiler';
import { checkHealth } from '../../src/health';
import type { DiagramFile } from '../../src/model';

const [dir, out] = process.argv.slice(2).filter((a) => a !== '--');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
const byCode = new Map<string, { n: number; dwg: Set<string> }>();
let model = 0, withWarn = 0, withRollup = 0, origin = 0;
const lines: string[] = [];
for (const f of files) {
  let d: DiagramFile;
  try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  const m = compile(d);
  const r = checkHealth(d, m);
  if (!r.hasModel || m.elements.size === 0) continue;
  model++;
  if (r.hasOrigin) origin++;
  if (r.issues.some((i) => i.severity !== 'info')) withWarn++;
  if (r.loads.some((l) => l.known > 0)) withRollup++;
  for (const i of r.issues) {
    const e = byCode.get(i.code) ?? { n: 0, dwg: new Set() };
    e.n++; e.dwg.add(f); byCode.set(i.code, e);
    const t0 = i.targets[0];
    const el = d.elements.find((x) => x.id === t0);
    lines.push(JSON.stringify({ file: f, ...i, kind: el?.kind ?? (t0 ? 'bus' : ''), name: el?.name }));
  }
  for (const l of r.loads) lines.push(JSON.stringify({ file: f, code: 'LOAD', ...l }));
}
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`drawings with model: ${model}; with origin ${origin} (${Math.round(origin / model * 100)}%)`);
console.log(`with ≥1 warning/error: ${withWarn} (${Math.round(withWarn / model * 100)}%)`);
console.log(`with a load roll-up that has ≥1 known load: ${withRollup} (${Math.round(withRollup / model * 100)}%)`);
for (const [c, e] of [...byCode].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${c.padEnd(16)} issues ${String(e.n).padStart(4)}  drawings ${String(e.dwg.size).padStart(3)} (${Math.round(e.dwg.size / model * 100)}%)`);
}
