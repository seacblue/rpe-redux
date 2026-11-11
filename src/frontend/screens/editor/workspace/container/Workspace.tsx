/**
 * Renders the editor's central authoring surface.
 *
 * The timeline stays mounted as the base layer. A registered Workspace mode
 * replaces it inside the same frame: the shell, inspector, and workspace bounds
 * do not move, and only the workspace content crossfades. Playback pauses on
 * entry and resumes on return; both are transport state, never chart edits.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "../../../../../i18n/react.ts";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { Icon } from "../../../../../design/components/icon/Icon.tsx";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../../../core/edit/state/visibility.ts";
import { CanvasStage } from "../stage/surface/CanvasStage.tsx";
import { useEditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import { collapseWorkspaceMode } from "./workspaceModeActions.ts";
import {
  closeWorkspaceMode,
  useActiveWorkspaceMode,
  useWorkspaceModes,
  type WorkspaceModeDefinition,
} from "./workspaceModes.ts";

/** How long a closed mode stays mounted for its exit transition. */
const MODE_EXIT_MS = 220;

/**
 * The editing surface: the merged preview and authoring canvas, or one
 * registered task page in the same frame.
 *
 * Every surrounding region, including the top bar, inspector, rail, and status
 * bar, is a sibling of the workspace rather than part of it.
 */
export function Workspace({ hidden = false }: { hidden?: boolean }) {
  const runtime = useEditorRuntime();
  const activeMode = useActiveWorkspaceMode();
  const modes = useWorkspaceModes();
  const [displayedId, setDisplayedId] = useState(() => activeMode?.id ?? "");
  // Derive the displayed page from the active mode during render; the state only
  // survives long enough to animate the closed page out.
  if (activeMode && displayedId !== activeMode.id) {
    setDisplayedId(activeMode.id);
  }
  const displayedMode = activeMode ?? modes.find((mode) => mode.id === displayedId) ?? null;
  const DisplayedMode = displayedMode?.component;
  const visibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const playingBeforeMode = useRef<boolean | null>(null);

  // Keep the last page mounted briefly so its exit transition can finish. The
  // active id still decides input and visibility immediately.
  useEffect(() => {
    if (activeMode || !displayedId) {
      return undefined;
    }
    const timer = window.setTimeout(() => setDisplayedId(""), MODE_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [activeMode, displayedId]);

  // Pause on entry and restore the entry transport state on return, so audio
  // does not keep running behind a page that no longer shows the timeline.
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

  // A mode belongs to an open document. Closing the document, or leaving the
  // editor for the library, returns to the timeline without reopening a pane.
  useEffect(() => {
    if (activeMode && (!visibility.hasDocument || visibility.atHome)) {
      closeWorkspaceMode();
    }
  }, [activeMode, visibility.atHome, visibility.hasDocument]);

  // Escape is the same spatial gesture as the mode bar's back button. Other
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
          className={`workspace-timeline-layer${activeMode ? " is-muted" : ""}`}
          aria-hidden={activeMode ? true : undefined}
          inert={activeMode ? true : undefined}
        >
          <CanvasStage />
        </div>
        {displayedMode && (
          <div
            key={displayedMode.id}
            className={`workspace-mode-layer${activeMode ? " is-active" : ""}`}
            aria-hidden={activeMode ? undefined : true}
            inert={activeMode ? undefined : true}
          >
            <WorkspaceModeBar mode={displayedMode} />
            <div className="workspace-mode-body">{DisplayedMode && <DisplayedMode />}</div>
          </div>
        )}
      </div>
    </main>
  );
}

/** The mode's one persistent exit point and its current task name. */
function WorkspaceModeBar({ mode }: { mode: WorkspaceModeDefinition }) {
  const { t } = useTranslation();
  const runtime = useEditorRuntime();
  const title = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus the mode name, not the exit button. Keyboard users still land inside
    // the new mode, but no button ring appears while the layer fades in.
    title.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="workspace-mode-bar">
      <div className="workspace-mode-title" ref={title} tabIndex={-1}>
        <Icon name={mode.icon} size={16} />
        <strong>{t(mode.label)}</strong>
      </div>
      <IconButton
        className="workspace-mode-back"
        icon="external"
        label={t("chrome.workspace.backToTimeline")}
        onClick={() => collapseWorkspaceMode(runtime)}
      />
    </div>
  );
}
