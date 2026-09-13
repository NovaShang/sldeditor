/**
 * Demo-only page for `<OneLineViewer>`: the sample diagram with a handful of
 * bindings, fed by an in-memory `createStaticTagSource` whose values a timer
 * walks through every alarm level, badge, value and quality state. Open the
 * standalone demo at `/#viewer` to see it; nothing here ships in the library.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { OneLineViewer, type OneLineViewerApi } from '../OneLineViewer';
import type { DiagramFile, TagValue } from '../model';
import { createStaticTagSource } from '../runtime/tag-source';
import { SAMPLE_DIAGRAM } from './sample-diagram';

const DIAGRAM: DiagramFile = {
  ...SAMPLE_DIAGRAM,
  tags: [
    { path: 'QF1/health', type: 'enum', enum: ['normal', 'attention', 'abnormal', 'critical'] },
    { path: 'QF1/badge', type: 'string' },
    { path: 'QF1/I', type: 'float', unit: 'A' },
    { path: 'QF2/health', type: 'enum' },
    { path: 'QF2/I', type: 'float', unit: 'A' },
    { path: 'B1/U', type: 'float', unit: 'kV' },
    { path: 'L2/label', type: 'string' },
    { path: 'L1/visible', type: 'bool' },
  ],
  bindings: [
    {
      target: 'QF1',
      prop: 'alarm',
      tag: 'QF1/health',
      mapping: {
        type: 'discrete',
        cases: [
          { when: 'normal', out: 'none' },
          { when: 'attention', out: 'warn' },
          { when: 'abnormal', out: 'alarm' },
          { when: 'critical', out: 'fault' },
        ],
        default: 'none',
      },
    },
    { target: 'QF1', prop: 'badge', tag: 'QF1/badge' },
    { target: 'QF1', prop: 'value', tag: 'QF1/I' },
    {
      target: 'QF2',
      prop: 'alarm',
      tag: 'QF2/health',
      mapping: {
        type: 'discrete',
        cases: [
          { when: 'attention', out: 'warn' },
          { when: 'abnormal', out: 'alarm' },
          { when: 'critical', out: 'fault' },
        ],
        default: 'none',
      },
    },
    { target: 'QF2', prop: 'value', tag: 'QF2/I' },
    { target: 'B1', prop: 'value', tag: 'B1/U' },
    { target: 'L2', prop: 'label.text', tag: 'L2/label' },
    { target: 'L1', prop: 'visible', tag: 'L1/visible' },
  ],
};

/** One frame of the mock feed; the demo loops through these. */
interface Frame {
  name: string;
  values: Record<string, TagValue | string | number | boolean | null>;
}

const FRAMES: Frame[] = [
  {
    name: 'normal',
    values: {
      'QF1/health': 'normal',
      'QF1/badge': '',
      'QF1/I': 128.4,
      'QF2/health': 'normal',
      'QF2/I': 96,
      'B1/U': 10.3,
      'L2/label': '馈线2',
      'L1/visible': true,
    },
  },
  {
    name: 'warn',
    values: { 'QF1/health': 'attention', 'QF1/badge': '过热', 'QF1/I': 231.7 },
  },
  {
    name: 'alarm',
    values: { 'QF1/health': 'abnormal', 'QF1/badge': '局放', 'QF1/I': 318.2, 'QF2/health': 'attention' },
  },
  {
    name: 'fault',
    values: {
      'QF1/health': 'critical',
      'QF1/badge': '火警',
      'QF1/I': 0,
      'QF2/health': 'abnormal',
      'L2/label': '馈线2 (停运)',
    },
  },
  {
    name: 'stale / bad / hidden',
    values: {
      'QF1/health': { v: 'normal', q: 'stale' },
      'QF1/badge': { v: '', q: 'stale' },
      'QF1/I': { v: 128.4, q: 'stale' },
      'QF2/health': { v: 'critical', q: 'bad' },
      'QF2/I': { v: 96, q: 'bad' },
      'L1/visible': false,
    },
  },
];

const STEP_MS = 2000;

export function ViewerDemo() {
  const source = useMemo(() => createStaticTagSource(FRAMES[0].values), []);
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const apiRef = useRef<OneLineViewerApi | null>(null);

  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), STEP_MS);
    return () => window.clearInterval(t);
  }, [paused]);

  useEffect(() => {
    // Frame 0 resets everything; later frames only touch what changes,
    // which is also what a real feed looks like.
    source.setMany(FRAMES[frame].values);
  }, [frame, source]);

  return (
    <div className="relative h-full w-full">
      <OneLineViewer
        diagram={DIAGRAM}
        tags={source}
        selectedIds={selected}
        onElementClick={(id) => setSelected([id])}
        onBackgroundClick={() => setSelected([])}
        onElementHover={setHovered}
        onReady={(api) => {
          apiRef.current = api;
        }}
      />
      <div
        className="ole-glass absolute left-3 top-3 z-20 flex items-center gap-2 rounded-2xl border border-border p-2 text-xs"
        style={{ top: 'calc(0.75rem + var(--ole-safe-top, 0px))' }}
      >
        <a className="px-1 underline" href="#">
          ← editor
        </a>
        <span className="mx-1 h-4 w-px bg-border" />
        <span>
          frame: <b>{FRAMES[frame].name}</b>
        </span>
        <button
          className="rounded border border-border px-2 py-0.5"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? 'play' : 'pause'}
        </button>
        <button
          className="rounded border border-border px-2 py-0.5"
          onClick={() => setFrame((f) => (f + 1) % FRAMES.length)}
        >
          next
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button
          className="rounded border border-border px-2 py-0.5"
          onClick={() => apiRef.current?.fit()}
        >
          fit
        </button>
        <button
          className="rounded border border-border px-2 py-0.5"
          onClick={() => apiRef.current?.focus('QF1')}
        >
          focus QF1
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-muted-foreground">
          selected: {selected.join(', ') || '—'} · hover: {hovered ?? '—'}
        </span>
      </div>
    </div>
  );
}
