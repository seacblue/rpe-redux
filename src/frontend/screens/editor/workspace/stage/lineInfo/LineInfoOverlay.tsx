/**
 * The stage's line-info slot; the controller publishes whether it is visible and
 * what it says.
 */
import { useEditorRuntimeValue } from "../../runtime/composition/EditorRuntime.tsx";
import type { LineInfoSnapshot } from "./lineInfoController.ts";

/** Renders the published line-info text while it is visible. */
export function LineInfoOverlay() {
  const lineInfo = useEditorRuntimeValue((runtime) => runtime.ui.lineInfo, {
    visible: false,
    text: "",
    layout: { rows: [] },
  } satisfies LineInfoSnapshot);
  return (
    <div className="line-info-overlay" hidden={!lineInfo.visible}>
      {lineInfo.layout.rows.length > 0
        ? lineInfo.layout.rows.map((row, rowIndex) => (
            <div className="line-info-row" key={rowIndex}>
              {row.map((token, tokenIndex) => (
                <span className={`line-info-token line-info-token-${token.kind}`} key={tokenIndex}>
                  {token.text}
                </span>
              ))}
            </div>
          ))
        : lineInfo.text}
    </div>
  );
}
