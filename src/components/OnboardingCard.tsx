/**
 * Empty-canvas onboarding card. Surfaces the canonical drawing flow:
 * busbar first → drag elements off the bus → chain from terminals.
 *
 * Visibility:
 *   - Hidden once any element exists (the card competes with the work).
 *   - Hidden once the user clicks "got it" (persisted across reloads).
 *   - Hidden in non-select tools so it doesn't fight the library popover or
 *     active drawing previews.
 */

import { Cable, Minus, Shapes, X } from 'lucide-react';
import { useOnboarding } from '../hooks/use-onboarding';
import { useT } from '../i18n';
import { useEditorStore } from '../store';

export function OnboardingCard() {
  const t = useT();
  const dismissed = useOnboarding((s) => s.dismissed);
  const dismiss = useOnboarding((s) => s.dismiss);
  const isEmpty = useEditorStore((s) => s.diagram.elements.length === 0);
  const tool = useEditorStore((s) => s.activeTool);
  const visible = isEmpty && !dismissed && (tool === 'select' || tool === 'pan');
  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label={t('onboard.title')}
      className="ole-glass pointer-events-auto absolute left-1/2 top-1/2 z-10 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border p-5 shadow-md"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('onboard.title')}</h2>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('onboard.dismiss')}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <ol className="mt-3 space-y-2.5">
        <Step
          n={1}
          icon={<Minus />}
          title={t('onboard.step1.title')}
          body={t('onboard.step1.body')}
        />
        <Step
          n={2}
          icon={<Shapes />}
          title={t('onboard.step2.title')}
          body={t('onboard.step2.body')}
        />
        <Step
          n={3}
          icon={<Cable />}
          title={t('onboard.step3.title')}
          body={t('onboard.step3.body')}
        />
      </ol>
      <button
        type="button"
        onClick={dismiss}
        className="mt-4 w-full rounded-md bg-primary py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t('onboard.dismiss')}
      </button>
    </div>
  );
}

function Step({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--selection)_18%,transparent)] font-mono text-[10px] font-semibold tabular-nums text-[var(--selection)]"
        aria-hidden
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <span className="text-muted-foreground [&>svg]:size-3.5">{icon}</span>
          <span>{title}</span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {body}
        </p>
      </div>
    </li>
  );
}
