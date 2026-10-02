/**
 * Runtime API origin (SPEC §30-adjacent hosting note).
 *
 * `config.js` next to `index.html` may set `window.__ATRIUM_API__` to the
 * backend origin — used when the static front is hosted separately (GitHub
 * Pages) from the API (tunnel). Empty/absent → same-origin (the Node server
 * or the Vite dev proxy).
 */

type AtriumWindow = Window & { __ATRIUM_API__?: string };

export const API_ORIGIN: string =
  (typeof window !== 'undefined' && (window as AtriumWindow).__ATRIUM_API__) || '';

/** Prefix a same-origin API path (`/api/...`) with the runtime API origin. */
export const apiUrl = (path: string): string => API_ORIGIN + path;

/**
 * Absolute URL of the login screen for hard navigations (session expiry,
 * logout). Built from the current location so it works both on the Node
 * server (`/…`) and on a static host with a sub-path (GitHub Pages `/atrium/`),
 * where the hash router keeps routes after `#`.
 */
export const loginUrl = (): string =>
  typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}#/login`
    : '/#/login';
