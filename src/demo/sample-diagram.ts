import type { DiagramFile } from '../model';
import { wireIdFromEnds } from '../store/id-allocator';

/** Convenience: build a Wire from two endpoints with content-hash id. */
function w(a: string, b: string): { id: string; ends: [string, string] } {
  return { id: wireIdFromEnds(a, b), ends: [a, b] };
}

/**
 * 10kV 单母线（一进两出）。
 * 没有提供 layout — 完全交给 auto-layout 验证管线。
 */
export const SAMPLE_DIAGRAM: DiagramFile = {
  version: '1',
  meta: { title: '10kV 单母线 — 一进两出' },
  elements: [
    { id: 'L_in', kind: 'grid-source', name: '进线' },
    { id: 'QS_in', kind: 'disconnector', name: '01' },

    { id: 'QF1', kind: 'breaker', name: '101' },
    { id: 'QS1', kind: 'disconnector', name: '101-1' },
    { id: 'L1', kind: 'load', name: '馈线1' },

    { id: 'QF2', kind: 'breaker', name: '102' },
    { id: 'QS2', kind: 'disconnector', name: '102-1' },
    { id: 'L2', kind: 'load', name: '馈线2' },
  ],
  buses: [
    {
      id: 'B1',
      name: '10kV-I',
      params: { Un: 10 },
    },
  ],
  wires: [
    w('L_in.t_bottom', 'QS_in.t1'),
    w('B1', 'QS_in.t2'),
    w('B1', 'QF1.t1'),
    w('B1', 'QF2.t1'),
    w('QF1.t2', 'QS1.t1'),
    w('QS1.t2', 'L1.t_top'),
    w('QF2.t2', 'QS2.t1'),
    w('QS2.t2', 'L2.t_top'),
  ],
};
