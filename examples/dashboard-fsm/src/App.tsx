import React from 'react';
import { Dashboard } from './Dashboard';
import { graph } from '@veriscope/graph';
import { mountDevtools } from '@veriscope/devtools';
import '@veriscope/devtools/bridge';

export function App() {
  const devtoolsRef = React.useRef<HTMLDivElement>(null);
  const handleRef = React.useRef<ReturnType<typeof mountDevtools> | null>(null);

  React.useEffect(() => {
    if (devtoolsRef.current && !handleRef.current) {
      graph.startRecording();
      handleRef.current = mountDevtools(devtoolsRef.current, graph, {
        height: '360px',
      });
    }
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <h1>Veriscope Dashboard FSM Demo</h1>
      <p>
        4-state FSM (idle → loading → success/error), 3 derived values, 3 assertions.
        Open the devtools panel below to inspect the live reactive graph.
      </p>
      <Dashboard />
      <hr style={{ margin: '20px 0' }} />
      <h3>Devtools</h3>
      <div ref={devtoolsRef} style={{ width: '100%' }} />
    </div>
  );
}
