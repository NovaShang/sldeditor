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

import { useEffect, useRef } from 'react';
import { FlipHorizontal, RotateCw, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip } from './ui/tooltip';
import { useT } from '../i18n';
import { useEditorStore } from '../store';

const GAP_PX = 12;
const TOP_FLIP_THRESHOLD_PX = 56;

export function ContextualToolbar() {
  const t = useT();
  const selection = useEditorStore((s) => s.selection);
  const selectedNode = useEditorStore((s) => s.selectedNode);
  const activeTool = useEditorStore((s) => s.activeTool);
  const rotate = useEditorStore((s) => s.rotateSelection);
  const mirror = useEditorStore((s) => s.mirrorSelection);
  const del = useEditorStore((s) => s.deleteSelection);
  const delNode = useEditorStore((s) => s.deleteSelectedNode);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const isElementMode = selection.length > 0;
    const isNodeMode = !isElementMode && selectedNode != null;
    const visible = (isElementMode || isNodeMode) && activeTool === 'select';
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
  }, [selection, selectedNode, activeTool]);

  const isNodeMode = selection.length === 0 && selectedNode != null;

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={isNodeMode ? t('ctx.ariaNode') : t('ctx.ariaElement')}
      className="ole-glass pointer-events-auto fixed left-0 top-0 z-30 hidden items-center gap-0.5 rounded-2xl border border-border p-1 shadow-md"
    >
      {!isNodeMode && (
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
      <Tooltip
        content={
          <div className="space-y-0.5">
            <div>
              <span className="font-medium">{t('ctx.delete')}</span>
              <span className="ml-1.5 text-muted-foreground">Del</span>
            </div>
            <div className="text-muted-foreground">
              {isNodeMode ? t('ctx.deleteHintNode') : t('ctx.deleteHintElement')}
            </div>
          </div>
        }
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-destructive hover:text-destructive"
          onClick={() => (isNodeMode ? delNode() : del())}
          aria-label={t('ctx.delete')}
        >
          <Trash2 />
        </Button>
      </Tooltip>
    </div>
  );
}
