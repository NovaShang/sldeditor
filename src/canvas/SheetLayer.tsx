/**
 * Drawing sheets (图纸页) on the canvas: outer border, inner border, title
 * block and its text, for every sheet in `diagram.sheets`. The bottom-most
 * drawn layer — a frame sits under the drawing, never over it.
 *
 * Geometry comes from `sheetPrimitives` and nothing else, the same function
 * every exporter renders from, so the frame on screen and the page on paper
 * cannot disagree. This layer only decides colour and pointer behaviour.
 *
 * Pointer behaviour (see `sheet-hit.ts` for why): the paper is click-through;
 * only the two border lines (a fat transparent stroke, fixed in SCREEN px so
 * it stays grabbable at any zoom) and the title block take the pointer, and
 * only under the select tool — any other tool, and the read-only viewer
 * (pan only), clicks straight through to the canvas.
 */

import { useLocale } from '../i18n';
import { sheetFieldLabels, sheetOfText } from '../i18n/sheet-labels';
import { sheetPrimitives } from '../model/sheet-render';
import { useCanvasStore } from '../store';

/** Width of the invisible border grab band, screen px (non-scaling stroke). */
const BORDER_HIT_PX = 10;

export function SheetLayer() {
  const sheets = useCanvasStore((s) => s.diagram.sheets);
  const shared = useCanvasStore((s) => s.diagram.meta?.titleBlock);
  const selectedSheet = useCanvasStore((s) => s.selectedSheet);
  // `sheetFieldLabels()` reads the locale imperatively; subscribing here is
  // what makes the title block re-translate when the user switches language.
  useLocale((s) => s.locale);

  if (!sheets?.length) return null;
  const labels = sheetFieldLabels();
  const total = sheets.length;

  return (
    <g className="ole-sheet-layer">
      {sheets.map((sheet, i) => {
        const p = sheetPrimitives(sheet, shared, labels, sheetOfText(i + 1, total));
        const outer = p.rects[0];
        const selected = selectedSheet === sheet.id;
        return (
          <g
            key={sheet.id}
            className="ole-sheet"
            data-sheet-id={sheet.id}
            data-selected={selected ? 'true' : undefined}
          >
            {p.rects.map((r, k) => (
              <rect
                key={`r${k}`}
                className="ole-sheet-border"
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                strokeWidth={r.stroke}
              />
            ))}
            {p.lines.map((l, k) => (
              <line
                key={`l${k}`}
                className="ole-sheet-line"
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                strokeWidth={l.stroke}
              />
            ))}
            {p.texts.map((t, k) => (
              <text
                key={`t${k}`}
                className={t.role === 'label' ? 'ole-sheet-label' : 'ole-sheet-value'}
                x={t.x}
                y={t.y}
                fontSize={t.size}
              >
                {t.text}
              </text>
            ))}
            {selected && (
              // The printed border is a ~1 unit hairline that vanishes when
              // zoomed out to see several pages; a screen-px outline keeps the
              // selection legible at any zoom.
              <rect
                className="ole-sheet-halo"
                x={outer.x}
                y={outer.y}
                width={outer.w}
                height={outer.h}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {/* Hit targets last so they sit over the glyphs. Same geometry as
                the visible rects, so a fit over `[data-sheet-id]` measures
                the paper, not a padded box. */}
            <rect
              className="ole-sheet-title-hit"
              x={p.titleBlock.x}
              y={p.titleBlock.y}
              width={p.titleBlock.w}
              height={p.titleBlock.h}
            />
            {p.rects.map((r, k) => (
              <rect
                key={`h${k}`}
                className="ole-sheet-hit"
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                strokeWidth={BORDER_HIT_PX}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}
