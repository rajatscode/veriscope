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

    walk.simple(ast, {
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
        // Also detect plain identifier comparisons (headless test mode without .val)
        if (node.left.type === 'Identifier') {
          signals.add(node.left.name);
          comparisons.push({
            signal: node.left.name,
            op: node.operator,
            value: nodeToString(node.right, source),
          });
        }
        if (node.right.type === 'Identifier') {
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
