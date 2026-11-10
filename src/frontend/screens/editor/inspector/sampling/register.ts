/**
 * Registers the sampling inspector pane and its close lifecycle.
 *
 * The pane is opened by the event inspector's sampling entry or the
 * selected-event shortcut, so it has no sidebar or toolbar route. Leaving the
 * pane by any means restores the free camera the sampling session borrowed.
 */
import { bindInspectorLifecycle, registerInspectorPanel } from "../controller.ts";
import { stopSampling } from "../../sampling/samplingSession.ts";
import { SamplingInspector } from "./SamplingInspector.tsx";
import { INSPECTOR_TUTORIALS } from "../tutorials.ts";

const disposePanel = registerInspectorPanel({
  id: "sampling",
  component: SamplingInspector,
  label: "editorPanels.sampling.title",
  icon: "preview",
  tutorial: INSPECTOR_TUTORIALS.sampling,
  editsChart: true,
});
const disposeLifecycle = bindInspectorLifecycle("sampling", {
  onClose: stopSampling,
});
const unregister = () => {
  disposeLifecycle();
  disposePanel();
};

if (import.meta.hot) {
  import.meta.hot.dispose(unregister);
}
