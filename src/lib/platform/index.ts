/**
 * Server-only. Not re-exported from a shared barrel: pulling `server-only` into
 * a client bundle is a build error, and it should stay that way.
 */
export { getIsPlatformAdmin, isPlatformAdmin, requirePlatformAdmin } from "./access";
export type { PlatformOptions } from "./access";
