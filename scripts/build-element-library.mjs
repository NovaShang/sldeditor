#!/usr/bin/env node
// Build the OneLineEditor element library by converting selected QElectroTech
// `.elmt` files into product-shaped SVG fragments + terminal metadata.
//
// Output layout (one file per element — no centralized index):
//   src/element-library/<id>.json   — full record { id, name, category, viewBox, svg, terminals, ... }
//
// Frontend should auto-discover via e.g. `import.meta.glob('./*.json')`.
//
// Run: node scripts/build-element-library.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const QET_ROOT = path.join(ROOT, 'third_party', 'qelectrotech', '10_electric');
const OUT_DIR = path.join(ROOT, 'src', 'element-library');

// ---------------------------------------------------------------------------
// Manifest: every product-facing element references either a `.elmt` source
// (kind:'elmt') or an inline-defined symbol (kind:'inline'). For .elmt sources
// we may post-process via `dropPrimitive` to strip decorative artwork (e.g.
// the "Form 1 / Forme 1" annotations that QET ships) and via `extraTerminals`
// to add connection points the original symbol omits.
// ---------------------------------------------------------------------------

const dropFormLabel = (p) =>
  p.tag === 'text' && /^Form\s*\d+/i.test(p.attrs.text || '');

/**
 * A pure-digit <text> primitive within this distance of a terminal is treated
 * as a QET pin-number glyph and split into `terminalLabelsSvg` (see
 * `buildElement`). 20 units cleanly separates the breaker's pin digits
 * (≤ 9 units from their pins) from machine glyphs like the motors' "3"/"1"
 * (≥ 70 units from any terminal).
 */
