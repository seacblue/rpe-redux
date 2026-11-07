/**
 * Removes guide passages that describe AI-restricted editing features.
 *
 * The canonical guide is `sdk/llm-guide.md`. HTML comments name the feature a
 * passage teaches, so the stored document stays readable while the served copy
 * only contains capabilities the AI caller may actually use.
 *
 * - `<!-- ai-block:feature -->` ... `<!-- /ai-block:feature -->` hides a block.
 * - `<!-- ai-line:feature -->` at the end of a line hides that line.
 *
 * HTML comments do not render in Markdown, so the source guide remains valid.
 */
import {
  aiEditingFeatureStates,
  type AiEditingFeatureStates,
} from "../../settings/editingAiAccess.ts";
import type { EditingFeature } from "../../settings/editingFeatureKeys.ts";

const BLOCK_START = /^<!--\s*ai-block:([A-Za-z]+)\s*-->$/;
const BLOCK_END = /^<!--\s*\/ai-block:([A-Za-z]+)\s*-->$/;
const LINE_MARKER = /<!--\s*ai-line:([A-Za-z]+)\s*-->/g;

/** Unknown markers stay visible; a typo must not silently hide documentation. */
function enabled(states: Readonly<Record<EditingFeature, boolean>>, name: string): boolean {
  return Object.hasOwn(states, name) ? states[name as EditingFeature] : true;
}

/** Strip one line's trailing horizontal whitespace after removing its marker. */
function withoutLineMarker(line: string): string {
  return line.replace(/[ \t]+$/u, "");
}

/** Return a guide copy that omits passages for AI-disabled features. */
export function filterAiGuide(
  text: string,
  states: AiEditingFeatureStates = aiEditingFeatureStates(),
): string {
  const output: string[] = [];
  let hiddenDepth = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const start = BLOCK_START.exec(trimmed);
    if (start) {
      if (hiddenDepth > 0) {
        hiddenDepth += 1;
      } else if (!enabled(states, start[1])) {
        hiddenDepth = 1;
      }
      continue;
    }
    const end = BLOCK_END.exec(trimmed);
    if (end) {
      if (hiddenDepth > 0) {
        hiddenDepth -= 1;
      }
      continue;
    }
    if (hiddenDepth > 0) {
      continue;
    }
    let hidden = false;
    const stripped = line.replace(LINE_MARKER, (_whole, name: string) => {
      if (!enabled(states, name)) {
        hidden = true;
      }
      return "";
    });
    if (hidden) {
      continue;
    }
    if (stripped === line) {
      output.push(line);
    } else if (stripped.trim()) {
      output.push(withoutLineMarker(stripped));
    }
  }
  return output.join("\n");
}
