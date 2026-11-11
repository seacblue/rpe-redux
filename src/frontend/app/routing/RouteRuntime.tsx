/**
 * Keeps the address bar and the live editor on the same destination.
 *
 * The editor state stays authoritative while the user works: opening a chart,
 * returning home, closing a document, or showing a settings page mirrors into
 * history. A `popstate` event is the one path in the other direction; it drives
 * the same guarded editor operations, and a cancelled prompt restores the URL
 * from the state that is still on screen.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { editorProjectId } from "../../../core/edit/state/publishedValues.ts";
import {
  getEditorVisibility,
  subscribeToEditorVisibility,
} from "../../../core/edit/state/visibility.ts";
import {
  routeHistoryMode,
  routeKey,
  sameRoute,
  sameRouteDestination,
  withSettings,
  type AppRoute,
} from "../../../core/shell/route.ts";
import {
  getBootRoute,
  getBootSettled,
  routeDocumentActions,
  subscribeBootSettled,
  type RouteDocumentActions,
} from "../../contracts/appRoute.ts";
import {
  CLOSE_SETTINGS_EVENT,
  OPEN_SETTINGS_EVENT,
  getSettingsWindowState,
  subscribeSettingsWindowState,
} from "../../screens/settings/settingsWindowController.ts";
import { currentLocationRoute, readLocationRoute, writeLocationRoute } from "./routeLocation.ts";

/** Build the route the live editor currently represents. */
function routeFromState(
  atHome: boolean,
  hasDocument: boolean,
  projectId: string,
  settingsOpen: boolean,
  settingsCategory: string,
): AppRoute {
  let base: AppRoute;
  if (!atHome && hasDocument) {
    base = projectId
      ? { kind: "chart", projectId, settings: null }
      : { kind: "editor", settings: null };
  } else {
    base = { kind: "home", settings: null };
  }
  return withSettings(base, settingsOpen ? settingsCategory : null);
}

/** Read the state-derived route from the live stores. */
function readStateRoute(): AppRoute {
  const visibility = getEditorVisibility();
  const settings = getSettingsWindowState();
  return routeFromState(
    visibility.atHome,
    visibility.hasDocument,
    editorProjectId.get(),
    settings.open,
    settings.category,
  );
}

/** Write the live state to the address and record it as the last committed route. */
function syncFromState(mode: "push" | "replace"): AppRoute {
  const route = readStateRoute();
  writeLocationRoute(route, mode);
  return route;
}

/** Apply the destination part of a history target through the editor's own guards. */
async function applyDestination(target: AppRoute, actions: RouteDocumentActions): Promise<boolean> {
  const visibility = getEditorVisibility();
  const projectId = editorProjectId.get();
  switch (target.kind) {
    case "home":
      return visibility.atHome ? true : actions.leaveEditor();
    case "editor":
      if (!visibility.hasDocument) {
        return false;
      }
      if (visibility.atHome) {
        actions.showEditor();
      }
      return true;
    case "chart":
      if (projectId === target.projectId) {
        if (!visibility.hasDocument) {
          return false;
        }
        if (visibility.atHome) {
          actions.showEditor();
        }
        return true;
      }
      return actions.openProject(target.projectId);
  }
}

/** Apply the settings part of a history target without asking a document question. */
function applySettings(target: AppRoute): void {
  const settings = getSettingsWindowState();
  if (target.settings === null) {
    if (settings.open) {
      window.dispatchEvent(new Event(CLOSE_SETTINGS_EVENT));
    }
    return;
  }
  if (!settings.open) {
    window.dispatchEvent(
      new CustomEvent(OPEN_SETTINGS_EVENT, {
        detail: { category: target.settings || undefined },
      }),
    );
    return;
  }
  if (target.settings && settings.category !== target.settings) {
    window.dispatchEvent(
      new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { category: target.settings } }),
    );
  }
}

