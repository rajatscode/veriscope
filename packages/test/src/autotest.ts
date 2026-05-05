import type { CircuitGraph } from '@veriscope/graph';
import { explore } from './explore.js';
import type { AutotestAssertionResult, AutotestResult, ExploreOptions } from './types.js';

export interface AutotestOptions extends ExploreOptions {
  name?: string;
}

export async function runAutotest(
  graph: CircuitGraph,
  options: AutotestOptions = {},
): Promise<AutotestResult> {
  const result = await explore(graph, options);
  const failedAssertions = new Set(result.violations.map(v => v.assertionName));

  const assertions: AutotestAssertionResult[] = graph.getAssertions().map(assertion => {
    const declaredDeps = new Set([
      ...assertion.deps,
      ...(assertion.metadata?.checkDeps ?? []),
      ...(assertion.metadata?.triggerDeps ?? []),
    ]);
    const partialCoverage = assertion.metadata?.partial ?? declaredDeps.size === 0;
    return {
      id: assertion.id,
      name: assertion.name,
      kind: assertion.kind,
      status: failedAssertions.has(assertion.name) ? 'failed' : 'passed',
      partialCoverage,
      reason: assertion.metadata?.reason ?? (partialCoverage ? 'missing explorable assertion dependency metadata' : undefined),
    };
  });

  return {
    status: result.violations.length > 0 ? 'failed' : 'passed',
    assertions,
    violations: result.violations,
    scenarios: result.scenarios,
    coverage: result.coverage,
    steps: result.steps,
    snapshot: graph.snapshot({
      ...(result.snapshot?.captureContext ?? {}),
      tool: '@veriscope/test/autotest',
      name: options.name,
    }),
  };
}
