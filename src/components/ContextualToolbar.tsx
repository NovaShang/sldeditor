/**
 * Canva-style contextual floating toolbar that follows the selected element
 * (or selection bbox) — and the selected wire/node, since v0.4. Renders the
 * relevant primary actions (rotate / mirror / delete for elements, delete
 * for nodes) right next to the work, so the eye doesn't need to travel.
 *
 * Position is updated each frame via rAF + DOM transform — no React state in
 * the hot loop. The toolbar reads from the canvas DOM each frame which means
 * it tracks pan, zoom, and element/wire moves "for free".
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlipHorizontal, ListPlus, RotateCw, Spline, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { useT } from '../i18n';
import { useEditorStore } from '../store';
import { COLOR_ORDER, inkClass } from '../lib/colors';
import type { DiagramColor } from '../model';
import type { LocaleKey } from '../i18n/messages';
import { isTypingKeyEvent } from '../lib/text-entry';
import { useContextMenu } from './ContextMenu';
import { addContactItems, addContactSource } from './contact-actions';

/** Swatch labels, spelled out rather than built by template so the keys stay
 *  greppable and type-checked against the message table. */
const COLOR_LABEL: Record<DiagramColor, LocaleKey> = {
  default: 'ctx.colorDefault',
  red: 'ctx.colorRed',
  amber: 'ctx.colorAmber',
  green: 'ctx.colorGreen',
  blue: 'ctx.colorBlue',
  gray: 'ctx.colorGray',
  brown: 'ctx.colorBrown',
  'green-yellow': 'ctx.colorGreenYellow',
};

const GAP_PX = 12;
const TOP_FLIP_THRESHOLD_PX = 56;

