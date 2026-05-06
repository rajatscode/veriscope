import { describe, it, expect } from 'vitest';
import { inferBoundaryValues, parseComputeFn } from '../fn-parser';

// Declare globals so fn.toString() references them by name
declare const loading: { val: boolean };
declare const validated: { val: boolean };
declare const count: { val: number };
declare const score: { val: number };
declare const foo: { val: any };
declare const bar: { val: any };
declare const x: { val: number };
declare const y: { val: number };

describe('parseComputeFn (Acorn)', () => {
  it('extracts single .val signal read', () => {
    const fn = () => loading.val;
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.signals).toEqual(['loading']);
    expect(parsed!.comparisons).toHaveLength(0);
  });

  it('extracts multiple .val signal reads', () => {
    const fn = () => foo.val + bar.val;
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.signals).toContain('foo');
    expect(parsed!.signals).toContain('bar');
  });

  it('extracts negated AND expression with branches', () => {
    const fn = () => !loading.val && validated.val;
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.signals).toContain('loading');
    expect(parsed!.signals).toContain('validated');
    expect(parsed!.branches).toBeGreaterThan(0);
  });

  it('extracts comparison with operator and boundary', () => {
    const fn = () => score.val > 100;
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.signals).toContain('score');
    expect(parsed!.comparisons).toHaveLength(1);
    expect(parsed!.comparisons[0]).toEqual({
      signal: 'score',
      op: '>',
      value: '100',
    });
  });

  it('extracts multiple comparisons in OR expression', () => {
    const fn = () => x.val < 0 || x.val > 10;
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.signals).toEqual(['x']);
    expect(parsed!.comparisons).toHaveLength(2);
    expect(parsed!.comparisons[0].op).toBe('<');
    expect(parsed!.comparisons[1].op).toBe('>');
    expect(parsed!.branches).toBe(1);
  });

  it('handles equality comparisons', () => {
    const fn = () => score.val === 42;
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.comparisons[0]).toEqual({
      signal: 'score',
      op: '===',
      value: '42',
    });
  });

  it('infers boundary values from comparisons', () => {
    const boundaries = inferBoundaryValues([
      { signal: 'score', op: '>=', value: '0' },
      { signal: 'status', op: '===', value: "'error'" },
      { signal: 'message', op: '!==', value: 'null' },
    ]);

    expect(boundaries.get('score')).toEqual([0, -1, 1]);
    expect(boundaries.get('status')).toEqual(['error']);
    expect(boundaries.get('message')).toEqual([null]);
  });

  it('extracts right-side .val comparison with flipped operator', () => {
    const fn = () => 0 >= count.val;
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.signals).toContain('count');
    expect(parsed!.comparisons).toContainEqual({
      signal: 'count',
      op: '<=',
      value: '0',
    });
  });

  it('extracts negation of .val signal', () => {
    const fn = () => !loading.val;
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.signals).toContain('loading');
  });

  it('extracts negation of alias', () => {
    const fn = () => { const l = loading.val; return !l; };
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.signals).toContain('loading');
  });

  it('extracts signal from ternary condition', () => {
    const fn = () => loading.val ? 'yes' : 'no';
    const parsed = parseComputeFn(fn as any);
    expect(parsed).not.toBeNull();
    expect(parsed!.signals).toContain('loading');
  });

  it('returns null for unparseable input', () => {
    const result = parseComputeFn(null as any);
    expect(result).toBeNull();
  });
});
