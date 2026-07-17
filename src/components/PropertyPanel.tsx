/**
 * Right-panel property editor — minimal by design. Shows only what the user
 * needs to *configure* (name, note, kind-specific state). Transformations
 * (rotate/mirror/delete) live on the contextual floating toolbar; type label
 * lives in the panel header.
 */

import { useEffect, useRef, useState } from 'react';
import { libraryById } from '../element-library';
import { useT } from '../i18n';
import { useLibT } from '../i18n/library';
import { useEditorStore } from '../store';
import {
  annotationKind,
  type AnnotationId,
  type Bus,
  type BusId,
  type Element,
  type ElementId,
  type Junction,
  type LibraryParamField,
  type LibraryStateField,
  type LineAnnotation,
  type ParamValue,
  type RectAnnotation,
  type TableAnnotation,
  type TextAnnotation,
  type WireId,
} from '../model';
import {
  makeTableBody,
  TABLE_DEFAULT_CELL_H,
  TABLE_DEFAULT_CELL_W,
} from '../lib/annotation-geom';
import { cn } from '../lib/utils';

export function PropertyPanel() {
  const t = useT();
  const selection = useEditorStore((s) => s.selection);
  const elements = useEditorStore((s) => s.diagram.elements);
  const buses = useEditorStore((s) => s.diagram.buses);
  const junctions = useEditorStore((s) => s.diagram.junctions);
  const selectedNode = useEditorStore((s) => s.selectedNode);
  const selectedWire = useEditorStore((s) => s.selectedWire);
  const selectedAnnotation = useEditorStore((s) => s.selectedAnnotation);

  if (selectedWire) return <WirePanel wireId={selectedWire} />;
  if (selectedNode) return <NodePanel nodeId={selectedNode} />;
  if (selectedAnnotation) return <AnnotationPanel annId={selectedAnnotation} />;

  if (selection.length === 0) {
    return (
      <div className="px-4 py-5 text-center text-xs text-muted-foreground">
        {t('props.empty')}
      </div>
    );
  }

  if (selection.length > 1) {
    return (
      <div className="px-4 py-5 text-center text-xs text-muted-foreground">
        {t('props.multi', { n: selection.length })}
      </div>
    );
  }

  const id = selection[0];
  const bus = (buses ?? []).find((b) => b.id === id);
  if (bus) return <BusInspector bus={bus} />;
  const junction = (junctions ?? []).find((j) => j.id === id);
  if (junction) return <JunctionPanel junction={junction} />;
  const element = elements.find((e) => e.id === id);
  if (!element) return null;
  const lib = libraryById[element.kind];

  return (
    <div className="flex flex-col gap-2.5 overflow-y-auto px-3 py-3 text-xs">
      <TextRow
        label={t('props.name')}
        value={element.name ?? ''}
        placeholder={element.id}
        onCommit={(v) =>
          useEditorStore
            .getState()
            .updateElement(id, { name: v.trim() === '' ? undefined : v.trim() })
        }
      />
      <TextAreaRow
        key={id}
        label={t('props.note')}
        value={element.note ?? ''}
        onCommit={(v) =>
          useEditorStore
            .getState()
            .updateElement(id, { note: v.trim() === '' ? undefined : v.trim() })
        }
      />
      {lib?.state && lib.state.length > 0 && (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
          {lib.state.map((field) => (
            <StateField key={field.name} id={id} element={element} field={field} />
          ))}
        </div>
      )}
      <ParamsSection
        id={id}
        element={element}
        schema={lib?.params ?? []}
      />
    </div>
  );
}

function ParamsSection({
  id,
  element,
  schema,
}: {
  id: ElementId;
  element: Element;
  schema: LibraryParamField[];
}) {
  const schemaKeys = new Set(schema.map((p) => p.name));
  const extras = element.params
    ? Object.entries(element.params).filter(([k]) => !schemaKeys.has(k))
    : [];
  if (schema.length === 0 && extras.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
      {schema.map((field) => (
        <SchemaParamField
          key={field.name}
          id={id}
          element={element}
          field={field}
        />
      ))}
      {extras.map(([key, value]) => (
        <ParamField
          key={key}
          id={id}
          element={element}
          fieldKey={key}
          value={value}
        />
      ))}
    </div>
  );
}

/**
 * Schema-driven param row: uses the library entry's declared label / unit /
 * type / default.
 */
