/**
 * The custom window buttons at the top-right of the frameless frame.
 *
 * Minimize, maximize/restore, and close call the desktop window controller. The
 * controls stay outside the app shell's modal inertness so the window can still
 * be managed while a dialog is open; fullscreen modes keep only close at the edge.
 */
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { controlWindow, observeWindowState } from "./windowControls.ts";
import { Button } from "../../../../design/components/button/Button.tsx";
import { IconButton } from "../../../../design/components/button/IconButton.tsx";
import type { IconName } from "../../../../design/components/icon/Icon.tsx";
import { registerWindowControls } from "../../../../design/components/modal/Modal.tsx";
import { useThemeUi } from "../../../app/useThemeUi.ts";
import { ThemeUiNodeView } from "../../../platform/themeUi.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import { useSetting } from "../../../screens/settings/useSetting.ts";
import type { WindowDisplayMode } from "../../../platform/desktop/windowDisplay.ts";

// Caption controls are window chrome, not page content: they answer the pointer
// but stay out of the document's focus order, so Tab never leaves a dialog for
// this strip. Pointer focus is suppressed for the same reason.
const chromeButtonProps = {
  tabIndex: -1,
  onMouseDown: (event: MouseEvent<HTMLButtonElement>) => event.preventDefault(),
} as const;

/** Caption buttons for the frameless frame: minimize, maximize or restore, and close. */
export function WindowControls() {
  const { t } = useTranslation();
  const displayMode = useSetting<WindowDisplayMode>("window-display-mode", "windowed");
  const template = useThemeUi().components.windowControl;
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");
  const setControlsRef = useCallback((element: HTMLDivElement | null) => {
    registerWindowControls(element);
  }, []);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    observeWindowState((value) => {
      if (!disposed) {
        setMaximized(value);
      }
    })
      .then((remove) => {
        if (disposed) {
          remove();
        } else {
          unlisten = remove;
        }
      })
      .catch((failure) => {
        if (!disposed) {
          setError(String(failure));
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  /** Runs a window action and records a failure for the error readout. */
  const run = (action: "minimize" | "maximize" | "close") => {
    controlWindow(action).catch((failure) => setError(String(failure)));
  };
  const control = (
    action: "minimize" | "maximize" | "close",
    icon: IconName,
    label: string,
    urgent = false,
  ) => {
    if (!template) {
      return (
        <IconButton
          {...chromeButtonProps}
          icon={icon}
          size="caption"
          variant={urgent ? "ghost" : "plain"}
          className={urgent ? "urgent" : ""}
          label={label}
          onClick={() => run(action)}
        />
      );
    }
    const active = action === "maximize" && maximized;
    return (
      <Button
        {...chromeButtonProps}
        variant="plain"
        className={`redux-icon-button redux-icon-button-caption theme-window-control${urgent ? " urgent" : ""}`}
        aria-label={label}
        data-tip-title={label}
        data-active={active}
        data-window-action={action}
        onClick={() => run(action)}
      >
        <ThemeUiNodeView tree={template} bindings={{ label, icon, active }} />
      </Button>
    );
  };
  const showWindowStateControls = displayMode === "windowed";
  return (
    <div className="redux-window-controls" role="group" ref={setControlsRef}>
      {showWindowStateControls &&
        control("minimize", "windowMinimize", t("chrome.window.minimize"))}
      {showWindowStateControls &&
        control(
          "maximize",
          maximized ? "windowRestore" : "windowMaximize",
          t(maximized ? "chrome.window.restore" : "chrome.window.maximize"),
        )}
      {control("close", "windowClose", t("chrome.window.close"), true)}
      {error && (
        <span className="redux-window-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
