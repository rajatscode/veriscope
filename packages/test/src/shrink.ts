// shrink.ts — Sequence shrinking for violation reproduction

import type { Violation } from './types.js';

export interface ShrinkStep {
  signal: string;
  value: any;
}

/**
 * Attempt to shrink a violation's input sequence to a minimal reproduction.
 * Uses delta-debugging-style bisection: try removing half the sequence at a time,
 * then individual steps.
 *
 * @param sequence The original sequence of signal assignments that caused the violation
 * @param replay Function that replays a sequence and returns true if violation still occurs
 * @returns The minimal sequence that still triggers the violation
 */
export function shrinkSequence(
  sequence: ShrinkStep[],
  replay: (seq: ShrinkStep[]) => boolean,
): ShrinkStep[] {
  if (sequence.length <= 1) return sequence;

  let current = [...sequence];

  // Phase 1: Try removing halves
  let chunkSize = Math.max(1, Math.floor(current.length / 2));
  while (chunkSize >= 1 && current.length > 1) {
    let i = 0;
    while (i < current.length) {
      const candidate = [
        ...current.slice(0, i),
        ...current.slice(i + chunkSize),
      ];
      if (candidate.length > 0 && replay(candidate)) {
        current = candidate;
        // Don't advance i — the next chunk is now at the same position
      } else {
        i += chunkSize;
      }
    }
    chunkSize = Math.max(1, Math.floor(chunkSize / 2));
    if (chunkSize === 1 && current.length <= 2) break;
  }

  // Phase 2: Try removing individual steps
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < current.length; i++) {
      const candidate = [...current.slice(0, i), ...current.slice(i + 1)];
      if (candidate.length > 0 && replay(candidate)) {
        current = candidate;
        changed = true;
        break; // restart from beginning
      }
    }
  }

  return current;
}