function SchemaParamField({
  id,
  element,
  field,
}: {
  id: ElementId;
  element: Element;
  field: LibraryParamField;
}) {
  const t = useT();
  const libT = useLibT();
  const cur = element.params?.[field.name] ?? field.default;
  const label = libT(`${element.kind}.param.${field.name}`, field.label ?? field.name);
  const onCommit = (next: ParamValue | undefined) => {
    const params = { ...(element.params ?? {}) };
    if (next === undefined || next === field.default) delete params[field.name];
    else params[field.name] = next;
    useEditorStore.getState().updateElement(id, {
      params: Object.keys(params).length > 0 ? params : undefined,
    });
  };

  if (field.type === 'boolean') {
    return (
      <Field label={label}>
        <ToggleButton active={!!cur} onClick={() => onCommit(!cur)}>
          {cur ? t('common.yes') : t('common.no')}
        </ToggleButton>
      </Field>
    );
  }
  if (field.type === 'number') {
    return (
      <NumberRow
        label={label}
        value={typeof cur === 'number' ? cur : 0}
        unit={field.unit}
        onCommit={onCommit}
      />
    );
  }
  return (
    <TextRow
      label={label}
      value={typeof cur === 'string' ? cur : ''}
      unit={field.unit}
      onCommit={(v) => onCommit(v.trim() === '' ? undefined : v)}
    />
  );
}

/**
 * Param row driven purely by the stored value's type (no library schema
 * required). Number/boolean/string are each rendered with the right input;
 * empty strings clear the key so users don't leave dangling `""` values.
 */
function ParamField({
  id,
  element,
  fieldKey,
  value,
}: {
  id: ElementId;
  element: Element;
  fieldKey: string;
  value: ParamValue;
}) {
  const t = useT();
  const onCommit = (next: ParamValue | undefined) => {
    const params = { ...(element.params ?? {}) };
    if (next === undefined) delete params[fieldKey];
    else params[fieldKey] = next;
    useEditorStore.getState().updateElement(id, {
      params: Object.keys(params).length > 0 ? params : undefined,
    });
  };

  if (typeof value === 'boolean') {
    return (
      <Field label={fieldKey}>
        <ToggleButton active={value} onClick={() => onCommit(!value)}>
          {value ? t('common.yes') : t('common.no')}
        </ToggleButton>
      </Field>
    );
  }
  if (typeof value === 'number') {
    return (
      <NumberRow label={fieldKey} value={value} onCommit={onCommit} />
    );
  }
  return (
    <TextRow
      label={fieldKey}
      value={value}
      onCommit={(v) => onCommit(v.trim() === '' ? undefined : v)}
    />
  );
}

// ---------------------------------------------------------------------------
// Bus inspector — selected bus shows name + Un + span (read-only span).
// ---------------------------------------------------------------------------

function BusInspector({ bus }: { bus: Bus }) {
  const t = useT();
  const id = bus.id;
  const onName = (v: string) => {
    const name = v.trim();
    updateBusEntry(id, { name: name === '' ? undefined : name });
  };
  return (
    <div className="flex flex-col gap-2.5 overflow-y-auto px-3 py-3 text-xs">
      <TextRow
        label={t('props.name')}
        value={bus.name ?? ''}
        placeholder={bus.id}
        onCommit={onName}
      />
      <TextAreaRow
        key={id}
        label={t('props.note')}
        value={bus.note ?? ''}
        onCommit={(v) =>
          updateBusEntry(id, { note: v.trim() === '' ? undefined : v.trim() })
        }
      />
      <BusParams bus={bus} />
    </div>
  );
}

function BusParams({ bus }: { bus: Bus }) {
  const onCommit = (key: string, next: ParamValue | undefined) => {
    const params = { ...(bus.params ?? {}) };
    if (next === undefined || next === '') delete params[key];
    else params[key] = next;
    updateBusEntry(bus.id, {
      params: Object.keys(params).length > 0 ? params : undefined,
    });
  };
  const cur = bus.params ?? {};
  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
      <NumberRow
        label="Un"
        value={typeof cur.Un === 'number' ? cur.Un : 0}
        unit="kV"
        onCommit={(v) => onCommit('Un', v)}
      />
    </div>
  );
}

function updateBusEntry(id: BusId, patch: Partial<Bus>) {
  useEditorStore.getState().dispatch((d) => {
    const buses = (d.buses ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b));
    return { ...d, buses };
  });
}

// ---------------------------------------------------------------------------
// Annotation inspector — per-type controls for text / rect / line / table.
// ---------------------------------------------------------------------------

