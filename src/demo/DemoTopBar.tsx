/**
 * Demo-only chrome: file open/save/save-as, image export, theme toggle.
 *
 * Lives in `src/demo/` rather than the editor library because real
 * consumers usually own their persistence layer (load DiagramFile from
 * their backend, save back via their own UI). The library exposes the
 * store actions and image helpers; this is just a reference wiring.
 */

import {
  Download,
  FileImage,
  FilePlus,
  FileType,
  FolderOpen,
  Languages,
  Moon,
  Save,
  Sun,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/tooltip';
import { useTheme } from '../hooks/use-theme';
import { useLocale, useT } from '../i18n';
import { openDiagram, saveDiagram } from '../lib/file-io';
import { downloadPng, downloadSvg } from '../lib/export-image';
import { useEditorStore } from '../store';

export function DemoTopBar() {
  const t = useT();
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  const fileSession = useEditorStore((s) => s.fileSession);
  const fileLabel = fileSession?.name ?? t('common.unnamed');

  const { onNew, onOpen, onSave, onSaveAs } = useFileActions();

  // Cmd/Ctrl + O / S / Shift+S — keyboard shortcuts for file ops.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'o') {
        e.preventDefault();
        onOpen();
      } else if (k === 's') {
        e.preventDefault();
        if (e.shiftKey) onSaveAs();
        else onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpen, onSave, onSaveAs]);

  return (
    <div className="absolute left-3 top-3 z-20">
      <div className="ole-glass flex items-center gap-0.5 rounded-2xl border border-border p-1.5 shadow-sm">
        <FileMenu
          fileLabel={fileLabel}
          onNew={onNew}
          onOpen={onOpen}
          onSave={onSave}
          onSaveAs={onSaveAs}
        />
        <ExportMenu />
        <div aria-hidden className="mx-1 h-4 w-px bg-border" />
        <LocaleToggle />
        <Tooltip
          content={
            <div className="space-y-0.5">
              <div className="font-medium">
                {isDark ? t('topbar.theme.toLight') : t('topbar.theme.toDark')}
              </div>
              <div className="text-muted-foreground">
                {isDark
                  ? t('topbar.theme.currentDark')
                  : t('topbar.theme.currentLight')}
              </div>
            </div>
          }
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              isDark ? t('topbar.theme.toLight') : t('topbar.theme.toDark')
            }
            aria-pressed={isDark}
            onClick={toggle}
          >
            {isDark ? <Sun /> : <Moon />}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

function LocaleToggle() {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const toggle = useLocale((s) => s.toggle);
  const isZh = locale === 'zh';
  return (
    <Tooltip
      content={
        <div className="space-y-0.5">
          <div className="font-medium">
            {isZh ? t('topbar.lang.toEnglish') : t('topbar.lang.toChinese')}
          </div>
          <div className="text-muted-foreground">
            {isZh
              ? t('topbar.lang.currentChinese')
              : t('topbar.lang.currentEnglish')}
          </div>
        </div>
      }
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label={
          isZh ? t('topbar.lang.toEnglish') : t('topbar.lang.toChinese')
        }
        onClick={toggle}
      >
        <Languages />
      </Button>
    </Tooltip>
  );
}

function ExportMenu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const exportAs = (kind: 'svg' | 'png') => () => {
    setOpen(false);
    const { internal, diagram, fileSession } = useEditorStore.getState();
    const baseName =
      fileSession?.name?.replace(/\.json$/i, '') ?? diagram.meta?.title ?? 'diagram';
    const opts = { title: diagram.meta?.title };
    if (kind === 'svg') downloadSvg(internal, `${baseName}.svg`, opts);
    else
      downloadPng(internal, `${baseName}.png`, { ...opts, scale: 2 }).catch((err) => {
        console.error(err);
        alert(t('topbar.export.pngFailed', { err: (err as Error).message }));
      });
  };

  return (
    <div ref={ref} className="relative">
      <Tooltip
        content={
          <div className="space-y-0.5">
            <div className="font-medium">{t('topbar.export.label')}</div>
            <div className="text-muted-foreground">
              {t('topbar.export.tooltip')}
            </div>
          </div>
        }
        disabled={open}
      >
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Download />
          {t('topbar.export.label')}
        </Button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          className="ole-glass absolute left-0 top-full mt-1.5 min-w-40 rounded-md border border-border p-1 shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            onClick={exportAs('svg')}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground [&>svg]:size-4"
          >
            <FileType />
            <span className="flex-1">SVG</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={exportAs('png')}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground [&>svg]:size-4"
          >
            <FileImage />
            <span className="flex-1">PNG (2×)</span>
          </button>
        </div>
      )}
    </div>
  );
}