const TERMINAL_LABEL_RADIUS = 20;

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
    // Single virtual `tap` terminal — the data model special-cases bus
    // multi-attach via this name. Do NOT split into t_left/t_right.
    terminals: [{ id: 'tap', x: 0, y: 0, orientation: 'n' }],
    stretchable: { axis: 'x', minLength: 20, naturalSpan: 80 },
    params: [
      { name: 'Un', label: '额定电压', type: 'number', unit: 'kV', showOnCanvas: true },
    ],
    label: { x: 0, y: -6, anchor: 'middle' },
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
    state: [{ name: 'open', type: 'boolean', default: false, label: '断开' }],
    label: { x: 6, y: -2, anchor: 'start' },
    // QET ships the "1"/"2" pin numbers at font-size 4 — bump for legibility.
    textFontSize: 6,
  },
  {
    id: 'disconnector',
    name: '隔离开关 (QS)',
    category: 'switching',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_13/en_60617_07_13_06.elmt' },
    state: [{ name: 'open', type: 'boolean', default: false, label: '断开' }],
    label: { x: 6, y: -10, anchor: 'start' },
  },
  {
    id: 'earthing-switch',
    name: '接地刀闸 (QE)',
    category: 'switching',
    description: '隔离开关 + 接地连接，单端口',
    state: [{ name: 'open', type: 'boolean', default: true, label: '断开' }],
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
    label: { x: 12, y: -8, anchor: 'start' },
  },
  {
    id: 'load-switch',
    name: '负荷开关',
    category: 'switching',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_13/en_60617_07_13_08.elmt' },
    state: [{ name: 'open', type: 'boolean', default: false, label: '断开' }],
  },
  {
    id: 'fuse',
    name: '熔断器 (FU)',
    category: 'switching',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_21/en_60617_07_21_01.elmt' },
    // QET source lists the bottom terminal first; force convention t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: 0, y: -30, orientation: 'n' },
      { id: 't2', x: 0, y: 30, orientation: 's' },
    ],
    state: [{ name: 'blown', type: 'boolean', default: false, label: '熔断' }],
    label: { x: 7, y: -2, anchor: 'start' },
  },

  // ---- 变压器 ----
  {
    id: 'transformer-2w',
    name: '双绕组变压器',
    category: 'transformer',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_09/en_60617_06_09_01.elmt' },
    dropPrimitive: dropFormLabel,
    // QET source lists the bottom terminal first; force convention t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: -30, y: -140, orientation: 'n' },
      { id: 't2', x: -30, y: 0, orientation: 's' },
    ],
    params: [
      { name: 'S', label: '容量', type: 'number', unit: 'MVA', showOnCanvas: true },
      { name: 'ratio', label: '变比', type: 'string', showOnCanvas: true },
    ],
    label: { x: 4, y: -68, anchor: 'start' },
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
    label: { x: 4, y: -64, anchor: 'start' },
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
    // QET source lists the bottom terminal first; force convention t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: -30, y: -60, orientation: 'n' },
      { id: 't2', x: -30, y: 0, orientation: 's' },
    ],
  },
  {
    id: 'pt',
    name: '电压互感器 (PT)',
    category: 'instrument-transformer',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_13/en_60617_06_13_01A.elmt' },
    dropPrimitive: dropFormLabel,
    // QET source lists the bottom terminal first; force convention t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: 0, y: -40, orientation: 'n' },
      { id: 't2', x: 0, y: 71, orientation: 's' },
    ],
  },

  // ---- 电源 ----
  {
    id: 'generator',
    name: '发电机 (G)',
    category: 'source',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_16/en_60617_06_16_01.elmt' },
    extraTerminals: [{ id: 't_bottom', x: -20, y: 0, orientation: 's' }],
    textFontSize: 14,
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
    category: 'storage',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_15/en_60617_06_15_01.elmt' },
    extraTerminals: [
      { id: 't_left', x: -10, y: 0, orientation: 'w' },
      { id: 't_right', x: 15, y: 0, orientation: 'e' },
    ],
    params: [{ name: 'E', label: '容量', type: 'number', unit: 'kWh' }],
  },

  // ---- 负荷 / 电机 ----
  {
    id: 'sync-motor',
    name: '同步电动机',
    category: 'load',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_07/en_60617_06_07_02.elmt' },
    textFontSize: 14,
  },
  {
    id: 'async-motor',
    name: '异步电动机',
    category: 'load',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_08/en_60617_06_08_01.elmt' },
    textFontSize: 14,
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
    params: [
      { name: 'P', label: '有功功率', type: 'number', unit: 'MW', showOnCanvas: true },
      { name: 'cosphi', label: '功率因数', type: 'number' },
    ],
    label: { x: 6, y: 0, anchor: 'start' },
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
    params: [
      { name: 'Q', label: '无功容量', type: 'number', unit: 'Mvar' },
      { name: 'stages', label: '分组数', type: 'number' },
    ],
  },
  {
    id: 'arrester',
    name: '避雷器 (FBL)',
    category: 'protection',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_22/en_60617_07_22_03.elmt' },
  },

  // ---- 中性点接地 (变压器中性点接地方式) ----
  {
    id: 'grounding-transformer',
    name: '接地变 (Z形)',
    category: 'grounding',
    description: '星-曲折接线变压器，中性点接地用',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_10/en_60617_06_10_15.elmt' },
    dropPrimitive: dropFormLabel,
    // QET source lists the bottom terminal first; force convention t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: -30, y: -150, orientation: 'n' },
      { id: 't2', x: -30, y: 10, orientation: 's' },
    ],
  },
  {
    id: 'ngr',
    name: '中性点电阻 (NGR)',
    category: 'grounding',
    description: '小电阻接地：连接变压器中性点到地',
    source: {
      kind: 'inline',
      svg: [
        '<line x1="0" y1="-30" x2="0" y2="-15" fill="none" stroke="black" stroke-width="1"/>',
        '<rect x="-6" y="-15" width="12" height="22" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="0" y1="7" x2="0" y2="15" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-10" y1="15" x2="10" y2="15" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-7" y1="19" x2="7" y2="19" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-4" y1="23" x2="4" y2="23" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-1.5" y1="27" x2="1.5" y2="27" fill="none" stroke="black" stroke-width="1"/>',
      ].join(''),
      bbox: { x1: -10, y1: -30, x2: 10, y2: 28 },
    },
    terminals: [{ id: 't_top', x: 0, y: -30, orientation: 'n' }],
    params: [{ name: 'R', label: '电阻', type: 'number', unit: 'Ω' }],
  },
  {
    id: 'arc-suppression-coil',
    name: '消弧线圈',
    category: 'grounding',
    description: '中性点谐振接地：电感线圈连接到地',
    source: {
      kind: 'inline',
      svg: [
        '<line x1="0" y1="-30" x2="0" y2="-12" fill="none" stroke="black" stroke-width="1"/>',
        // three stacked semicircular bumps (IEC inductor)
        '<path d="M 0 -12 A 4 4 0 0 1 0 -4 A 4 4 0 0 1 0 4 A 4 4 0 0 1 0 12" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="0" y1="12" x2="0" y2="20" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-10" y1="20" x2="10" y2="20" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-7" y1="24" x2="7" y2="24" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-4" y1="28" x2="4" y2="28" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-1.5" y1="32" x2="1.5" y2="32" fill="none" stroke="black" stroke-width="1"/>',
      ].join(''),
      bbox: { x1: -10, y1: -30, x2: 10, y2: 33 },
    },
    terminals: [{ id: 't_top', x: 0, y: -30, orientation: 'n' }],
  },

  {
    id: 'panelboard',
    name: '配电箱',
    category: 'load',
    description: '配电箱 / 负荷中心（IEC 60617 分配中心符号）：顶部进线，底部分路示意',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_11/en_60617_11_12/en_60617_11_12_07.elmt' },
    // QET draws this distribution centre incoming-at-bottom / ways-on-top —
    // upside down for a load, which takes its feeder from above (the load
    // convention is a TOP terminal, orientation 'n'; cf. `load`, `ev-charger`).
    // Flip it vertically so the incoming feeder is at the top and the (still
    // decorative — too tight to wire at QET's 10-unit pitch) way-stubs sit at
    // the bottom. extraTerminals are in the un-flipped source frame; the flip
    // moves t_in to the top and its orientation s→n (see `applyTransform`).
    transform: { flipV: true },
    extraTerminals: [{ id: 't_in', x: -25, y: 0, orientation: 's' }],
  },
  // ---- 新能源 / 电力电子 ----
  {
    id: 'pv',
    name: '光伏组件',
    category: 'renewable',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_18/en_60617_06_18_06.elmt' },
    // QET symbol has no terminals. PV is a source: feed its DC out the BOTTOM
    // (orientation 's') like every other generator (grid-source, generator,
    // wind-turbine) so it wires straight down into a combiner/inverter below.
    // The old right-edge pin (x:50, 'e') was off-axis and horizontal, forcing
    // layouts to shift downstream symbols +50x to avoid a jog. x:0 sits on the
    // panel box's bottom edge (box spans x:-10..50) and on the symbol axis.
    extraTerminals: [{ id: 't_dc', x: 0, y: 40, orientation: 's' }],
    textFontSize: 14,
  },
  {
    id: 'wind-turbine',
    name: '风力发电机',
    category: 'renewable',
    description: '风机：发电机 + 三叶轮标记',
    source: {
      kind: 'inline',
      svg: [
        // generator circle
        '<circle cx="0" cy="0" r="20" fill="none" stroke="black" stroke-width="1"/>',
        '<text x="0" y="4" text-anchor="middle" font-family="Liberation Sans, Arial, sans-serif" font-size="16">G</text>',
        // three-blade rotor (60° spaced lines from hub on top)
        '<line x1="0" y1="-20" x2="0" y2="-32" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="0" y1="-32" x2="-10" y2="-39" fill="none" stroke="black" stroke-width="1.5"/>',
        '<line x1="0" y1="-32" x2="10" y2="-39" fill="none" stroke="black" stroke-width="1.5"/>',
        '<line x1="0" y1="-32" x2="0" y2="-44" fill="none" stroke="black" stroke-width="1.5"/>',
      ].join(''),
      bbox: { x1: -20, y1: -44, x2: 20, y2: 20 },
    },
    terminals: [{ id: 't_bottom', x: 0, y: 20, orientation: 's' }],
  },
  {
    id: 'rectifier',
    name: '整流器 (AC→DC)',
    category: 'renewable',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_14/en_60617_06_14_03.elmt' },
    extraTerminals: [
      { id: 't_ac', x: -20, y: -40, orientation: 'n' },
      { id: 't_dc', x: -20, y: 0, orientation: 's' },
    ],
  },
  {
    id: 'inverter',
    name: '逆变器 (DC→AC)',
    category: 'renewable',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_14/en_60617_06_14_05.elmt' },
    // QET draws this inverter DC-top / AC-bottom — opposite to the AC-top /
    // DC-bottom convention every other converter follows (rectifier,
    // converter-bidir, power-supply). Flip it vertically so it matches.
    // extraTerminals are in the un-flipped source frame; the flip moves them.
    transform: { flipV: true },
    extraTerminals: [
      { id: 't_dc', x: -20, y: -40, orientation: 'n' },
      { id: 't_ac', x: -20, y: 0, orientation: 's' },
    ],
  },
  {
    id: 'converter-bidir',
    name: '双向变流器 (PCS)',
    category: 'renewable',
    description: '储能变流器：双向 AC ↔ DC',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_14/en_60617_06_14_06.elmt' },
    extraTerminals: [
      { id: 't_ac', x: -20, y: -40, orientation: 'n' },
      { id: 't_dc', x: -20, y: 0, orientation: 's' },
    ],
    params: [{ name: 'S', label: '容量', type: 'number', unit: 'MVA' }],
  },
  {
    id: 'dc-dc-converter',
    name: 'DC/DC 变换器',
    category: 'renewable',
    description: 'DC/DC 变换器 / 直流充电器（IEC 60617）',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_14/en_60617_06_14_02.elmt' },
    // QET symbol has no terminals; DC in on top, DC out on bottom (top→bottom flow).
    extraTerminals: [
      { id: 't_in', x: -20, y: -40, orientation: 'n' },
      { id: 't_out', x: -20, y: 0, orientation: 's' },
    ],
    params: [{ name: 'P', label: '功率', type: 'number', unit: 'kW' }],
  },
  {
    id: 'mppt',
    name: 'MPPT 控制器',
    category: 'renewable',
    // No dedicated IEC/QET symbol for an MPPT charge controller — the accepted
    // SLD convention is the DC/DC-converter block (same source as dc-dc-converter),
    // distinguished by name/label. PV in on top, battery/DC-bus out on bottom.
    description: 'MPPT 太阳能充电控制器（DC/DC，最大功率点跟踪）',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_14/en_60617_06_14_02.elmt' },
    extraTerminals: [
      { id: 't_pv', x: -20, y: -40, orientation: 'n' },
      { id: 't_bat', x: -20, y: 0, orientation: 's' },
    ],
    params: [{ name: 'I', label: '额定电流', type: 'number', unit: 'A' }],
  },

  // ---- 保护 / 剩余电流 ----
  {
    id: 'gfci-breaker',
    name: 'GFCI 断路器 (RCBO)',
    category: 'protection',
    description: '剩余电流断路器带过流保护 (UL943 / IEC 61009)。北美 GFCI / 欧洲 RCBO。',
    source: { kind: 'elmt', path: '11_singlepole/200_fuses_protective_gears/50_residual_current_circuit_breaker/rcbo.elmt' },
    // QET source lists bottom terminal first; force convention t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: 0, y: -20, orientation: 'n' },
      { id: 't2', x: 0, y: 20, orientation: 's' },
    ],
    state: [{ name: 'open', type: 'boolean', default: false, label: '断开' }],
    params: [
      { name: 'In', label: '额定电流', type: 'number', unit: 'A' },
      { name: 'IDn', label: '剩余动作电流', type: 'number', unit: 'mA', default: 30 },
    ],
  },
  {
    id: 'rcd',
    name: '剩余电流装置 (RCD)',
    category: 'protection',
    description: '不带过流保护的剩余电流断路器 (IEC 61008)。',
    source: { kind: 'elmt', path: '11_singlepole/200_fuses_protective_gears/50_residual_current_circuit_breaker/ddr1.elmt' },
    state: [{ name: 'open', type: 'boolean', default: false, label: '断开' }],
    params: [
      { name: 'IDn', label: '剩余动作电流', type: 'number', unit: 'mA', default: 30 },
    ],
  },
  {
    id: 'recloser',
    name: '重合闸 (Recloser)',
    category: 'protection',
    description: '中压自动重合闸开关。',
    source: {
      kind: 'inline',
      svg: [
        '<line x1="0" y1="-30" x2="0" y2="-10" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="0" y1="0" x2="0" y2="30" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="0" y1="0" x2="-8" y2="-13" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="-2" y1="-8" x2="2" y2="-12" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="-2" y1="-12" x2="2" y2="-8" stroke="black" stroke-width="1" fill="none"/>',
        '<path d="M 13 -12 A 7 7 0 1 1 6 -5" fill="none" stroke="black" stroke-width="0.8"/>',
        '<polygon points="4,-7 6,-5 8,-3" fill="black"/>',
        '<text x="14" y="6" font-family="Liberation Sans, Arial, sans-serif" font-size="6" fill="#000000">AR</text>',
      ].join(''),
      bbox: { x1: -10, y1: -30, x2: 22, y2: 30 },
    },
    terminals: [
      { id: 't1', x: 0, y: -30, orientation: 'n' },
      { id: 't2', x: 0, y: 30, orientation: 's' },
    ],
    state: [{ name: 'open', type: 'boolean', default: false, label: '断开' }],
  },

  // ---- 计量 / 测量 ----
  {
    id: 'energy-meter',
    name: '电能表 (Wh)',
    category: 'measurement',
    description: '有功电能表 (kWh) — 服务入口 / 子表。',
    source: { kind: 'elmt', path: '11_singlepole/500_home_installation/40_meters/wattheuremetre_08-04-03_en60617.elmt' },
  },
  {
    id: 'voltmeter',
    name: '电压表 (V)',
    category: 'measurement',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_08/en_60617_08_02/en_60617_08_02_01.elmt' },
    extraTerminals: [{ id: 't_top', x: 0, y: -40, orientation: 'n' }],
  },
  {
    id: 'ammeter',
    name: '电流表 (A)',
    category: 'measurement',
    source: {
      kind: 'inline',
      svg: [
        '<ellipse cx="0" cy="-20" rx="20" ry="20" fill="none" stroke="black" stroke-width="1"/>',
        '<text x="0" y="-15" text-anchor="middle" font-family="Liberation Sans, Arial, sans-serif" font-size="14">A</text>',
      ].join(''),
      bbox: { x1: -20, y1: -40, x2: 20, y2: 0 },
    },
    terminals: [{ id: 't_top', x: 0, y: -40, orientation: 'n' }],
  },
  {
    id: 'wattmeter',
    name: '功率表 (W)',
    category: 'measurement',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_08/en_60617_08_03/en_60617_08_03_01.elmt' },
    extraTerminals: [{ id: 't_top', x: 0, y: -40, orientation: 'n' }],
  },
  {
    id: 'frequency-meter',
    name: '频率表 (Hz)',
    category: 'measurement',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_08/en_60617_08_02/en_60617_08_02_07.elmt' },
    extraTerminals: [{ id: 't_top', x: 0, y: -40, orientation: 'n' }],
  },

  // ---- 电机控制 ----
  {
    id: 'contactor',
    name: '接触器 (KM)',
    category: 'motor-control',
    description: '主回路接触器, 通常配热继电器和电机使用。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_13/en_60617_07_13_02.elmt' },
    // QET source lists bottom terminal first; force convention t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: 0, y: -40, orientation: 'n' },
      { id: 't2', x: 0, y: 20, orientation: 's' },
    ],
    state: [{ name: 'open', type: 'boolean', default: true, label: '断开' }],
  },
  {
    id: 'motor-starter',
    name: '电机启动器',
    category: 'motor-control',
    description: '电机启动器 (IEC 60617 通用符号)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_14/en_60617_07_14_01.elmt' },
    extraTerminals: [
      { id: 't_top', x: 0, y: -25, orientation: 'n' },
      { id: 't_bottom', x: 0, y: 25, orientation: 's' },
    ],
  },
  {
    id: 'thermal-overload',
    name: '热过载继电器',
    category: 'motor-control',
    description: '电机热过载保护继电器, 通常串接在接触器和电机之间。',
    source: {
      kind: 'inline',
      svg: [
        '<line x1="0" y1="-30" x2="0" y2="-15" stroke="black" stroke-width="1" fill="none"/>',
        '<rect x="-7" y="-15" width="14" height="30" fill="none" stroke="black" stroke-width="1"/>',
        '<polyline points="-4,-10 -1,-5 -4,0 -1,5 -4,10" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="0" y1="15" x2="0" y2="30" stroke="black" stroke-width="1" fill="none"/>',
      ].join(''),
      bbox: { x1: -7, y1: -30, x2: 8, y2: 30 },
    },
    terminals: [
      { id: 't1', x: 0, y: -30, orientation: 'n' },
      { id: 't2', x: 0, y: 30, orientation: 's' },
    ],
    state: [{ name: 'tripped', type: 'boolean', default: false, label: '动作' }],
  },
  {
    id: 'vfd',
    name: '变频器 (VFD)',
    category: 'motor-control',
    description: 'Variable Frequency Drive — 异步电动机调速。',
    source: {
      kind: 'inline',
      svg: [
        '<rect x="-22" y="-20" width="44" height="40" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-22" y1="20" x2="22" y2="-20" stroke="black" stroke-width="1" fill="none"/>',
        '<text x="-15" y="-5" font-family="Liberation Sans, Arial, sans-serif" font-size="9" fill="#000000">~</text>',
        '<text x="6" y="14" font-family="Liberation Sans, Arial, sans-serif" font-size="9" fill="#000000">~f</text>',
        '<line x1="0" y1="-40" x2="0" y2="-20" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="0" y1="20" x2="0" y2="40" stroke="black" stroke-width="1" fill="none"/>',
      ].join(''),
      bbox: { x1: -22, y1: -40, x2: 22, y2: 40 },
    },
    terminals: [
      { id: 't_in', x: 0, y: -40, orientation: 'n' },
      { id: 't_out', x: 0, y: 40, orientation: 's' },
    ],
  },
  {
    id: 'soft-starter',
    name: '软启动器',
    category: 'motor-control',
    description: '电机软启动器 (晶闸管降压启动)。',
    source: {
      kind: 'inline',
      svg: [
        '<rect x="-20" y="-20" width="40" height="40" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-12" y1="-12" x2="12" y2="12" stroke="black" stroke-width="1" fill="none"/>',
        '<polygon points="4,8 12,12 8,4" fill="none" stroke="black" stroke-width="1"/>',
        '<text x="-12" y="-2" font-family="Liberation Sans, Arial, sans-serif" font-size="6" fill="#000000">SS</text>',
        '<line x1="0" y1="-40" x2="0" y2="-20" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="0" y1="20" x2="0" y2="40" stroke="black" stroke-width="1" fill="none"/>',
      ].join(''),
      bbox: { x1: -20, y1: -40, x2: 20, y2: 40 },
    },
    terminals: [
      { id: 't_in', x: 0, y: -40, orientation: 'n' },
      { id: 't_out', x: 0, y: 40, orientation: 's' },
    ],
  },

  // ---- 切换 / DC ----
  {
    id: 'transfer-switch',
    name: '切换开关 (ATS)',
    category: 'switching',
    description: '双源切换开关 (Automatic / Manual Transfer Switch)。两个电源输入 + 一个负荷输出, 互锁不并联。',
    source: {
      kind: 'inline',
      svg: [
        '<line x1="-15" y1="-30" x2="-15" y2="-12" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="15" y1="-30" x2="15" y2="-12" stroke="black" stroke-width="1" fill="none"/>',
        '<text x="-25" y="-20" font-family="Liberation Sans, Arial, sans-serif" font-size="6" fill="#000000">N</text>',
        '<text x="19" y="-20" font-family="Liberation Sans, Arial, sans-serif" font-size="6" fill="#000000">E</text>',
        '<circle cx="-15" cy="-10" r="1.5" fill="black"/>',
        '<circle cx="15" cy="-10" r="1.5" fill="black"/>',
        '<circle cx="0" cy="6" r="1.5" fill="black"/>',
        '<line x1="-15" y1="-10" x2="0" y2="6" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="15" y1="-10" x2="0" y2="6" stroke="black" stroke-width="0.6" fill="none" stroke-dasharray="2 1.5"/>',
        '<line x1="0" y1="6" x2="0" y2="30" stroke="black" stroke-width="1" fill="none"/>',
      ].join(''),
      bbox: { x1: -25, y1: -30, x2: 22, y2: 30 },
    },
    terminals: [
      { id: 't_normal', x: -15, y: -30, orientation: 'n' },
      { id: 't_emergency', x: 15, y: -30, orientation: 'n' },
      { id: 't_load', x: 0, y: 30, orientation: 's' },
    ],
    state: [
      { name: 'position', type: 'string', default: 'normal', label: '位置 (normal/emergency/off)' },
    ],
  },
  {
    id: 'dc-disconnector',
    name: '直流隔离开关',
    category: 'switching',
    description: 'DC isolating switch — 光伏组串 / 储能 直流侧隔离。',
    source: {
      kind: 'inline',
      svg: [
        '<line x1="0" y1="-30" x2="0" y2="-12" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="0" y1="0" x2="0" y2="30" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="0" y1="0" x2="-8" y2="-15" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="6" y1="-4" x2="14" y2="-4" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="6" y1="-1" x2="9" y2="-1" stroke="black" stroke-width="0.8" fill="none"/>',
        '<line x1="11" y1="-1" x2="14" y2="-1" stroke="black" stroke-width="0.8" fill="none"/>',
      ].join(''),
      bbox: { x1: -10, y1: -30, x2: 16, y2: 30 },
    },
    terminals: [
      { id: 't1', x: 0, y: -30, orientation: 'n' },
      { id: 't2', x: 0, y: 30, orientation: 's' },
    ],
    state: [{ name: 'open', type: 'boolean', default: false, label: '断开' }],
  },
  {
    id: 'dc-combiner',
    name: '直流汇流箱',
    category: 'renewable',
    description: '光伏组串汇流箱 (4 路输入示例)。',
    source: {
      kind: 'inline',
      svg: [
        '<rect x="-25" y="-15" width="50" height="30" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-18" y1="-30" x2="-18" y2="-15" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="-6" y1="-30" x2="-6" y2="-15" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="6" y1="-30" x2="6" y2="-15" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="18" y1="-30" x2="18" y2="-15" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="0" y1="15" x2="0" y2="30" stroke="black" stroke-width="1" fill="none"/>',
        '<text x="-9" y="5" font-family="Liberation Sans, Arial, sans-serif" font-size="7" fill="#000000">DC</text>',
      ].join(''),
      bbox: { x1: -25, y1: -30, x2: 25, y2: 30 },
    },
    terminals: [
      { id: 't_s1', x: -18, y: -30, orientation: 'n' },
      { id: 't_s2', x: -6, y: -30, orientation: 'n' },
      { id: 't_s3', x: 6, y: -30, orientation: 'n' },
      { id: 't_s4', x: 18, y: -30, orientation: 'n' },
      { id: 't_dc', x: 0, y: 30, orientation: 's' },
    ],
  },

  // ---- 充电 ----
  {
    id: 'ev-charger',
    name: 'EV 充电桩',
    category: 'load',
    description: '电动汽车充电站 / 充电桩。',
    source: {
      kind: 'inline',
      svg: [
        '<line x1="0" y1="-25" x2="0" y2="-15" stroke="black" stroke-width="1" fill="none"/>',
        '<rect x="-15" y="-15" width="30" height="35" fill="none" stroke="black" stroke-width="1"/>',
        '<rect x="-9" y="-8" width="14" height="6" fill="none" stroke="black" stroke-width="0.8"/>',
        '<rect x="5" y="-7" width="2" height="4" fill="black"/>',
        '<text x="-9" y="13" font-family="Liberation Sans, Arial, sans-serif" font-size="7" fill="#000000">EV</text>',
      ].join(''),
      bbox: { x1: -15, y1: -25, x2: 15, y2: 20 },
    },
    terminals: [{ id: 't_top', x: 0, y: -25, orientation: 'n' }],
  },

  // ---- 无源元件 / 电力电子 ----
  {
    id: 'resistor',
    name: '电阻 (R)',
    category: 'passive',
    description: '通用电阻 / 限流 / 制动电阻。',
    source: { kind: 'elmt', path: '11_singlepole/395_electronics_semiconductors/10_resistors/resistance.elmt' },
    extraTerminals: [{ id: 't2', x: 0, y: 10, orientation: 's' }],
    params: [
      { name: 'R', label: '阻值', type: 'number', unit: 'Ω', showOnCanvas: true },
      { name: 'P', label: '额定功率', type: 'number', unit: 'W' },
    ],
    label: { x: 6, y: 0, anchor: 'start' },
  },
  {
    id: 'capacitor',
    name: '电容 (C)',
    category: 'passive',
    description: '通用 / 滤波 / 直流母线电容。无功补偿请用并联电容器。',
    source: { kind: 'elmt', path: '11_singlepole/395_electronics_semiconductors/20_capacitors/capacite.elmt' },
    extraTerminals: [{ id: 't_bottom', x: 0, y: 2, orientation: 's' }],
    params: [
      { name: 'C', label: '容值', type: 'number', unit: 'μF', showOnCanvas: true },
      { name: 'Un', label: '额定电压', type: 'number', unit: 'V' },
    ],
  },
  {
    id: 'diode',
    name: '二极管 (D)',
    category: 'passive',
    description: '整流 / 续流 / 保护二极管。t1=阳极(上), t2=阴极(下)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_05/en_60617_05_03/en_60617_05_03_01.elmt' },
    // QET lists the cathode (bottom) terminal first; force t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: 0, y: -40, orientation: 'n' },
      { id: 't2', x: 0, y: 0, orientation: 's' },
    ],
    label: { x: 6, y: -20, anchor: 'start' },
  },

  // ---- 控制 / 信号 ----
  {
    id: 'indicator-light',
    name: '指示灯 (HL)',
    category: 'control',
    description: '信号 / 状态指示灯。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_08/en_60617_08_10/en_60617_08_10_01.elmt' },
    // QET lamp ships no terminals; it's a circle (cx0, cy-10, r10) — wire top/bottom.
    terminals: [
      { id: 't1', x: 0, y: -20, orientation: 'n' },
      { id: 't2', x: 0, y: 0, orientation: 's' },
    ],
    params: [{ name: 'color', label: '颜色', type: 'string' }],
  },
  {
    id: 'push-button',
    name: '按钮 (SB)',
    category: 'control',
    description: '手动按钮, 自动复位 (常开 make)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_07/en_60617_07_07_02.elmt' },
    // QET lists the bottom terminal first; force convention t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: 0, y: -40, orientation: 'n' },
      { id: 't2', x: 0, y: 20, orientation: 's' },
    ],
  },
  {
    id: 'relay-coil',
    name: '继电器线圈 (KA)',
    category: 'control',
    description: '继电器 / 接触器操作线圈 (方框)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_15/en_60617_07_15_01.elmt' },
    // QET lists the bottom terminal first; force convention t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: 0, y: -20, orientation: 'n' },
      { id: 't2', x: 0, y: 20, orientation: 's' },
    ],
  },
  {
    id: 'make-contact',
    name: '常开触点 (NO)',
    category: 'control',
    description: '常开辅助触点 (make contact)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_02/en_60617_07_02_01.elmt' },
    state: [{ name: 'closed', type: 'boolean', default: false, label: '闭合' }],
  },
  {
    id: 'break-contact',
    name: '常闭触点 (NC)',
    category: 'control',
    description: '常闭辅助触点 (break contact)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_02/en_60617_07_02_03.elmt' },
    state: [{ name: 'open', type: 'boolean', default: false, label: '断开' }],
  },
  {
    id: 'bell',
    name: '电铃 (HA)',
    category: 'control',
    description: '信号电铃 / 警铃。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_08/en_60617_08_10/en_60617_08_10_06.elmt' },
  },

  // ---- 接线 ----
  {
    id: 'terminal',
    name: '接线端子 / 节点 (X)',
    category: 'busbar',
    description: '接线端子 / 接线盒 / 汇接节点。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_03/en_60617_03_02/en_60617_03_02_02.elmt' },
    // QET terminal is a small filled dot (r2.5); expose 4 cardinal attach points.
    terminals: [
      { id: 't_top', x: 0, y: -2.5, orientation: 'n' },
      { id: 't_bottom', x: 0, y: 2.5, orientation: 's' },
      { id: 't_left', x: -2.5, y: 0, orientation: 'w' },
      { id: 't_right', x: 2.5, y: 0, orientation: 'e' },
    ],
  },

  // ---- 开关 (补充) ----
  {
    id: 'fuse-switch-disconnector',
    name: '熔断器式隔离开关',
    category: 'switching',
    description: '负荷型熔断器隔离开关 (on-load fuse switch-disconnector)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_21/en_60617_07_21_09.elmt' },
    state: [{ name: 'open', type: 'boolean', default: false, label: '断开' }],
  },

  // ---- 负荷 (补充) ----
  {
    id: 'socket-outlet',
    name: '插座 / 连接器',
    category: 'load',
    description: '电源插座 / 多极连接器。',
    source: { kind: 'elmt', path: '11_singlepole/140_connectors_plugs/prise_multipolaire_2.elmt' },
  },

  // ======================================================================
  // Tier A — 配电 SLD 常用
  // ======================================================================
  {
    id: 'inductor',
    name: '电感 (L)',
    category: 'passive',
    description: '通用电感 / 线圈 / 扼流圈。',
    source: { kind: 'elmt', path: '11_singlepole/395_electronics_semiconductors/30_inductors/inductance.elmt' },
    // QET lists top terminal first (t1=top n, t2=bottom s) — convention OK.
    params: [
      { name: 'L', label: '电感量', type: 'number', unit: 'mH', showOnCanvas: true },
      { name: 'In', label: '额定电流', type: 'number', unit: 'A' },
    ],
    label: { x: 6, y: 0, anchor: 'start' },
  },
  {
    id: 'voltage-regulator',
    name: '调压器 (T)',
    category: 'transformer',
    description: '可调感应调压器 / 自耦调压器。',
    source: { kind: 'elmt', path: '11_singlepole/340_converters_inverters/10_converters/regulator_ind_3f_1.elmt' },
    // QET lists top terminal first (t1=top n, t2=bottom s) — convention OK.
    params: [
      { name: 'ratio', label: '调压范围', type: 'string', showOnCanvas: true },
    ],
  },
  {
    id: 'dc-motor',
    name: '直流电机 (M)',
    category: 'load',
    description: '直流电动机 (串励通用符号)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_06/en_60617_06_05/en_60617_06_05_01.elmt' },
    // QET draws both leads at the top of the machine circle.
    textFontSize: 14,
  },
  {
    id: 'heater',
    name: '电加热器 (EH)',
    category: 'load',
    description: '电阻加热元件 / 电热负荷。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_04/en_60617_04_01/en_60617_04_01_12.elmt' },
    // Horizontal element: t1=left (w), t2=right (e).
    params: [
      { name: 'P', label: '功率', type: 'number', unit: 'kW', showOnCanvas: true },
    ],
  },
  {
    id: 'selector-switch',
    name: '选择开关 (SA)',
    category: 'switching',
    description: '转换 / 选择开关 (旋转操作, 保位)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_07/en_60617_07_07_04.elmt' },
    // QET lists top terminal first (t1=top n, t2=bottom s) — convention OK.
    state: [{ name: 'open', type: 'boolean', default: false, label: '断开' }],
  },

  // ======================================================================
  // Tier B — 工业控制 / 仪表
  // ======================================================================
  {
    id: 'limit-switch',
    name: '限位开关 (SQ)',
    category: 'control',
    description: '行程 / 位置开关 (常开, 机械操作)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_08/en_60617_07_08_01.elmt' },
    // QET lists top terminal first (t1=top n, t2=bottom s) — convention OK.
    state: [{ name: 'closed', type: 'boolean', default: false, label: '闭合' }],
  },
  {
    id: 'proximity-switch',
    name: '接近开关 (SQ)',
    category: 'control',
    description: '接近传感器 / 无触点接近开关。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_19/en_60617_07_19_01.elmt' },
    // QET lists top terminal first (t1=top n, t2=bottom s) — convention OK.
  },
  {
    id: 'time-relay',
    name: '时间继电器 (KT)',
    category: 'control',
    description: '延时 (缓动) 继电器线圈。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_15/en_60617_07_15_08.elmt' },
    // QET lists the bottom terminal first; force convention t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: 0, y: -20, orientation: 'n' },
      { id: 't2', x: 0, y: 20, orientation: 's' },
    ],
  },
  {
    id: 'buzzer',
    name: '蜂鸣器 (HA)',
    category: 'control',
    description: '信号蜂鸣器。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_08/en_60617_08_10/en_60617_08_10_10.elmt' },
  },
  {
    id: 'siren',
    name: '警笛 (HA)',
    category: 'control',
    description: '声响警笛 / 报警器。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_08/en_60617_08_10/en_60617_08_10_09.elmt' },
  },
  {
    id: 'thermocouple',
    name: '热电偶 (BT)',
    category: 'measurement',
    description: '热电偶温度传感器。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_08/en_60617_08_06/en_60617_08_06_01.elmt' },
    // QET draws both leads at the top; keep its natural two top terminals.
  },

  // ======================================================================
  // Tier C — 电力电子器件
  // ======================================================================
  {
    id: 'thyristor',
    name: '晶闸管 (V)',
    category: 'passive',
    description: '反向阻断三极晶闸管 / SCR。t1=阳极(上), t2=阴极(下)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_05/en_60617_05_04/en_60617_05_04_06.elmt' },
    // QET lists anode (top) first (t1=top n, t2=bottom s) — convention OK.
    label: { x: 6, y: -20, anchor: 'start' },
  },
  {
    id: 'triac',
    name: '双向晶闸管 (V)',
    category: 'passive',
    description: '双向三极晶闸管 (TRIAC)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_05/en_60617_05_04/en_60617_05_04_11.elmt' },
    // QET lists top terminal first (t1=top n, t2=bottom s) — convention OK.
    label: { x: 6, y: -20, anchor: 'start' },
  },
  {
    id: 'zener-diode',
    name: '稳压二极管 (D)',
    category: 'passive',
    description: '齐纳 / 稳压二极管。t1=阳极(上), t2=阴极(下)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_05/en_60617_05_03/en_60617_05_03_06.elmt' },
    // QET lists the cathode (bottom) terminal first; force t1=top, t2=bottom.
    terminals: [
      { id: 't1', x: 0, y: -40, orientation: 'n' },
      { id: 't2', x: 0, y: 0, orientation: 's' },
    ],
    label: { x: 6, y: -20, anchor: 'start' },
  },
  {
    id: 'igbt',
    name: '绝缘栅双极晶体管 (IGBT)',
    category: 'passive',
    description: 'N 沟道增强型 IGBT。t1=集电极(上), t2=发射极(下), t_g=门极。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_05/en_60617_05_05/en_60617_05_05_19.elmt' },
    // QET symbol has no terminals; add collector (top-right), emitter
    // (bottom-right) and gate (left) at the symbol's lead endpoints.
    extraTerminals: [
      { id: 't1', x: 20, y: -30, orientation: 'n' },
      { id: 't2', x: 20, y: 40, orientation: 's' },
      { id: 't_g', x: -30, y: 20, orientation: 'w' },
    ],
  },

  // ======================================================================
  // Tier D — 无标准 IEC 符号 → 内联标注方框
  // ======================================================================
  {
    id: 'plc',
    name: 'PLC / 控制器',
    category: 'control',
    description: '可编程逻辑控制器 (PLC)。',
    source: {
      kind: 'inline',
      svg: [
        '<rect x="-22" y="-22" width="44" height="44" fill="none" stroke="black" stroke-width="1"/>',
        '<text x="0" y="4" text-anchor="middle" font-family="Liberation Sans, Arial, sans-serif" font-size="11" fill="#000000">PLC</text>',
        '<line x1="0" y1="-40" x2="0" y2="-22" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="0" y1="22" x2="0" y2="40" stroke="black" stroke-width="1" fill="none"/>',
      ].join(''),
      bbox: { x1: -22, y1: -40, x2: 22, y2: 40 },
    },
    terminals: [
      { id: 't_top', x: 0, y: -40, orientation: 'n' },
      { id: 't_bottom', x: 0, y: 40, orientation: 's' },
    ],
  },
  {
    id: 'ups',
    name: '不间断电源 (UPS)',
    category: 'source',
    description: '在线 / 后备式不间断电源。',
    source: {
      kind: 'inline',
      svg: [
        '<rect x="-24" y="-20" width="48" height="40" fill="none" stroke="black" stroke-width="1"/>',
        '<text x="0" y="4" text-anchor="middle" font-family="Liberation Sans, Arial, sans-serif" font-size="11" fill="#000000">UPS</text>',
        '<line x1="0" y1="-40" x2="0" y2="-20" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="0" y1="20" x2="0" y2="40" stroke="black" stroke-width="1" fill="none"/>',
      ].join(''),
      bbox: { x1: -24, y1: -40, x2: 24, y2: 40 },
    },
    terminals: [
      { id: 't_in', x: 0, y: -40, orientation: 'n' },
      { id: 't_out', x: 0, y: 40, orientation: 's' },
    ],
    params: [{ name: 'S', label: '容量', type: 'number', unit: 'kVA' }],
  },
  {
    id: 'power-supply',
    name: '开关电源 (PS)',
    category: 'source',
    description: 'AC→DC 开关电源 / 直流电源模块。t_ac 上(~), t_dc 下(=)。',
    source: {
      kind: 'inline',
      svg: [
        '<rect x="-22" y="-20" width="44" height="40" fill="none" stroke="black" stroke-width="1"/>',
        '<line x1="-22" y1="20" x2="22" y2="-20" stroke="black" stroke-width="1" fill="none"/>',
        '<text x="-15" y="-5" font-family="Liberation Sans, Arial, sans-serif" font-size="9" fill="#000000">~</text>',
        '<text x="8" y="15" font-family="Liberation Sans, Arial, sans-serif" font-size="9" fill="#000000">=</text>',
        '<line x1="0" y1="-40" x2="0" y2="-20" stroke="black" stroke-width="1" fill="none"/>',
        '<line x1="0" y1="20" x2="0" y2="40" stroke="black" stroke-width="1" fill="none"/>',
      ].join(''),
      bbox: { x1: -22, y1: -40, x2: 22, y2: 40 },
    },
    terminals: [
      { id: 't_ac', x: 0, y: -40, orientation: 'n' },
      { id: 't_dc', x: 0, y: 40, orientation: 's' },
    ],
    params: [{ name: 'Vdc', label: '输出电压', type: 'number', unit: 'V', showOnCanvas: true }],
  },
  {
    id: 'genset',
    name: '发电机组 (G)',
    category: 'source',
    description: '柴油 / 燃气发电机组。',
    source: {
      kind: 'inline',
      svg: [
        '<rect x="-26" y="-20" width="52" height="40" fill="none" stroke="black" stroke-width="1"/>',
        '<text x="0" y="4" text-anchor="middle" font-family="Liberation Sans, Arial, sans-serif" font-size="11" fill="#000000">GEN</text>',
        '<line x1="0" y1="20" x2="0" y2="40" stroke="black" stroke-width="1" fill="none"/>',
      ].join(''),
      bbox: { x1: -26, y1: -20, x2: 26, y2: 40 },
    },
    terminals: [
      { id: 't_out', x: 0, y: 40, orientation: 's' },
    ],
    params: [{ name: 'P', label: '功率', type: 'number', unit: 'kW', showOnCanvas: true }],
  },

  // ---- 保护继电器 / 仪表 (补充) ----
  // IEC "function box" symbols — glyph drawn inside, ship with 0 terminals.
  // Each gets a single top-center input terminal `t_top` (orientation 'n'),
  // matching voltmeter/ammeter. The `t_top` y/x are filled from the generated
  // viewBox top-center after a first build.
  {
    id: 'protective-relay',
    name: '保护继电器',
    category: 'protection',
    description: '测量继电器 / 保护继电器通用符号 (IEC 60617)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_16/en_60617_07_16_01.elmt' },
    extraTerminals: [{ id: 't_top', x: 0, y: -40, orientation: 'n' }],
  },
  {
    id: 'overcurrent-relay',
    name: '过流继电器 (50/51)',
    category: 'protection',
    description: '过电流保护继电器 (ANSI 50/51)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_17/en_60617_07_17_05.elmt' },
    extraTerminals: [{ id: 't_top', x: -30, y: -60, orientation: 'n' }],
  },
  {
    id: 'undervoltage-relay',
    name: '欠压继电器 (27)',
    category: 'protection',
    description: '欠电压保护继电器 (ANSI 27)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_17/en_60617_07_17_07.elmt' },
    extraTerminals: [{ id: 't_top', x: -30, y: -80, orientation: 'n' }],
  },
  {
    id: 'reverse-power-relay',
    name: '逆功率继电器 (32)',
    category: 'protection',
    description: '逆功率 / 逆流保护继电器 (ANSI 32)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_17/en_60617_07_17_02.elmt' },
    extraTerminals: [{ id: 't_top', x: -30, y: -40, orientation: 'n' }],
  },
  {
    id: 'distance-relay',
    name: '距离继电器 (21)',
    category: 'protection',
    description: '距离 / 低阻抗保护继电器 (ANSI 21)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_17/en_60617_07_17_09.elmt' },
    extraTerminals: [{ id: 't_top', x: -30, y: -40, orientation: 'n' }],
  },
  {
    id: 'phase-failure-relay',
    name: '断相继电器',
    category: 'protection',
    description: '断相 / 缺相保护继电器。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_17/en_60617_07_17_12.elmt' },
    extraTerminals: [{ id: 't_top', x: -30, y: -40, orientation: 'n' }],
  },
  {
    id: 'buchholz-relay',
    name: '瓦斯继电器 (63)',
    category: 'protection',
    description: '瓦斯 / 气体继电器 (Buchholz, ANSI 63)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_07/en_60617_07_18/en_60617_07_18_01.elmt' },
    extraTerminals: [{ id: 't_top', x: 0, y: -60, orientation: 'n' }],
  },
  {
    id: 'power-factor-meter',
    name: '功率因数表 (cosφ)',
    category: 'measurement',
    description: '功率因数表 (cosφ)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_08/en_60617_08_02/en_60617_08_02_05.elmt' },
    extraTerminals: [{ id: 't_top', x: 0, y: -40, orientation: 'n' }],
  },
  {
    id: 'synchronoscope',
    name: '同步表',
    category: 'measurement',
    description: '同步指示器 / 同步表。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_08/en_60617_08_02/en_60617_08_02_08.elmt' },
    extraTerminals: [{ id: 't_top', x: 0, y: -40, orientation: 'n' }],
  },
  {
    id: 'varmeter',
    name: '无功功率表 (var)',
    category: 'measurement',
    description: '无功功率表 (var)。',
    source: { kind: 'elmt', path: '91_en_60617/en_60617_08/en_60617_08_02/en_60617_08_02_04.elmt' },
    extraTerminals: [{ id: 't_top', x: 0, y: -40, orientation: 'n' }],
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

// QET stores `.elmt` text already XML-escaped (e.g. `U &lt;` for "U <"); the
// flat attribute parser reads it verbatim, so decode entities back to real
// characters before escapeXml re-encodes them — otherwise `&lt;` would round
// out as `&amp;lt;` and render as literal "&lt;" on the canvas (affects the
// IEC relay function glyphs: U<, Z<, m<3, etc.).
function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&');
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
      return `<text x="${num(a.x)}" y="${num(ySvg)}" font-family="Liberation Sans, Arial, sans-serif" font-size="${fontSize}" fill="${color}"${transform}>${escapeXml(decodeXmlEntities(a.text || ''))}</text>`;
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
  const transform = entry.transformPrimitive || ((p) => p);
  const visualPrims = parsed.primitives
    .filter((p) => p.tag !== 'terminal' && !dropPredicate(p))
    .map(transform);
  const terminalPrims = parsed.primitives.filter((p) => p.tag === 'terminal');

  let bbox = null;
  for (const p of visualPrims) bbox = unionBBox(bbox, primitiveBBox(p));
  if (!bbox) bbox = { x1: -10, y1: -10, x2: 10, y2: 10 };

  const terminalsFromElmt = terminalPrims.map((p, i) => ({
    id: `t${i + 1}`,
    ...extractTerminal(p),
  }));
  const terminals = entry.terminals
    ? entry.terminals
    : [...terminalsFromElmt, ...(entry.extraTerminals || [])];

  // Split QET pin-number glyphs (pure-digit <text> sitting on a terminal,
  // e.g. the breaker's "1"/"2") out of the main artwork into
  // `terminalLabelsSvg`: the canvas reveals them only while wiring or when
  // the element is selected, and exports omit them entirely. Machine glyphs
  // like the motor's "M 3~" digits are far from any terminal and stay put.
  // Note: they still count toward the bbox above so the viewBox (and thus
  // hit rect / anchors) is independent of this split.
  const isTerminalNumber = (p) =>
    p.tag === 'text' &&
    /^\d+$/.test((p.attrs.text || '').trim()) &&
    terminals.some(
      (t) => Math.hypot(+p.attrs.x - t.x, +p.attrs.y - t.y) <= TERMINAL_LABEL_RADIUS,
    );
  const toSvg = (prims) => {
    let body = prims.map(primitiveToSvg).filter(Boolean).join('');
    // Post-process: rewrite all <text font-size="..."> in the output. Used for
    // visibility tweaks where we want bigger glyphs without recomputing the
    // QET-derived y baseline (the text label still lives at QET's intended
    // position; only the rendered glyph height grows).
    if (entry.textFontSize !== undefined) {
      body = body.replace(
        /font-size="\d+(?:\.\d+)?"/g,
        `font-size="${entry.textFontSize}"`,
      );
    }
    return body;
  };
  const svgBody = toSvg(visualPrims.filter((p) => !isTerminalNumber(p)));
  const terminalLabelsSvg = toSvg(visualPrims.filter(isTerminalNumber));

  return finalize(entry, {
    svgBody,
    terminalLabelsSvg,
    bbox,
    terminals,
    sourceMeta: {
      kind: 'elmt',
      path: entry.source.path,
      qetEnglishName: parsed.names.en,
    },
  });
}

