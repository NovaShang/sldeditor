import { useEffect, useState } from 'react';
import { OneLineEditor } from '../OneLineEditor';
import { DemoTopBar } from './DemoTopBar';
import { SAMPLE_DIAGRAM } from './sample-diagram';
import { CIRCUIT_DIAGRAM } from './circuit-diagram';
import { ViewerDemo } from './ViewerDemo';

/** `/#viewer` shows the read-only runtime viewer instead of the editor;
 *  `/#circuit` seeds a circuit diagram (on a first visit / cleared storage). */
function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function App() {
  const hash = useHashRoute();
  if (hash === '#viewer') return <ViewerDemo />;
  return (
    <div className="relative h-full w-full">
      <OneLineEditor diagram={hash === '#circuit' ? CIRCUIT_DIAGRAM : SAMPLE_DIAGRAM} />
      <DemoTopBar />
    </div>
  );
}
