import React from 'react';
import { useSignal, useDerived } from '@veriscope/react';
import { assertAlways, assertNever, assertAfter } from '@veriscope/graph';

export function Dashboard() {
  // 4-state FSM signal
  const phase = useSignal<'idle' | 'loading' | 'success' | 'error'>('idle', 'phase', {
    states: ['idle', 'loading', 'success', 'error'],
  });
  const data = useSignal<any>(null, 'data');
  const retryCount = useSignal(0, 'retryCount');

  // Derived signals
  const loading = useDerived(() => phase.val === 'loading', [phase], 'loading');
  const hasError = useDerived(() => phase.val === 'error', [phase], 'hasError');
  const canRetry = useDerived(
    () => hasError.val && retryCount.val < 3,
    [hasError, retryCount],
    'canRetry',
  );

  // Assertions — the spec
  assertAlways(() => retryCount.val >= 0 && retryCount.val <= 3, 'retry-bounded');
  assertNever(() => phase.val === 'success' && data.val === null, 'success-has-data');
  assertAfter(loading, 'posedge', 'eventually', () => !loading.val, {
    name: 'loading-resolves',
    devWatchdogMs: 5000,
  });

  // Simulated fetch
  const fetchData = React.useCallback(() => {
    phase.set('loading');
    setTimeout(() => {
      // Simulate success/failure (80% success)
      if (Math.random() > 0.2) {
        data.set({ metrics: [42, 73, 19], timestamp: Date.now() });
        phase.set('success');
      } else {
        phase.set('error');
        retryCount.set(retryCount.val + 1);
      }
    }, 800 + Math.random() * 400);
  }, [phase, data, retryCount]);

  const reset = React.useCallback(() => {
    phase.set('idle');
    data.set(null);
    retryCount.set(0);
  }, [phase, data, retryCount]);

  const phaseColors: Record<string, string> = {
    idle: '#888',
    loading: '#2196F3',
    success: '#4CAF50',
    error: '#f44336',
  };

  return (
    <div style={{ maxWidth: 500 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
      }}>
        <span style={{
          display: 'inline-block',
          width: 12, height: 12, borderRadius: '50%',
          background: phaseColors[phase.val],
        }} />
        <strong style={{ fontFamily: '"SF Mono", monospace', fontSize: '0.9rem' }}>
          phase: {phase.val}
        </strong>
        <span style={{ color: '#666', fontSize: '0.8rem' }}>
          retries: {retryCount.val}/3
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          onClick={fetchData}
          disabled={loading.val}
          style={{
            padding: '8px 16px', cursor: loading.val ? 'not-allowed' : 'pointer',
            opacity: loading.val ? 0.5 : 1,
          }}
        >
          {loading.val ? 'Loading…' : 'Fetch Data'}
        </button>
        {canRetry.val && (
          <button onClick={fetchData} style={{ padding: '8px 16px' }}>
            Retry ({3 - retryCount.val} left)
          </button>
        )}
        <button onClick={reset} style={{ padding: '8px 16px' }}>
          Reset
        </button>
      </div>

      {phase.val === 'success' && data.val && (
        <div style={{
          background: '#e8f5e9', padding: 12, borderRadius: 6,
          fontFamily: '"SF Mono", monospace', fontSize: '0.85rem',
        }}>
          <div>Metrics: {JSON.stringify(data.val.metrics)}</div>
          <div>Fetched: {new Date(data.val.timestamp).toLocaleTimeString()}</div>
        </div>
      )}

      {phase.val === 'error' && (
        <div style={{
          background: '#ffebee', padding: 12, borderRadius: 6,
          color: '#c62828', fontSize: '0.85rem',
        }}>
          Fetch failed. {canRetry.val ? 'You can retry.' : 'Max retries reached.'}
        </div>
      )}
    </div>
  );
}
