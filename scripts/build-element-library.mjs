#!/usr/bin/env node
// Build the OneLineEditor element library by converting selected QElectroTech
// `.elmt` files into product-shaped SVG fragments + terminal metadata.
//
// Output layout:
//   src/element-library/
//     index.json        — manifest with viewBox, terminals, embedded SVG body
//     svg/<id>.svg      — standalone SVG for visual inspection
//
// Run: node scripts/build-element-library.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const QET_ROOT = path.join(ROOT, 'third_party', 'qelectrotech', '10_electric');
const OUT_DIR = path.join(ROOT, 'src', 'element-library');
const OUT_SVG_DIR = path.join(OUT_DIR, 'svg');

// ---------------------------------------------------------------------------
// Manifest: every product-facing element references either a `.elmt` source
// (kind:'elmt') or an inline-defined symbol (kind:'inline'). For .elmt sources
// we may post-process via `dropPrimitive` to strip decorative artwork (e.g.
// the "Form 1 / Forme 1" annotations that QET ships) and via `extraTerminals`
// to add connection points the original symbol omits.
// ---------------------------------------------------------------------------

const dropFormLabel = (p) =>
  p.tag === 'text' && /^Form\s*\d+/i.test(p.attrs.text || '');

const MANIFEST = [
  // ---- 母线 / 接线 ----
  {
    id: 'busbar',
    name: '母线段',
    category: 'busbar',
    description: '可拉伸单母线段，多设备挂接',
    source: {
      kind: 'inline',
      svg:
        '<line x1="-40" y1="0" x2="40" y2="0" stroke="black" stroke-width="3" stroke-linecap="round" fill="none"/>',
      bbox: { x1: -40, y1: -2, x2: 40, y2: 2 },
    },
    terminals: [
      { id: 't_left', x: -40, y: 0, orientation: 'w' },
      { id: 't_right', x: 40, y: 0, orientation: 'e' },
    ],
    stretchable: { axis: 'x', minLength: 20 },
  },
  {
    id: 'earth',
    name: '接地',
    category: 'busbar',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_02/en_60617_02_15/en_60617_02_15_01.elmt' },
  },

  // ---- 开关 ----
  {
    id: 'breaker',
    name: '断路器 (QF)',
    category: 'switching',
    source: { kind: 'elmt', path: '11_singlepole/200_fuses_protective_gears/11_circuit_breakers/disjoncteur1.elmt' },
  },
  {
    id: 'disconnector',
    name: '隔离开关 (QS)',
    category: 'switching',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_13/en_60617_07_13_06.elmt' },
  },
  {
    id: 'earthing-switch',
    name: '接地刀闸 (QE)',
    category: 'switching',
    description: '隔离开关 + 接地连接，单端口',
    source: {
      kind: 'inline',
      svg: [
        '<line x1="0" y1="-30" x2="0" y2="-12" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="0" y1="-12" x2="-9" y2="9" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="-3" y1="-12" x2="3" y2="-12" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="-10" y1="14" x2="10" y2="14" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="-7" y1="19" x2="7" y2="19" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="-4" y1="24" x2="4" y2="24" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="-1.5" y1="29" x2="1.5" y2="29" stroke="black" stroke-width="1" fill="none"/>',
      ].join(''),
      bbox: { x1: -10, y1: -30, x2: 10, y2: 30 },
    },
    terminals: [{ id: 't_top', x: 0, y: -30, orientation: 'n' }],
  },
  {
    id: 'load-switch',
    name: '负荷开关',
    category: 'switching',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_13/en_60617_07_13_08.elmt' },
  },
  {
    id: 'fuse',
    name: '熔断器 (FU)',
    category: 'switching',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_21/en_60617_07_21_01.elmt' },
  },

  // ---- 变压器 ----
  {
    id: 'transformer-2w',
    name: '双绕组变压器',
    category: 'transformer',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_09/en_60617_06_09_01.elmt' },
    dropPrimitive: dropFormLabel,
  },
  {
    id: 'transformer-3w',
    name: '三绕组变压器',
    category: 'transformer',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_09/en_60617_06_09_04.elmt' },
    dropPrimitive: dropFormLabel,
    // QET ships only the high-side terminal; add the two low-side terminals.
    extraTerminals: [
      { id: 't_low_left', x: -50, y: 0, orientation: 's' },
      { id: 't_low_right', x: 0, y: 0, orientation: 's' },
    ],
  },
  {
    id: 'autotransformer',
    name: '自耦变压器',
    category: 'transformer',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_09/en_60617_06_09_06.elmt' },
    dropPrimitive: dropFormLabel,
    extraTerminals: [{ id: 't_bottom', x: -30, y: 20, orientation: 's' }],
  },

  // ---- 互感器 ----
  {
    id: 'ct',
    name: '电流互感器 (CT)',
    category: 'instrument-transformer',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_09/en_60617_06_09_10.elmt' },
    dropPrimitive: dropFormLabel,
  },
  {
    id: 'pt',
    name: '电压互感器 (PT)',
    category: 'instrument-transformer',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_13/en_60617_06_13_01A.elmt' },
    dropPrimitive: dropFormLabel,
  },

  // ---- 电源 ----
  {
    id: 'generator',
    name: '发电机 (G)',
    category: 'source',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_16/en_60617_06_16_01.elmt' },
    extraTerminals: [{ id: 't_bottom', x: -20, y: 0, orientation: 's' }],
  },
  {
    id: 'grid-source',
    name: '系统电源',
    category: 'source',
    description: '无穷大母线 / 外部电网',
    source: {
      kind: 'inline',
      svg: [
        '<circle cx="0" cy="-15" r="14" fill="none" stroke="black" stroke-width="1"/>',
        '<text x="0" y="-12" text-anchor="middle" font-family="Liberation Sans, Arial, sans-serif" font-size="14">~</text>',
        '<line x1="0" y1="-1" x2="0" y2="20" stroke="black" stroke-width="1" fill="none"/>',
      ].join(''),
      bbox: { x1: -14, y1: -29, x2: 14, y2: 20 },
    },
    terminals: [{ id: 't_bottom', x: 0, y: 20, orientation: 's' }],
  },
  {
    id: 'battery',
    name: '电池储能',
    category: 'source',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_15/en_60617_06_15_01.elmt' },
    extraTerminals: [
      { id: 't_left', x: -10, y: 0, orientation: 'w' },
      { id: 't_right', x: 15, y: 0, orientation: 'e' },
    ],
  },

  // ---- 负荷 / 电机 ----
  {
    id: 'sync-motor',
    name: '同步电动机',
    category: 'load',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_07/en_60617_06_07_02.elmt' },
  },
  {
    id: 'async-motor',
    name: '异步电动机',
    category: 'load',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_08/en_60617_06_08_01.elmt' },
  },
  {
    id: 'load',
    name: '负荷',
    category: 'load',
    description: '抽象负荷（电流流出箭头）',
    source: {
      kind: 'inline',
      svg: [
        '<line x1="0" y1="-20" x2="0" y2="10" stroke="black" stroke-width="1" fill="none"/>',
        '<polygon points="-6,10 6,10 0,22" fill="black" stroke="black" stroke-width="1"/>',
      ].join(''),
      bbox: { x1: -6, y1: -20, x2: 6, y2: 22 },
    },
    terminals: [{ id: 't_top', x: 0, y: -20, orientation: 'n' }],
  },

  // ---- 无功 / 保护 ----
  {
    id: 'shunt-reactor',
    name: '并联电抗器',
    category: 'compensation',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_09/en_60617_06_09_08.elmt' },
    dropPrimitive: dropFormLabel,
    extraTerminals: [{ id: 't_bottom', x: -30, y: 20, orientation: 's' }],
  },
  {
    id: 'series-reactor',
    name: '串联电抗器',
    category: 'compensation',
    description: '与并联电抗器同符号；通过用法区分。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_09/en_60617_06_09_08.elmt' },
    dropPrimitive: dropFormLabel,
    extraTerminals: [{ id: 't_bottom', x: -30, y: 20, orientation: 's' }],
  },
  {
    id: 'shunt-capacitor',
    name: '并联电容器',
    category: 'compensation',
    source: { kind: 'elmt', path: '11_singlepole/395_electronics_semiconductors/20_capacitors/capacite.elmt' },
    extraTerminals: [{ id: 't_bottom', x: 0, y: 2, orientation: 's' }],
  },
  {
    id: 'arrester',
    name: '避雷器 (FBL)',
    category: 'protection',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_22/en_60617_07_22_03.elmt' },
  },
];

