// interaction.ts — Playwright bridge: map UI interactions to signal changes

import type { CircuitGraph } from '@veriscope/graph';

export interface InteractionMapping {
  signalId: string;
  trigger: {
    element: string;  // CSS selector
    action: 'click' | 'type' | 'select';
    value?: string;
  };
}

/**
 * Discover which signals change when UI interactions occur.
 * This is the "observation" mode — drive random interactions,
 * record which signals change, build the mapping.
 */
export function discoverMappings(
  graph: CircuitGraph,
  interactions: Array<{ element: string; action: string; value?: string }>,
  perform: (interaction: { element: string; action: string; value?: string }) => void,
): InteractionMapping[] {
  const mappings: InteractionMapping[] = [];

  for (const interaction of interactions) {
    // Snapshot signal values before
    const before = new Map<string, any>();
    for (const node of graph.getNodes()) {
      if (node.getValue) before.set(node.id, node.getValue());
    }

    // Perform the interaction
    perform(interaction);

    // Check which signals changed
    for (const node of graph.getNodes()) {
      if (node.getValue) {
        const oldVal = before.get(node.id);
        const newVal = node.getValue();
        if (!Object.is(oldVal, newVal)) {
          mappings.push({
            signalId: node.id,
            trigger: {
              element: interaction.element,
              action: interaction.action as 'click' | 'type' | 'select',
              value: interaction.value,
            },
          });
        }
      }
    }
  }

  return mappings;
}

/**
 * Use discovered mappings to drive exploration via UI interactions
 * instead of raw signal writes.
 */
export function exploreViaInteractions(
  graph: CircuitGraph,
  mappings: InteractionMapping[],
  perform: (trigger: InteractionMapping['trigger']) => void,
  options?: { budget?: number },
): void {
  const budget = options?.budget ?? 100;
  let steps = 0;

  for (const mapping of mappings) {
    if (steps >= budget) break;
    perform(mapping.trigger);
    graph.checkAssertions();
    steps++;
  }
}
