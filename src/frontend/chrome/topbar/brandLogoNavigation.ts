/** Navigation seam for the title-bar brand, kept independent of React rendering. */
import type { EditorNavigationCommands } from "../../contracts/editorCommands.ts";

/** Routes a title-bar brand press through the document-releasing library exit. */
export function activateBrandLogo(
  atHome: boolean,
  navigation: Pick<EditorNavigationCommands, "closeLibrary"> | null,
): void {
  if (!atHome) {
    navigation?.closeLibrary();
  }
}
