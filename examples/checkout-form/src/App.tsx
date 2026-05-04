import React from 'react';
import { CheckoutForm } from './CheckoutForm';
import { graph, coverage } from '@veriscope/graph';
import { mountDevtools } from '@veriscope/devtools';

export function App() {
  const devtoolsRef = React.useRef<HTMLDivElement>(null);
  const handleRef = React.useRef<ReturnType<typeof mountDevtools> | null>(null);

  React.useEffect(() => {
    if (devtoolsRef.current && !handleRef.current) {
      graph.enableCoverage();
      graph.startRecording();
      handleRef.current = mountDevtools(devtoolsRef.current, graph, {
        height: '360px',
        coverage,
      });
    }
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, []);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 20 }}>
      <h1>Veriscope Ship Gate: Checkout Form</h1>
      <p>
        8 tracked signals, 4 derived values, 5 assertions, 1 edge effect.
        Open the devtools panel below to see the live waveform, dependency graph, and assertion status.
      </p>
      <CheckoutForm />
      <hr style={{ margin: '20px 0' }} />
      <h3>Devtools</h3>
      <div ref={devtoolsRef} style={{ width: '100%' }} />
    </div>
  );
}
