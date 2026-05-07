/**
 * Grid snap helpers. Snapping is bound to the visual grid: when the user
 * hides the grid (ViewToolbar / `G`), `.hide-grid` lands on the canvas
 * root and snap() returns the value untouched. So "show grid" and "snap to
 * grid" are one switch.
 *
 * Used by: SelectTool drag move, BusHandles span resize, drop-on-bus
 * placement, drag-drop from palette.
 */

export const GRID_SIZE = 10;

export function isSnapEnabled(): boolean {
  if (typeof document === 'undefined') return true;
  const root = document.querySelector('.ole-canvas-root');
  return !!root && !root.classList.contains('hide-grid');
}

export function snap(v: number): number {
  return isSnapEnabled() ? Math.round(v / GRID_SIZE) * GRID_SIZE : v;
}

export function snapPoint(p: [number, number]): [number, number] {
  return [snap(p[0]), snap(p[1])];
}
