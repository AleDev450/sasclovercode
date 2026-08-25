/**
 * Inert stand-in for the `server-only` marker package.
 *
 * The real package throws unless the bundler resolves it through React's
 * `react-server` export condition, which Vitest does not apply. Aliasing it
 * here lets server modules be imported by tests while the production build
 * still gets the real guard.
 */
export {};
