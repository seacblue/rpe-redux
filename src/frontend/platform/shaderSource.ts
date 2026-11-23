/**
 * Reads a shader's GLSL from the packaged assets.
 *
 * The preview runtime and the inspector receive shader text through this loader,
 * which keeps network access out of `core/global/chart`.
 */
import { assetUrl } from "../../core/platform/assetUrl.ts";
import { assetPath } from "../../core/global/document/resources.ts";
import type { ReadableDocumentAssets } from "./documentStoreHandle.ts";
import { currentDocumentAssets } from "./documentStoreHandle.ts";

function readDocumentAssets(): ReadableDocumentAssets | null {
  return currentDocumentAssets();
}

/**
 * Reads one shader's GLSL out of the packaged assets.
 *
 * `path` is relative to `assets/`, for example `redux/shaders/<name>.glsl`.
 * Returns null when the file is absent, which selects the unprocessed preview.
 */
export async function readShaderSource(path: string, chartName = ""): Promise<string | null> {
  if (!path.startsWith("redux/")) {
    const assets = readDocumentAssets();
    const index = assets
      ? Object.assign(new Map(assets), { names: () => assets.names?.() ?? assets.keys() })
      : null;
    const resolved = index ? (assetPath(index, path, chartName) ?? path) : path;
    const bytes = await assets?.read?.(resolved);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }
  const response = await fetch(assetUrl(path));
  return response.ok ? await response.text() : null;
}
