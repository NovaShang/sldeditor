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
import { soleSelectedAnnotation, useEditorStore } from '../store';
import {
  annotationKind,
  isCircuitDiagram,
  SYMBOL_SCALE_MAX,
  SYMBOL_SCALE_MIN,
  type AnnotationId,
  type Bus,
  type BusId,
  type Element,
  type ElementId,
  type Junction,
  type LibraryParamField,
  type LibraryStateField,
  type AnnotationStroke,
  type AnnotationStrokeWidth,
  type BoxAnnotation,
  type DiagramColor,
  type LineAnnotation,
  type ParamValue,
  type TableAnnotation,
  type TextAnnotation,
  type WireId,
} from '../model';
import {
  makeTableBody,
  TABLE_DEFAULT_CELL_H,
  TABLE_DEFAULT_CELL_W,
} from '../lib/annotation-geom';
import { COLOR_ORDER, inkClass } from '../lib/colors';
import {
  applyConductor,
  CONDUCTOR_PRESETS,
  longestWire,
  nodeHasConductor,
  wireHasConductor,
} from '../lib/conductors';
import { nameLines } from '../lib/element-labels';
import { continuationKey, familyOf, isContinuation } from '../lib/kind-families';
import { centerOnWorld } from '../canvas/fit-to-content';
import { cn } from '../lib/utils';

