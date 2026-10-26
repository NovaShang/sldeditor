/**
 * Right-panel inspector for a drawing sheet (图纸页): paper, frame scale,
 * how big the labels come out on paper, the title block, and page actions.
 *
 * The title block is filled in here, not on the canvas, because the old
 * annotation frame made users edit it cell by cell — and because half of it
 * (project, client, designer, checker) is the same on every sheet, which a
 * per-sheet table cannot express.
 */

import { useMemo } from 'react';
import type { InternalModel } from '../compiler/internal-model';
import { targetBox } from '../health/present';
import { useHostActions } from '../hooks/use-host-actions';
import { useLocale, useT } from '../i18n';
import { annotationBBox } from '../lib/annotation-geom';
import { cn } from '../lib/utils';
import {
  clampSheetScale,
  DEFAULT_LABEL_FONT,
  formatSheetScale,
  labelFontForPrint,
  NICE_SCALES,
  PAPER_LABEL,
  PAPER_ORDER,
  PRINT_TEXT_MIN_MM,
  PRINT_TEXT_TARGET_MM,
  printedMm,
  SHEET_OWN_FIELDS,
  SHEET_SHARED_FIELDS,
  sheetContentArea,
  sheetRect,
  type DiagramFile,
  type PaperId,
  type Sheet,
  type SheetOrientation,
} from '../model';
import { useEditorStore } from '../store';
import { Field, SegRow, TextRow } from './PropertyPanel';

type Box = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * Slack (world units) before something counts as outside the content area.
 * `fitSheet` rounds the frame's position to whole units, so a drawing it has
 * just fitted can sit half a unit past the edge — the warning must not
 * survive the button that is meant to clear it.
 */
const OVERFLOW_TOLERANCE = 1;

/**
 * Ids of the devices, buses, junctions and annotations that touch this sheet
 * but are not wholly inside its content area (inside the inner border, above
 * the title-block band) — what would print cut off or under the title block.
 *
 * "Touch" = the box overlaps the sheet's outer border, the same test
 * `fitSheet` uses to decide what to fit, so pressing it clears this list.
 * Things entirely outside the sheet belong to another sheet, or to none.
 */
export function sheetOverflowIds(d: DiagramFile, internal: InternalModel, sheet: Sheet): string[] {
  const r = sheetRect(sheet);
  const a = sheetContentArea(sheet);
  const overlaps = (b: Box) =>
    b.maxX >= r.x && b.minX <= r.x + r.w && b.maxY >= r.y && b.minY <= r.y + r.h;
  const within = (b: Box) =>
    b.minX >= a.x - OVERFLOW_TOLERANCE &&
    b.minY >= a.y - OVERFLOW_TOLERANCE &&
    b.maxX <= a.x + a.w + OVERFLOW_TOLERANCE &&
    b.maxY <= a.y + a.h + OVERFLOW_TOLERANCE;
  const out: string[] = [];
  for (const id of [...internal.elements.keys(), ...internal.buses.keys(), ...internal.junctions.keys()]) {
    const b = targetBox(internal, id);
    if (b && overlaps(b) && !within(b)) out.push(id);
  }
  for (const ann of d.annotations ?? []) {
    const b = annotationBBox(ann);
    if (overlaps(b) && !within(b)) out.push(ann.id);
  }
  return out;
}

/** The store clamps `meta.labelFontSize` to this range (enlargeLabelsForPrint). */
const LABEL_FONT_MIN = 5;
const LABEL_FONT_MAX = 32;

