/**
 * While a lone device is dragged over a conductor it would go in line with,
 * highlight that conductor (every one, for a multi-pole device across phase
 * wires) and mark where it will be cut. Same look as the place ghost's
 * drop-on-wire preview.
 */

import { useEffect, useState } from 'react';
import { getInsertPreview, subscribeInsertPreview, type InsertPlan } from './insert-on-wire';

export function InsertPreview() {
  const [plan, setPlan] = useState<InsertPlan | null>(getInsertPreview());
  useEffect(() => subscribeInsertPreview(setPlan), []);
  if (!plan) return null;
  return <InsertHighlight plan={plan} />;
}

export function InsertHighlight({ plan }: { plan: InsertPlan }) {
  return (
    <g className="ole-insert-preview" pointerEvents="none">
      {plan.hosts.map((path, i) => (
        <polyline
          key={`host-${i}`}
          points={path.map((p) => `${p[0]},${p[1]}`).join(' ')}
          className="ole-insert-host"
        />
      ))}
      {plan.cuts.flatMap((c, i) => [
        <circle key={`a-${i}`} cx={c.pinToStart.at[0]} cy={c.pinToStart.at[1]} r={3} className="ole-insert-cut" />,
        <circle key={`b-${i}`} cx={c.pinToEnd.at[0]} cy={c.pinToEnd.at[1]} r={3} className="ole-insert-cut" />,
      ])}
    </g>
  );
}
