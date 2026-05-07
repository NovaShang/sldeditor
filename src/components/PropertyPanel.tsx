/**
 * Right-panel property editor — minimal by design. Shows only what the user
 * needs to *configure* (name, note, kind-specific state). Transformations
 * (rotate/mirror/delete) live on the contextual floating toolbar; type label
 * lives in the panel header.
 */

import { useEffect, useRef, useState } from 'react';
import { libraryById } from '@/element-library';
import { useEditorStore } from '@/store';
import type {
  Element,
  ElementId,
  LibraryStateField,
  ParamValue,
} from '@/model';
import { cn } from '@/lib/utils';

export function PropertyPanel() {
  const selection = useEditorStore((s) => s.selection);
  const elements = useEditorStore((s) => s.diagram.elements);

  if (selection.length === 0) {
    return (
      <div className="px-4 py-5 text-center text-xs text-muted-foreground">
        未选中
      </div>
    );
  }

  if (selection.length > 1) {
    return (
      <div className="px-4 py-5 text-center text-xs text-muted-foreground">
        已选中 {selection.length} 个元件
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
        label="名称"
        value={element.name ?? ''}
        placeholder={element.id}
        onCommit={(v) =>
          useEditorStore
            .getState()
            .updateElement(id, { name: v.trim() === '' ? undefined : v.trim() })
        }
      />
      <TextAreaRow
        label="备注"
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
      <label className="w-12 shrink-0 text-[11px] text-muted-foreground">{label}</label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function TextRow({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [local, setLocal] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setLocal(value), [value]);
  return (
    <Field label={label}>
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
        className="h-7 w-full rounded-md border border-border/60 bg-background/50 px-2 text-[11px] focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
      />
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
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setLocal(String(value)), [value]);
  return (
    <Field label={label}>
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
        className="h-7 w-full rounded-md border border-border/60 bg-background/50 px-2 font-mono text-[11px] tabular-nums focus:border-border focus:outline-none focus:ring-1 focus:ring-ring"
      />
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
      <Field label={field.label ?? field.name}>
        <ToggleButton active={!!cur} onClick={() => onCommit(!cur)}>
          {cur ? '是' : '否'}
        </ToggleButton>
      </Field>
    );
  }
  if (field.type === 'number') {
    return (
      <NumberRow
        label={field.label ?? field.name}
        value={typeof cur === 'number' ? cur : 0}
        onCommit={onCommit}
      />
    );
  }
  return (
    <TextRow
      label={field.label ?? field.name}
      value={typeof cur === 'string' ? cur : ''}
      onCommit={(v) => onCommit(v.trim() === '' ? undefined : v)}
    />
  );
}
