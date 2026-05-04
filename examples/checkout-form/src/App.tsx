import React from 'react';
import { CheckoutForm } from './CheckoutForm';
import { graph } from '@veriscope/graph';
import { mountDevtools } from '@veriscope/devtools';

export function App() {
  const devtoolsRef = React.useRef<HTMLDivElement>(null);
  const handleRef = React.useRef<ReturnType<typeof mountDevtools> | null>(null);

  React.useEffect(() => {
    if (devtoolsRef.current && !handleRef.current) {
      // Start recording before mounting so the waveform has data
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
      <h1>Veriscope Demo: Checkout Form</h1>
      <p>This form uses <code>@veriscope/react</code> hooks with assertions from <code>@veriscope/graph</code>.</p>
      <CheckoutForm />
      <hr style={{ margin: '20px 0' }} />
      <div ref={devtoolsRef} style={{ width: '100%' }} />
    </div>
  );
}