// ---------------------------------------------------------------------------
// .elmt parser. The format is flat XML inside <description>; every primitive
// is a self-closing tag with key="value" attributes.
// ---------------------------------------------------------------------------

function parseAttrs(s) {
  const out = {};
  for (const m of s.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function parseElmt(xml) {
  const defMatch = xml.match(/<definition\s+([^>]+)>/);
  if (!defMatch) throw new Error('no <definition> tag');
  const defAttrs = parseAttrs(defMatch[1]);

  const names = {};
  for (const m of xml.matchAll(/<name\s+lang="([^"]+)">([^<]*)<\/name>/g)) {
    names[m[1]] = m[2];
  }

  const descMatch = xml.match(/<description>([\s\S]*?)<\/description>/);
  const desc = descMatch ? descMatch[1] : '';

  const primitives = [];
  // Match self-closing tags. We deliberately exclude <dynamic_text> (placeholder
  // labels written by the editor at runtime) and any nested <text></text> inside
  // dynamic_text blocks.
  const selfClosing = /<(line|rect|ellipse|polygon|polyline|arc|text|terminal)\s+([^>]*?)\/>/g;
  for (const m of desc.matchAll(selfClosing)) {
    primitives.push({ tag: m[1], attrs: parseAttrs(m[2]) });
  }
  return { defAttrs, names, primitives };
}

// ---------------------------------------------------------------------------
// Style + primitive-to-SVG conversion.
// ---------------------------------------------------------------------------

const STROKE_WIDTH = { thin: 0.4, normal: 1, hold: 2, eleve: 2, bold: 2 };
const NAMED_COLORS = new Set([
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta',
  'gray', 'grey', 'darkgray', 'lightgray', 'brown', 'orange', 'none',
]);

function parseStyle(s) {
  const out = {};
  for (const part of (s || '').split(';')) {
    const [k, v] = part.split(':');
    if (k && v) out[k.trim()] = v.trim();
  }
  return out;
}

function fillFromStyle(s) {
  const f = s.filling;
  if (!f || f === 'none') return 'none';
  if (NAMED_COLORS.has(f)) return f;
  if (f.startsWith('#')) return f;
  // QET hatch patterns (hor, ver, bdiag, fdiag, cross, ...) — flatten to none
  // for v0; we can map them to <pattern> defs later if needed.
  return 'none';
}

function strokeFromStyle(s) {
  const c = s.color;
  if (!c) return 'black';
  if (NAMED_COLORS.has(c)) return c;
  if (c.startsWith('#')) return c;
  return 'black';
}

function strokeWidthFromStyle(s) {
  return STROKE_WIDTH[s['line-weight']] ?? 1;
}

function dashFromStyle(s) {
  switch (s['line-style']) {
    case 'dashed': return '4 2';
    case 'dotted': return '1 2';
    case 'dashdotted': return '4 2 1 2';
    default: return null;
  }
}

function num(v) {
  // Trim trailing zeros from common cases for compact output.
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return Number.isInteger(n) ? String(n) : String(+n.toFixed(3));
}

function escapeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Convert a Qt-style elliptical arc (start/sweep angles in degrees, Qt
// convention: 0° = +x axis, positive angle = counter-clockwise as the user
// sees it on a y-down screen) to an SVG path.
function arcPath(x, y, w, h, start, angle) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  // Negate angle because SVG user space flips y. With this negation the
  // resulting (sin, cos) pair lands on the same screen pixel Qt would draw.
  const toRad = (a) => (-a * Math.PI) / 180;
  const x1 = cx + rx * Math.cos(toRad(start));
  const y1 = cy + ry * Math.sin(toRad(start));
  const x2 = cx + rx * Math.cos(toRad(start + angle));
  const y2 = cy + ry * Math.sin(toRad(start + angle));
  const largeArc = Math.abs(angle) > 180 ? 1 : 0;
  // Qt positive angle = CCW (user-visible). SVG sweep=0 = CCW in user space.
  const sweep = angle >= 0 ? 0 : 1;
  return `M ${num(x1)} ${num(y1)} A ${num(rx)} ${num(ry)} 0 ${largeArc} ${sweep} ${num(x2)} ${num(y2)}`;
}

function strokeAttrs(style) {
  const s = parseStyle(style);
  const dash = dashFromStyle(s);
  let out = ` stroke="${strokeFromStyle(s)}" stroke-width="${strokeWidthFromStyle(s)}"`;
  if (dash) out += ` stroke-dasharray="${dash}"`;
  return out;
}

function shapeAttrs(style) {
  const s = parseStyle(style);
  return ` fill="${fillFromStyle(s)}"` + strokeAttrs(style);
}

function primitiveToSvg(p) {
  const a = p.attrs;
  switch (p.tag) {
    case 'line':
      return `<line x1="${num(a.x1)}" y1="${num(a.y1)}" x2="${num(a.x2)}" y2="${num(a.y2)}" fill="none"${strokeAttrs(a.style)}/>`;
    case 'rect': {
      const rx = a.rx ?? 0, ry = a.ry ?? 0;
      return `<rect x="${num(a.x)}" y="${num(a.y)}" width="${num(a.width)}" height="${num(a.height)}" rx="${num(rx)}" ry="${num(ry)}"${shapeAttrs(a.style)}/>`;
    }
    case 'ellipse': {
      const cx = +a.x + +a.width / 2;
      const cy = +a.y + +a.height / 2;
      const rx = +a.width / 2;
      const ry = +a.height / 2;
      return `<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(rx)}" ry="${num(ry)}"${shapeAttrs(a.style)}/>`;
    }
    case 'polygon':
    case 'polyline': {
      const pts = [];
      for (let i = 1; ; i++) {
        if (a[`x${i}`] === undefined) break;
        pts.push(`${num(a[`x${i}`])},${num(a[`y${i}`])}`);
      }
      const closed = a.closed !== 'false'; // default closed
      const tag = closed ? 'polygon' : 'polyline';
      const attrs = closed ? shapeAttrs(a.style) : ` fill="none"${strokeAttrs(a.style)}`;
      return `<${tag} points="${pts.join(' ')}"${attrs}/>`;
    }
    case 'arc':
      return `<path d="${arcPath(+a.x, +a.y, +a.width, +a.height, +a.start, +a.angle)}" fill="none"${strokeAttrs(a.style)}/>`;
    case 'text': {
      const fontSize = +(a.font?.split(',')[1] || 9);
      const color = a.color || '#000000';
      // QET positions text from its top-left; SVG `y` is the baseline. Bias
      // by ~0.8em so visual placement matches QElectroTech.
      const ySvg = +a.y + fontSize * 0.8;
      const rot = +(a.rotation || 0);
      const transform = rot ? ` transform="rotate(${rot} ${num(a.x)} ${num(ySvg)})"` : '';
      return `<text x="${num(a.x)}" y="${num(ySvg)}" font-family="Liberation Sans, Arial, sans-serif" font-size="${fontSize}" fill="${color}"${transform}>${escapeXml(a.text || '')}</text>`;
    }
    case 'terminal':
      return null; // handled outside the visual layer
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bounding box (for tight viewBox) + terminal extraction.
// ---------------------------------------------------------------------------

function unionBBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
    x2: Math.max(a.x2, b.x2),
    y2: Math.max(a.y2, b.y2),
  };
}

function primitiveBBox(p) {
  const a = p.attrs;
  switch (p.tag) {
    case 'line':
      return { x1: Math.min(+a.x1, +a.x2), y1: Math.min(+a.y1, +a.y2), x2: Math.max(+a.x1, +a.x2), y2: Math.max(+a.y1, +a.y2) };
    case 'rect':
    case 'ellipse':
    case 'arc':
      return { x1: +a.x, y1: +a.y, x2: +a.x + +a.width, y2: +a.y + +a.height };
    case 'polygon':
    case 'polyline': {
      const xs = [], ys = [];
      for (let i = 1; ; i++) {
        if (a[`x${i}`] === undefined) break;
        xs.push(+a[`x${i}`]); ys.push(+a[`y${i}`]);
      }
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    }
    case 'text': {
      const fontSize = +(a.font?.split(',')[1] || 9);
      const len = (a.text || '').length * fontSize * 0.6;
      return { x1: +a.x, y1: +a.y, x2: +a.x + len, y2: +a.y + fontSize };
    }
    case 'terminal':
      return null; // do not influence visual bbox
    default:
      return null;
  }
}

function extractTerminal(p) {
  const a = p.attrs;
  return { x: +a.x, y: +a.y, orientation: (a.orientation || 'n').toLowerCase() };
}

// ---------------------------------------------------------------------------
// Build a single element.
// ---------------------------------------------------------------------------

function buildElement(entry) {
  if (entry.source.kind === 'inline') {
    const bbox = entry.source.bbox;
    return finalize(entry, {
      svgBody: entry.source.svg,
      bbox,
      terminals: entry.terminals || [],
      sourceMeta: { kind: 'inline' },
    });
  }

  const fullPath = path.join(QET_ROOT, entry.source.path);
  const xml = fs.readFileSync(fullPath, 'utf8');
  const parsed = parseElmt(xml);

  const dropPredicate = entry.dropPrimitive || (() => false);
  const visualPrims = parsed.primitives.filter((p) => p.tag !== 'terminal' && !dropPredicate(p));
  const terminalPrims = parsed.primitives.filter((p) => p.tag === 'terminal');

  let bbox = null;
  for (const p of visualPrims) bbox = unionBBox(bbox, primitiveBBox(p));
  if (!bbox) bbox = { x1: -10, y1: -10, x2: 10, y2: 10 };

  const svgBody = visualPrims.map(primitiveToSvg).filter(Boolean).join('');

  const terminalsFromElmt = terminalPrims.map((p, i) => ({
    id: `t${i + 1}`,
    ...extractTerminal(p),
  }));
  const terminals = entry.terminals
    ? entry.terminals
    : [...terminalsFromElmt, ...(entry.extraTerminals || [])];

  return finalize(entry, {
    svgBody,
    bbox,
    terminals,
    sourceMeta: {
      kind: 'elmt',
      path: entry.source.path,
      qetEnglishName: parsed.names.en,
      qetUuid: parsed.defAttrs.uuid,
    },
  });
}

function finalize(entry, { svgBody, bbox, terminals, sourceMeta }) {
  // Pad the bbox so strokes don't get clipped, and so the viewBox includes
  // every terminal point (which sits exactly on the boundary).
  for (const t of terminals) {
    bbox = unionBBox(bbox, { x1: t.x, y1: t.y, x2: t.x, y2: t.y });
  }
  const pad = 2;
  const vb = {
    x: Math.floor(bbox.x1 - pad),
    y: Math.floor(bbox.y1 - pad),
    w: Math.ceil(bbox.x2 + pad) - Math.floor(bbox.x1 - pad),
    h: Math.ceil(bbox.y2 + pad) - Math.floor(bbox.y1 - pad),
  };

  return {
    id: entry.id,
    name: entry.name,
    category: entry.category,
    description: entry.description,
    viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`,
    width: vb.w,
    height: vb.h,
    svg: svgBody,
    terminals,
    stretchable: entry.stretchable,
    source: sourceMeta,
  };
}

function standaloneSvg(el) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${el.viewBox}" width="${el.width * 2}" height="${el.height * 2}">${el.svg}${el.terminals
    .map((t) => `<circle cx="${num(t.x)}" cy="${num(t.y)}" r="1.5" fill="#dc2626"/>`)
    .join('')}</svg>\n`;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main() {
  fs.mkdirSync(OUT_SVG_DIR, { recursive: true });

  const elements = [];
  const seenIds = new Set();
  for (const entry of MANIFEST) {
    if (seenIds.has(entry.id)) throw new Error(`duplicate element id: ${entry.id}`);
    seenIds.add(entry.id);

    let built;
    try {
      built = buildElement(entry);
    } catch (err) {
      console.error(`✗ ${entry.id}: ${err.message}`);
      throw err;
    }

    elements.push(built);
    fs.writeFileSync(path.join(OUT_SVG_DIR, `${entry.id}.svg`), standaloneSvg(built));
    console.log(`✓ ${entry.id.padEnd(22)} ${built.viewBox.padEnd(20)} terminals=${built.terminals.length}`);
  }

  // Group by category for the side-panel layout (PRD §5.1).
  const categories = {};
  for (const el of elements) {
    (categories[el.category] ||= []).push(el.id);
  }

  const index = {
    version: '0.1',
    generatedAt: new Date().toISOString(),
    sourceLicense: 'GPLv2 (QElectroTech ELEMENTS.LICENSE) — see THIRD_PARTY_NOTICES.md',
    categories,
    elements,
  };

  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  console.log(`\nWrote ${elements.length} elements to ${path.relative(ROOT, OUT_DIR)}`);
}

main();
