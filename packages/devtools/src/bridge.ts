// bridge.ts — Side-effect import that exposes the CircuitGraph to Chrome DevTools
// Usage: import '@veriscope/devtools/bridge'

import { graph } from '@veriscope/graph';

if (typeof window !== 'undefined') {
  (window as any).__VERISCOPE_GRAPH__ = graph;

  // Dispatch event so DevTools panel knows the bridge is ready
  window.dispatchEvent(new CustomEvent('veriscope-bridge-ready', { detail: { graph } }));

  // Listen for DevTools commands
  window.addEventListener('veriscope-devtools-command', (event: any) => {
    const { command } = event.detail;
    switch (command) {
      case 'snapshot':
        window.dispatchEvent(new CustomEvent('veriscope-devtools-response', {
          detail: { type: 'snapshot', data: graph.snapshot() },
        }));
        break;
      case 'startRecording':
        graph.startRecording();
        break;
      case 'stopRecording':
        graph.stopRecording();
        break;
      case 'getWaveformData': {
        const data = graph.getWaveformData();
        const serialized: Record<string, any[]> = {};
        data.forEach((v, k) => { serialized[k] = v; });
        window.dispatchEvent(new CustomEvent('veriscope-devtools-response', {
          detail: { type: 'waveformData', data: serialized },
        }));
        break;
      }
      case 'checkAssertions': {
        const violations = graph.checkAssertions();
        window.dispatchEvent(new CustomEvent('veriscope-devtools-response', {
          detail: { type: 'assertions', data: violations },
        }));
        break;
      }
    }
  });
}
