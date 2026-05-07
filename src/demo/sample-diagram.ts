import type { DiagramFile } from '../model';

/**
 * 10kV 单母线（一进两出），照搬 docs/data-model.md §11.2 的示例。
 * 没有提供 layout — 完全交给 auto-layout 验证管线。
 *
 * NOTE: kind names use the library JSON IDs from src/element-library/.
 *  - "infinite_bus" → not in library; using "grid-source" (系统电源) instead.
 *  - "load" → "load"
 *  - "bus" → "busbar"
 *  - kebab-case ids match `LibraryEntry.id` exactly.
 */
export const SAMPLE_DIAGRAM: DiagramFile = {
  version: '1',
  meta: { title: '10kV 单母线 — 一进两出' },
  elements: [
    {
      id: 'B1',
      kind: 'busbar',
      name: '10kV-I',
      params: { Un: 10 },
      tap: ['QS_in.t2', 'QF1.t1', 'QF2.t1'],
    },

    { id: 'L_in', kind: 'grid-source', name: '进线' },
    { id: 'QS_in', kind: 'disconnector', name: '01' },

    { id: 'QF1', kind: 'breaker', name: '101' },
    { id: 'QS1', kind: 'disconnector', name: '101-1' },
    { id: 'L1', kind: 'load', name: '馈线1' },

    { id: 'QF2', kind: 'breaker', name: '102' },
    { id: 'QS2', kind: 'disconnector', name: '102-1' },
    { id: 'L2', kind: 'load', name: '馈线2' },
  ],
  connections: [
    ['L_in.t_bottom', 'QS_in.t1'],
    ['QF1.t2', 'QS1.t1'],
    ['QS1.t2', 'L1.t_top'],
    ['QF2.t2', 'QS2.t1'],
    ['QS2.t2', 'L2.t_top'],
  ],
};