export function PropertyPanel() {
  const t = useT();
  const selection = useEditorStore((s) => s.selection);
  const elements = useEditorStore((s) => s.diagram.elements);
  const buses = useEditorStore((s) => s.diagram.buses);
  const junctions = useEditorStore((s) => s.diagram.junctions);
  const selectedNode = useEditorStore((s) => s.selectedNode);
  const selectedWire = useEditorStore((s) => s.selectedWire);
  const selectedAnnotations = useEditorStore((s) => s.selectedAnnotations);
  const soleAnnotation = useEditorStore(soleSelectedAnnotation);

  // Every inspector is keyed by the id it edits, so a selection change
  // remounts it: a draft typed for one object can never be shown for, or
  // committed to, the next one. The unmounting fields commit what they hold
  // to the object they were editing (see `useDraft`).
  if (selectedWire) return <WirePanel key={selectedWire} wireId={selectedWire} />;
  if (selectedNode) return <NodePanel key={selectedNode} nodeId={selectedNode} />;
  if (soleAnnotation) return <AnnotationPanel key={soleAnnotation} annId={soleAnnotation} />;

  // Mixed / multi selections get a plain count. There is no bulk editing for
  // anything, so the only requirement is that a mixed set doesn't fall
  // through to a single-object editor.
  const total = selection.length + selectedAnnotations.length;

  if (total === 0) {
    return (
      <div className="px-4 py-5 text-center text-xs text-muted-foreground">
        {t('props.empty')}
      </div>
    );
  }

  if (total > 1) {
    return (
      <div className="px-4 py-5 text-center text-xs text-muted-foreground">
        {t('props.multi', { n: total })}
      </div>
    );
  }

  const id = selection[0];
  const bus = (buses ?? []).find((b) => b.id === id);
  if (bus) return <BusInspector key={id} bus={bus} />;
  const junction = (junctions ?? []).find((j) => j.id === id);
  if (junction) return <JunctionPanel key={id} junction={junction} />;
  const element = elements.find((e) => e.id === id);
  if (!element) return null;
  const lib = libraryById[element.kind];

  return (
    <div key={id} className="flex flex-col gap-2.5 overflow-y-auto px-3 py-3 text-xs">
      <KindFamilyRow id={id} kind={element.kind} />
      <TextRow
        label={t('props.name')}
        value={element.name ?? ''}
        placeholder={element.id}
        // A device tag is routinely stacked ("QF1" over "630A/25kA"). This is
        // the same field as the canvas in-place editor and must behave the
        // same way (Enter done, Shift+Enter new line), or a name typed on the
        // canvas comes back here as one run-on line the moment anything else
        // is edited.
        multiline
        onCommit={(v) => {
          const next = nameLines(v, '').join('\n');
          useEditorStore
            .getState()
            .updateElement(id, { name: next === '' ? undefined : next });
        }}
      />
      <Field label={t('props.label')}>
        <ToggleButton
          active={!element.labelHidden}
          onClick={() =>
            useEditorStore
              .getState()
              .updateElement(id, { labelHidden: element.labelHidden ? undefined : true })
          }
        >
          {element.labelHidden ? t('props.labelHidden') : t('props.labelShown')}
        </ToggleButton>
      </Field>
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
      <ColorRow
        label={t('props.color')}
        value={element.color}
        onChange={(c) =>
          useEditorStore
            .getState()
            .updateElement(id, { color: c === 'default' ? undefined : c })
        }
      />
      {lib && <SizeRow id={id} />}
      <PinNumbersSection id={id} element={element} />
      {isContinuation(element.kind) && <PartnerRow id={id} name={element.name} />}
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
 * What the checks assume when a number is left empty. Shown as the
 * placeholder, so an unset power factor reads "default 0.9" rather than a 0
 * that looks like a value (10-25 walkthrough).
 */
const IMPLIED_DEFAULTS: Record<string, number> = { cosphi: 0.9 };

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
    // Only an empty value drops the key. A value that merely *equals* the
    // library default is still an explicit choice and has to persist: canvas
    // labels render from `element.params` without consulting defaults, so
    // discarding it made the most common ratings unlabelable — an RCD left at
    // its default 30 mA could never display "30mA", which is exactly the text
    // users were typing by hand as floating annotations. It also made the two
    // authoring paths disagree, since the AI writing `IDn: 30` through
    // apply_ops did produce a label.
    if (next === undefined || next === '') delete params[field.name];
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
    const implied = IMPLIED_DEFAULTS[field.name];
    return (
      <NumberRow
        label={label}
        value={typeof cur === 'number' ? cur : undefined}
        unit={field.unit}
        placeholder={implied !== undefined ? t('props.defaultHint', { v: implied }) : undefined}
        // The generic load's P is in MW while motors, sockets and lights are
        // in kW (10-25 walkthrough): spell the MW value out in kW.
        hint={
          field.unit === 'MW' && typeof cur === 'number' && cur > 0
            ? `= ${(cur * 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} kW`
            : undefined
        }
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
      <ColorRow
        label={t('props.color')}
        value={bus.color}
        onChange={(c) => updateBusEntry(id, { color: c === 'default' ? undefined : c })}
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

  const kind = annotationKind(ann);
  switch (kind) {
    // Rect and ellipse expose the same controls; only the stroke default
    // differs (a rect is a group frame, an ellipse is a drawn shape).
    case 'rect':
    case 'ellipse': {
      const r = ann as BoxAnnotation;
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
          <ColorRow
            label={t('props.color')}
            value={r.color}
            onChange={(c) => patch({ color: c === 'default' ? undefined : c })}
          />
          <StrokeRows
            stroke={r.stroke}
            strokeWidth={r.strokeWidth}
            defaultStroke={kind === 'rect' ? 'dashed' : 'solid'}
            patch={patch}
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
          <ColorRow
            label={t('props.color')}
            value={l.color}
            onChange={(c) => patch({ color: c === 'default' ? undefined : c })}
          />
          <StrokeRows
            stroke={l.stroke}
            strokeWidth={l.strokeWidth}
            defaultStroke="solid"
            patch={patch}
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
          <ColorRow
            label={t('props.color')}
            value={tb.color}
            onChange={(c) => patch({ color: c === 'default' ? undefined : c })}
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
          <ColorRow
            label={t('props.color')}
            value={tx.color}
            onChange={(c) => patch({ color: c === 'default' ? undefined : c })}
          />
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
/**
 * Six swatches — the whole palette, always visible.
 *
 * A row of swatches rather than a dropdown because colour is a glanceable
 * property: the user is looking at the drawing, not reading a list, and one
 * click has to be enough. `default` shows as the theme's own ink so "back to
 * normal" is a swatch like any other rather than a hidden reset.
 */
function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DiagramColor | undefined;
  onChange: (c: DiagramColor) => void;
}) {
  const t = useT();
  const current = value ?? 'default';
  return (
    <Field label={label}>
      <div className="flex gap-1">
        {COLOR_ORDER.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={current === c}
            aria-label={t(`props.color.${c}` as Parameters<typeof t>[0])}
            title={t(`props.color.${c}` as Parameters<typeof t>[0])}
            onClick={() => onChange(c)}
            className={cn(
              'size-6 rounded-md border transition-shadow',
              current === c
                ? 'border-primary ring-1 ring-primary'
                : 'border-border/60 hover:border-border',
            )}
          >
            <span
              className={cn('block size-full rounded-[3px]', inkClass(c))}
              style={{
                backgroundColor: c === 'default' ? 'var(--foreground)' : 'currentColor',
              }}
            />
          </button>
        ))}
      </div>
    </Field>
  );
}

/** Stroke style + weight — shared by every shape that has a stroke. */
function StrokeRows({
  stroke,
  strokeWidth,
  defaultStroke,
  patch,
}: {
  stroke: AnnotationStroke | undefined;
  strokeWidth: AnnotationStrokeWidth | undefined;
  defaultStroke: AnnotationStroke;
  patch: (p: Record<string, unknown>) => void;
}) {
  const t = useT();
  return (
    <>
      <SegRow
        label={t('props.annStroke')}
        value={stroke ?? defaultStroke}
        options={[
          { value: 'solid' as const, label: t('props.annStrokeSolid'), glyph: <StrokeGlyph width={1.5} /> },
          { value: 'dashed' as const, label: t('props.annStrokeDashed'), glyph: <StrokeGlyph width={1.5} dash="5 3" /> },
          { value: 'dotted' as const, label: t('props.annStrokeDotted'), glyph: <StrokeGlyph width={1.5} dash="0.1 3" /> },
        ]}
        onChange={(v) => patch({ stroke: v })}
      />
      <SegRow
        label={t('props.annStrokeWidth')}
        value={String(strokeWidth ?? 1)}
        options={[
          { value: '1', label: t('props.annWidthThin'), glyph: <StrokeGlyph width={1} /> },
          { value: '2', label: t('props.annWidthMedium'), glyph: <StrokeGlyph width={2.5} /> },
          { value: '3', label: t('props.annWidthThick'), glyph: <StrokeGlyph width={4} /> },
        ]}
        onChange={(v) => patch({ strokeWidth: Number(v) })}
      />
    </>
  );
}

export function SegRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; glyph?: React.ReactNode }[];
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
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-7 flex-1 truncate px-1.5 text-[11px] transition-colors',
              o.glyph && 'flex items-center justify-center',
              value === o.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {o.glyph ?? o.label}
          </button>
        ))}
      </div>
    </Field>
  );
}

