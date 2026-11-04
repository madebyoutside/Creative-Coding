export { DEFAULT_PARAMS, normalizeParams } from './params.js';

/** Create and start a halftone instance; the public entry point. */
export async function createHalftone(options = {}) {
  const { Halftone } = await import('./Halftone.js');
  return Halftone.create(options);
}
