/**
 * Export the current diagram as an ASCII DXF (AutoCAD R12 / AC1009). Mirrors
 * `export-image.ts` in shape but emits native CAD entities so the output is
 * editable in AutoCAD/LibreCAD/etc.
 *
 * Mapping summary:
 *   <line>          → LINE
 *   <polyline>      → LWPOLYLINE (open)
 *   <polygon>       → LWPOLYLINE (closed)
 *   <rect>          → LWPOLYLINE (closed, 4 corners; rx/ry ignored)
 *   <circle>        → CIRCLE
 *   <ellipse>       → CIRCLE if rx≈ry, else sampled LWPOLYLINE (closed)
 *   <path d="M..A..">→ sampled LWPOLYLINE (open)
 *   <text>          → TEXT
 *   wire route      → LWPOLYLINE (open)
 *   free annotation → TEXT (one per line)
 *   element label   → TEXT (one per line, ID + showOnCanvas params)
 *
 * Y is flipped to CAD convention (Y up). 4 layers: WIRES, ELEMENTS, LABELS,
 * ANNOTATIONS.
 */

import {
  transformPoint,
  type InternalModel,
  type ResolvedElement,
  type ResolvedPlacement,
} from '../compiler';
import type {
  LabelMode,
  LibraryEntry,
  LibraryLabelAnchor,
  TextAnnotation,
} from '../model';

export interface DxfExportOptions {
  /** Used as the $PROJECTNAME header value when present. */
  title?: string;
  /** Decimal places for coordinate output. Default 6. */
  precision?: number;
  /** Element label visibility. Mirrors `DiagramFile.meta.labelMode`. Default 'all'. */
  labelMode?: LabelMode;
  /** Free text annotations from `DiagramFile.annotations` — `InternalModel`
   *  doesn't carry them, so the caller passes them through. */
  annotations?: TextAnnotation[];
}

const LAYER_WIRES = 'WIRES';
const LAYER_ELEMENTS = 'ELEMENTS';
const LAYER_LABELS = 'LABELS';
const LAYER_ANNOTATIONS = 'ANNOTATIONS';

const ARC_SAMPLES = 32;
const ELLIPSE_SAMPLES = 64;
const LABEL_FONT_SIZE = 7;
const ANNOTATION_FONT_SIZE = 8;
const ANNOTATION_LINE_HEIGHT = 1.25;
const LABEL_LINE_HEIGHT = 9;
const TEXT_FONT_SIZE_DEFAULT = 6;

export function buildExportDxf(
  model: InternalModel,
  opts: DxfExportOptions = {},
): string {
  const w = new DxfWriter(opts.precision ?? 6);

  w.header(opts.title);
  w.tables([
    { name: LAYER_WIRES, color: 7 },
    { name: LAYER_ELEMENTS, color: 7 },
    { name: LAYER_LABELS, color: 8 },
    { name: LAYER_ANNOTATIONS, color: 3 },
  ]);
  w.beginEntities();

  // Wires (already in world coordinates).
  for (const r of model.wireRenders.values()) {
    if (r.path.length < 2) continue;
    w.lwpolyline(LAYER_WIRES, r.path.map(worldToDxf), false);
  }

  // Buses (drawn after wires so the heavier bar sits on top).
  for (const { geometry } of model.buses.values()) {
    const { axis, at, span } = geometry;
    const half = span / 2;
    const a: [number, number] = axis === 'x' ? [at[0] - half, at[1]] : [at[0], at[1] - half];
    const b: [number, number] = axis === 'x' ? [at[0] + half, at[1]] : [at[0], at[1] + half];
    w.lwpolyline(LAYER_WIRES, [a, b].map(worldToDxf), false);
  }

  // Element symbols.
  for (const re of model.elements.values()) {
    const place = model.layout.get(re.element.id);
    const lib = re.libraryDef;
    if (!place || !lib) continue;
    emitLibrarySvg(w, lib.svg, place);
  }

  // Element structural labels (ID + showOnCanvas params).
  const mode: LabelMode = opts.labelMode ?? 'all';
  if (mode !== 'off') {
    for (const re of model.elements.values()) {
      const place = model.layout.get(re.element.id);
      if (!place || !re.libraryDef) continue;
      const lines = labelLines(re, mode);
      if (lines.length === 0) continue;
      const anchor = re.libraryDef.label ?? fallbackAnchor(re.libraryDef);
      const [ax, ay] = anchorWorld(anchor, place, re.libraryDef);
      // Lines stack downward in screen-space → upward separation in DXF Y-up
      // becomes negative spacing on the screen-Y, i.e. positive when flipped.
      for (let i = 0; i < lines.length; i++) {
        const [x, y] = worldToDxf([ax, ay + i * LABEL_LINE_HEIGHT]);
        w.text(LAYER_LABELS, [x, y], lines[i], LABEL_FONT_SIZE, 0, false);
      }
    }
  }

  // Free text annotations.
  for (const ann of opts.annotations ?? []) {
    if (!ann.text) continue;
    const fs = ann.fontSize ?? ANNOTATION_FONT_SIZE;
    const lines = ann.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const [x, y] = worldToDxf([
        ann.at[0],
        ann.at[1] + (i + 1) * fs * ANNOTATION_LINE_HEIGHT,
      ]);
      // SVG `<text y>` is the baseline; the canvas annotation layer paints
      // the first line at `at.y + fs` and steps by fs*1.25. We mimic that so
      // DXF placement matches what users see on the canvas.
      w.text(LAYER_ANNOTATIONS, [x, y], lines[i], fs, 0, false);
    }
  }

  w.endEntities();
  return w.toString();
}