/** Route mirror and history listener mounted beside the shell. */
export function RouteRuntime({ enabled }: { enabled: boolean }) {
  const visibility = useSyncExternalStore(
    subscribeToEditorVisibility,
    getEditorVisibility,
    getEditorVisibility,
  );
  const projectId = useSyncExternalStore(
    editorProjectId.subscribe,
    editorProjectId.get,
    editorProjectId.get,
  );
  const settings = useSyncExternalStore(
    subscribeSettingsWindowState,
    getSettingsWindowState,
    getSettingsWindowState,
  );
  const bootSettled = useSyncExternalStore(subscribeBootSettled, getBootSettled, getBootSettled);

  const lastWritten = useRef<string | null>(null);
  const previousState = useRef<AppRoute | null>(null);
  const firstMirror = useRef(true);
  const applying = useRef(false);
  const applyGeneration = useRef(0);
  const appliedBootSettings = useRef(false);
  /** `undefined` = no boot settings; `null` = waiting; a string = resolved. */
  const pendingBootSettings = useRef<string | null | undefined>(undefined);

  // A rebuilt editor assembly must not mirror the previous assembly's state.
  useEffect(() => {
    if (bootSettled) {
      return;
    }
    lastWritten.current = null;
    previousState.current = null;
    firstMirror.current = true;
    applying.current = false;
    appliedBootSettings.current = false;
    pendingBootSettings.current = undefined;
    applyGeneration.current += 1;
  }, [bootSettled]);

  // Capture the address before the first mirror so a boot restore becomes a
  // replace, and open the settings page that the address names.
  useEffect(() => {
    if (!enabled || !bootSettled) {
      return;
    }
    if (lastWritten.current === null) {
      const current = currentLocationRoute();
      lastWritten.current = routeKey(current);
      previousState.current = current;
    }
    if (appliedBootSettings.current) {
      return;
    }
    appliedBootSettings.current = true;
    const boot = getBootRoute();
    if (!boot || boot.settings === null) {
      return;
    }
    pendingBootSettings.current = boot.settings;
    window.dispatchEvent(
      new CustomEvent(OPEN_SETTINGS_EVENT, {
        detail: { category: boot.settings || undefined },
      }),
    );
  }, [bootSettled, enabled]);

  // Mirror the live editor into history. Opening a destination pushes; closing
  // a document, changing a settings page, and the first boot write replace.
  useEffect(() => {
    if (!enabled || !bootSettled || applying.current) {
      return;
    }
    if (pendingBootSettings.current !== undefined) {
      if (!settings.open) {
        return;
      }
      pendingBootSettings.current = undefined;
    }
    if (lastWritten.current === null) {
      return;
    }
    const next = routeFromState(
      visibility.atHome,
      visibility.hasDocument,
      projectId,
      settings.open,
      settings.category,
    );
    const nextKey = routeKey(next);
    if (nextKey === lastWritten.current) {
      firstMirror.current = false;
      previousState.current = next;
      return;
    }
    const previous = previousState.current;
    const boot = getBootRoute();
    const explicitBoot = boot !== null && (boot.kind !== "home" || boot.settings !== null);
    writeLocationRoute(
      next,
      routeHistoryMode(previous, next, {
        first: firstMirror.current,
        hasDocument: visibility.hasDocument,
        failedBootDestination: explicitBoot && !sameRoute(next, boot),
      }),
    );
    lastWritten.current = nextKey;
    previousState.current = next;
    firstMirror.current = false;
  }, [
    bootSettled,
    enabled,
    projectId,
    settings.category,
    settings.open,
    visibility.atHome,
    visibility.hasDocument,
  ]);

  // Turn Back/Forward into the same guarded operations the UI uses. The URL is
  // already at the target when this runs; a cancelled prompt restores it from
  // the state that remains on screen.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let lastObservedAddress: string | null = null;
    const onPopState = (): void => {
      if (!bootSettled) {
        return;
      }
      const address = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (address === lastObservedAddress) {
        return;
      }
      lastObservedAddress = address;
      const target = readLocationRoute();
      if (!target) {
        const synced = syncFromState("replace");
        lastWritten.current = routeKey(synced);
        previousState.current = synced;
        return;
      }
      const before = readStateRoute();
      if (sameRoute(target, before)) {
        lastWritten.current = routeKey(target);
        previousState.current = target;
        return;
      }
      const actions = routeDocumentActions();
      if (!actions) {
        const synced = syncFromState("replace");
        lastWritten.current = routeKey(synced);
        previousState.current = synced;
        return;
      }
      const guarded =
        !sameRouteDestination(before, target) &&
        getEditorVisibility().dirty &&
        !getEditorVisibility().atHome;
      if (guarded) {
        writeLocationRoute(before, "push");
        lastWritten.current = routeKey(before);
      } else {
        lastWritten.current = routeKey(target);
      }
      applying.current = true;
      const generation = ++applyGeneration.current;
      void applyDestination(target, actions)
        .then((applied) => {
          if (generation !== applyGeneration.current) {
            return;
          }
          applying.current = false;
          if (!applied) {
            const synced = syncFromState("replace");
            lastWritten.current = routeKey(synced);
            previousState.current = synced;
            return;
          }
          applySettings(target);
          writeLocationRoute(target, "replace");
          lastWritten.current = routeKey(target);
          previousState.current = target;
        })
        .catch(() => {
          if (generation !== applyGeneration.current) {
            return;
          }
          applying.current = false;
          const synced = syncFromState("replace");
          lastWritten.current = routeKey(synced);
          previousState.current = synced;
        });
    };
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onPopState);
      applyGeneration.current += 1;
    };
  }, [bootSettled, enabled]);

  return null;
}
