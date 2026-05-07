/**
 * Translation table for `LibraryEntry` user-facing strings: display name,
 * description, state labels, param labels.
 *
 * Kept separate from the strict `messages.ts` map because keys are derived
 * from runtime data (entry id + field name) and would balloon the typed
 * key union. Falls back to the JSON-defined value when no translation exists.
 *
 * Key shape: `<entryId>.name`, `<entryId>.desc`, `<entryId>.state.<name>`,
 * `<entryId>.param.<name>`.
 */

import { useLocale, type Locale } from './index';

type Table = Record<string, string>;

const zh: Table = {
  // Names — the JSON `name` field is already Chinese, so we only need them
  // here for symmetry / one-stop translation. English is the value-add.
  'arc-suppression-coil.name': '消弧线圈',
  'arrester.name': '避雷器 (FBL)',
  'async-motor.name': '异步电动机',
  'autotransformer.name': '自耦变压器',
  'battery.name': '电池储能',
  'breaker.name': '断路器 (QF)',
  'busbar.name': '母线段',
  'converter-bidir.name': '双向变流器 (PCS)',
  'ct.name': '电流互感器 (CT)',
  'disconnector.name': '隔离开关 (QS)',
  'earth.name': '接地',
  'earthing-switch.name': '接地刀闸 (QE)',
  'fuse.name': '熔断器 (FU)',
  'generator.name': '发电机 (G)',
  'grid-source.name': '系统电源',
  'grounding-transformer.name': '接地变 (Z形)',
  'inverter.name': '逆变器 (DC→AC)',
  'load-switch.name': '负荷开关',
  'load.name': '负荷',
  'ngr.name': '中性点电阻 (NGR)',
  'pt.name': '电压互感器 (PT)',
  'pv.name': '光伏组件',
  'rectifier.name': '整流器 (AC→DC)',
  'series-reactor.name': '串联电抗器',
  'shunt-capacitor.name': '并联电容器',
  'shunt-reactor.name': '并联电抗器',
  'sync-motor.name': '同步电动机',
  'transformer-2w.name': '双绕组变压器',
  'transformer-3w.name': '三绕组变压器',
  'wind-turbine.name': '风力发电机',

  // Descriptions
  'arc-suppression-coil.desc': '中性点谐振接地：电感线圈连接到地',
  'busbar.desc': '可拉伸单母线段，多设备挂接',
  'converter-bidir.desc': '储能变流器：双向 AC ↔ DC',
  'earthing-switch.desc': '隔离开关 + 接地连接，单端口',
  'grid-source.desc': '无穷大母线 / 外部电网',
  'grounding-transformer.desc': '星-曲折接线变压器，中性点接地用',
  'load.desc': '抽象负荷（电流流出箭头）',
  'ngr.desc': '小电阻接地：连接变压器中性点到地',
  'series-reactor.desc': '与并联电抗器同符号；通过用法区分',
  'wind-turbine.desc': '风机：发电机 + 三叶轮标记',

  // State labels
  'breaker.state.open': '断开',
  'disconnector.state.open': '断开',
  'earthing-switch.state.open': '断开',
  'fuse.state.blown': '熔断',
  'load-switch.state.open': '断开',

  // Param labels
  'battery.param.E': '容量',
  'busbar.param.Un': '额定电压',
  'converter-bidir.param.S': '容量',
  'load.param.P': '有功功率',
  'load.param.cosphi': '功率因数',
  'ngr.param.R': '电阻',
  'shunt-capacitor.param.Q': '无功容量',
  'shunt-capacitor.param.stages': '分组数',
  'transformer-2w.param.S': '容量',
  'transformer-2w.param.ratio': '变比',
};

const en: Table = {
  'arc-suppression-coil.name': 'Arc-suppression coil',
  'arrester.name': 'Surge arrester (FBL)',
  'async-motor.name': 'Asynchronous motor',
  'autotransformer.name': 'Autotransformer',
  'battery.name': 'Battery storage',
  'breaker.name': 'Circuit breaker (QF)',
  'busbar.name': 'Busbar segment',
  'converter-bidir.name': 'Bidirectional converter (PCS)',
  'ct.name': 'Current transformer (CT)',
  'disconnector.name': 'Disconnector (QS)',
  'earth.name': 'Earth',
  'earthing-switch.name': 'Earthing switch (QE)',
  'fuse.name': 'Fuse (FU)',
  'generator.name': 'Generator (G)',
  'grid-source.name': 'Grid source',
  'grounding-transformer.name': 'Grounding transformer (zig-zag)',
  'inverter.name': 'Inverter (DC→AC)',
  'load-switch.name': 'Load break switch',
  'load.name': 'Load',
  'ngr.name': 'Neutral grounding resistor (NGR)',
  'pt.name': 'Voltage transformer (PT)',
  'pv.name': 'PV module',
  'rectifier.name': 'Rectifier (AC→DC)',
  'series-reactor.name': 'Series reactor',
  'shunt-capacitor.name': 'Shunt capacitor',
  'shunt-reactor.name': 'Shunt reactor',
  'sync-motor.name': 'Synchronous motor',
  'transformer-2w.name': 'Two-winding transformer',
  'transformer-3w.name': 'Three-winding transformer',
  'wind-turbine.name': 'Wind turbine',

  'arc-suppression-coil.desc': 'Resonant neutral grounding: inductor to earth',
  'busbar.desc': 'Stretchable single-bus segment with multiple taps',
  'converter-bidir.desc': 'Storage converter: bidirectional AC ↔ DC',
  'earthing-switch.desc': 'Disconnector + earth connection, single port',
  'grid-source.desc': 'Infinite bus / external grid',
  'grounding-transformer.desc': 'Wye-zigzag transformer for neutral grounding',
  'load.desc': 'Abstract load (current-out arrow)',
  'ngr.desc': 'Low-resistance grounding: transformer neutral to earth',
  'series-reactor.desc': 'Same symbol as shunt reactor; distinguished by usage',
  'wind-turbine.desc': 'Wind turbine: generator + three-blade rotor mark',

  'breaker.state.open': 'Open',
  'disconnector.state.open': 'Open',
  'earthing-switch.state.open': 'Open',
  'fuse.state.blown': 'Blown',
  'load-switch.state.open': 'Open',

  'battery.param.E': 'Capacity',
  'busbar.param.Un': 'Rated voltage',
  'converter-bidir.param.S': 'Capacity',
  'load.param.P': 'Active power',
  'load.param.cosphi': 'Power factor',
  'ngr.param.R': 'Resistance',
  'shunt-capacitor.param.Q': 'Reactive capacity',
  'shunt-capacitor.param.stages': 'Stages',
  'transformer-2w.param.S': 'Capacity',
  'transformer-2w.param.ratio': 'Ratio',
};

const tables: Record<Locale, Table> = { zh, en };

function lookup(locale: Locale, key: string): string | undefined {
  return tables[locale][key] ?? tables.zh[key];
}

/** Returns a translator that re-renders on locale change. */
export function useLibT(): (key: string, fallback?: string) => string {
  const locale = useLocale((s) => s.locale);
  return (key, fallback) => lookup(locale, key) ?? fallback ?? key;
}