function FileMenu({
  fileLabel,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
}: {
  fileLabel: string;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    <div ref={ref} className="relative">
      <Tooltip
        content={
          <div className="space-y-0.5">
            <div>
              <span className="font-medium">{t('topbar.file.label')}</span>
              <span className="ml-1.5 text-muted-foreground">
                ⌘O / ⌘S / ⌘⇧S
              </span>
            </div>
            <div className="text-muted-foreground">
              {t('topbar.file.current', { name: fileLabel })}
            </div>
            <div className="text-muted-foreground">
              {t('topbar.file.tooltip')}
            </div>
          </div>
        }
        disabled={open}
      >
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <FolderOpen />
          {t('topbar.file.label')}
        </Button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          className="ole-glass absolute left-0 top-full mt-1.5 min-w-44 rounded-md border border-border p-1 shadow-md"
        >
          <div className="border-b border-border px-2 pb-1.5 pt-1 text-xs text-muted-foreground">
            {fileLabel}
          </div>
          <MenuItem onClick={run(onNew)} icon={<FilePlus />}>
            {t('topbar.file.new')}
          </MenuItem>
          <MenuItem onClick={run(onOpen)} icon={<FolderOpen />} hint="⌘O">
            {t('topbar.file.open')}
          </MenuItem>
          <MenuItem onClick={run(onSave)} icon={<Save />} hint="⌘S">
            {t('topbar.file.save')}
          </MenuItem>
          <MenuItem onClick={run(onSaveAs)} icon={<Save />} hint="⌘⇧S">
            {t('topbar.file.saveAs')}
          </MenuItem>
        </div>
      )}
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
      {hint && (
        <span className="text-xs tabular-nums text-muted-foreground">{hint}</span>
      )}
    </button>
  );
}

function useFileActions() {
  const t = useT();
  const loadDiagramFromFile = useEditorStore((s) => s.loadDiagramFromFile);
  const setFileSession = useEditorStore((s) => s.setFileSession);
  const setDiagram = useEditorStore((s) => s.setDiagram);

  const onNew = () => {
    const { diagram } = useEditorStore.getState();
    if (diagram.elements.length > 0) {
      const ok = confirm(t('topbar.file.newConfirm'));
      if (!ok) return;
    }
    setDiagram({ version: '1', elements: [] });
    setFileSession(null);
  };

  const onOpen = async () => {
    try {
      const result = await openDiagram();
      if (result) loadDiagramFromFile(result.diagram, result.session);
    } catch (e) {
      alert(t('topbar.file.openFailed', { err: (e as Error).message }));
    }
  };

  const onSave = async () => {
    try {
      const { diagram, fileSession } = useEditorStore.getState();
      const session = await saveDiagram(diagram, fileSession);
      if (session) setFileSession(session);
    } catch (e) {
      alert(t('topbar.file.saveFailed', { err: (e as Error).message }));
    }
  };

  const onSaveAs = async () => {
    try {
      const { diagram, fileSession } = useEditorStore.getState();
      const session = await saveDiagram(diagram, fileSession, { saveAs: true });
      if (session) setFileSession(session);
    } catch (e) {
      alert(t('topbar.file.saveFailed', { err: (e as Error).message }));
    }
  };

  return { onNew, onOpen, onSave, onSaveAs };
}
