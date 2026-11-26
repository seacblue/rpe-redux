/** Owns the React refs for the preview's canvases and exposes them as one surface handle. */
import {
  createDomSurface,
  type DomSurfaceHandle,
  type DomSurfaceProviderProps,
} from "../../../../../contracts/domSurface.ts";
import type { PreviewSurface } from "../../runtime/composition/editorSurfaces.ts";

/** Refs and attach callbacks for the six preview canvases. */
export type PreviewSurfaceHandle = DomSurfaceHandle<PreviewSurface>;

const previewSurface = createDomSurface<PreviewSurface>(
  ["canvas", "noteBatch", "shader", "mask", "noteFieldMask", "overlay"],
  {
    selector: () => "preview.canvas",
    provider: "PreviewSurfaceProvider",
  },
);

/** Creates the canvas handles the preview runtime attaches to. */
export function createPreviewSurface(): PreviewSurfaceHandle {
  return previewSurface.create();
}

/** Provides the preview surface handle to the canvases and the editor runtime. */
export function PreviewSurfaceProvider(props: DomSurfaceProviderProps<PreviewSurface>) {
  return previewSurface.Provider(props);
}

/** Returns the preview surface handle; throws outside the provider. */
export function usePreviewSurface(): PreviewSurfaceHandle {
  return previewSurface.useSurface();
}
