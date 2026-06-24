import type { Tool, ToolId } from './types';
import { SelectTool } from './SelectTool';
import { PanTool } from './PanTool';
import { WireTool } from './WireTool';
import { PlaceTool } from './PlaceTool';
import { BusbarTool } from './BusbarTool';
import { JunctionTool } from './JunctionTool';
import { TextTool } from './TextTool';

export const TOOLS: Record<ToolId, Tool> = {
  select: SelectTool,
  pan: PanTool,
  wire: WireTool,
  place: PlaceTool,
  busbar: BusbarTool,
  junction: JunctionTool,
  text: TextTool,
};

export type { Tool, ToolContext, ToolId } from './types';
