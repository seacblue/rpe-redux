/**
 * Loads the built-in settings features.
 *
 * Each import registers its own navigation and schema as a side effect, and the
 * order here is the order the categories appear in settings navigation, so
 * reordering an import is a visible product change.
 */
// Import built-in features so each feature can contribute its navigation and schema.
import "./appearance.ts";
import "./coverBackground.ts";
import "./skin.ts";
import "./language.ts";
import "./generalInterface.ts";
import "./runtimePorts.ts";
import "./editingSettings.ts";
import "./timeline.ts";
import "./audio.ts";
import "./preview.ts";
import "./files.ts";
import "./webStorage.ts";
import "./libraryBackup.ts";
import "./codeCell.ts";
import "./updates.ts";
import "./extensions.ts";
import "./shortcuts.ts";
import "./help.ts";
import "./editingFeatures.ts";
