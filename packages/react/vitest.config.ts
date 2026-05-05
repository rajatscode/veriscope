import { defineConfig } from 'vitest/config';
import { veriscopeAliases } from '../../vitest.config';

export default defineConfig({
  resolve: {
    alias: veriscopeAliases,
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
