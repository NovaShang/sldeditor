/**
 * Floating Done / Cancel controls shown while an annotation is being edited
 * inline (a text note or a table cell). Gives a discoverable, mouse-driven
 * way to finish editing beyond the Enter / Esc keys — the same
 * follow-the-work pattern as ContextualToolbar (rAF + DOM transform, no React
 * state in the hot loop).
 *
 * Both buttons `preventDefault` on mousedown so pressing them does not blur
 * the inline editor first — otherwise the editor's own `onBlur` would commit
 * before Cancel could restore the original value. The click handlers then act
 * on the still-focused editor deliberately: Done blurs it (commit), Cancel
 * writes the original value back and blurs (a no-op commit / delete-if-empty).
 */

import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { useT } from '../i18n';
import { annotationKind, type TableAnnotation, type TextAnnotation } from '../model';
import { useEditorStore } from '../store';

const GAP_PX = 8;
const TOP_FLIP_THRESHOLD_PX = 56;

const CELL_FO = '.ole-ann-cell-edit-fo';
const TEXT_FO = '.ole-free-annotation-edit-fo';

function activeEditorEl(): HTMLElement | null {
  return (
    (document.querySelector(`${CELL_FO} input`) as HTMLElement | null) ??
    (document.querySelector(`${TEXT_FO} [contenteditable]`) as HTMLElement | null)
  );
}

export function AnnotationEditToolbar() {
  const t = useT();
  const editing = useEditorStore((s) => s.editingAnnotation);
  const editingCell = useEditorStore((s) => s.editingCell);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!editing) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';

    let raf = 0;
    let last = '';
    const tick = () => {
      // Prefer the inner editor (input / contenteditable) — it hugs the actual
      // text, whereas the text foreignObject is an oversized 320px growth box,
      // which would push the buttons far to the right of short notes.
      const host =
        activeEditorEl() ??
        document.querySelector(CELL_FO) ??
        document.querySelector(TEXT_FO) ??
        document.querySelector(`[data-annotation-id="${CSS.escape(editing)}"]`);
      if (host) {
        const r = host.getBoundingClientRect();
        // Anchor to the editor's top-left (where the text/cell actually
        // begins) so the buttons hug short content instead of trailing off
        // the right of the oversized text growth box.
        let ty = r.top - GAP_PX;
        let translateY = '-100%';
        if (ty < TOP_FLIP_THRESHOLD_PX) {
          ty = r.bottom + GAP_PX;
          translateY = '0%';
        }
        const transform = `translate3d(${r.left}px, ${ty}px, 0) translate(0, ${translateY})`;
        if (transform !== last) {
          el.style.transform = transform;
          last = transform;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [editing, editingCell]);

  const done = () => {
    activeEditorEl()?.blur();
  };

  const cancel = () => {
    const store = useEditorStore.getState();
    const id = store.editingAnnotation;
    const ann = store.diagram.annotations?.find((a) => a.id === id);
    if (!ann) {
      store.setEditingAnnotation(null);
      return;
    }
    // Restore the pre-edit value into the DOM editor, then blur so the
    // editor's own commit path runs but sees "no change".
    if (annotationKind(ann) === 'table' && store.editingCell) {
      const input = document.querySelector(`${CELL_FO} input`) as HTMLInputElement | null;
      const [r, c] = store.editingCell;
      if (input) {
        input.value = (ann as TableAnnotation).cells[r]?.[c] ?? '';
        input.blur();
        return;
      }
    } else {
      const div = document.querySelector(`${TEXT_FO} [contenteditable]`) as HTMLElement | null;
      if (div) {
        div.innerText = (ann as TextAnnotation).text ?? '';
        div.blur();
        return;
      }
    }
    store.setEditingAnnotation(null);
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={t('ctx.ariaEdit')}
      className="ole-glass pointer-events-auto fixed left-0 top-0 z-40 hidden items-center gap-0.5 rounded-2xl border border-border p-1 shadow-md"
    >
      <Tooltip content={<span className="font-medium">{t('ctx.done')} · Enter</span>}>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-emerald-600 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400"
          onMouseDown={(e) => e.preventDefault()}
          onClick={done}
          aria-label={t('ctx.done')}
        >
          <Check />
        </Button>
      </Tooltip>
      <Tooltip content={<span className="font-medium">{t('ctx.cancel')} · Esc</span>}>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          aria-label={t('ctx.cancel')}
        >
          <X />
        </Button>
      </Tooltip>
    </div>
  );
}
