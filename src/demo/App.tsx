import { OneLineEditor } from '../OneLineEditor';
import { DemoTopBar } from './DemoTopBar';
import { SAMPLE_DIAGRAM } from './sample-diagram';

export function App() {
  return (
    <div className="relative h-full w-full">
      <OneLineEditor diagram={SAMPLE_DIAGRAM} />
      <DemoTopBar />
    </div>
  );
}