function AnnotationPanel({ annId }: { annId: AnnotationId }) {
  const t = useT();
  const ann = useEditorStore((s) =>
    (s.diagram.annotations ?? []).find((a) => a.id === annId),
  );
  if (!ann) {
    return (
      <div className="px-4 py-5 text-center text-xs text-muted-foreground">
        {t('props.annNotFound', { id: annId })}
      </div>
    );
  }
  const patch = (p: Record<string, unknown>) =>
    useEditorStore.getState().updateAnnotation(annId, p);

  switch (annotationKind(ann)) {
    case 'rect': {
      const r = ann as RectAnnotation;
      return (
        <div className="flex flex-col gap-2.5 px-3 py-3 text-xs">
          <TextRow
            label={t('props.annLabel')}
            value={r.label ?? ''}
            placeholder={t('props.annLabelPlaceholder')}
            onCommit={(v) =>
              patch({ label: v.trim() === '' ? undefined : v.trim() })
            }
          />
          <SegRow
            label={t('props.annStroke')}
            value={r.stroke ?? 'dashed'}
            options={[
              { value: 'solid', label: t('props.annStrokeSolid') },
              { value: 'dashed', label: t('props.annStrokeDashed') },
            ]}
            onChange={(v) => patch({ stroke: v })}
          />
          <SegRow
            label={t('props.annFill')}
            value={r.fill ?? 'none'}
            options={[
              { value: 'none', label: t('props.annFillNone') },
              { value: 'tint', label: t('props.annFillTint') },
            ]}
            onChange={(v) => patch({ fill: v === 'none' ? undefined : v })}
          />
        </div>
      );
    }
    case 'line': {
      const l = ann as LineAnnotation;
      return (
        <div className="flex flex-col gap-2.5 px-3 py-3 text-xs">
          <SegRow
            label={t('props.annStroke')}
            value={l.stroke ?? 'solid'}
            options={[
              { value: 'solid', label: t('props.annStrokeSolid') },
              { value: 'dashed', label: t('props.annStrokeDashed') },
            ]}
            onChange={(v) => patch({ stroke: v })}
          />
          <SegRow
            label={t('props.annArrow')}
            value={l.arrow ?? 'none'}
            options={[
              { value: 'none', label: t('props.annArrowNone') },
              { value: 'end', label: t('props.annArrowEnd') },
              { value: 'both', label: t('props.annArrowBoth') },
            ]}
            onChange={(v) => patch({ arrow: v === 'none' ? undefined : v })}
          />
        </div>
      );
    }
    case 'table': {
      const tb = ann as TableAnnotation;
      return (
        <div className="flex flex-col gap-2.5 px-3 py-3 text-xs">
          <StepperRow
            label={t('props.annRows')}
            value={tb.rowHeights.length}
            min={1}
            onChange={(n) => patch(resizeTableRows(tb, n))}
          />
          <StepperRow
            label={t('props.annCols')}
            value={tb.colWidths.length}
            min={1}
            onChange={(n) => patch(resizeTableCols(tb, n))}
          />
          <FontSizeRow
            label={t('props.annFontSize')}
            value={tb.fontSize}
            onCommit={(fs) => patch({ fontSize: fs })}
          />
        </div>
      );
    }
    default: {
      const tx = ann as TextAnnotation;
      return (
        <div className="flex flex-col gap-2.5 px-3 py-3 text-xs">
          <FontSizeRow
            label={t('props.annFontSize')}
            value={tx.fontSize}
            onCommit={(fs) => patch({ fontSize: fs })}
          />
        </div>
      );
    }
  }
}

/** Grow/shrink table rows from the end, preserving existing cell content. */
function resizeTableRows(
  tb: TableAnnotation,
  n: number,
): Pick<TableAnnotation, 'rowHeights' | 'cells'> {
  const cols = tb.colWidths.length;
  const lastH = tb.rowHeights[tb.rowHeights.length - 1] ?? TABLE_DEFAULT_CELL_H;
  const rowHeights = tb.rowHeights.slice(0, n);
  while (rowHeights.length < n) rowHeights.push(lastH);
  const cells = tb.cells.slice(0, n).map((r) => [...r]);
  while (cells.length < n) cells.push(makeTableBody(cols, 1).cells[0]);
  return { rowHeights, cells };
}

