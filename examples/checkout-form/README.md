# Checkout Form — Veriscope Ship Gate Demo

A checkout form demonstrating every Phase 1 Veriscope capability:

- **8 tracked signals**: username, email, password, confirmPassword, loading, submitted, error, phase
- **4 derived values**: usernameValid, emailValid, passwordMatch, canSubmit
- **5 assertions**: loading-error-mutex, success-requires-submit, phase-loading-sync, submit-starts-loading, loading-resolves
- **1 edge effect**: loading-done-toast (fires on loading negedge)
- **Devtools panel**: live waveform, dependency graph, assertion status

## Quick start

```bash
# From the veriscope root
npm run build
cd examples/checkout-form
npm run dev       # Vite dev server
npm run diff      # CLI diff between graph-v1 and graph-v2
```

## Running tests

```bash
cd examples/checkout-form
npx vitest run
```

## The seeded bug

The `loading-error-mutex` assertion states that `loading` and `error` must never both be truthy simultaneously. The `explore()` function finds this violation by independently driving both root signals to adversarial values — `loading=true` and `error='Server error'` — which is reachable in the real component when a re-submit occurs before the previous error is cleared.

## Graph diff demo

Two snapshot files demonstrate the CLI diff command:

- **graph-v1.json** — Before: 7 signals, 2 derived (no confirmPassword/passwordMatch)
- **graph-v2.json** — After: 8 signals, 3 derived (adds confirmPassword, passwordMatch, updated canSubmit deps)

```bash
npm run diff
# Output:
# Added nodes:
#   + sig-confirmPassword
#   + der-passwordMatch
# Added edges:
#   + sig-password → der-passwordMatch
#   + sig-confirmPassword → der-passwordMatch
#   + der-passwordMatch → der-canSubmit
```
