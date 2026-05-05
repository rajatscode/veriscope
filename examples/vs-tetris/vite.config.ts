import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sourceAlias = (path: string) => new URL(path, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@veriscope/devtools/bridge', replacement: sourceAlias('../../packages/devtools/src/bridge.ts') },
      { find: '@veriscope/devtools', replacement: sourceAlias('../../packages/devtools/src/index.ts') },
      { find: '@veriscope/graph', replacement: sourceAlias('../../packages/graph/src/index.ts') },
      { find: '@veriscope/mutate', replacement: sourceAlias('../../packages/mutate/src/index.ts') },
      { find: '@veriscope/react', replacement: sourceAlias('../../packages/react/src/index.ts') },
      { find: '@veriscope/test', replacement: sourceAlias('../../packages/test/src/index.ts') },
    ],
  },
});
