// fn-parser.ts — fn.toString() parsing for expression structure

import type { ParsedExpression } from './types.js';

/**
 * Parse fn.toString() to extract expression structure for comparison boundary detection.
 * Uses lightweight regex-based parsing (no Acorn dependency for MVP).
 */
export function parseComputeFn(fn: () => any): ParsedExpression | null {
  try {
    const source = fn.toString();

    // Find .val accesses: identifier.val
    const valReads = [...source.matchAll(/(\w+)\.val/g)].map(m => m[1]);

    // Find comparisons: identifier.val <op> <value>
    const comparisons = [...source.matchAll(/(\w+)\.val\s*([><=!]+)\s*([^;,)&|]+)/g)].map(m => ({
      signal: m[1],
      op: m[2],
      value: m[3].trim(),
    }));

    return { signals: valReads, comparisons };
  } catch {
    return null;
  }
}