export async function downloadDxf(
  model: InternalModel,
  filename = 'diagram.dxf',
  opts?: DxfExportOptions,
): Promise<void> {
  const dxf = buildExportDxf(model, opts);
  const url = URL.createObjectURL(
    new Blob([dxf], { type: 'application/dxf;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// -----------------------------------------------------------------------------
// SVG fragment → DXF entities
// -----------------------------------------------------------------------------

function emitLibrarySvg(
  w: DxfWriter,
  svg: string,
  place: ResolvedPlacement,
): void {
  // Wrap so DOMParser sees a single root element.
  const wrapped = `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
  const doc = new DOMParser().parseFromString(wrapped, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.querySelector('parsererror')) return;

  for (const el of Array.from(root.children)) {
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'line':
        emitLine(w, el, place);
        break;
      case 'polyline':
        emitPoly(w, el, place, false);
        break;
      case 'polygon':
        emitPoly(w, el, place, true);
        break;
      case 'rect':
        emitRect(w, el, place);
        break;
      case 'circle':
        emitCircle(w, el, place);
        break;
      case 'ellipse':
        emitEllipse(w, el, place);
        break;
      case 'path':
        emitPath(w, el, place);
        break;
      case 'text':
        emitText(w, el, place);
        break;
      default:
        break;
    }
  }
}

function emitLine(
  w: DxfWriter,
  el: Element,
  place: ResolvedPlacement,
): void {
  const x1 = numAttr(el, 'x1');
  const y1 = numAttr(el, 'y1');
  const x2 = numAttr(el, 'x2');
  const y2 = numAttr(el, 'y2');
  const a = worldToDxf(localToWorld([x1, y1], place));
  const b = worldToDxf(localToWorld([x2, y2], place));
  w.line(LAYER_ELEMENTS, a, b);
}

function emitPoly(
  w: DxfWriter,
  el: Element,
  place: ResolvedPlacement,
  closed: boolean,
): void {
  const pts = parsePoints(el.getAttribute('points') ?? '');
  if (pts.length < 2) return;
  const out = pts.map((p) => worldToDxf(localToWorld(p, place)));
  w.lwpolyline(LAYER_ELEMENTS, out, closed);
}

function emitRect(
  w: DxfWriter,
  el: Element,
  place: ResolvedPlacement,
): void {
  const x = numAttr(el, 'x');
  const y = numAttr(el, 'y');
  const ww = numAttr(el, 'width');
  const hh = numAttr(el, 'height');
  const corners: [number, number][] = [
    [x, y],
    [x + ww, y],
    [x + ww, y + hh],
    [x, y + hh],
  ];
  const out = corners.map((p) => worldToDxf(localToWorld(p, place)));
  w.lwpolyline(LAYER_ELEMENTS, out, true);
}

function emitCircle(
  w: DxfWriter,
  el: Element,
  place: ResolvedPlacement,
): void {
  const cx = numAttr(el, 'cx');
  const cy = numAttr(el, 'cy');
  const r = numAttr(el, 'r');
  const center = worldToDxf(localToWorld([cx, cy], place));
  w.circle(LAYER_ELEMENTS, center, r);
}

function emitEllipse(
  w: DxfWriter,
  el: Element,
  place: ResolvedPlacement,
): void {
  const cx = numAttr(el, 'cx');
  const cy = numAttr(el, 'cy');
  const rx = numAttr(el, 'rx');
  const ry = numAttr(el, 'ry');
  if (Math.abs(rx - ry) < 1e-6) {
    emitCircleRaw(w, cx, cy, rx, place);
    return;
  }
  sampleEllipse(w, cx, cy, rx, ry, place);
}

function emitCircleRaw(
  w: DxfWriter,
  cx: number,
  cy: number,
  r: number,
  place: ResolvedPlacement,
): void {
  const center = worldToDxf(localToWorld([cx, cy], place));
  w.circle(LAYER_ELEMENTS, center, r);
}

function sampleEllipse(
  w: DxfWriter,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  place: ResolvedPlacement,
): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < ELLIPSE_SAMPLES; i++) {
    const t = (i / ELLIPSE_SAMPLES) * Math.PI * 2;
    pts.push(
      worldToDxf(
        localToWorld([cx + rx * Math.cos(t), cy + ry * Math.sin(t)], place),
      ),
    );
  }
  w.lwpolyline(LAYER_ELEMENTS, pts, true);
}

function emitText(
  w: DxfWriter,
  el: Element,
  place: ResolvedPlacement,
): void {
  const x = numAttr(el, 'x');
  const y = numAttr(el, 'y');
  const fs = parseFloat(el.getAttribute('font-size') ?? '') || TEXT_FONT_SIZE_DEFAULT;
  const txt = (el.textContent ?? '').trim();
  if (!txt) return;
  const p = worldToDxf(localToWorld([x, y], place));
  // place.rot is CCW in math frame (see transforms.ts); after flipping Y we
  // are in DXF's CCW frame, so the same numeric angle maps directly.
  w.text(LAYER_ELEMENTS, p, txt, fs, place.rot, place.mirror);
}

// -----------------------------------------------------------------------------
// SVG path (M / A subset) → sampled LWPOLYLINE
// -----------------------------------------------------------------------------

function emitPath(
  w: DxfWriter,
  el: Element,
  place: ResolvedPlacement,
): void {
  const d = el.getAttribute('d') ?? '';
  const cmds = tokenizePath(d);
  if (cmds.length === 0) return;

  let pen: [number, number] | null = null;
  let buffer: [number, number][] = [];
  const flush = () => {
    if (buffer.length >= 2) {
      w.lwpolyline(
        LAYER_ELEMENTS,
        buffer.map((p) => worldToDxf(localToWorld(p, place))),
        false,
      );
    }
    buffer = [];
  };

  for (const c of cmds) {
    if (c.cmd === 'M') {
      flush();
      pen = [c.args[0], c.args[1]];
      buffer.push(pen);
    } else if (c.cmd === 'A' && pen) {
      const [rx, ry, , large, sweep, x2, y2] = c.args;
      const arc = arcEndpointToCenter(
        pen,
        [x2, y2],
        rx,
        ry,
        large !== 0,
        sweep !== 0,
      );
      if (arc) {
        // Skip the start point (already pushed by M or previous segment) and
        // sample the rest.
        for (let i = 1; i <= ARC_SAMPLES; i++) {
          const t = arc.theta1 + (arc.delta * i) / ARC_SAMPLES;
          buffer.push([
            arc.cx + rx * Math.cos(t),
            arc.cy + ry * Math.sin(t),
          ]);
        }
      } else {
        buffer.push([x2, y2]); // degenerate: straight line fallback
      }
      pen = [x2, y2];
    }
  }
  flush();
}

interface PathCmd {
  cmd: 'M' | 'A';
  args: number[];
}

function tokenizePath(d: string): PathCmd[] {
  const out: PathCmd[] = [];
  // Split by command letter while preserving the letter.
  const re = /([MmAa])([^MmAa]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const cmd = m[1].toUpperCase() as 'M' | 'A';
    const nums = m[2]
      .trim()
      .split(/[\s,]+/)
      .filter((s) => s.length > 0)
      .map(Number);
    out.push({ cmd, args: nums });
  }
  return out;
}

interface ArcCenter {
  cx: number;
  cy: number;
  theta1: number;
  delta: number;
}

/**
 * SVG endpoint → center parametrization (W3C SVG 1.1 §F.6.5). Assumes
 * x-axis-rotation = 0 (verified across the element library).
 */
function arcEndpointToCenter(
  p1: [number, number],
  p2: [number, number],
  rx: number,
  ry: number,
  largeArc: boolean,
  sweep: boolean,
): ArcCenter | null {
  if (rx <= 0 || ry <= 0) return null;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  if (x1 === x2 && y1 === y2) return null;

  const x1p = (x1 - x2) / 2;
  const y1p = (y1 - y2) / 2;

  let RX = Math.abs(rx);
  let RY = Math.abs(ry);
  const r2x = RX * RX;
  const r2y = RY * RY;
  const lambda = (x1p * x1p) / r2x + (y1p * y1p) / r2y;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    RX *= s;
    RY *= s;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const num = RX * RX * RY * RY - RX * RX * y1p * y1p - RY * RY * x1p * x1p;
  const den = RX * RX * y1p * y1p + RY * RY * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));

  const cxp = (coef * (RX * y1p)) / RY;
  const cyp = (coef * -(RY * x1p)) / RX;

  const cx = cxp + (x1 + x2) / 2;
  const cy = cyp + (y1 + y2) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };

  const theta1 = angle(1, 0, (x1p - cxp) / RX, (y1p - cyp) / RY);
  let delta = angle(
    (x1p - cxp) / RX,
    (y1p - cyp) / RY,
    (-x1p - cxp) / RX,
    (-y1p - cyp) / RY,
  );
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  else if (sweep && delta < 0) delta += 2 * Math.PI;

  return { cx, cy, theta1, delta };
}

// -----------------------------------------------------------------------------
// Geometry helpers
// -----------------------------------------------------------------------------

function localToWorld(
  local: [number, number],
  place: ResolvedPlacement,
): [number, number] {
  return transformPoint(local, place);
}

function worldToDxf(p: [number, number]): [number, number] {
  return [p[0], -p[1]];
}

function numAttr(el: Element, name: string): number {
  const v = parseFloat(el.getAttribute(name) ?? '');
  return Number.isFinite(v) ? v : 0;
}

function parsePoints(raw: string): [number, number][] {
  const nums = raw.trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

// -----------------------------------------------------------------------------
// Element labels — mirrors AnnotationLayer.tsx so DXF text matches the canvas
// -----------------------------------------------------------------------------

function labelLines(re: ResolvedElement, mode: LabelMode): string[] {
  const lines: string[] = [];
  const head = re.element.name?.trim() || re.element.id;
  if (head) lines.push(head);
  if (mode !== 'all' || !re.libraryDef?.params) return lines;
  const params = re.element.params ?? {};
  for (const p of re.libraryDef.params) {
    if (!p.showOnCanvas) continue;
    const v = params[p.name];
    if (v === undefined || v === null || v === '') continue;
    lines.push(`${v}${p.unit ?? ''}`);
  }
  return lines;
}

function fallbackAnchor(lib: LibraryEntry): LibraryLabelAnchor {
  const vb = parseViewBox(lib.viewBox);
  if (!vb) return { x: 0, y: 0, anchor: 'start' };
  return { x: vb.x + vb.w + 2, y: vb.y + 4, anchor: 'start' };
}

function parseViewBox(s: string): { x: number; y: number; w: number; h: number } | null {
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

function anchorWorld(
  anchor: LibraryLabelAnchor,
  place: ResolvedPlacement,
  _lib: LibraryEntry,
): [number, number] {
  let x = anchor.x;
  let y = anchor.y;
  if (place.mirror) x = -x;
  switch (place.rot) {
    case 90:
      [x, y] = [-y, x];
      break;
    case 180:
      [x, y] = [-x, -y];
      break;
    case 270:
      [x, y] = [y, -x];
      break;
    default:
      break;
  }
  return [x + place.at[0], y + place.at[1]];
}

// -----------------------------------------------------------------------------
// DXF writer — minimal ASCII (AC1009) emitter
// -----------------------------------------------------------------------------

class DxfWriter {
  private out: string[] = [];
  // Explicit field + assignment rather than a constructor parameter
  // property — embedding consumers (load-survey) compile this file
  // through their own tsconfig with `erasableSyntaxOnly: true`, which
  // rejects non-erasable TS syntax like ``private readonly precision``.
  private readonly precision: number;

  constructor(precision: number) {
    this.precision = precision;
  }

  toString(): string {
    return this.out.join('');
  }

  private g(code: number, value: string | number): void {
    this.out.push(`${code}\n${this.fmt(value)}\n`);
  }

  private fmt(v: string | number): string {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return '0';
      if (Number.isInteger(v)) return String(v);
      return v.toFixed(this.precision);
    }
    return v;
  }

  header(title?: string): void {
    this.g(0, 'SECTION');
    this.g(2, 'HEADER');
    this.g(9, '$ACADVER');
    this.g(1, 'AC1009');
    this.g(9, '$INSUNITS');
    this.g(70, 0);
    if (title) {
      this.g(9, '$PROJECTNAME');
      this.g(1, sanitizeText(title));
    }
    this.g(0, 'ENDSEC');
  }

  tables(layers: { name: string; color: number }[]): void {
    this.g(0, 'SECTION');
    this.g(2, 'TABLES');
    this.g(0, 'TABLE');
    this.g(2, 'LAYER');
    this.g(70, layers.length);
    for (const l of layers) {
      this.g(0, 'LAYER');
      this.g(2, l.name);
      this.g(70, 0);
      this.g(62, l.color);
      this.g(6, 'CONTINUOUS');
    }
    this.g(0, 'ENDTAB');
    this.g(0, 'ENDSEC');
  }

  beginEntities(): void {
    this.g(0, 'SECTION');
    this.g(2, 'ENTITIES');
  }

  endEntities(): void {
    this.g(0, 'ENDSEC');
    this.g(0, 'EOF');
  }

  line(layer: string, p1: [number, number], p2: [number, number]): void {
    this.g(0, 'LINE');
    this.g(8, layer);
    this.g(10, p1[0]);
    this.g(20, p1[1]);
    this.g(30, 0);
    this.g(11, p2[0]);
    this.g(21, p2[1]);
    this.g(31, 0);
  }

  lwpolyline(layer: string, points: [number, number][], closed: boolean): void {
    if (points.length < 2) return;
    this.g(0, 'LWPOLYLINE');
    this.g(8, layer);
    this.g(90, points.length);
    this.g(70, closed ? 1 : 0);
    for (const [x, y] of points) {
      this.g(10, x);
      this.g(20, y);
    }
  }

  circle(layer: string, center: [number, number], radius: number): void {
    this.g(0, 'CIRCLE');
    this.g(8, layer);
    this.g(10, center[0]);
    this.g(20, center[1]);
    this.g(30, 0);
    this.g(40, radius);
  }

  text(
    layer: string,
    p: [number, number],
    text: string,
    height: number,
    rotationDeg: number,
    mirrorX: boolean,
  ): void {
    this.g(0, 'TEXT');
    this.g(8, layer);
    this.g(10, p[0]);
    this.g(20, p[1]);
    this.g(30, 0);
    this.g(40, height);
    this.g(1, sanitizeText(text));
    if (rotationDeg !== 0) this.g(50, rotationDeg);
    if (mirrorX) this.g(71, 2);
  }
}

function sanitizeText(s: string): string {
  // DXF group code 1 fields are line-delimited; strip newlines so a multi-line
  // annotation can't smuggle its own DXF directives. Also clamp length to
  // 250 chars (DXF R12 line limit) to be safe.
  return s.replace(/[\r\n]+/g, ' ').slice(0, 250);
}
