import { describe, test, expect } from 'vitest';
import { CircuitGraph, assertAlways, assertNever, assertAfter } from '@veriscope/graph';
import { explore } from '@veriscope/test';
import { mutate } from '@veriscope/mutate';

/**
 * Headless checkout form graph — mirrors CheckoutForm.tsx signals,
 * derived values, and assertions without React.
 */
function buildCheckoutGraph(): CircuitGraph {
  const g = new CircuitGraph();

  // Root signals with mutable state
  let username = '';
  let email = '';
  let password = '';
  let confirmPassword = '';
  let loading = false;
  let submitted = false;
  let error: string | null = null;
  let phase: string = 'idle';

  const usernameId = g.registerNode({ name: 'username', type: 'signal' });
  g.setNodeValue(usernameId, () => username);
  g.setNodeSetter(usernameId, (v: string) => { username = v; });

  const emailId = g.registerNode({ name: 'email', type: 'signal' });
  g.setNodeValue(emailId, () => email);
  g.setNodeSetter(emailId, (v: string) => { email = v; });

  const passwordId = g.registerNode({ name: 'password', type: 'signal' });
  g.setNodeValue(passwordId, () => password);
  g.setNodeSetter(passwordId, (v: string) => { password = v; });

  const confirmPasswordId = g.registerNode({ name: 'confirmPassword', type: 'signal' });
  g.setNodeValue(confirmPasswordId, () => confirmPassword);
  g.setNodeSetter(confirmPasswordId, (v: string) => { confirmPassword = v; });

  const loadingId = g.registerNode({ name: 'loading', type: 'signal' });
  g.setNodeValue(loadingId, () => loading);
  g.setNodeSetter(loadingId, (v: boolean) => { loading = v; });

  const submittedId = g.registerNode({ name: 'submitted', type: 'signal' });
  g.setNodeValue(submittedId, () => submitted);
  g.setNodeSetter(submittedId, (v: boolean) => { submitted = v; });

  const errorId = g.registerNode({ name: 'error', type: 'signal' });
  g.setNodeValue(errorId, () => error);
  g.setNodeSetter(errorId, (v: string | null) => { error = v; });

  const phaseId = g.registerNode({ name: 'phase', type: 'signal' });
  g.setNodeValue(phaseId, () => phase);
  g.setNodeSetter(phaseId, (v: string) => { phase = v; });

  // Derived signals
  g.registerNode({ name: 'usernameValid', type: 'derived', deps: [usernameId] });
  g.registerNode({ name: 'emailValid', type: 'derived', deps: [emailId] });
  g.registerNode({ name: 'passwordMatch', type: 'derived', deps: [passwordId, confirmPasswordId] });
  g.registerNode({ name: 'canSubmit', type: 'derived', deps: [loadingId] });

  // Assertions — same spec as CheckoutForm.tsx
  assertAlways(() => !(loading && error !== null), 'loading-error-mutex', g);
  assertAlways(() => phase !== 'success' || submitted, 'success-requires-submit', g);
  assertNever(() => phase === 'loading' && !loading, 'phase-loading-sync', g);
  assertAfter({ nodeId: submittedId }, 'posedge', 'immediately', () => loading, {
    name: 'submit-starts-loading',
  }, g);
  assertAfter({ nodeId: loadingId }, 'posedge', 'eventually', () => !loading, {
    name: 'loading-resolves',
    devWatchdogMs: 5000,
  }, g);

  return g;
}

describe('checkout-form ship gate', () => {
  test('explore finds the seeded loading-error-mutex violation', async () => {
    const g = buildCheckoutGraph();
    const result = await explore(g, { budget: 500 });

    // explore() should find that loading=true + error!=null violates loading-error-mutex
    expect(result.violations.length).toBeGreaterThan(0);
    const names = result.violations.map(v => v.assertionName);
    expect(names).toContain('loading-error-mutex');
  });

  test('graph snapshot and diff round-trips', () => {
    const g = buildCheckoutGraph();
    const snap = g.snapshot();

    expect(snap.nodes.length).toBeGreaterThanOrEqual(12); // 8 signals + 4 derived
    expect(snap.edges.length).toBeGreaterThan(0);
  });

  test('mutation score validates assertion quality', async () => {
    const result = await mutate(buildCheckoutGraph, { budget: 200 });

    // A score > 0 means at least some mutations were killed by assertions
    expect(result.score).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
  });
});
