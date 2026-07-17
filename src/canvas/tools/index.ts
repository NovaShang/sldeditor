import type { Tool, ToolId } from './types';
import { SelectTool } from './SelectTool';
import { PanTool } from './PanTool';
import { WireTool } from './WireTool';
import { PlaceTool } from './PlaceTool';
import { BusbarTool } from './BusbarTool';
import { JunctionTool } from './JunctionTool';
import { TextTool } from './TextTool';
import { RectTool } from './RectTool';
import { LineTool } from './LineTool';
import { TableTool } from './TableTool';

export const TOOLS: Record<ToolId, Tool> = {
  select: SelectTool,
  pan: PanTool,
  wire: WireTool,
  place: PlaceTool,
  busbar: BusbarTool,
  junction: JunctionTool,
  text: TextTool,
  rect: RectTool,
  line: LineTool,
  table: TableTool,
};

export type { Tool, ToolContext, ToolId } from './types';
