import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { veriscopeAliases } from '../../vitest.config';

const solidBrowser = fileURLToPath(new URL('../../node_modules/solid-js/dist/solid.js', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      ...veriscopeAliases,
      { find: 'solid-js', replacement: solidBrowser },
    ],
  },
});
