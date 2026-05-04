import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['@veriscope/graph'],
  },
  optimizeDeps: {
    // Don't pre-bundle workspace packages — ensures singleton graph instance
    exclude: ['@veriscope/graph', '@veriscope/react', '@veriscope/devtools'],
  },
});
