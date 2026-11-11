/**
 * The mounted asset-library pane.
 *
 * The inspector frame keeps every panel mounted and only toggles `hidden`, so
 * this component describes loading, error, and ready itself. The title stays
 * outside the view because the view does not exist until a snapshot is ready.
 */
import { Spinner } from "../../../../../design/components/spinner/Spinner.tsx";
import { InlineAlert } from "../../../../../design/components/alert/InlineAlert.tsx";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import { AssetLibraryView } from "./AssetLibraryView.tsx";
import { useEditorRuntimeValue } from "../../../editor/workspace/runtime/composition/EditorRuntime.tsx";
import type { AssetLibraryPanelState } from "./model.ts";

/**
 * The asset-library pane.
 *
 * The inspector frame mounts every registered panel permanently and only
 * toggles `hidden` on it, so this component has to describe all three states on
 * its own. A `null` state means no document has built the library yet and stays
 * blank; `loading` is the asynchronous build and shows the spinner.
 *
 * The title is rendered here rather than inside the view because it has to stay
 * on screen while the tree is still being built — the view only exists once a
 * snapshot is ready.
 */
export function AssetsPanel({
  showTitle = true,
  variant = "all",
}: {
  showTitle?: boolean;
  variant?: "all" | "tree" | "details" | "stacked" | "split";
} = {}) {
  const state = useEditorRuntimeValue(
    (runtime) => runtime.ui.assetLibrary,
    null as AssetLibraryPanelState | null,
  );
  const { t } = useTranslation();
  return (
    <>
      {showTitle && (
        <div className="panel-title">
          {t("editorPanels.assetLibrary.title")}
          {state?.status === "ready" && (
            <small>
              {t("editorPanels.assetLibrary.count", { count: state.snapshot.assetCount })}
            </small>
          )}
        </div>
      )}
      {state?.status === "loading" && <Spinner label={t("editorPanels.assetLibrary.loading")} />}
      {state?.status === "error" && (
        <InlineAlert
          className="asset-library-error"
          action={
            <Button variant="outlined" onClick={state.retry}>
              {t("common.action.retry")}
            </Button>
          }
        >
          {t("editorPanels.assetLibrary.loadFailed")}
        </InlineAlert>
      )}
      {state?.status === "ready" && (
        <AssetLibraryView {...state.snapshot} {...state.actions} variant={variant} />
      )}
    </>
  );
}
