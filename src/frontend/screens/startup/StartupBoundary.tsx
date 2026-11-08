/**
 * The startup error boundary.
 *
 * A render failure replaces the editor with the failure screen while the window
 * controls, which live outside the tree, keep working.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { StartupView } from "./StartupView.tsx";
import { diagnosticText } from "../../platform/diagnosticLog.ts";
import { showDesktopWindow } from "../../platform/desktop/windowDisplay.ts";
import { t } from "../../../i18n/index.ts";
import { setLongTaskBootState } from "../../../core/state/longTasks.ts";

/** Keeps editor render failures from unmounting the independent window controls. */
export class StartupBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };

  /** Converts a render failure into the message the boundary displays. */
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: diagnosticText(error) || t("settings.startup.failed") };
  }

  /** Appends the React component stack to the diagnostic text. */
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    setLongTaskBootState("failed");
    // A render failure can happen before AppContent reaches its normal reveal
    // barrier; keep the failure report reachable when the native window starts
    // hidden for geometry restoration.
    void showDesktopWindow().catch(() => {});
    this.setState({
      error: `${diagnosticText(error)}\n\nReact component stack:${info.componentStack}`,
    });
  }

  /** Renders the failure screen, or the children while the tree is healthy. */
  render(): ReactNode {
    return this.state.error !== null ? (
      <StartupView
        error={this.state.error}
        source="render"
        retry={() => {
          setLongTaskBootState("loading");
          this.setState({ error: null });
        }}
      />
    ) : (
      this.props.children
    );
  }
}
