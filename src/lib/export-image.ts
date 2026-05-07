/**
 * Export the current diagram as a standalone SVG (or rasterized PNG). Builds
 * the SVG offline from `InternalModel` rather than scraping the live canvas
 * — this keeps UI chrome (selection halos, terminal hit rects, marquee,
 * etc.) out of the file and crops tightly around the actual content.
 */

import { libraryById } from '../element-library';
import { transformAttr } from '../canvas/transform-attr';
import { transformPoint, type InternalModel, type ResolvedPlacement } from '../compiler';
import type { LibraryEntry } from '../model';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PADDING = 24;

interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ExportOptions {
  /** Title used as the suggested filename / SVG <title>. */
  title?: string;
  /** Background fill (`'transparent'` skips the rect). Default white. */
  background?: string;
}

export function buildExportSvg(
  model: InternalModel,
  opts: ExportOptions = {},
): string {
  const bbox = computeContentBbox(model);
  const x = Math.floor(bbox.minX - PADDING);
  const y = Math.floor(bbox.minY - PADDING);
  const w = Math.ceil(bbox.maxX + PADDING) - x;
  const h = Math.ceil(bbox.maxY + PADDING) - y;
  const bg = opts.background ?? '#FFFFFF';

  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<svg xmlns="${SVG_NS}" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">`,
  );
  if (opts.title) out.push(`  <title>${escapeXml(opts.title)}</title>`);
  if (bg !== 'transparent') {
    out.push(
      `  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bg}"/>`,
    );
  }

  // Wires first (rendered behind elements).
  out.push('  <g fill="none" stroke="black" stroke-width="1">');
  for (const [, route] of model.routes) {
    for (const path of route.paths) {
      if (path.length < 2) continue;
      const pts = path.map(([px, py]) => `${px},${py}`).join(' ');
      out.push(`    <polyline points="${pts}"/>`);
    }
  }
  out.push('  </g>');

  // Elements.
  for (const re of model.elements.values()) {
    if (!re.libraryDef) continue;
    const place = model.layout.get(re.element.id);
    if (!place) continue;
    const lib = libraryById[re.element.kind];
    out.push(
      `  <g id="${escapeXml(re.element.id)}" transform="${transformAttr(place, lib)}">`,
    );
    out.push(`    ${re.libraryDef.svg}`);
    out.push('  </g>');
  }

  out.push('</svg>');
  return out.join('\n');
}

function computeContentBbox(model: InternalModel): Bbox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const update = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  for (const t of model.terminals.values()) update(t.world[0], t.world[1]);
  for (const re of model.elements.values()) {
    const place = model.layout.get(re.element.id);
    const lib = re.libraryDef;
    if (!place || !lib) continue;
    const vb = parseViewBox(lib.viewBox);
    if (!vb) {
      update(place.at[0], place.at[1]);
      continue;
    }
    // Stretchable elements (busbars) scale their viewBox along the stretch
    // axis by `span / referenceLength`. Apply that pre-rotation so the bbox
    // matches the rendered transform from `transformAttr`.
    const sx = stretchFactor(lib, place, 'x');
    const sy = stretchFactor(lib, place, 'y');
    const corners: Array<[number, number]> = [
      [vb.x * sx, vb.y * sy],
      [(vb.x + vb.w) * sx, vb.y * sy],
      [vb.x * sx, (vb.y + vb.h) * sy],
      [(vb.x + vb.w) * sx, (vb.y + vb.h) * sy],
    ];
    for (const c of corners) {
      const [wx, wy] = transformPoint(c, place);
      update(wx, wy);
    }
  }
  for (const route of model.routes.values()) {
    for (const path of route.paths) {
      for (const [x, y] of path) update(x, y);
    }
  }
  if (minX === Infinity) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  return { minX, minY, maxX, maxY };
}

function stretchFactor(
  lib: LibraryEntry,
  place: ResolvedPlacement,
  axis: 'x' | 'y',
): number {
  const stretch = lib.stretchable;
  if (!stretch || stretch.axis !== axis || !place.span) return 1;
  if (lib.terminals.length < 2) return 1;
  const vs = lib.terminals.map((t) => (axis === 'x' ? t.x : t.y));
  const ref = Math.max(...vs) - Math.min(...vs);
  if (ref <= 0) return 1;
  return place.span / ref;
}

function parseViewBox(
  s: string,
): { x: number; y: number; w: number; h: number } | null {
  const parts = s.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null;
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function downloadSvg(
  model: InternalModel,
  filename = 'diagram.svg',
  opts?: ExportOptions,
): Promise<void> {
  const xml = buildExportSvg(model, opts);
  triggerDownload(
    new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }),
    filename,
  );
}

export async function downloadPng(
  model: InternalModel,
  filename = 'diagram.png',
  opts?: ExportOptions & { scale?: number },
): Promise<void> {
  const xml = buildExportSvg(model, opts);
  const scale = opts?.scale ?? 2;

  const url = URL.createObjectURL(
    new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    if (opts?.background && opts.background !== 'transparent') {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
    triggerDownload(blob, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load SVG into image'));
    img.src = src;
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
