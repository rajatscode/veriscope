import tetrisSource from './tetris.ts?raw';
import veriscopeReactSource from './ports/veriscope/VeriscopeReact.tsx?raw';
import reactPlainSource from './ports/react/PlainReact.tsx?raw';
import solidPlainSource from './ports/solid/PlainSolid.tsx?raw';
import sveltePlainSource from './ports/svelte/PlainSvelte.svelte?raw';

export const leftSources = {
  veriscope: veriscopeReactSource,
  engine: tetrisSource,
};

export const rightSources = {
  react: reactPlainSource,
  solid: solidPlainSource,
  svelte: sveltePlainSource,
};
