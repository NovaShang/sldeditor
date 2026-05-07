/**
 * Renders the in-progress marquee selection rect. Subscribes directly to
 * `marquee-bus` to avoid going through React state for every pointermove.
 */

import { useEffect, useState } from 'react';
import { getMarquee, subscribeMarquee, type MarqueeRect } from './marquee-bus';

export function MarqueeOverlay() {
  const [rect, setRect] = useState<MarqueeRect | null>(getMarquee());
  useEffect(() => subscribeMarquee(setRect), []);

  if (!rect || (rect.w === 0 && rect.h === 0)) return null;
  return (
    <rect
      className="ole-marquee"
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
      pointerEvents="none"
    />
  );
}
