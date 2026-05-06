import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bridge.ts', 'src/waveform.ts', 'src/visualizer.ts', 'src/assertions.ts', 'src/liveAssertions.ts', 'src/mutants.ts', 'src/layout.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  clean: true,
  external: ['@veriscope/graph'],
});
