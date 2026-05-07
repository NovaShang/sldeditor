import './styles.css';

export { OneLineEditor } from './OneLineEditor';
export type { OneLineEditorProps } from './OneLineEditor';

export type {
  DiagramFile,
  DiagramMeta,
  DiagramVersion,
  Element,
  ElementId,
  PinName,
  NodeId,
  TerminalRef,
  ParamValue,
  Connection,
  NamedConnection,
  Placement,
  Route,
  LibraryEntry,
  LibraryTerminal,
  LibraryStretchable,
  LibraryStateField,
  LibrarySource,
  Orientation,
} from './model';

// Compiler / runtime model — exported so library consumers can build their
// own renderers or analysis tools on top of the same DiagramFile pipeline.
export {
  compile,
  LIBRARY,
  getLibraryEntry,
  emptyInternalModel,
  resolvePlacement,
  transformPoint,
  transformOrientation,
  orientationVec,
} from './compiler';
export type {
  ConnectivityNode,
  Diagnostic,
  InternalModel,
  InternalRoute,
  ResolvedElement,
  ResolvedPlacement,
  TerminalGeometry,
} from './compiler';

export { useEditorStore } from './store';
export type { EditorState } from './store';
