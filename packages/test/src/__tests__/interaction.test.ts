import { describe, it, expect, vi } from 'vitest';
import { CircuitGraph } from '@veriscope/graph';
import { discoverMappings, exploreViaInteractions } from '../interaction';

function buildGraph() {
  const g = new CircuitGraph();
  let countVal = 0;
  let nameVal = 'alice';

  const countId = g.registerNode({ name: 'count', type: 'signal' });
  g.setNodeValue(countId, () => countVal);
  g.setNodeSetter(countId, (v: number) => { countVal = v; });

  const nameId = g.registerNode({ name: 'name', type: 'signal' });
  g.setNodeValue(nameId, () => nameVal);
  g.setNodeSetter(nameId, (v: string) => { nameVal = v; });

  return {
    graph: g,
    countId,
    nameId,
    setCount: (v: number) => { countVal = v; },
    setName: (v: string) => { nameVal = v; },
  };
}

describe('discoverMappings', () => {
  it('identifies which signals changed after an interaction', () => {
    const { graph, countId, setCount } = buildGraph();

    const interactions = [
      { element: '#inc-btn', action: 'click' },
    ];

    const mappings = discoverMappings(graph, interactions, (interaction) => {
      if (interaction.element === '#inc-btn') {
        setCount(1);
      }
    });

    expect(mappings).toHaveLength(1);
    expect(mappings[0].signalId).toBe(countId);
    expect(mappings[0].trigger.element).toBe('#inc-btn');
    expect(mappings[0].trigger.action).toBe('click');
  });

  it('returns multiple mappings when multiple signals change', () => {
    const { graph, setCount, setName } = buildGraph();

    const interactions = [
      { element: '#reset-btn', action: 'click' },
    ];

    const mappings = discoverMappings(graph, interactions, () => {
      setCount(42);
      setName('bob');
    });

    expect(mappings).toHaveLength(2);
    const signalIds = mappings.map(m => m.signalId);
    expect(signalIds).toHaveLength(2);
  });

  it('returns empty array when no signals change', () => {
    const { graph } = buildGraph();

    const interactions = [
      { element: '#noop-btn', action: 'click' },
    ];

    const mappings = discoverMappings(graph, interactions, () => {
      // no-op
    });

    expect(mappings).toHaveLength(0);
  });

  it('handles multiple interactions independently', () => {
    const { graph, countId, nameId, setCount, setName } = buildGraph();

    const interactions = [
      { element: '#inc-btn', action: 'click' },
      { element: '#name-input', action: 'type', value: 'charlie' },
    ];

    const mappings = discoverMappings(graph, interactions, (interaction) => {
      if (interaction.element === '#inc-btn') {
        setCount(1);
      } else if (interaction.element === '#name-input') {
        setName('charlie');
      }
    });

    // First interaction changes count, second changes name
    // But count stays at 1 for second interaction so only name changes
    expect(mappings.length).toBeGreaterThanOrEqual(2);
    expect(mappings.some(m => m.signalId === countId && m.trigger.element === '#inc-btn')).toBe(true);
    expect(mappings.some(m => m.signalId === nameId && m.trigger.element === '#name-input')).toBe(true);
  });
});

describe('exploreViaInteractions', () => {
  it('calls perform for each mapping', () => {
    const { graph } = buildGraph();
    const perform = vi.fn();

    const mappings = [
      { signalId: 'count_0', trigger: { element: '#inc-btn', action: 'click' as const } },
      { signalId: 'name_1', trigger: { element: '#name-input', action: 'type' as const, value: 'x' } },
    ];

    exploreViaInteractions(graph, mappings, perform);

    expect(perform).toHaveBeenCalledTimes(2);
    expect(perform).toHaveBeenCalledWith(mappings[0].trigger);
    expect(perform).toHaveBeenCalledWith(mappings[1].trigger);
  });

  it('respects budget option', () => {
    const { graph } = buildGraph();
    const perform = vi.fn();

    const mappings = Array.from({ length: 10 }, (_, i) => ({
      signalId: `sig_${i}`,
      trigger: { element: `#btn-${i}`, action: 'click' as const },
    }));

    exploreViaInteractions(graph, mappings, perform, { budget: 3 });

    expect(perform).toHaveBeenCalledTimes(3);
  });

  it('calls checkAssertions after each interaction', () => {
    const { graph } = buildGraph();
    const checkSpy = vi.spyOn(graph, 'checkAssertions');

    const mappings = [
      { signalId: 'count_0', trigger: { element: '#btn', action: 'click' as const } },
    ];

    exploreViaInteractions(graph, mappings, () => {});

    expect(checkSpy).toHaveBeenCalledTimes(1);
  });
});
