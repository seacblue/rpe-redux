/**
 * Blob URLs for browser-library assets.
 *
 * The desktop service exposes stable HTTP asset URLs. The browser library has
 * no HTTP origin, so it registers a blob URL per project asset and the shared
 * URL builders consult this cache before constructing a service URL.
 */

import { releaseObjectUrl } from "../../platform/browser/mediaHost.ts";

const urls = new Map<string, string>();

function key(origin: string, projectId: string, name: string): string {
  return `${origin}\u0000${projectId}\u0000${name}`;
}

/** Associate one project asset name with its live blob URL. */
export function cacheProjectAssetUrl(
  origin: string,
  projectId: string,
  name: string,
  url: string,
): void {
  urls.set(key(origin, projectId, name), url);
}

/** Return the cached blob URL for one project asset, if any. */
export function cachedProjectAssetUrl(
  origin: string,
  projectId: string,
  name: string,
): string | null {
  return urls.get(key(origin, projectId, name)) ?? null;
}

/** Release every blob URL cached for one project. */
export function clearProjectAssetUrls(origin: string, projectId: string): void {
  const prefix = `${origin}\u0000${projectId}\u0000`;
  for (const [entry, url] of urls) {
    if (!entry.startsWith(prefix)) {
      continue;
    }
    urls.delete(entry);
    releaseObjectUrl(url);
  }
}