/** Grow/shrink table columns from the end, preserving existing content. */
function resizeTableCols(
  tb: TableAnnotation,
  n: number,
): Pick<TableAnnotation, 'colWidths' | 'cells'> {
  const lastW = tb.colWidths[tb.colWidths.length - 1] ?? TABLE_DEFAULT_CELL_W;
  const colWidths = tb.colWidths.slice(0, n);
  while (colWidths.length < n) colWidths.push(lastW);
  const cells = tb.cells.map((row) => {
    const next = row.slice(0, n);
    while (next.length < n) next.push('');
    return next;
  });
  return { colWidths, cells };
}

/** Segmented single-choice control (2–3 options). */
function SegRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex overflow-hidden rounded-md border border-border/60">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-7 flex-1 truncate px-1.5 text-[11px] transition-colors',
              value === o.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

/** Integer stepper with − / + buttons (rows/cols count). */
function StepperRow({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`${label} −`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className="h-7 w-7 rounded-md border border-border/60 text-[13px] leading-none text-muted-foreground hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
        >
          −
        </button>
        <span className="w-8 text-center font-mono text-[11px] tabular-nums">
          {value}
        </span>
        <button
          type="button"
          aria-label={`${label} +`}
          onClick={() => onChange(value + 1)}
          className="h-7 w-7 rounded-md border border-border/60 text-[13px] leading-none text-muted-foreground hover:bg-accent"
        >
          +
        </button>
      </div>
    </Field>
  );
}

const FONT_SIZE_MIN = 5;
const FONT_SIZE_MAX = 32;
const FONT_SIZE_DEFAULT = 8;

