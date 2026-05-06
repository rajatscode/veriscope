// fn-parser.ts — fn.toString() parsing via Acorn AST for expression structure

import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import type { ParsedExpression } from './types.js';

function nodeToString(node: any, source: string): string {
  return source.slice(node.start, node.end);
}

/**
 * Parse fn.toString() to extract expression structure using Acorn AST.
 * Detects signal reads (.val), comparison operators/boundaries, and branch structure.
 */
export function parseComputeFn(fn: () => any): ParsedExpression | null {
  try {
    const source = fn.toString();
    const ast = acorn.parse(source, {
      ecmaVersion: 2022,
      sourceType: 'module',
    });
    const signals = new Set<string>();
    const comparisons: Array<{ signal: string; op: string; value: string }> = [];
    let branches = 0;
    const valAliases = new Map<string, string>();

    walk.simple(ast, {
      VariableDeclarator(node: any) {
        if (node.init?.type === 'MemberExpression' &&
            node.init.property?.name === 'val' &&
            node.init.object?.type === 'Identifier' &&
            node.id?.type === 'Identifier') {
          valAliases.set(node.id.name, node.init.object.name);
          signals.add(node.init.object.name);
        }
      },
      MemberExpression(node: any) {
        if (
          node.property.type === 'Identifier' &&
          node.property.name === 'val' &&
          node.object.type === 'Identifier'
        ) {
          signals.add(node.object.name);
        }
      },
      BinaryExpression(node: any) {
        // Check if left side is a .val access
        if (
          node.left.type === 'MemberExpression' &&
          node.left.property.type === 'Identifier' &&
          node.left.property.name === 'val' &&
          node.left.object.type === 'Identifier'
        ) {
          comparisons.push({
            signal: node.left.object.name,
            op: node.operator,
            value: nodeToString(node.right, source),
          });
        }
        // Also check if right side is a .val access (e.g., 100 < score.val)
        if (
          node.right.type === 'MemberExpression' &&
          node.right.property.type === 'Identifier' &&
          node.right.property.name === 'val' &&
          node.right.object.type === 'Identifier'
        ) {
          comparisons.push({
            signal: node.right.object.name,
            op: node.operator,
            value: nodeToString(node.left, source),
          });
        }
        // Check aliases: const c = sig.val; c >= 0
        if (node.left.type === 'Identifier' && valAliases.has(node.left.name)) {
          comparisons.push({
            signal: valAliases.get(node.left.name)!,
            op: node.operator,
            value: nodeToString(node.right, source),
          });
        }
        if (node.right.type === 'Identifier' && valAliases.has(node.right.name)) {
          comparisons.push({
            signal: valAliases.get(node.right.name)!,
            op: node.operator,
            value: nodeToString(node.left, source),
          });
        }
        // Also detect plain identifier comparisons (headless test mode without .val)
        if (node.left.type === 'Identifier' && !valAliases.has(node.left.name)) {
          signals.add(node.left.name);
          comparisons.push({
            signal: node.left.name,
            op: node.operator,
            value: nodeToString(node.right, source),
          });
        }
        if (node.right.type === 'Identifier' && !valAliases.has(node.right.name)) {
          signals.add(node.right.name);
        }
      },
      LogicalExpression(_node: any) {
        branches++;
      },
    });

    return { signals: [...signals], comparisons, branches };
  } catch {
    return null;
  }
}

export function inferBoundaryValues(
  comparisons: Array<{ signal: string; op: string; value: string }>,
): Map<string, any[]> {
  const boundaries = new Map<string, Set<any>>();

  for (const comp of comparisons) {
    const rawValue = comp.value.trim();
    const numVal = Number(rawValue);
    const isNumeric = !Number.isNaN(numVal) && rawValue !== 'null' && rawValue !== '';

    if (!boundaries.has(comp.signal)) {
      boundaries.set(comp.signal, new Set());
    }
    const set = boundaries.get(comp.signal)!;

    if (isNumeric) {
      set.add(numVal);
      set.add(numVal - 1);
      set.add(numVal + 1);
      if (Math.abs(numVal) > 2) set.add(0);
    } else if (rawValue === 'null') {
      set.add(null);
    } else {
      const strVal = rawValue.replace(/^['"]|['"]$/g, '');
      set.add(strVal);
    }
  }

  return new Map(
    [...boundaries].map(([signal, values]) => [signal, [...values]]),
  );
}
