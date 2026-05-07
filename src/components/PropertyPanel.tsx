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
import type {
  Element,
  ElementId,
  LibraryParamField,
  LibraryStateField,
  ParamValue,
} from '../model';
import { cn } from '../lib/utils';

export function PropertyPanel() {
  const t = useT();
  const selection = useEditorStore((s) => s.selection);
  const elements = useEditorStore((s) => s.diagram.elements);
  const selectedNode = useEditorStore((s) => s.selectedNode);

  if (selectedNode) return <NodePanel nodeId={selectedNode} />;

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
          {node.name ? `${node.name} · ` : ''}
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
  useEffect(() => setLocal(value), [value]);
  return (
    <Field label={label}>
      <textarea
        rows={2}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== value) onCommit(local);
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
