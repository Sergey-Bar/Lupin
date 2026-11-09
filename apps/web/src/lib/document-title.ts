import { routeFor } from '../route-manifest.js';

/**
 * The browser tab's title: "Page · Lupin".
 *
 * The page goes first so a row of narrow tabs still tells them apart. A path the manifest
 * does not know gets the product name alone rather than a guessed label.
 */
export function documentTitleFor(path: string): string {
  const route = routeFor(path);
  return route === undefined ? 'Lupin' : `${route.label} · Lupin`;
}
