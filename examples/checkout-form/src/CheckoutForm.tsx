import React from 'react';
import { useSignal, useDerived, useEdgeEffect } from '@veriscope/react';
import { assertAlways, assertNever, assertAfter } from '@veriscope/graph';

export function CheckoutForm() {
  const username = useSignal('', 'username');
  const email = useSignal('', 'email');
  const password = useSignal('', 'password');
  const loading = useSignal(false, 'loading');
  const submitted = useSignal(false, 'submitted');
  const error = useSignal<string | null>(null, 'error');
  const phase = useSignal<'idle' | 'loading' | 'success' | 'error'>('idle', 'phase', {
    states: ['idle', 'loading', 'success', 'error'],
  });

  const usernameValid = useDerived(
    () => username.val.length >= 3,
    [username],
    'usernameValid',
  );
  const emailValid = useDerived(
    () => email.val.includes('@'),
    [email],
    'emailValid',
  );
  const canSubmit = useDerived(
    () => usernameValid.val && emailValid.val && !loading.val,
    [usernameValid, emailValid, loading],
    'canSubmit',
  );

  // Assertions — the spec, not test cases
  assertAlways(() => !(loading.val && error.val !== null), 'loading-error-mutex');
  assertAlways(() => phase.val !== 'success' || submitted.val, 'success-requires-submit');
  assertNever(() => phase.val === 'loading' && !loading.val, 'phase-loading-sync');
  assertAfter(submitted, 'posedge', 'immediately', () => loading.val, {
    name: 'submit-starts-loading',
  });
  assertAfter(loading, 'posedge', 'eventually', () => !loading.val, {
    name: 'loading-resolves',
    devWatchdogMs: 5000,
  });

  useEdgeEffect(loading, 'negedge', () => {
    console.log('Loading complete!');
  }, 'loading-done-toast');

  const handleSubmit = () => {
    if (!canSubmit.val) return;
    submitted.set(true);
    loading.set(true);
    error.set(null);
    phase.set('loading');
    // Simulate async
    setTimeout(() => {
      loading.set(false);
      if (Math.random() > 0.3) {
        phase.set('success');
      } else {
        error.set('Server error');
        phase.set('error');
      }
    }, 1000);
  };

  return (
    <div style={{ maxWidth: 400, margin: '0 auto', padding: 20 }}>
      <h2>Checkout Form</h2>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>Username</label>
        <input
          value={username.val}
          onChange={e => username.set(e.target.value)}
          style={{ width: '100%', padding: 6 }}
        />
        <small style={{ color: usernameValid.val ? 'green' : '#888' }}>
          {usernameValid.val ? 'Valid' : 'Min 3 chars'}
        </small>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>Email</label>
        <input
          value={email.val}
          onChange={e => email.set(e.target.value)}
          style={{ width: '100%', padding: 6 }}
        />
        <small style={{ color: emailValid.val ? 'green' : '#888' }}>
          {emailValid.val ? 'Valid' : 'Must contain @'}
        </small>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4 }}>Password</label>
        <input
          type="password"
          value={password.val}
          onChange={e => password.set(e.target.value)}
          style={{ width: '100%', padding: 6 }}
        />
      </div>
      <button
        onClick={handleSubmit}
        disabled={!canSubmit.val}
        style={{ padding: '8px 16px', cursor: canSubmit.val ? 'pointer' : 'not-allowed' }}
      >
        {loading.val ? 'Submitting...' : 'Submit'}
      </button>
      <p>Phase: <strong>{phase.val}</strong></p>
      {error.val && <p style={{ color: 'red' }}>{error.val}</p>}
    </div>
  );
}