export function ContextualToolbar() {
  const t = useT();
  const selection = useEditorStore((s) => s.selection);
  const selectedNode = useEditorStore((s) => s.selectedNode);
  const selectedWire = useEditorStore((s) => s.selectedWire);
  const activeTool = useEditorStore((s) => s.activeTool);
  const rotate = useEditorStore((s) => s.rotateSelection);
  const mirror = useEditorStore((s) => s.mirrorSelection);
  const del = useEditorStore((s) => s.deleteSelection);
  const setColor = useEditorStore((s) => s.setSelectionColor);
  const selectedAnnotations = useEditorStore((s) => s.selectedAnnotations);
  const delNode = useEditorStore((s) => s.deleteSelectedNode);
  const delWire = useEditorStore((s) => s.deleteSelectedWire);
  const resetWirePath = useEditorStore((s) => s.resetWirePath);
  const wireRenders = useEditorStore((s) => s.internal.wireRenders);
  const wireIsManual =
    selectedWire != null && wireRenders.get(selectedWire)?.userEdited === true;

  const ref = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLButtonElement>(null);
  const contextMenu = useContextMenu();
  // Re-evaluated on every document change: renaming a coil makes it (or
  // stops it being) a device contacts can be added to.
  const elements = useEditorStore((s) => s.diagram.elements);
  const soleId = selection.length === 1 ? selection[0] : undefined;
  const contactSource = useMemo(
    () => (soleId ? addContactSource(soleId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [soleId, elements],
  );
  const openContacts = useCallback(() => {
    const btn = contactRef.current;
    if (!btn || !soleId) return;
    const items = addContactItems(t, soleId);
    if (items.length === 0) return;
    const r = btn.getBoundingClientRect();
    contextMenu.open(r.left, r.bottom + 4, items);
  }, [contextMenu, soleId, t]);

  // C — "add contact" for the selected coil / contactor / timer.
  useEffect(() => {
    if (!contactSource) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'c' && e.key !== 'C') return;
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingKeyEvent(e)) return;
      const st = useEditorStore.getState();
      if (st.readOnly || st.editingElement || st.editingAnnotation) return;
      if (st.activeTool !== 'select' && st.activeTool !== 'pan') return;
      e.preventDefault();
      openContacts();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contactSource, openContacts]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const isElementMode = selection.length > 0;
    const isWireMode = !isElementMode && selectedWire != null;
    const isNodeMode = !isElementMode && !isWireMode && selectedNode != null;
    const visible =
      (isElementMode || isWireMode || isNodeMode) &&
      (activeTool === 'select' || activeTool === 'pan');
    if (!visible) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';

    let raf = 0;
    let lastTransform = '';
    const tick = () => {
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      let any = false;
      const accept = (r: DOMRect) => {
        if (r.width === 0 && r.height === 0) return;
        if (r.left < left) left = r.left;
        if (r.right > right) right = r.right;
        if (r.top < top) top = r.top;
        if (r.bottom > bottom) bottom = r.bottom;
        any = true;
      };
      if (isElementMode) {
        for (const id of selection) {
          const node = document.querySelector(
            `[data-element-id="${CSS.escape(id)}"]`,
          );
          if (node) accept(node.getBoundingClientRect());
        }
      } else if (isWireMode && selectedWire) {
        const w = document.querySelector(
          `polyline.ole-wire[data-wire-id="${CSS.escape(selectedWire)}"]`,
        );
        if (w) accept((w as Element).getBoundingClientRect());
      } else if (isNodeMode && selectedNode) {
        const wires = document.querySelectorAll(
          `polyline.ole-wire[data-node-id="${CSS.escape(selectedNode)}"]`,
        );
        for (const w of wires) accept((w as Element).getBoundingClientRect());
      }
      if (any) {
        const cx = (left + right) / 2;
        let ty = top - GAP_PX;
        let translateY = '-100%';
        // Flip below if there's no room above.
        if (ty < TOP_FLIP_THRESHOLD_PX) {
          ty = bottom + GAP_PX;
          translateY = '0%';
        }
        const transform = `translate3d(${cx}px, ${ty}px, 0) translate(-50%, ${translateY})`;
        if (transform !== lastTransform) {
          el.style.transform = transform;
          lastTransform = transform;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selection, selectedNode, selectedWire, activeTool]);

  const isWireMode = selection.length === 0 && selectedWire != null;
  const isNodeMode = selection.length === 0 && !isWireMode && selectedNode != null;
  const hideTransform = isNodeMode || isWireMode;
  // Junctions carry no `color`, so a node selection has nothing to paint;
  // everything else (elements, buses, the selected wire, annotations) does.
  const canColor =
    !isNodeMode &&
    (selection.length > 0 || selectedWire != null || selectedAnnotations.length > 0);

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={
        isWireMode
          ? t('ctx.ariaWire')
          : isNodeMode
            ? t('ctx.ariaNode')
            : t('ctx.ariaElement')
      }
      className="ole-glass pointer-events-auto fixed left-0 top-0 z-30 hidden items-center gap-0.5 rounded-2xl border border-border p-1 shadow-md"
    >
      {isWireMode && wireIsManual && selectedWire && (
        <>
          <Tooltip
            content={
              <div className="space-y-0.5">
                <div>
                  <span className="font-medium">{t('ctx.resetWirePath')}</span>
                </div>
                <div className="text-muted-foreground">
                  {t('ctx.resetWirePathHint')}
                </div>
              </div>
            }
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => resetWirePath(selectedWire)}
              aria-label={t('ctx.resetWirePath')}
            >
              <Spline />
            </Button>
          </Tooltip>
          <div aria-hidden className="mx-0.5 h-4 w-px bg-border" />
        </>
      )}
      {!hideTransform && contactSource && (
        <>
          <Tooltip
            content={
              <div className="space-y-0.5">
                <div>
                  <span className="font-medium">{t('contacts.add')}</span>
                  <span className="ml-1.5 text-muted-foreground">C</span>
                </div>
                <div className="text-muted-foreground">
                  {t('contacts.addHint', { tag: contactSource.tag })}
                </div>
              </div>
            }
          >
            <Button
              ref={contactRef}
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={openContacts}
              aria-label={t('contacts.add')}
              aria-haspopup="menu"
            >
              <ListPlus />
            </Button>
          </Tooltip>
          <div aria-hidden className="mx-0.5 h-4 w-px bg-border" />
        </>
      )}
      {!hideTransform && (
        <>
          <Tooltip
            content={
              <div className="space-y-0.5">
                <div>
                  <span className="font-medium">{t('ctx.rotate')}</span>
                  <span className="ml-1.5 text-muted-foreground">R</span>
                </div>
                <div className="text-muted-foreground">{t('ctx.rotateHint')}</div>
              </div>
            }
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => rotate(90)}
              aria-label={t('ctx.rotate')}
            >
              <RotateCw />
            </Button>
          </Tooltip>
          <Tooltip
            content={
              <div className="space-y-0.5">
                <div>
                  <span className="font-medium">{t('ctx.mirror')}</span>
                  <span className="ml-1.5 text-muted-foreground">M</span>
                </div>
                <div className="text-muted-foreground">{t('ctx.mirrorHint')}</div>
              </div>
            }
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => mirror()}
              aria-label={t('ctx.mirrorTitle')}
            >
              <FlipHorizontal />
            </Button>
          </Tooltip>
          <div aria-hidden className="mx-0.5 h-4 w-px bg-border" />
        </>
      )}
      {canColor && (
        <>
          <div
            role="group"
            aria-label={t('ctx.color')}
            className="flex items-center gap-0.5"
          >
            {COLOR_ORDER.map((c) => (
              <Tooltip key={c} content={t(COLOR_LABEL[c])}>
                <button
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={t(COLOR_LABEL[c])}
                  className="ole-swatch flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent"
                >
                  {/* The dot must show what the canvas will actually do, and
                      the canvas themes by a `.dark` CLASS, not color-scheme —
                      so it wears the same `ole-ink-*` class the renderer uses
                      and paints from `currentColor`. Hard-coding either hex
                      here would silently disagree in one of the two themes;
                      `default` has no class and inherits theme ink, which is
                      exactly what an uncoloured object does. */}
                  <span
                    aria-hidden
                    className={`size-3.5 rounded-full border border-border bg-current ${inkClass(c) ?? ''}`}
                  />
                </button>
              </Tooltip>
            ))}
          </div>
          <div aria-hidden className="mx-0.5 h-4 w-px bg-border" />
        </>
      )}
      <Tooltip
        content={
          <div className="space-y-0.5">
            <div>
              <span className="font-medium">{t('ctx.delete')}</span>
              <span className="ml-1.5 text-muted-foreground">Del</span>
            </div>
            <div className="text-muted-foreground">
              {isWireMode
                ? t('ctx.deleteHintWire')
                : isNodeMode
                  ? t('ctx.deleteHintNode')
                  : t('ctx.deleteHintElement')}
            </div>
          </div>
        }
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive hover:text-destructive"
          onClick={() =>
            isWireMode ? delWire() : isNodeMode ? delNode() : del()
          }
          aria-label={t('ctx.delete')}
        >
          <Trash2 />
        </Button>
      </Tooltip>
    </div>
  );
}
