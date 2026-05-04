# Veriscope

HDL-grade observability for reactive UI. Your UI is the device under test.

Veriscope connects the reactive dependency graph to debugging, testing, and coverage — in one integrated toolkit. Write assertions, not test cases. See your signals over time. Know exactly what depends on what.

## Packages

| Package | What it does |
|---|---|
| `@veriscope/graph` | Core dependency graph, waveform recording, graph diffing, assertions |
| `@veriscope/react` | React adapter: `useSignal`, `useDerived`, `useEdgeEffect` |
| `@veriscope/devtools` | Waveform viewer, graph visualizer, assertion monitor, coverage panel |
| `@veriscope/coverage` | Toggle/FSM/cross coverage metrics, reporters, CI thresholds |
| `@veriscope/test` | Backward graph solver, truth tables, adversarial exploration |
| `@veriscope/mutate` | Graph-level mutation testing for assertion validation |

## Quick Start

```bash
npm install @veriscope/graph @veriscope/react
```

```tsx
import { useSignal, useDerived, useEdgeEffect } from '@veriscope/react'
import { assertAlways, assertAfter } from '@veriscope/graph'

function CheckoutForm() {
  const loading = useSignal(false, 'loading')
  const submitted = useSignal(false, 'submitted')
  const error = useSignal<string | null>(null, 'error')

  const canSubmit = useDerived(
    () => !loading.val && !submitted.val,
    [loading, submitted],
    'canSubmit'
  )

  // Assertions — the spec, not test cases
  assertAlways(() => !(loading.val && error.val !== null), 'loading-error-mutex')
  assertAfter(submitted, 'posedge', 'immediately', () => loading.val, {
    name: 'submit-starts-loading'
  })

  // Edge effect — fires once on transition, not every render
  useEdgeEffect(loading, 'negedge', () => {
    showToast('Done!')
  }, 'loading-complete')

  return (
    <button disabled={!canSubmit.val} onClick={() => { submitted.set(true); loading.set(true) }}>
      {loading.val ? 'Submitting...' : 'Submit'}
    </button>
  )
}
```

## Zero-Test-Case Verification

```ts
import { explore } from '@veriscope/test'
import { graph } from '@veriscope/graph'

test('checkout flow', async () => {
  render(<CheckoutForm />)

  const result = explore(graph, { budget: 1000 })
  expect(result.violations).toHaveLength(0)
  expect(result.coverage.toggle).toBeGreaterThan(0.9)
})
```

The explorer reads the dependency graph, traces backward from assertions to find which inputs matter, enumerates all boolean combinations, and adversarially tries to break each assertion. No hand-written test cases needed.

## Mutation Testing

```ts
import { mutate } from '@veriscope/mutate'

const result = mutate(
  () => { render(<CheckoutForm />); return graph },
  { budget: 500 }
)
// result.score → 87.4% (assertions catch 87% of possible reactive bugs)
// result.survived → tells you exactly which assertion is missing
```

## Graph Diffing in CI

```bash
npx veriscope diff graph-main.json graph-pr.json
# Removed edge: userProfile → dashboardTitle
# Added node: newFeatureFlag (signal, boolean)
```

## The Discipline Model

Veriscope rewards disciplined code. You use `useSignal` instead of `useState`, `.val` to read, `.set()` to write. In return you get: dependency graph visualization, waveform debugging, reactive coverage metrics, assertion-based verification, and mutation testing — automatically, with zero test cases.

No magic. No auto-instrumentation. The discipline IS the product.

## Production

```ts
// All @veriscope/* code is gated behind import.meta.env.DEV
// Tree-shaking removes it entirely from production bundles
```

## Development

```bash
npm install
npm run build    # build all packages
npm run test     # run all tests
```

## License

MIT
