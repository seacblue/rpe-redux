/**
 * React-owned portal hosts.
 *
 * A floating surface belongs to the app root, except inside a modal where it
 * belongs to that dialog. The provider tree carries the host elements, so a
 * component never searches the DOM for the surface that owns its portal.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

interface PortalHosts {
  appRoot: HTMLElement | null;
  modal: HTMLElement | null;
}

const PortalHostsContext = createContext<PortalHosts>({ appRoot: null, modal: null });

/**
 * Supplies one host level; omitted values inherit from the parent provider.
 *
 * The entry point provides the app root once. A Modal nests another provider
 * with its dialog element, so descendants can choose the nearest modal while
 * controls that must escape dialog clipping keep reading the app root.
 */
export function PortalHostProvider({
  host,
  modalHost,
  children,
}: {
  host?: HTMLElement | null;
  modalHost?: HTMLElement | null;
  children: ReactNode;
}): React.JSX.Element {
  const parent = useContext(PortalHostsContext);
  const value = useMemo(
    () => ({
      appRoot: host ?? parent.appRoot,
      modal: modalHost ?? parent.modal,
    }),
    [host, modalHost, parent.appRoot, parent.modal],
  );
  return <PortalHostsContext.Provider value={value}>{children}</PortalHostsContext.Provider>;
}

/** The app-root layer, shared by floating controls and popovers. */
export function useAppRootHost(): HTMLElement | null {
  return useContext(PortalHostsContext).appRoot;
}

/** The nearest modal dialog when present, otherwise the app root. */
export function useOverlayHost(): HTMLElement | null {
  const hosts = useContext(PortalHostsContext);
  return hosts.modal ?? hosts.appRoot;
}
