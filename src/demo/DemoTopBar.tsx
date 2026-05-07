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
  Moon,
  Save,
  Sun,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useTheme } from '@/hooks/use-theme';
import { openDiagram, saveDiagram } from '@/lib/file-io';
import { downloadPng, downloadSvg } from '@/lib/export-image';
import { useEditorStore } from '@/store';

export function DemoTopBar() {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  const fileSession = useEditorStore((s) => s.fileSession);
  const fileLabel = fileSession?.name ?? '未命名';

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
        <Tooltip
          content={
            <div className="space-y-0.5">
              <div className="font-medium">
                {isDark ? '切换到亮色' : '切换到暗色'}
              </div>
              <div className="text-muted-foreground">
                当前：{isDark ? '暗色' : '亮色'}主题
              </div>
            </div>
          }
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={isDark ? '切换到亮色' : '切换到暗色'}
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

function ExportMenu() {
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
        alert(`导出 PNG 失败: ${(err as Error).message}`);
      });
  };

  return (
    <div ref={ref} className="relative">
      <Tooltip
        content={
          <div className="space-y-0.5">
            <div className="font-medium">导出</div>
            <div className="text-muted-foreground">
              SVG 矢量（可编辑）或 PNG 位图（2× 高清）
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
          导出
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
              <span className="font-medium">文件</span>
              <span className="ml-1.5 text-muted-foreground">
                ⌘O / ⌘S / ⌘⇧S
              </span>
            </div>
            <div className="text-muted-foreground">
              当前：{fileLabel}
            </div>
            <div className="text-muted-foreground">
              打开本地 .json 图、保存、或另存为
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
          文件
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
            新建
          </MenuItem>
          <MenuItem onClick={run(onOpen)} icon={<FolderOpen />} hint="⌘O">
            打开…
          </MenuItem>
          <MenuItem onClick={run(onSave)} icon={<Save />} hint="⌘S">
            保存
          </MenuItem>
          <MenuItem onClick={run(onSaveAs)} icon={<Save />} hint="⌘⇧S">
            另存为…
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
  const loadDiagramFromFile = useEditorStore((s) => s.loadDiagramFromFile);
  const setFileSession = useEditorStore((s) => s.setFileSession);
  const setDiagram = useEditorStore((s) => s.setDiagram);

  const onNew = () => {
    const { diagram } = useEditorStore.getState();
    if (diagram.elements.length > 0) {
      const ok = confirm('新建会清空当前未保存的内容，是否继续？');
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
      alert(`打开失败：${(e as Error).message}`);
    }
  };

  const onSave = async () => {
    try {
      const { diagram, fileSession } = useEditorStore.getState();
      const session = await saveDiagram(diagram, fileSession);
      if (session) setFileSession(session);
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`);
    }
  };

  const onSaveAs = async () => {
    try {
      const { diagram, fileSession } = useEditorStore.getState();
      const session = await saveDiagram(diagram, fileSession, { saveAs: true });
      if (session) setFileSession(session);
    } catch (e) {
      alert(`保存失败：${(e as Error).message}`);
    }
  };

  return { onNew, onOpen, onSave, onSaveAs };
}
