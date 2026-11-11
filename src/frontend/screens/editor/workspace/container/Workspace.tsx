/**
 * Renders the editor's central authoring surface.
 *
 * The timeline stays mounted as the base layer. A registered document task opens
 * as a wide Inspector over this frame, so the canvas neither resizes nor changes
 * page: playback pauses while the task is open and resumes on return. Both are
 * transport state, never chart edits.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../../../core/edit/state/visibility.ts";
import { CanvasStage } from "../stage/surface/CanvasStage.tsx";
import { useEditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import { collapseWorkspaceMode } from "./workspaceModeActions.ts";
import { closeWorkspaceMode, useActiveWorkspaceMode } from "./workspaceModes.ts";

/**
 * The editing surface: the merged preview and authoring canvas.
 *
 * Every surrounding region, including the top bar, inspector, rail, and status
 * bar, is a sibling of the workspace rather than part of it.
 */
export function Workspace({ hidden = false }: { hidden?: boolean }) {
  const runtime = useEditorRuntime();
  const activeMode = useActiveWorkspaceMode();
  const visibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const playingBeforeMode = useRef<boolean | null>(null);

  // Pause on entry and restore the entry transport state on return, so audio
  // does not keep running behind the expanded Inspector.
  useEffect(() => {
    const playback = runtime?.providers.playback.playback;
    if (!playback) {
      return;
    }
    if (activeMode) {
      if (playingBeforeMode.current === null) {
        playingBeforeMode.current = playback.audio.playing || playback.pending;
        playback.pause();
        runtime?.timeline.viewport.setPlaybackActive(false);
      }
      return;
    }
    if (playingBeforeMode.current === null) {
      return;
    }
    const resume = playingBeforeMode.current;
    playingBeforeMode.current = null;
    if (resume && runtime?.getSession().chart) {
      runtime.timeline.viewport.setPlaybackActive(true);
      void playback.play(runtime.getSession().chart).catch(() => {
        runtime.timeline.viewport.setPlaybackActive(false);
      });
    }
  }, [activeMode, runtime]);

  // A task belongs to an open document. Closing the document, or leaving the
  // editor for the library, returns to the timeline without reopening a pane.
  useEffect(() => {
    if (activeMode && (!visibility.hasDocument || visibility.atHome)) {
      closeWorkspaceMode();
    }
  }, [activeMode, visibility.atHome, visibility.hasDocument]);

  // Escape is the same gesture as the expanded header's return control. Other
  // surfaces claim Escape first; only a plain, undhandled press returns.
  useEffect(() => {
    if (!activeMode) {
      return undefined;
    }
    let timer = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) {
        return;
      }
      if (timer) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = 0;
        if (!event.defaultPrevented && !runtime?.ui.activeInspector.get()) {
          collapseWorkspaceMode(runtime);
        }
      }, 0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [activeMode, runtime]);

  return (
    <main
      className="workspace panel redux-stage-overlay"
      data-workspace-mode={activeMode?.id ?? "timeline"}
      data-timeline-visible={activeMode ? "false" : "true"}
      hidden={hidden}
    >
      <div className="workspace-mode-stack">
        <div
          className="workspace-timeline-layer"
          aria-hidden={activeMode ? true : undefined}
          inert={activeMode ? true : undefined}
        >
          <CanvasStage />
        </div>
      </div>
    </main>
  );
}