export function SheetInspector({ sheetId }: { sheetId: string }) {
  const t = useT();
  const sheets = useEditorStore((s) => s.diagram.sheets);
  const diagram = useEditorStore((s) => s.diagram);
  const internal = useEditorStore((s) => s.internal);
  const onExportSheet = useHostActions((s) => s.onExportSheet);
  const locale = useLocale((s) => s.locale);

  const index = (sheets ?? []).findIndex((sh) => sh.id === sheetId);
  const sheet = index >= 0 ? sheets![index] : undefined;
  const overflow = useMemo(
    () => (sheet ? sheetOverflowIds(diagram, internal, sheet).length > 0 : false),
    [diagram, internal, sheet],
  );
  if (!sheet) return null;

  const st = () => useEditorStore.getState();
  const scale = clampSheetScale(sheet.scale);
  // An off-list scale (an exact ratio past the last nice step, or a hand-
  // edited file) still has to show as the current value.
  const scaleOptions: number[] = (NICE_SCALES as readonly number[]).includes(scale)
    ? [...NICE_SCALES]
    : [...NICE_SCALES, scale].sort((x, y) => x - y);

  const labelFont = diagram.meta?.labelFontSize ?? DEFAULT_LABEL_FONT;
  const mm = printedMm(labelFont, scale);
  const small = mm < PRINT_TEXT_MIN_MM;
  // "1,2 mm" in German: a millimetre figure is read, not parsed.
  const fmtMm = (v: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);
  // At large enlargements even the biggest label size the editor allows is
  // too small on paper; then the button would do nothing, so don't offer it.
  const canEnlarge =
    Math.min(LABEL_FONT_MAX, Math.max(LABEL_FONT_MIN, labelFontForPrint(scale))) > labelFont;

  const shared = diagram.meta?.titleBlock ?? {};
  const count = sheets?.length ?? 0;

  return (
    <div className="flex flex-col gap-2.5 overflow-y-auto px-3 py-3 text-xs">
      <SegRow<PaperId>
        label={t('sheet.paper')}
        value={sheet.paper}
        options={PAPER_ORDER.map((p) => ({ value: p, label: PAPER_LABEL[p] }))}
        onChange={(paper) => st().updateSheet(sheet.id, { paper })}
      />
      <SegRow<SheetOrientation>
        label={t('sheet.orientation')}
        value={sheet.orientation}
        options={[
          { value: 'landscape', label: t('sheet.landscape'), glyph: <PaperGlyph landscape /> },
          { value: 'portrait', label: t('sheet.portrait'), glyph: <PaperGlyph /> },
        ]}
        onChange={(orientation) => st().updateSheet(sheet.id, { orientation })}
      />
      <Field label={t('sheet.frameScale')}>
        <select
          aria-label={t('sheet.frameScale')}
          value={String(scale)}
          onChange={(e) => st().updateSheet(sheet.id, { scale: Number(e.target.value) })}
          className="h-7 w-full min-w-0 rounded-md border border-border/60 bg-transparent px-1.5 text-[11px] tabular-nums"
        >
          {scaleOptions.map((s) => (
            <option key={s} value={String(s)}>
              {formatSheetScale(s)}
            </option>
          ))}
        </select>
      </Field>
      {overflow && <Note tone="warn">{t('sheet.overflow')}</Note>}
      <ActionButton emphasis={overflow} onClick={() => st().fitSheet(sheet.id)}>
        {t('sheet.fit')}
      </ActionButton>

      {/* Legibility: the answer to "on A4 I can't read it". Always shown, so
          the number is familiar before it ever turns amber. */}
      <div className="flex flex-col gap-1.5">
        <Note tone={small ? 'warn' : 'quiet'}>
          {t('sheet.textHeight', { mm: fmtMm(mm) })}
          {small && (
            <span className="mt-0.5 block">
              {t('sheet.textSmall', { target: fmtMm(PRINT_TEXT_TARGET_MM) })}
            </span>
          )}
        </Note>
        {small && canEnlarge && (
          <ActionButton emphasis onClick={() => st().enlargeLabelsForPrint(sheet.id)}>
            {t('sheet.enlargeLabels')}
          </ActionButton>
        )}
      </div>

      <Section title={t('sheet.own')}>
        {SHEET_OWN_FIELDS.map((k) => (
          <TextRow
            key={k}
            label={t(`sheet.field.${k}`)}
            value={sheet[k] ?? ''}
            onCommit={(v) => st().updateSheet(sheet.id, { [k]: v.trim() })}
          />
        ))}
      </Section>
      <Section title={t('sheet.shared')}>
        {SHEET_SHARED_FIELDS.map((k) => (
          <TextRow
            key={k}
            label={t(`sheet.field.${k}`)}
            value={shared[k] ?? ''}
            onCommit={(v) => st().updateTitleBlock({ [k]: v.trim() })}
          />
        ))}
      </Section>

      <div className="mt-1 flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
        {count > 1 && (
          <div className="flex gap-1.5">
            <ActionButton disabled={index === 0} onClick={() => st().reorderSheet(sheet.id, -1)}>
              {t('sheet.moveEarlier')}
            </ActionButton>
            <ActionButton
              disabled={index === count - 1}
              onClick={() => st().reorderSheet(sheet.id, 1)}
            >
              {t('sheet.moveLater')}
            </ActionButton>
          </div>
        )}
        {onExportSheet && (
          <ActionButton onClick={() => onExportSheet(sheet.id)}>{t('sheet.export')}</ActionButton>
        )}
        <ActionButton destructive onClick={() => st().removeSheet(sheet.id)}>
          {t('sheet.delete')}
        </ActionButton>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * Amber, not red: small print or a drawing past the frame is something to
 * fix before printing, not an error — and the fix is one button away.
 */
function Note({ tone, children }: { tone: 'warn' | 'quiet'; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'warn' ? 'status' : undefined}
      className={cn(
        'rounded-md px-2 py-1.5 text-[11px] leading-snug',
        tone === 'warn'
          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  );
}

/**
 * Full-width text button. Wraps instead of truncating: "Enlarge frame to fit
 * the drawing" in French or Arabic is longer than the panel, and a truncated
 * action reads as nothing.
 */
function ActionButton({
  onClick,
  disabled,
  emphasis,
  destructive,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  emphasis?: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'min-h-7 w-full min-w-0 flex-1 rounded-md border px-2 py-1 text-[11px] leading-tight transition-colors disabled:pointer-events-none disabled:opacity-40',
        emphasis
          ? 'border-amber-500/50 text-foreground hover:bg-amber-500/10'
          : destructive
            ? 'border-border/60 text-destructive hover:bg-destructive/10'
            : 'border-border/60 text-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

/** Orientation drawn rather than named, like the stroke glyphs: two words
 *  side by side do not fit the panel in every language. */
function PaperGlyph({ landscape }: { landscape?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden>
      {landscape ? (
        <rect x="1.5" y="4" width="13" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      ) : (
        <rect x="4" y="1.5" width="8" height="13" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      )}
    </svg>
  );
}
