import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sourceAlias = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export const veriscopeAliases = [
  { find: '@veriscope/devtools/bridge', replacement: sourceAlias('./packages/devtools/src/bridge.ts') },
  { find: '@veriscope/devtools', replacement: sourceAlias('./packages/devtools/src/index.ts') },
  { find: '@veriscope/coverage', replacement: sourceAlias('./packages/coverage/src/index.ts') },
  { find: '@veriscope/graph', replacement: sourceAlias('./packages/graph/src/index.ts') },
  { find: '@veriscope/mutate', replacement: sourceAlias('./packages/mutate/src/index.ts') },
  { find: '@veriscope/react', replacement: sourceAlias('./packages/react/src/index.ts') },
  { find: '@veriscope/solid', replacement: sourceAlias('./packages/solid/src/index.ts') },
  { find: '@veriscope/test', replacement: sourceAlias('./packages/test/src/index.ts') },
];

export default defineConfig({
  resolve: {
    alias: veriscopeAliases,
  },
});
