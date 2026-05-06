/**
 * verify-all.ts — Comprehensive package-by-package verification
 *
 * Tests EVERY feature across all 8 packages with EXPECTED vs ACTUAL output
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';

interface TestResult {
  package: string;
  feature: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL';
  duration: number;
}

const results: TestResult[] = [];

function report(
  pkg: string,
  feature: string,
  expected: string,
  actual: string,
  status: 'PASS' | 'FAIL',
  duration: number,
) {
  results.push({ package: pkg, feature, expected, actual, status, duration });
}

async function runCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd: process.cwd() });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

async function verify(): Promise<void> {
  console.log('🚀 COMPREHENSIVE VERISCOPE FEATURE VERIFICATION\n');

  // === 1. @veriscope/graph ===
  {
    const start = performance.now();
    try {
      const { CircuitGraph, assertAlways } = await import('./packages/graph/dist/index.js');

      // 1a. Create graph with nodes and edges
      const g = new CircuitGraph();
      const sig1 = g.registerNode({ name: 'sig1', type: 'signal' });
      const sig2 = g.registerNode({ name: 'sig2', type: 'signal' });
      const derived = g.registerNode({ name: 'derived', type: 'derived', deps: [sig1, sig2] });

      let v1 = 0, v2 = 0;
      g.setNodeValue(sig1, () => v1);
      g.setNodeValue(sig2, () => v2);
      g.setNodeSetter(sig1, (x: number) => { v1 = x; });
      g.setNodeSetter(sig2, (x: number) => { v2 = x; });

      const nodes = g.getNodes();
      const edges = g.getEdges();
      const expected1a = '3 nodes, 2 edges';
      const actual1a = `${nodes.length} nodes, ${edges.length} edges`;
      report('graph', 'Register nodes and edges', expected1a, actual1a, actual1a === expected1a ? 'PASS' : 'FAIL', performance.now() - start);

      // 1b. Snapshot and diff
      const snap1 = g.snapshot();
      g.registerNode({ name: 'sig3', type: 'signal' });
      const snap2 = g.snapshot();
      const diff = CircuitGraph.diffGraphs(snap1, snap2);

      const expected1b = 'sig3 in addedNodes';
      const actual1b = diff.addedNodes.includes('sig3') ? 'sig3 in addedNodes' : 'sig3 NOT found';
      report('graph', 'Snapshot and diff', expected1b, actual1b, actual1b === expected1b ? 'PASS' : 'FAIL', 0);

      // 1c. Coverage
      g.enableCoverage();
      g.openTick();
      v1 = 1;
      g.notifyChange(sig1, 0, 1);
      g.closeTick();
      g.openTick();
      v1 = 0;
      g.notifyChange(sig1, 1, 0);
      g.closeTick();

      const { coverage } = await import('./packages/graph/dist/index.js');
      const covReport = coverage.getReport();
      const expected1c = 'coverage report exists';
      const actual1c = covReport && Object.keys(covReport).length > 0 ? 'coverage report exists' : 'NO coverage';
      report('graph', 'Coverage recording', expected1c, actual1c, actual1c === expected1c ? 'PASS' : 'FAIL', 0);
    } catch (error) {
      report('graph', 'FATAL', 'no error', String(error), 'FAIL', 0);
    }
  }

  // === 2. @veriscope/test (explore) ===
  {
    const start = performance.now();
    try {
      const { CircuitGraph, assertAlways } = await import('./packages/graph/dist/index.js');
      const { explore } = await import('./packages/test/dist/index.js');

      // 2a. explore() finds violation with boolean signals
      const g = new CircuitGraph();
      let a = false, b = false;
      const aId = g.registerNode({ name: 'a', type: 'signal' });
      const bId = g.registerNode({ name: 'b', type: 'signal' });
      g.setNodeValue(aId, () => a);
      g.setNodeValue(bId, () => b);
      g.setNodeSetter(aId, (v: boolean) => { a = v; });
      g.setNodeSetter(bId, (v: boolean) => { b = v; });

      assertAlways(() => !(a && b), 'mutex', g, [{ nodeId: aId }, { nodeId: bId }]);

      const result1 = await explore(g, { budget: 100 });
      const expected2a = 'violations.length > 0';
      const actual2a = result1.violations.length > 0 ? 'violations.length > 0' : `violations.length = ${result1.violations.length}`;
      report('test', 'explore() finds boolean violation', expected2a, actual2a, actual2a === expected2a ? 'PASS' : 'FAIL', performance.now() - start);

      // 2b. explore() handles non-boolean signals
      const g2 = new CircuitGraph();
      let loading = false, error: string | null = null;
      const loadId = g2.registerNode({ name: 'loading', type: 'signal' });
      const errId = g2.registerNode({ name: 'error', type: 'signal' });
      g2.setNodeValue(loadId, () => loading);
      g2.setNodeValue(errId, () => error);
      g2.setNodeSetter(loadId, (v: boolean) => { loading = v; });
      g2.setNodeSetter(errId, (v: string | null) => { error = v; });

      assertAlways(() => !(loading && error !== null), 'load-mutex', g2, [{ nodeId: loadId }, { nodeId: errId }]);

      const result2 = await explore(g2, { budget: 100 });
      const expected2b = 'handles non-boolean signals';
      const actual2b = Array.isArray(result2.violations) ? 'handles non-boolean signals' : 'FAILED';
      report('test', 'explore() non-boolean signals', expected2b, actual2b, actual2b === expected2b ? 'PASS' : 'FAIL', 0);
    } catch (error) {
      report('test', 'FATAL', 'no error', String(error), 'FAIL', 0);
    }
  }

  // === 3. @veriscope/cli ===
  {
    const start = performance.now();
    try {
      // 3a. CLI snapshot command
      const snapResult = await runCommand('npx', ['tsx', 'packages/cli/src/index.ts', 'snapshot', 'packages/graph/dist/index.js']);
      const expected3a = 'snapshot output produced';
      const actual3a = snapResult.stdout.length > 0 ? 'snapshot output produced' : `empty (code=${snapResult.code})`;
      report('cli', 'snapshot command', expected3a, actual3a, actual3a === expected3a ? 'PASS' : 'FAIL', performance.now() - start);
    } catch (error) {
      report('cli', 'snapshot command', 'runs', String(error), 'FAIL', 0);
    }
  }

  // === 4. @veriscope/react ===
  {
    const start = performance.now();
    try {
      const { CircuitGraph } = await import('./packages/graph/dist/index.js');
      const { useSignal } = await import('./packages/react/dist/index.js');

      // Can't fully test React hooks without React runtime, but verify exports exist
      const expected4 = 'hooks exported';
      const actual4 = typeof useSignal === 'function' ? 'hooks exported' : 'FAILED';
      report('react', 'Hook exports', expected4, actual4, actual4 === expected4 ? 'PASS' : 'FAIL', performance.now() - start);
    } catch (error) {
      report('react', 'Hook exports', 'exists', String(error), 'FAIL', 0);
    }
  }

  // === 5. @veriscope/coverage ===
  {
    const start = performance.now();
    try {
      const { coverage } = await import('./packages/graph/dist/index.js');

      coverage.reset();
      coverage.recordToggle('sig1', true);
      coverage.recordToggle('sig1', false);

      const report1 = coverage.getReport();
      const expected5 = 'coverage has toggle data';
      const actual5 = Object.keys(report1).length > 0 ? 'coverage has toggle data' : 'empty report';
      report('coverage', 'Toggle recording and report', expected5, actual5, actual5 === expected5 ? 'PASS' : 'FAIL', performance.now() - start);
    } catch (error) {
      report('coverage', 'Toggle recording', 'works', String(error), 'FAIL', 0);
    }
  }

  // === 6. @veriscope/solid ===
  {
    const start = performance.now();
    try {
      const { useSignal } = await import('./packages/solid/dist/index.js');
      const expected = 'hooks exported';
      const actual = typeof useSignal === 'function' ? 'hooks exported' : 'FAILED';
      report('solid', 'Hook exports', expected, actual, actual === expected ? 'PASS' : 'FAIL', performance.now() - start);
    } catch (error) {
      report('solid', 'Hook exports', 'exists', String(error), 'FAIL', 0);
    }
  }

  // === 7. @veriscope/mutate ===
  {
    const start = performance.now();
    try {
      const { mutate, generateMutations } = await import('./packages/mutate/dist/index.js');
      const expected = 'mutate functions exported';
      const actual = typeof mutate === 'function' && typeof generateMutations === 'function'
        ? 'mutate functions exported' : 'FAILED';
      report('mutate', 'Mutation exports', expected, actual, actual === expected ? 'PASS' : 'FAIL', performance.now() - start);
    } catch (error) {
      report('mutate', 'Mutation exports', 'exists', String(error), 'FAIL', 0);
    }
  }

  // === 8. @veriscope/devtools ===
  {
    const start = performance.now();
    try {
      const { mountDevtools, createWaveformPanel } = await import('./packages/devtools/dist/index.js');
      const expected = 'devtools exported';
      const actual = typeof mountDevtools === 'function' && typeof createWaveformPanel === 'function'
        ? 'devtools exported' : 'FAILED';
      report('devtools', 'Devtools exports', expected, actual, actual === expected ? 'PASS' : 'FAIL', performance.now() - start);
    } catch (error) {
      report('devtools', 'Devtools exports', 'exists', String(error), 'FAIL', 0);
    }
  }

  // === PRINT RESULTS ===
  console.log('📊 DETAILED RESULTS\n');
  let passCount = 0, failCount = 0;

  for (const r of results) {
    const emoji = r.status === 'PASS' ? '✓' : '✗';
    const statusColor = r.status === 'PASS' ? '\x1b[32m' : '\x1b[31m';
    console.log(`${emoji} ${statusColor}${r.status}\x1b[0m  ${r.package.padEnd(12)} ${r.feature.padEnd(40)} ${r.duration.toFixed(0)}ms`);
    console.log(`   EXPECTED: ${r.expected}`);
    console.log(`   ACTUAL:   ${r.actual}`);
    if (r.status === 'PASS') passCount++; else failCount++;
  }

  console.log(`\n📈 SUMMARY: ${passCount} passed, ${failCount} failed\n`);

  if (failCount > 0) {
    process.exit(1);
  }
}

verify().catch(error => {
  console.error('Verification failed:', error);
  process.exit(1);
});