/**
 * A stroke option drawn rather than named.
 *
 * "Thin / Medium / Thick" and "Solid / Dashed / Dotted" do not fit three-across
 * in a 224px panel in English, and would not fit in German or Russian either —
 * but a weight is a thing you can simply show, which is what every drawing tool
 * does. The word survives as the accessible name and the tooltip.
 */
function StrokeGlyph({ width, dash }: { width: number; dash?: string }) {
  return (
    <svg viewBox="0 0 28 12" className="h-3 w-7" aria-hidden>
      <line
        x1="2"
        y1="6"
        x2="26"
        y2="6"
        stroke="currentColor"
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Symbol size as a typed percentage — any value from 25% to 400%, the same
 * continuous range the corner grips on the canvas drag through (the grips are
 * the main way to resize; this is for an exact number). ↺ returns to 100%.
 * Commits on Enter or blur, one undo entry per commit.
 */
/**
 * Switch a contact between NO / NC / the four time-delay forms, or an
 * off-page connector between outgoing and incoming — in place, wires kept
 * (see `lib/kind-families.ts`). Renders nothing for kinds outside a family.
 */
function KindFamilyRow({ id, kind }: { id: string; kind: string }) {
  const t = useT();
  const libT = useLibT();
  const family = familyOf(kind);
  if (!family) return null;
  const change = (next: string) => useEditorStore.getState().changeKind(id, next);
  if (family.id === 'continuation') {
    return (
      <SegRow
        label={t('props.direction')}
        value={kind}
        options={[
          { value: 'continuation-out', label: t('props.directionOut') },
          { value: 'continuation-in', label: t('props.directionIn') },
        ]}
        onChange={change}
      />
    );
  }
  const label = t('props.contactType');
  return (
    <Field label={label}>
      <select
        aria-label={label}
        value={kind}
        onChange={(e) => change(e.target.value)}
        className="h-7 w-full min-w-0 rounded-md border border-border/60 bg-transparent px-1.5 text-[11px]"
      >
        {family.kinds.map((k) => (
          <option key={k} value={k}>
            {libT(`${k}.name`, libraryById[k]?.name ?? k)}
          </option>
        ))}
      </select>
    </Field>
  );
}

/**
 * Where an off-page connector's other end is. Same name = same conductor
 * (the compiler merges them), so this lists the other connectors sharing the
 * name and jumps to one on click. No partner is not an error — it may be on
 * another drawing — so the empty state is a plain note.
 */
function PartnerRow({ id, name }: { id: string; name: string | undefined }) {
  const t = useT();
  const key = continuationKey(name);
  // Select the array itself and derive below: a selector that builds a new
  // array every call never settles under zustand 5.
  const elements = useEditorStore((s) => s.diagram.elements);
  const partners = key
    ? elements
        .filter((e) => e.id !== id && isContinuation(e.kind) && continuationKey(e.name) === key)
        .map((e) => e.id)
    : [];
  const jump = (pid: string) => {
    const st = useEditorStore.getState();
    st.setSelection([pid]);
    const at = st.internal.layout.get(pid)?.at;
    if (at) centerOnWorld(at);
  };
  return (
    <Field label={t('props.partner')}>
      {!key ? (
        <span className="text-[11px] text-muted-foreground">{t('props.partnerUnnamed')}</span>
      ) : partners.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">{t('props.partnerNone')}</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {partners.map((pid) => (
            <button
              key={pid}
              type="button"
              onClick={() => jump(pid)}
              className="h-7 rounded-md border border-border/60 px-2 text-[11px] hover:bg-accent"
            >
              {t('props.partnerJump', { id: pid })}
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

function SizeRow({ id }: { id: string }) {
  const t = useT();
  const scale = useEditorStore((s) => s.internal.layout.get(id)?.scale ?? 1);
  const pct = Math.round(scale * 100);
  const [draft, setDraft] = useState<string | null>(null);
  const set = (p: number) => {
    const v = Math.min(SYMBOL_SCALE_MAX, Math.max(SYMBOL_SCALE_MIN, p / 100));
    useEditorStore.getState().updatePlacement(id, { scale: Math.round(v * 100) / 100 });
  };
  const commit = () => {
    if (draft === null) return;
    const n = parseFloat(draft.replace(',', '.'));
    setDraft(null);
    if (Number.isFinite(n) && n > 0 && Math.round(n) !== pct) set(n);
  };
  const label = t('props.size');
  return (
    <Field label={label}>
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <input
            aria-label={label}
            inputMode="decimal"
            value={draft ?? String(pct)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setDraft(null);
            }}
            className="h-7 w-full rounded-md border border-border/60 bg-transparent pr-5 pl-2 font-mono text-[11px] tabular-nums outline-none focus:border-primary"
          />
          <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-muted-foreground">
            %
          </span>
        </div>
        {pct !== 100 && (
          <button
            type="button"
            title={t('props.sizeReset')}
            aria-label={t('props.sizeReset')}
            onClick={() => set(100)}
            className="h-7 w-7 shrink-0 rounded-md text-[13px] leading-none text-muted-foreground hover:bg-accent"
          >
            ↺
          </button>
        )}
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
      <ConductorRow wireIds={[wire.id]} />
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
      <ColorRow
        label={t('props.color')}
        value={wire.color}
        onChange={(c) =>
          useEditorStore
            .getState()
            .updateWire(wireId, { color: c === 'default' ? undefined : c })
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
// Circuit diagrams: conductor presets and pin numbers.
// ---------------------------------------------------------------------------

/**
 * "Conductor" — five chips, L1 L2 L3 N PE, each setting the IEC 60445 colour
 * AND the designation of the wire(s) in one undo step (see `lib/conductors`).
 * Circuit diagrams only: a single-line diagram's one line is all phases.
 * For a whole node (`node`), the label goes on its longest wire only.
 */
function ConductorRow({ wireIds, node }: { wireIds: string[]; node?: boolean }) {
  const t = useT();
  const circuit = useEditorStore((s) => isCircuitDiagram(s.diagram));
  const wires = useEditorStore((s) => s.diagram.wires);
  const renders = useEditorStore((s) => s.internal.wireRenders);
  if (!circuit || wireIds.length === 0) return null;
  const ids = new Set(wireIds);
  const picked = (wires ?? []).filter((w) => ids.has(w.id));
  const labelOn = node ? longestWire(wireIds, renders) : undefined;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{t('props.conductor')}</span>
      <div role="group" aria-label={t('props.conductor')} className="flex overflow-hidden rounded-md border border-border/60">
        {CONDUCTOR_PRESETS.map((p) => {
          const active = node
            ? nodeHasConductor(picked, p, labelOn)
            : picked.length > 0 && picked.every((w) => wireHasConductor(w, p));
          const tip = `${p.label} · ${t(`props.conductor.${p.label}` as Parameters<typeof t>[0])}`;
          return (
            <button
              key={p.label}
              type="button"
              aria-pressed={active}
              aria-label={tip}
              title={tip}
              onClick={() =>
                useEditorStore.getState().dispatch((d) => applyConductor(d, wireIds, p, labelOn))
              }
              className={cn(
                'flex h-7 flex-1 items-center justify-center gap-1 border-border/60 font-mono text-[11px] transition-colors [&:not(:first-child)]:border-l',
                active
                  ? 'bg-accent font-semibold text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  p.color === 'green-yellow' ? 'ole-pe-swatch' : cn('bg-current', inkClass(p.color)),
                )}
                style={p.color === 'default' ? { backgroundColor: 'var(--foreground)' } : undefined}
              />
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * "Pin numbers" — the designation printed beside each terminal on a circuit
 * diagram, editable per element (`Element.pinLabels`). The fields are laid out
 * the way the pins sit on the canvas — top pins in the first row, left to
 * right — so no terminal ids are needed to tell them apart.
 *
 * A field's placeholder is the library default; clearing a field returns to
 * it. "Hide" blanks every designation of the element (stored as `''`, which
 * `pinLabelOf` reads as hidden); a pin hidden that way shows "—".
 */
function PinNumbersSection({ id, element }: { id: string; element: Element }) {
  const t = useT();
  const circuit = useEditorStore((s) => isCircuitDiagram(s.diagram));
  const lib = useEditorStore((s) => s.internal.library.get(element.kind));
  const terminals = useEditorStore((s) => s.internal.terminals);
  if (!circuit || !lib || lib.terminals.length === 0) return null;

  const own = element.pinLabels ?? {};
  const allHidden = lib.terminals.every((lt) => own[lt.id] === '');

  // Rows by on-canvas height, then left to right.
  const placed = lib.terminals.map((lt, i) => {
    const w = terminals.get(`${id}.${lt.id}`)?.world ?? [lt.x, lt.y];
    return { lt, x: w[0], y: w[1], i };
  });
  placed.sort((a, b) => a.y - b.y || a.x - b.x || a.i - b.i);
  const rows: (typeof placed)[] = [];
  for (const p of placed) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - p.y) < 1) last.push(p);
    else rows.push([p]);
  }

  const write = (next: Record<string, string>) => {
    useEditorStore.getState().updateElement(id, {
      pinLabels: Object.keys(next).length > 0 ? next : undefined,
    });
  };
  const commit = (terminalId: string, raw: string) => {
    const v = raw.trim();
    const fallback = lib.terminals.find((lt) => lt.id === terminalId)?.label ?? '';
    const next = { ...own };
    if (v === '' || v === fallback) delete next[terminalId];
    else next[terminalId] = v;
    write(next);
  };
  const toggleHidden = () => {
    const next: Record<string, string> = {};
    if (allHidden) {
      // Show again: drop the blanks, keep any real overrides.
      for (const [k, v] of Object.entries(own)) if (v !== '') next[k] = v;
    } else {
      for (const lt of lib.terminals) next[lt.id] = '';
    }
    write(next);
  };

  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{t('props.pinNumbers')}</span>
        <button
          type="button"
          onClick={toggleHidden}
          aria-pressed={allHidden}
          className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {allHidden ? t('props.pinNumbersShow') : t('props.pinNumbersHide')}
        </button>
      </div>
      {!allHidden &&
        rows.map((row) => (
          <div key={row[0].lt.id} className="flex gap-1">
            {row.map(({ lt }) => (
              <PinField
                key={lt.id}
                value={own[lt.id] ?? ''}
                placeholder={own[lt.id] === '' ? '—' : lt.label ?? ''}
                ariaLabel={`${t('props.pinNumbers')} ${lt.label ?? lt.id}`}
                title={lt.label}
                onCommit={(v) => commit(lt.id, v)}
              />
            ))}
          </div>
        ))}
    </div>
  );
}

function PinField({
  value,
  placeholder,
  ariaLabel,
  title,
  onCommit,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  /** The library default, so a filled-in field still says what it replaced. */
  title?: string;
  onCommit: (v: string) => void;
}) {
  const draft = useDraft(value, onCommit);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={ref}
      type="text"
      value={draft.text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      title={title}
      onChange={(e) => draft.set(e.target.value)}
      onFocus={draft.onFocus}
      onBlur={draft.onBlur}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') ref.current?.blur();
        if (e.key === 'Escape') {
          draft.revert();
          ref.current?.blur();
        }
      }}
      className="h-7 w-0 min-w-0 flex-1 rounded-md border border-border/60 bg-background/50 px-1 text-center font-mono text-[11px] placeholder:text-muted-foreground/60 focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
    />
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
  const wires = useEditorStore((s) => s.diagram.wires);
  const terminalToNode = useEditorStore((s) => s.internal.terminalToNode);
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

      {/* A node is one potential: a preset colours every wire on it and
          writes the designation once, on its longest wire. */}
      <ConductorRow
        node
        wireIds={(wires ?? [])
          .filter((w) => terminalToNode.get(w.ends[0]) === nodeId)
          .map((w) => w.id)}
      />

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

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {/* Wraps rather than truncates: "Active po…" told the user nothing. */}
      <label title={label} className="w-16 shrink-0 break-words text-[11px] leading-tight text-muted-foreground">
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * The uncommitted text of a field that commits on blur (TextRow, PinField,
 * NumberRow). A typed value must never be silently dropped, so besides blur
 * it is also committed when the field unmounts — the inspector remounts per
 * selected object (see `PropertyPanel`), and some ways of changing the
 * selection never blur the field (outline clicks, the assistant, a chrome
 * button that keeps focus where it is). The unmount commit goes through the
 * field's own latest `commit`, i.e. to the object it was editing.
 *
 * `set` writes through a ref as well as state, so a blur dispatched in the
 * same tick as a keystroke or an Escape revert sees the current text, not
 * the previous render's.
 */
function useDraft(value: string, commit: (text: string) => void) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  const live = useRef({ text, value, commit });
  live.current.value = value;
  live.current.commit = commit;
  // The last text handed to `commit`: blur followed by unmount (or a commit
  // the store normalises back to the old value) must not commit it twice.
  const lastSent = useRef<string | null>(null);

  const set = (next: string) => {
    live.current.text = next;
    setText(next);
  };
  const flush = () => {
    const cur = live.current;
    if (cur.text === cur.value || cur.text === lastSent.current) return;
    lastSent.current = cur.text;
    cur.commit(cur.text);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // External change (undo/redo, the assistant): adopt it unless the user is
  // typing here — resetting mid-edit would clobber keystrokes.
  useEffect(() => {
    if (focused.current) return;
    live.current.text = value;
    setText(value);
    lastSent.current = null;
  }, [value]);

  useEffect(() => () => flushRef.current(), []);

  return {
    text,
    set,
    /** Back to the stored value; the blur that usually follows is a no-op. */
    revert: () => set(live.current.value),
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      flush();
    },
  };
}

/** Rows a `multiline` TextRow will grow to before it starts scrolling. */
const TEXT_ROW_MAX_ROWS = 6;

export function TextRow({
  label,
  value,
  placeholder,
  unit,
  multiline,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  unit?: string;
  /**
   * The value may hold line breaks and the box grows with the content.
   * Enter still commits — it is a name, and "type it, press Enter" is what
   * everyone does; with Enter as a newline, most users' first Enter became
   * a stray line break in the name instead of "done". A deliberate line
   * break is Shift+Enter, the same as in a text annotation on the canvas.
   * ⌘/Ctrl+Enter also commits; Escape reverts.
   */
  multiline?: boolean;
  onCommit: (v: string) => void;
}) {
  const draft = useDraft(value, onCommit);
  const local = draft.text;
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const commonProps = {
    value: local,
    placeholder,
    onChange: (e: { target: { value: string } }) => draft.set(e.target.value),
    onFocus: draft.onFocus,
    onBlur: draft.onBlur,
    className: cn(
      'w-full rounded-md border border-border/60 bg-background/50 px-2 text-[11px] focus:border-border focus:outline-none focus:ring-1 focus:ring-ring',
      unit && 'pr-8',
      multiline ? 'resize-none py-1.5 leading-snug' : 'h-7',
    ),
  };
  return (
    <Field label={label}>
      <div className="relative">
        {multiline ? (
          <textarea
            ref={ref}
            rows={Math.min(
              TEXT_ROW_MAX_ROWS,
              Math.max(1, local.split('\n').length),
            )}
            onKeyDown={(e) => {
              // Shift+Enter falls through to the textarea: a line break.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ref.current?.blur();
              }
              if (e.key === 'Escape') {
                draft.revert();
                ref.current?.blur();
              }
              // Everything else belongs to the box — but must not reach the
              // canvas hotkeys behind it.
              e.stopPropagation();
            }}
            {...commonProps}
          />
        ) : (
          <input
            ref={ref}
            type="text"
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') ref.current?.blur();
              if (e.key === 'Escape') {
                draft.revert();
                ref.current?.blur();
              }
            }}
            {...commonProps}
          />
        )}
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
  placeholder,
  hint,
  onCommit,
}: {
  label: string;
  /** Undefined = not set: the field shows empty (with `placeholder`), not 0. */
  value: number | undefined;
  min?: number;
  unit?: string;
  placeholder?: string;
  /** A quiet line under the input, e.g. the value converted to kW. */
  hint?: string;
  /** Called with undefined when the user clears a field that had a value. */
  onCommit: (v: number | undefined) => void;
}) {
  const shown = value === undefined ? '' : String(value);
  const draft = useDraft(shown, (text) => {
    if (text.trim() === '') {
      if (value !== undefined) onCommit(undefined);
      return;
    }
    const n = Number(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else draft.revert();
  });
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Field label={label}>
      <div className="relative">
        <input
          ref={ref}
          type="number"
          value={draft.text}
          placeholder={placeholder}
          onChange={(e) => draft.set(e.target.value)}
          onFocus={draft.onFocus}
          onBlur={draft.onBlur}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') ref.current?.blur();
            if (e.key === 'Escape') {
              draft.revert();
              ref.current?.blur();
            }
          }}
          min={min}
          className={cn(
            'h-7 w-full rounded-md border border-border/60 bg-background/50 px-2 font-mono text-[11px] tabular-nums placeholder:font-sans placeholder:text-muted-foreground/70 focus:border-border focus:outline-none focus:ring-1 focus:ring-ring',
            unit && 'pr-8',
          )}
        />
        {unit && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>}
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
