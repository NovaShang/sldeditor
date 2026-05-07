import { useEffect } from 'react';
import { EditorShell } from '@/components/EditorShell';
import { useKeyboardShortcuts } from '@/canvas';
import type { DiagramFile } from '@/model';
import { useEditorStore } from '@/store';

export interface OneLineEditorProps {
  className?: string;
  /** Initial DiagramFile to render. Re-renders when this reference changes. */
  diagram?: DiagramFile;
}

export function OneLineEditor({ className, diagram }: OneLineEditorProps) {
  const setDiagram = useEditorStore((s) => s.setDiagram);

  useEffect(() => {
    if (diagram) setDiagram(diagram);
  }, [diagram, setDiagram]);

  useKeyboardShortcuts();

  return (
    <div className={className ?? 'h-full w-full'}>
      <EditorShell />
    </div>
  );
}
