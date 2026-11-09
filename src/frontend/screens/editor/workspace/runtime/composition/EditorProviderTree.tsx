/** Owns the React provider tree, runtime construction, chrome binding, and teardown. */
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { createEditorAssembly } from "./EditorAssembly.ts";
import { EditorRuntimeProvider, type EditorRuntime } from "./EditorRuntime.tsx";
import { DocumentIdentityHostProvider } from "../../../../../contracts/editorHostReact.tsx";
import { useDocumentIdentity } from "../../session/useDocumentIdentity.ts";
import type { EditorSessionRuntime } from "../providers/SessionProvider.tsx";
import { PreviewProvider } from "../providers/PreviewProvider.tsx";
import { TimelineProvider } from "../providers/TimelineProvider.tsx";
import { PlaybackProvider } from "../providers/PlaybackProvider.tsx";
import { InspectorProvider } from "../providers/InspectorProvider.tsx";
import { DocumentProvider } from "../providers/DocumentProvider.tsx";
import { CollaborationProvider } from "../../collaboration/collaborationRuntime.tsx";
import { useTimelineDomSurface } from "../../timeline/surface/TimelineDomSurface.tsx";
import { usePreviewSurface } from "../../preview/surface/PreviewDomSurface.tsx";
import { useInspectorSurface } from "../../../inspector/InspectorDomSurface.tsx";
import { useTransportSurface } from "../../../../../chrome/transport/TransportDomSurface.tsx";

interface ProviderErrorBoundaryProps {
  readonly onError: (error: string) => void;
  readonly onReady: (ready: boolean) => void;
  readonly children: ReactNode;
}

interface ProviderErrorBoundaryState {
  readonly error: string | null;
}

/** Keeps a provider render failure on the visible startup error surface. */
class ProviderErrorBoundary extends Component<
  ProviderErrorBoundaryProps,
  ProviderErrorBoundaryState
> {
  state: ProviderErrorBoundaryState = { error: null };

  /** Converts a thrown value into the state that hides the failed subtree. */
  static getDerivedStateFromError(error: unknown): ProviderErrorBoundaryState {
    return { error: String(error) };
  }

  /** Reports the failure with its stack and marks the provider tree not ready. */
  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError(
      error && typeof error === "object" && "stack" in error && typeof error.stack === "string"
        ? error.stack
        : String(error),
    );
    this.props.onReady(false);
  }

  /** Renders children while no failure is recorded. */
  render(): ReactNode {
    return this.state.error ? null : this.props.children;
  }
}

/** Publishes the open document's display identity to the chrome contract. */
function DocumentIdentityHost({ children }: { children: ReactNode }) {
  const identity = useDocumentIdentity();
  return (
    <DocumentIdentityHostProvider identity={identity}>{children}</DocumentIdentityHostProvider>
  );
}

/** Constructs and publishes one editor runtime without creating another React root. */
export function EditorProviderTree({
  session,
  enabled,
  resetKey,
  onReady,
  onError,
  children,
}: {
  session: EditorSessionRuntime;
  enabled: boolean;
  resetKey: number;
  onReady: (ready: boolean) => void;
  onError: (error: string) => void;
  children: ReactNode;
}) {
  const [runtime, setRuntime] = useState<EditorRuntime | null>(null);
  const timelineSurface = useTimelineDomSurface();
  const previewSurface = usePreviewSurface();
  const inspectorSurface = useInspectorSurface();
  const transportSurface = useTransportSurface();
  const providerRenderFailed = useRef(false);

  // Waits for the feature hosts to publish their DOM surfaces, then builds one
  // assembly and disposes it when the mount key changes.
  useEffect(() => {
    if (!enabled) {
      onReady(false);
      return;
    }

    providerRenderFailed.current = false;
    let active = true;
    let mounted: EditorRuntime | null = null;
    let timer = 0;
    let attempts = 0;
    /**
     * Builds the assembly once every surface ref has a node, retrying briefly.
     *
     * The retry uses a task timer rather than an animation frame: an occluded
     * browser tab or a minimized window may pause animation frames, and editor
     * startup must still finish while the window is in the background.
     */
    const mount = () => {
      if (!active) {
        return;
      }
      const surfacesReady = [
        ...Object.values(previewSurface.refs).map((ref) => ref.current),
        ...Object.values(timelineSurface.refs).map((ref) => ref.current),
        ...Object.values(inspectorSurface.refs).map((ref) => ref.current),
        ...Object.values(transportSurface.refs).map((ref) => ref.current),
      ].every(Boolean);
      if (!surfacesReady && attempts < 30) {
        attempts += 1;
        timer = window.setTimeout(mount, 16);
        return;
      }
      try {
        mounted = createEditorAssembly(
          {
            preview: previewSurface.resolve(),
            timeline: timelineSurface.resolve(),
            inspector: inspectorSurface.resolve(),
            transport: transportSurface.resolve(),
          },
          session,
        ).runtime;
        setRuntime(mounted);
        onError("");
        onReady(true);
      } catch (error) {
        if (!providerRenderFailed.current) {
          onError(
            error &&
              typeof error === "object" &&
              "stack" in error &&
              typeof error.stack === "string"
              ? error.stack
              : String(error),
          );
        }
        onReady(false);
      }
    };
    timer = window.setTimeout(mount, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
      mounted?.dispose();
      setRuntime(null);
    };
  }, [
    enabled,
    onError,
    onReady,
    resetKey,
    session,
    timelineSurface,
    previewSurface,
    inspectorSurface,
    transportSurface,
  ]);

  const providers = runtime?.providers;
  return (
    <EditorRuntimeProvider runtime={runtime}>
      <ProviderErrorBoundary
        key={resetKey}
        onError={(error) => {
          providerRenderFailed.current = true;
          onError(error);
        }}
        onReady={onReady}
      >
        <DocumentIdentityHost>
          <PreviewProvider runtime={providers?.preview ?? null}>
            <TimelineProvider runtime={providers?.timeline ?? null}>
              <PlaybackProvider runtime={providers?.playback ?? null}>
                <InspectorProvider runtime={providers?.inspector ?? null}>
                  <DocumentProvider runtime={providers?.document ?? null}>
                    <CollaborationProvider>{children}</CollaborationProvider>
                  </DocumentProvider>
                </InspectorProvider>
              </PlaybackProvider>
            </TimelineProvider>
          </PreviewProvider>
        </DocumentIdentityHost>
      </ProviderErrorBoundary>
    </EditorRuntimeProvider>
  );
}
