/**
 * Error boundary around the lazily loaded editor shell.
 *
 * A rejected chunk import or a shell render failure must not replace the
 * startup screen with a blank page; it reports to the startup report and hides
 * the failed subtree while `StartupView` offers the retry.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { diagnosticText } from "../platform/diagnosticLog.ts";

/** Inputs for the lazy shell boundary. */
export interface EditorShellBoundaryProps {
  /** Publishes the failure to the startup report. */
  readonly onError: (error: string) => void;
  readonly children: ReactNode;
}

interface EditorShellBoundaryState {
  readonly failed: boolean;
}

/** Hides a failed editor shell after reporting it once. */
export class EditorShellBoundary extends Component<
  EditorShellBoundaryProps,
  EditorShellBoundaryState
> {
  state: EditorShellBoundaryState = { failed: false };

  /** Switches to the empty fallback when the lazy shell throws. */
  static getDerivedStateFromError(): EditorShellBoundaryState {
    return { failed: true };
  }

  /** Sends the diagnostic text to the startup screen's error report. */
  componentDidCatch(error: unknown, _info: ErrorInfo): void {
    this.props.onError(diagnosticText(error));
  }

  /** Renders the shell until a failure, then leaves the startup screen in charge. */
  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
