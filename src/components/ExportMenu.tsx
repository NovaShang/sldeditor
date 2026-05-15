/**
 * Export menu — render the current diagram to SVG or PNG and trigger a
 * download. Reads the InternalModel from the store so the file matches what
 * the canvas shows minus UI chrome (selection halos, terminal hit rects,
 * etc.). Exported alongside `FileMenu` for embedding apps.
 */

import { Download, FileBox, FileImage, FileType } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { useT } from '../i18n';
import { downloadDxf } from '../lib/export-dxf';
import { downloadPng, downloadSvg } from '../lib/export-image';
import { useEditorStore } from '../store';

export function ExportMenu() {
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

  const exportAs = (kind: 'svg' | 'png' | 'dxf') => () => {
    setOpen(false);
    const { internal, diagram, fileSession } = useEditorStore.getState();
    const baseName =
      fileSession?.name?.replace(/\.json$/i, '') ?? diagram.meta?.title ?? 'diagram';
    const opts = {
      title: diagram.meta?.title,
      labelMode: diagram.meta?.labelMode,
      annotations: diagram.annotations,
    };
    if (kind === 'svg') downloadSvg(internal, `${baseName}.svg`, opts);
    else if (kind === 'png')
      downloadPng(internal, `${baseName}.png`, { ...opts, scale: 2 }).catch((err) => {
        console.error(err);
        alert(t('topbar.export.pngFailed', { err: (err as Error).message }));
      });
    else
      downloadDxf(internal, `${baseName}.dxf`, opts).catch((err) => {
        console.error(err);
        alert(t('topbar.export.dxfFailed', { err: (err as Error).message }));
      });
  };

  return (
    <div ref={ref} className="relative">
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
          <button
            type="button"
            role="menuitem"
            onClick={exportAs('dxf')}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground [&>svg]:size-4"
          >
            <FileBox />
            <span className="flex-1">DXF</span>
          </button>
        </div>
      )}
    </div>
  );
}
