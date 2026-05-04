// read-tracer.ts — Intercept .val reads during function execution

/**
 * Intercept .val reads during function execution to discover which signals are actually read.
 * Temporarily wraps .val getters to log reads, then restores originals.
 */
export function traceReads(
  fn: () => any,
  signals: Map<string, { val: any }>,
): { result: any; reads: string[] } {
  const reads: string[] = [];
  const originals = new Map<string, PropertyDescriptor | undefined>();

  for (const [id, signal] of signals) {
    const desc = Object.getOwnPropertyDescriptor(signal, 'val');
    originals.set(id, desc);

    if (desc && desc.get) {
      Object.defineProperty(signal, 'val', {
        get() {
          reads.push(id);
          return desc.get!.call(signal);
        },
        configurable: true,
      });
    } else {
      // Plain value property — wrap it
      const currentVal = (signal as any).val;
      Object.defineProperty(signal, 'val', {
        get() {
          reads.push(id);
          return currentVal;
        },
        configurable: true,
      });
    }
  }

  let result: any;
  try {
    result = fn();
  } finally {
    // Restore originals
    for (const [id, desc] of originals) {
      const sig = signals.get(id)!;
      if (desc) {
        Object.defineProperty(sig, 'val', desc);
      }
    }
  }

  return { result, reads };
}