/** Numeric font-size input; empty commits back to the default. */
function FontSizeRow({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
}) {
  return (
    <TextRow
      label={label}
      value={value != null ? String(value) : ''}
      placeholder={String(FONT_SIZE_DEFAULT)}
      unit="px"
      onCommit={(v) => {
        const trimmed = v.trim();
        if (trimmed === '') {
          onCommit(undefined);
          return;
        }
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return;
        onCommit(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(n))));
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Wire inspector — shows the two endpoints and a "select whole node" action.
// ---------------------------------------------------------------------------

function WirePanel({ wireId }: { wireId: WireId }) {
  const t = useT();
  const wires = useEditorStore((s) => s.diagram.wires);
  const elements = useEditorStore((s) => s.diagram.elements);
  const buses = useEditorStore((s) => s.diagram.buses);
  const junctions = useEditorStore((s) => s.diagram.junctions);
  const terminalToNode = useEditorStore((s) => s.internal.terminalToNode);
  const setSelectedNode = useEditorStore((s) => s.setSelectedNode);
  const wire = (wires ?? []).find((w) => w.id === wireId);
  if (!wire) {
    return (
      <div className="px-4 py-5 text-center text-xs text-muted-foreground">
        {t('props.wireNotFound', { id: wireId })}
      </div>
    );
  }
  const nodeId = terminalToNode.get(wire.ends[0]);
  const elemById = new Map(elements.map((e) => [e.id, e]));
  const busById = new Map((buses ?? []).map((b) => [b.id, b]));
  const junctionById = new Map((junctions ?? []).map((j) => [j.id, j]));
  const describeEnd = (end: string): { id: string; label: string; pin?: string } => {
    if (!end.includes('.')) {
      const b = busById.get(end);
      if (b) return { id: end, label: b.name ?? end };
      const j = junctionById.get(end);
      return { id: end, label: j?.name ?? end };
    }
    const dot = end.indexOf('.');
    const elId = end.slice(0, dot);
    const pin = end.slice(dot + 1);
    const el = elemById.get(elId);
    return { id: elId, label: el?.name ?? elId, pin };
  };
  const a = describeEnd(wire.ends[0]);
  const b = describeEnd(wire.ends[1]);
  return (
    <div className="flex flex-col gap-3 px-3 py-3 text-xs">
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t('props.wire')}
        </div>
        <div className="font-mono text-[12px]">{wire.id}</div>
      </div>
      <TextRow
        label={t('props.label')}
        value={wire.label ?? ''}
        placeholder={t('props.labelPlaceholder')}
        onCommit={(v) =>
          useEditorStore
            .getState()
            .updateWire(wireId, { label: v.trim() === '' ? undefined : v.trim() })
        }
      />
      <ul className="space-y-0.5 border-t border-border/40 pt-2">
        {[a, b].map((e, i) => (
          <li
            key={i}
            className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
            onClick={() => useEditorStore.getState().setSelection([e.id])}
          >
            <span className="flex-1 truncate font-mono text-[11px]">{e.id}</span>
            <span className="truncate text-[10px] text-muted-foreground">{e.label}</span>
            {e.pin && (
              <span className="font-mono text-[10px] text-muted-foreground/80">
                {e.pin}
              </span>
            )}
          </li>
        ))}
      </ul>
      {nodeId && (
        <button
          type="button"
          className="self-start rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
          onClick={() => setSelectedNode(nodeId)}
        >
          {t('props.selectWholeNode')}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Junction panel — a free-standing point connection node.
// ---------------------------------------------------------------------------

function JunctionPanel({ junction }: { junction: Junction }) {
  const t = useT();
  const world = useEditorStore((s) => s.internal.junctions.get(junction.id)?.world);
  const at = junction.layout?.at ?? world;
  return (
    <div className="flex flex-col gap-2.5 px-3 py-3 text-xs">
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t('props.junction')}
        </div>
        <div className="font-mono text-[12px]">{junction.id}</div>
      </div>
      <TextRow
        label={t('props.name')}
        value={junction.name ?? ''}
        placeholder={junction.id}
        onCommit={(v) =>
          useEditorStore
            .getState()
            .updateJunction(junction.id, { name: v.trim() === '' ? undefined : v.trim() })
        }
      />
      <TextAreaRow
        key={junction.id}
        label={t('props.note')}
        value={junction.note ?? ''}
        onCommit={(v) =>
          useEditorStore
            .getState()
            .updateJunction(junction.id, { note: v.trim() === '' ? undefined : v.trim() })
        }
      />
      {at && (
        <div className="flex items-center justify-between border-t border-border/40 pt-2">
          <span className="text-muted-foreground">{t('props.junctionPos')}</span>
          <span className="font-mono text-[11px]">
            {Math.round(at[0])}, {Math.round(at[1])}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connectivity-node panel — shown when a wire is the selected target.
// ---------------------------------------------------------------------------

function NodePanel({ nodeId }: { nodeId: string }) {
  const t = useT();
  const node = useEditorStore((s) => s.internal.nodes.get(nodeId));
  const elements = useEditorStore((s) => s.diagram.elements);
  const setSelection = useEditorStore((s) => s.setSelection);

  if (!node) {
    return (
      <div className="px-4 py-5 text-center text-xs text-muted-foreground">
        {t('props.nodeNotFound', { id: nodeId })}
      </div>
    );
  }

  // Group terminals by element so the list reads "QF1: a, b" rather than
  // a flat 1-per-row blob.
  const byElement = new Map<string, string[]>();
  for (const ref of node.terminals) {
    const dot = ref.indexOf('.');
    if (dot < 0) continue;
    const eId = ref.slice(0, dot);
    const pin = ref.slice(dot + 1);
    const arr = byElement.get(eId) ?? [];
    arr.push(pin);
    byElement.set(eId, arr);
  }

  const elById = new Map(elements.map((e) => [e.id, e]));

  return (
    <div className="flex flex-col gap-3 px-3 py-3 text-xs">
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {t('props.node')}
        </div>
        <div className="font-mono text-[12px]">
          {node.id}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {t('props.nodeStats', {
            terminals: node.terminals.length,
            elements: byElement.size,
          })}
        </div>
      </div>

      <ul className="space-y-0.5 border-t border-border/40 pt-2">
        {[...byElement.entries()].map(([eId, pins]) => {
          const el = elById.get(eId);
          return (
            <li
              key={eId}
              className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
              onClick={() => setSelection([eId])}
              title={t('props.selectElement', { label: eId })}
            >
              <span className="flex-1 truncate font-mono text-[11px]">{eId}</span>
              <span className="truncate text-[10px] text-muted-foreground">
                {el?.name ?? ''}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground/80">
                {pins.join(', ')}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form bits
// ---------------------------------------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="w-16 shrink-0 truncate text-[11px] text-muted-foreground">
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TextRow({
  label,
  value,
  placeholder,
  unit,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  unit?: string;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setLocal(value), [value]);
  return (
    <Field label={label}>
      <div className="relative">
        <input
          ref={ref}
          type="text"
          value={local}
          placeholder={placeholder}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => {
            if (local !== value) onCommit(local);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ref.current?.blur();
            if (e.key === 'Escape') {
              setLocal(value);
              ref.current?.blur();
            }
          }}
          className={cn(
            'h-7 w-full rounded-md border border-border/60 bg-background/50 px-2 text-[11px] focus:border-border focus:outline-none focus:ring-1 focus:ring-ring',
            unit && 'pr-8',
          )}
        />
        {unit && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
    </Field>
  );
}

/** How long after the last keystroke a note auto-saves. */
const NOTE_AUTOSAVE_MS = 350;

/**
 * Multi-line text row that **auto-saves while typing** (debounced) and
 * flushes on blur/unmount. Notes used to persist on blur only, which read
 * as data loss: type a note, press Enter (newline — documented behavior),
 * see no confirmation, click elsewhere → "my note disappeared". Auto-saving
 * also covers the panel unmounting while occluded, where blur never fires.
 *
 * Call sites must pass a `key` tied to the edited entity so a pending
 * debounce can never flush into a different element after a selection
 * change (the remount's unmount-flush commits against the old closure).
 */
function TextAreaRow({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  const timer = useRef<number | null>(null);
  // Live refs so the debounce/unmount flush always sees the latest text and
  // never re-commits what it already sent (commits trim, so the store value
  // can legitimately differ from `local` while typing trailing whitespace).
  const latest = useRef({ local, value, onCommit });
  latest.current = { local, value, onCommit };
  const lastSent = useRef<string | null>(null);

  // External change (undo/redo, AI edit): adopt it unless the user is
  // actively typing here — resetting mid-edit would clobber keystrokes.
  useEffect(() => {
    if (!focused.current) {
      setLocal(value);
      lastSent.current = null;
    }
  }, [value]);

  const flush = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const cur = latest.current;
    if (cur.local === cur.value || cur.local === lastSent.current) return;
    lastSent.current = cur.local;
    cur.onCommit(cur.local);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // Flush on unmount so nothing is lost when the panel closes while the
  // textarea still holds uncommitted text.
  useEffect(() => () => flushRef.current(), []);

  return (
    <Field label={label}>
      <textarea
        rows={2}
        value={local}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          setLocal(e.target.value);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => {
            timer.current = null;
            flushRef.current();
          }, NOTE_AUTOSAVE_MS);
        }}
        onBlur={() => {
          focused.current = false;
          flush();
        }}
        className="w-full resize-none rounded-md border border-border/60 bg-background/50 px-2 py-1 text-[11px] focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </Field>
  );
}

function NumberRow({
  label,
  value,
  min,
  unit,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  unit?: string;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setLocal(String(value)), [value]);
  return (
    <Field label={label}>
      <div className="relative">
        <input
          ref={ref}
          type="number"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={() => {
            const n = Number(local);
            if (Number.isFinite(n) && n !== value) onCommit(n);
            else setLocal(String(value));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ref.current?.blur();
            if (e.key === 'Escape') {
              setLocal(String(value));
              ref.current?.blur();
            }
          }}
          min={min}
          className={cn(
            'h-7 w-full rounded-md border border-border/60 bg-background/50 px-2 font-mono text-[11px] tabular-nums focus:border-border focus:outline-none focus:ring-1 focus:ring-ring',
            unit && 'pr-8',
          )}
        />
        {unit && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
    </Field>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-6 w-full items-center justify-center gap-1.5 rounded border text-[10px] transition-colors',
        active
          ? 'border-[var(--selection)] bg-[var(--selection)]/15 text-foreground'
          : 'border-border/60 text-muted-foreground hover:bg-accent',
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function StateField({
  id,
  element,
  field,
}: {
  id: ElementId;
  element: Element;
  field: LibraryStateField;
}) {
  const t = useT();
  const libT = useLibT();
  const label = libT(`${element.kind}.state.${field.name}`, field.label ?? field.name);
  const cur = element.state?.[field.name] ?? field.default;
  const onCommit = (next: ParamValue | undefined) => {
    const state = { ...(element.state ?? {}) };
    if (next === undefined || next === field.default) delete state[field.name];
    else state[field.name] = next;
    useEditorStore
      .getState()
      .updateElement(id, {
        state: Object.keys(state).length > 0 ? state : undefined,
      });
  };

  if (field.type === 'boolean') {
    return (
      <Field label={label}>
        <ToggleButton active={!!cur} onClick={() => onCommit(!cur)}>
          {cur ? t('common.yes') : t('common.no')}
        </ToggleButton>
      </Field>
    );
  }
  if (field.type === 'number') {
    return (
      <NumberRow
        label={label}
        value={typeof cur === 'number' ? cur : 0}
        onCommit={onCommit}
      />
    );
  }
  return (
    <TextRow
      label={label}
      value={typeof cur === 'string' ? cur : ''}
      onCommit={(v) => onCommit(v.trim() === '' ? undefined : v)}
    />
  );
}
