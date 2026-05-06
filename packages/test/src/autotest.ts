import type { CircuitGraph } from '@veriscope/graph';
import { backwardCone } from './backward-solve.js';
import { explore } from './explore.js';
import type { AutotestAssertionResult, AutotestConfidenceSummary, AutotestResult, ExploreOptions } from './types.js';

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
    const assertionScenarios = result.scenarios.filter(scenario => scenario.assertions.includes(assertion.name));
    const failScenarioCount = assertionScenarios.filter(scenario => scenario.violations.includes(assertion.name)).length;
    const scenarioCount = assertionScenarios.length;
    const exercised = scenarioCount > 0;
    const passed = !failedAssertions.has(assertion.name);

    // Compute specific reason when deps are missing
    let reason = assertion.metadata?.reason;
    if (!reason && partialCoverage && declaredDeps.size === 0) {
      const roots = backwardCone(graph, assertion.id);
      if (roots.length > 0) {
        reason = `missing dependency metadata — explorer found ${roots.length} reachable signal${roots.length === 1 ? '' : 's'}`;
      } else {
        reason = 'assertion reads no graph signals — may use external state';
      }
    } else if (!reason && partialCoverage) {
      reason = 'missing explorable assertion dependency metadata';
    }

    // Compute confidence level
    let confidence: AutotestAssertionResult['confidence'];
    if (!exercised || (declaredDeps.size === 0 && backwardCone(graph, assertion.id).length === 0)) {
      confidence = 'unverifiable';
    } else if (partialCoverage) {
      confidence = 'partial';
    } else if (passed && exercised) {
      confidence = 'verified';
    } else {
      confidence = 'verified';
    }

    return {
      id: assertion.id,
      name: assertion.name,
      kind: assertion.kind,
      status: passed ? 'passed' : 'failed',
      partialCoverage,
      confidence,
      reason,
      exercised,
      scenarioCount,
      passScenarioCount: scenarioCount - failScenarioCount,
      failScenarioCount,
    };
  });

  const confidence: AutotestConfidenceSummary = {
    verified: assertions.filter(a => a.confidence === 'verified').length,
    partial: assertions.filter(a => a.confidence === 'partial').length,
    unverifiable: assertions.filter(a => a.confidence === 'unverifiable').length,
  };

  return {
    status: result.violations.length > 0 ? 'failed' : 'passed',
    assertions,
    confidence,
    violations: result.violations,
    scenarios: result.scenarios,
    coverage: result.coverage,
    steps: result.steps,
    plan: result.plan,
    snapshot: graph.snapshot({
      ...(result.snapshot?.captureContext ?? {}),
      tool: '@veriscope/test/autotest',
      name: options.name,
      deterministic: result.plan.deterministic,
      stoppedByBudget: result.plan.stoppedByBudget,
    }),
  };
}
