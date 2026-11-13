/**
 * The timing page: the timing-point list above the selected point's properties.
 *
 * The same two faces are the page in every frame: the compact split stacks them
 * and the expanded workspace turns that split into a fixed list column beside
 * the wide detail column. The page therefore has one composition, not one per
 * layout.
 */
import { useTranslation } from "../../../../../i18n/react.ts";
import { InspectorPageSplit } from "../../../../chrome/inspectorPage/InspectorPageSplit.tsx";
import { GlobalTimingInspector } from "./GlobalTimingInspector.tsx";
import { GlobalTimingWorkspace } from "./GlobalTimingWorkspace.tsx";

/** Places the timing list and the selected point's property face in one split. */
export function TimingPageLayout() {
  const { t } = useTranslation();
  return (
    <InspectorPageSplit
      topLabel={t("editorPanels.inspector.form.bpm.title")}
      bottomLabel={t("editorPanels.inspector.form.bpm.attributes")}
      top={<GlobalTimingWorkspace />}
      bottom={<GlobalTimingInspector />}
    />
  );
}
