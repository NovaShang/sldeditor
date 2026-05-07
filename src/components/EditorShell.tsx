import { CanvasSvg } from '@/canvas';
import { ContextMenuHost } from './ContextMenu';
import { ContextualToolbar } from './ContextualToolbar';
import { FloatingToolbar } from './FloatingToolbar';
import { LeftPanel } from './LeftPanel';
import { LibraryPopover } from './LibraryPopover';
import { RightPanel } from './RightPanel';
import { TopBar } from './TopBar';
import { ViewToolbar } from './ViewToolbar';

export function EditorShell() {
  return (
    <ContextMenuHost>
      <div className="relative h-full w-full overflow-hidden bg-background text-foreground">
        <CanvasSvg />
        <LeftPanel />
        <RightPanel />
        <TopBar />
        <FloatingToolbar />
        <ViewToolbar />
        <ContextualToolbar />
        <LibraryPopover />
      </div>
    </ContextMenuHost>
  );
}
