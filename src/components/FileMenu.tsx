/**
 * File menu — New / Open / Save / Save As, plus ⌘O / ⌘S / ⌘⇧S keyboard
 * shortcuts. Renders as a dropdown button. Self-contained: reads/writes the
 * editor store directly and prompts the OS file picker (FS Access API where
 * available, hidden input fallback otherwise).
 *
 * Exported from the library so that embedding apps that want a "local file"
 * mode without backend can drop it into their own toolbar.
 *
 * `iconOnly` drops the visible label (the button keeps it as its accessible
 * name and tooltip) so a host toolbar that runs out of width — a phone — can
 * collapse it like its own buttons.
 *
 * Mounted in a host toolbar it sits OUTSIDE the editor's `.ole-root`, where
 * none of the library's scoped utilities reach (its icon fell back to
 * lucide's 24px default, in the host's text colour). So it carries its own
 * scope: an `ole-root ole-inline` wrapper that takes no box of its own.
 *
 * A host that wants the menu in its own design system instead (its own
 * dropdown, its own icon size) builds it from `useFileActions` — the same
 * actions and localized labels — plus `useFileShortcuts` for ⌘O / ⌘S / ⌘⇧S.
 */

import { FilePlus, FolderOpen, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { useFileActions, useFileShortcuts } from '../hooks/use-file-actions';

export interface FileMenuProps {
  /** Render the trigger as an icon-only button; the label stays its accessible name. */
  iconOnly?: boolean;
}

export function FileMenu({ iconOnly = false }: FileMenuProps = {}) {
  const actions = useFileActions();
  const { labels, onNew, onOpen, onSave, onSaveAs } = actions;
  const label = labels.file;
  const fileLabel = actions.fileName;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useFileShortcuts(actions);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="ole-root ole-inline">
      <div ref={ref} className="relative">
        <Button
          variant="ghost"
          size="sm"
          className={iconOnly ? 'w-8 px-0' : 'gap-1.5'}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={iconOnly ? label : undefined}
          title={iconOnly ? label : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <FolderOpen />
          {!iconOnly && label}
        </Button>
        {open && (
          <div
            role="menu"
            className="ole-glass absolute start-0 top-full mt-1.5 min-w-44 rounded-md border border-border p-1 shadow-md"
          >
            <div className="border-b border-border px-2 pb-1.5 pt-1 text-xs text-muted-foreground">
              {fileLabel}
            </div>
            <MenuItem onClick={run(onNew)} icon={<FilePlus />}>
              {labels.new}
            </MenuItem>
            <MenuItem onClick={run(onOpen)} icon={<FolderOpen />} hint="⌘O">
              {labels.open}
            </MenuItem>
            <MenuItem onClick={run(onSave)} icon={<Save />} hint="⌘S">
              {labels.save}
            </MenuItem>
            <MenuItem onClick={run(onSaveAs)} icon={<Save />} hint="⌘⇧S">
              {labels.saveAs}
            </MenuItem>
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  children,
  icon,
  hint,
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground [&>svg]:size-4"
    >
      {icon}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-xs tabular-nums text-muted-foreground">{hint}</span>}
    </button>
  );
}
