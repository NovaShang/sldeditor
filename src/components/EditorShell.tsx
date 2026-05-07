import { CanvasSvg } from '@/canvas';
import { FloatingToolbar } from './FloatingToolbar';
import { LeftPanel } from './LeftPanel';
import { RightPanel } from './RightPanel';
import { TopBar } from './TopBar';
import { ViewToolbar } from './ViewToolbar';

export function EditorShell() {
  return (
    <div className="flex h-full w-full flex-row bg-background text-foreground">
      <LeftPanel />
      <div className="relative flex h-full min-w-0 flex-1">
        <CanvasSvg />
        <TopBar />
        <FloatingToolbar />
        <ViewToolbar />
      </div>
      <RightPanel />
    </div>
  );
}