function finalize(entry, { svgBody, terminalLabelsSvg, bbox, terminals, sourceMeta }) {
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

  // Declarative import transform: some QET sources are drawn flipped/rotated
  // relative to this library's convention. `entry.transform` re-orients the
  // graphic AND terminals together about the viewBox centre (which preserves
  // the viewBox), so a one-line `transform: { flipV: true }` fixes a symbol at
  // build time instead of hand-editing coordinates. See `applyTransform`.
  ({ svgBody, terminalLabelsSvg, terminals } = applyTransform(
    entry.transform,
    svgBody,
    terminalLabelsSvg,
    terminals,
    vb,
  ));

  // Drop optional fields when absent so JSON keys stay stable across builds.
  const out = {
    id: entry.id,
    name: entry.name,
    category: entry.category,
  };
  if (entry.description !== undefined) out.description = entry.description;
  out.viewBox = `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
  out.width = vb.w;
  out.height = vb.h;
  out.svg = svgBody;
  if (terminalLabelsSvg) out.terminalLabelsSvg = terminalLabelsSvg;
  out.terminals = terminals;
  if (entry.stretchable) out.stretchable = entry.stretchable;
  if (entry.state) out.state = entry.state;
  if (entry.params) out.params = entry.params;
  if (entry.label) out.label = entry.label;
  out.source = sourceMeta;
  return out;
}

/**
 * Apply a declarative import transform to a symbol's graphic + terminals about
 * its viewBox centre. Centre-symmetric ops (flipV / flipH / rotate180) map the
 * viewBox onto itself, so the viewBox is unchanged. The graphic is flipped via
 * a wrapping group matrix (no per-coordinate rewrite); terminals are remapped
 * with matching orientation swaps. Note: a flip mirrors any `<text>` inside the
 * graphic — fine for the current symbols (which have none under a transform).
 */
function applyTransform(tf, svgBody, terminalLabelsSvg, terminals, vb) {
  if (!tf) return { svgBody, terminalLabelsSvg, terminals };
  const cx = vb.x + vb.w / 2;
  const cy = vb.y + vb.h / 2;
  const swapNS = (o) => (o === 'n' ? 's' : o === 's' ? 'n' : o);
  const swapEW = (o) => (o === 'e' ? 'w' : o === 'w' ? 'e' : o);

  let matrix, mapXY, mapOrient;
  if (tf.flipV) {
    matrix = `matrix(1 0 0 -1 0 ${2 * cy})`;
    mapXY = (x, y) => [x, 2 * cy - y];
    mapOrient = swapNS;
  } else if (tf.flipH) {
    matrix = `matrix(-1 0 0 1 ${2 * cx} 0)`;
    mapXY = (x, y) => [2 * cx - x, y];
    mapOrient = swapEW;
  } else if (tf.rotate180) {
    matrix = `matrix(-1 0 0 -1 ${2 * cx} ${2 * cy})`;
    mapXY = (x, y) => [2 * cx - x, 2 * cy - y];
    mapOrient = (o) => swapNS(swapEW(o));
  } else {
    throw new Error(
      `Unsupported transform ${JSON.stringify(tf)} (supported: flipV, flipH, rotate180)`,
    );
  }

  return {
    svgBody: `<g transform="${matrix}">${svgBody}</g>`,
    terminalLabelsSvg: terminalLabelsSvg
      ? `<g transform="${matrix}">${terminalLabelsSvg}</g>`
      : terminalLabelsSvg,
    terminals: terminals.map((t) => {
      const [x, y] = mapXY(t.x, t.y);
      return { ...t, x, y, orientation: mapOrient(t.orientation) };
    }),
  };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Wipe any existing per-element JSON so that elements removed from the
  // manifest don't leave stale files behind. Only touches *.json so a user
  // can drop hand-authored sidecar files in this directory if they want.
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  const seenIds = new Set();
  let count = 0;
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

    fs.writeFileSync(
      path.join(OUT_DIR, `${entry.id}.json`),
      JSON.stringify(built, null, 2) + '\n',
    );
    count++;
    console.log(`✓ ${entry.id.padEnd(22)} ${built.viewBox.padEnd(20)} terminals=${built.terminals.length}`);
  }

  console.log(`\nWrote ${count} elements to ${path.relative(ROOT, OUT_DIR)}`);
}

// Only run main() when invoked directly (`node scripts/build-element-library.mjs`).
// Importing this module from a test should be side-effect-free.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}

export { MANIFEST, buildElement };
