/** The imperative editor: operations, panes, dialogs, drawing readouts, notifications. */
export default {
  "editor.recording.updateBusy": "An update is being prepared. Try again after it finishes.",
  "editor.recording.title": "Render chart",
  "editor.recording.format": "Format",
  "editor.recording.format.mp4": "MP4 video",
  "editor.recording.format.mkv": "MKV video",
  "editor.recording.format.mov": "MOV video",
  "editor.recording.format.webm": "WebM video",
  "editor.recording.format.gif": "GIF animation",
  "editor.recording.format.apng": "APNG animation",
  "editor.recording.format.webp": "WebP animation",
  "editor.recording.format.mp3": "MP3 audio",
  "editor.recording.format.flac": "FLAC audio",
  "editor.recording.format.wav": "WAV audio",
  "editor.recording.format.ogg": "OGG audio",
  "editor.recording.formatHint.mp4":
    "Default. Copies the platform H.264 stream when available; the bitrate only applies to the re-encoding fallback.",
  "editor.recording.formatHint.mkv":
    "Fast H.264 + AAC in a Matroska container; the bitrate only applies to the re-encoding fallback.",
  "editor.recording.formatHint.mov":
    "Fast H.264 + AAC in a QuickTime container; the bitrate only applies to the re-encoding fallback.",
  "editor.recording.formatHint.webm":
    "VP9 + Opus, always re-encoded, so the export takes noticeably longer.",
  "editor.recording.formatHint.gif":
    "No audio and very large; palette animation, and the size shown is only an estimate. Higher speed significantly reduces the size.",
  "editor.recording.formatHint.apng":
    "No audio; lossless PNG animation, so the file can become very large. Higher speed significantly reduces the size.",
  "editor.recording.formatHint.webp":
    "No audio; lossy animated WebP, usually much smaller than GIF. Higher speed significantly reduces the size.",
  "editor.recording.formatHint.mp3": "Audio only; exports the mixed soundtrack as MP3.",
  "editor.recording.formatHint.flac": "Audio only; lossless FLAC soundtrack.",
  "editor.recording.formatHint.wav": "Audio only; uncompressed 16-bit WAV soundtrack.",
  "editor.recording.formatHint.ogg": "Audio only; Vorbis soundtrack in an Ogg container.",
  "editor.recording.aspectRatio": "Aspect ratio",
  "editor.recording.resolution": "Resolution",
  "editor.recording.custom": "Custom",
  "editor.recording.width": "Width (pixels)",
  "editor.recording.height": "Height (pixels)",
  "editor.recording.bitrate": "Video bitrate (Mbps)",
  "editor.recording.rateControl": "Rate control",
  "editor.recording.rateControl.standard": "Standard",
  "editor.recording.rateControl.vbr2": "VBR 2× peak",
  "editor.recording.autoBitrateLabel": "Auto-adjust bitrate",
  "editor.recording.estimatedSize": "Estimated file size",
  "editor.recording.musicVolume": "Music volume",
  "editor.recording.effectsVolume": "Hit sound volume",
  "editor.recording.fps": "Frames per second",
  "editor.recording.speed": "Output speed",
  "editor.recording.outputDuration": "Output duration {seconds} s",
  "editor.recording.rangeInput": "Input mode",
  "editor.recording.mode.beats": "Beats",
  "editor.recording.mode.time": "Time",
  "editor.recording.startBeat": "Start beat",
  "editor.recording.endBeat": "End beat",
  "editor.recording.startTime": "Start time",
  "editor.recording.endTime": "End time",
  "editor.recording.invalidTime": "Use 1:23.456 or 83.456",
  "editor.recording.export": "Export",
  "editor.recording.cancel": "Cancel export",
  "editor.recording.partialPath": "Partial output (updates during export): {path}",
  "editor.recording.preparing": "Preparing images and effects…",
  "editor.recording.audio": "Preparing audio…",
  "editor.recording.frames": "Rendering frames…",
  "editor.recording.encoding": "Finishing the export…",
  "editor.recording.error": "Export failed: {detail}",
  "editor.recording.invalid": "Check the dimensions, bitrate, volume and time interval.",
  "editor.recording.noMusic": "Load a decodable song before exporting.",
  "editor.recording.changed": "The output file changed during export. Choose it again and retry.",
  "editor.recording.noEncoder":
    "The bundled encoder could not be started. Repair or reinstall the application.",
  "editor.recording.encoderFailed":
    "The encoder could not write this format. Try another format or a shorter range.",
  "editor.recording.animated": "The image format cannot be decoded for video export.",
  "editor.recording.imageError": "A chart image could not be prepared for export.",
  "editor.recording.effectError": "A chart effect could not be prepared or rendered.",
  "editor.recording.resourcesChanged":
    "The chart resources changed during export. Please try again.",
  "editor.display.editorDisplay.trackScaleX": "Scale X",
  "editor.display.editorDisplay.trackScaleY": "Scale Y",
  "editor.display.editorDisplay.trackSizeX": "Size X",
  "editor.display.editorDisplay.trackSizeY": "Size Y",
  "editor.display.editorDisplay.trackColor": "Colour",
  "editor.display.editorDisplay.trackShader": "Shader",
  "editor.display.editorDisplay.trackText": "Text",
  "editor.display.gameUi.bindingPause": "Pause",
  "editor.display.gameUi.bindingComboNumber": "Combo count",
  "editor.display.gameUi.bindingCombo": "Combo label",
  "editor.display.gameUi.bindingScore": "Score",
  "editor.display.gameUi.bindingBar": "Progress bar",
  "editor.display.gameUi.bindingName": "Song title",
  "editor.display.gameUi.bindingLevel": "Difficulty",
  "editor.dialogs.dialog.incomplete": "The action did not finish",
  "editor.dialogs.dialog.unsavedChanges":
    "This chart has unsaved changes. Continue to discard them, or cancel to save or export first.",
  "editor.dialogs.lineDialog.needLine": "Add a judge line first.",
  "editor.overlap.title": "Choose overlapping object",
  "editor.dialogs.exportDialog.title": "Export chart",
  "editor.dialogs.exportDialog.format": "Format",
  "editor.dialogs.exportDialog.formatPez": "RPE Format (PEZ)",
  "editor.dialogs.exportDialog.formatOfficial": "Phigros Official Format (JSON)",
  "editor.dialogs.exportDialog.formatPec": "PhiEdit Format (PEC)",
  "editor.dialogs.exportDialog.warnings":
    "Exported with {count} loss warning(s). Some RPE features were omitted.",
  "editor.dialogs.exportDialog.export": "Export",

  "editor.app.commit.changeLineTexture": "Change judge line texture",

  "editor.app.commit.renameLineTexture": "Rename judge line texture everywhere",
  "editor.app.commit.selectCover": "Select cover",
  "editor.app.commit.selectMusic": "Select music",

  "editor.app.curve.commitGenerate": "Generate curve notes",
  "editor.app.curve.density": "Density",
  "editor.app.curve.easing": "Easing",
  "editor.app.curve.endBeat": "End beat",
  "editor.app.curve.endX": "End X",
  "editor.app.curve.generated": "Generated {count} curve notes",
  "editor.app.curve.needEnd": "Pick the curve end first",
  "editor.app.curve.needStart": "Pick the curve start first",
  "editor.app.curve.nothingToGenerate": "These parameters produce no intermediate notes",
  "editor.app.curve.startBeat": "Start beat",
  "editor.app.curve.startX": "Start X",
  "editor.app.curve.type": "Type",
  "editor.app.dialog.chooseChart": "Choose a chart",
  "editor.app.dialog.closeChart": "Return to chart library",
  "editor.app.dialog.discardAndReturn": "Discard and return",
  "editor.app.dialog.openWithoutSaving": "Don't save, open",
  "editor.app.notice.droppedManyImported":
    "Imported {count} charts. A multi-chart drop is not opened automatically; choose one in the library.",
  "editor.app.dialog.exitDiscard": "Discard and quit",
  "editor.app.dialog.exitKeep": "Keep editing",
  "editor.app.dialog.exitConfirm": "Quit",
  "editor.app.dialog.exitSave": "Save and quit",
  "editor.app.dialog.exitTitle": "Quit RPE Redux?",
  "editor.app.dialog.exitBody": "The editor will close.",
  "editor.app.dialog.exitDirtyBody": "This chart has unsaved changes.",
  "editor.app.dialog.exitHostBody": "You are hosting a room. Quitting closes it for everyone.",
  "editor.app.dialog.exitGuestBody": "You are in a room. Quitting leaves it.",
  "editor.app.dialog.exitPendingBody": "A room connection is in progress. Quitting cancels it.",
  "editor.app.dialog.multipleCharts":
    "The archive holds several RPE charts; the other files are kept when exporting a PEZ.",

  "editor.app.dialog.saveAndReturn": "Save and return",
  "editor.app.dialog.switchChart": "Switch chart",
  "editor.app.dialog.unsavedChangesBody": "Save to keep your changes, or discard to leave.",
  "editor.app.dialog.unsavedChangesTitle": "Unsaved changes",
  "editor.app.dialog.returnHomeTitle": "Return to the chart library?",
  "editor.app.dialog.returnHomeBody":
    "There are no unsaved changes. Return to the library to open another chart.",
  "editor.app.dialog.returnHome": "Return",
  "editor.app.dialog.returnStay": "Stay in editor",
  "editor.app.dialog.returnLeaveRoomTitle": "Return to the library and leave the room?",
  "editor.app.dialog.returnLeaveRoomBody":
    "Returning disconnects you from the room. The temporary room chart and its unsaved changes will be deleted from this device. Export it first if you need a copy.",
  "editor.app.dialog.returnLeaveRoom": "Leave room and return",
  "editor.app.dialog.returnLeaveRoomDirtyTitle": "Save before leaving the room?",
  "editor.app.dialog.returnLeaveRoomDirtyBody":
    "This chart has unsaved changes, and returning to the library leaves the room. Save the chart, discard the changes, or stay in the editor.",
  "editor.app.dialog.saveLeaveRoomAndReturn": "Save and leave room",
  "editor.app.dialog.discardLeaveRoomAndReturn": "Discard and leave room",
  "editor.app.dialog.returnCloseRoomTitle": "Return to the library and close the room?",
  "editor.app.dialog.returnCloseRoomBody":
    "You are hosting the room. Returning closes it for everyone and deletes the temporary room charts on their devices.",
  "editor.app.dialog.returnCloseRoom": "Close room and return",
  "editor.app.dialog.returnCloseRoomDirtyTitle": "Save before closing the room?",
  "editor.app.dialog.returnCloseRoomDirtyBody":
    "This chart has unsaved changes, and returning to the library closes the room for everyone. Save and close the room, discard the changes, or stay in the editor.",
  "editor.app.dialog.saveCloseRoomAndReturn": "Save and close room",
  "editor.app.dialog.discardCloseRoomAndReturn": "Discard and close room",
  "editor.app.dialog.returnCancelConnectTitle":
    "Return to the library and cancel the room connection?",
  "editor.app.dialog.returnCancelConnectBody":
    "The room connection has not finished. Returning to the library cancels it.",
  "editor.app.dialog.returnCancelConnect": "Cancel connection and return",
  "editor.app.dialog.returnCancelConnectDirtyTitle": "Save before cancelling the room connection?",
  "editor.app.dialog.returnCancelConnectDirtyBody":
    "This chart has unsaved changes, and returning to the library cancels the room connection. Save the chart, discard the changes, or stay in the editor.",
  "editor.app.dialog.returnRoomDocumentTitle": "Leave the room and return to the library?",
  "editor.app.dialog.returnRoomDocumentBody":
    "The temporary room chart and its unsaved changes will be deleted from this device. Export the chart first if you need a copy.",
  "editor.app.dialog.returnRoomDocumentConfirm": "Leave room and return",

  "editor.app.error.libraryServiceDown":
    "The local service is not running, so the chart library project cannot be opened",

  "editor.app.error.missingShellNode": "The editor shell is missing a DOM node: {selector}",
  "editor.app.error.projectMissing": "That project does not exist",
  "editor.app.error.stillUnsaved":
    "There are still unsaved changes; wait for the save to finish and retry",

  "editor.app.layer.extended": "Extended layer",
  "editor.app.notice.assetLibraryDirty":
    "The asset library changed; save the chart to keep the resources",
  "editor.app.notice.backupFailed":
    "Automatic backup failed: {message}. Save by hand or export a PEZ.",
  "editor.app.notice.backupSaving": "Saving automatic backup…",
  "editor.app.notice.backupSaved": "Automatic backup saved",
  "editor.app.notice.clipboardHistoryLoadFailed": "Could not read the clipboard history: {message}",
  "editor.app.notice.clipboardHistorySaveFailed": "Could not save the clipboard history: {message}",
  "editor.app.notice.desktopEnvironment":
    "Some native features need the desktop application; the chart library and editor stay available in the browser.",
  "editor.app.notice.desktopOnlyBackup": "Automatic backup needs the desktop app",

  "editor.app.notice.desktopOnlyOpenFile": "Opening local files needs the desktop app",
  "editor.app.notice.desktopOnlySaveFile": "Saving to a file needs the desktop app",

  "editor.app.notice.noteSource": "From judge line {line}, click to switch",
  "editor.app.notice.lineJumpMissing":
    "Judge line {line} does not exist. Available lines are 0–{max}.",
  "editor.app.notice.lineJumpInvalid": "That judge line number is too long.",
  "editor.app.notice.nothingToRedo": "Nothing to redo",
  "editor.app.notice.nothingToUndo": "Nothing to undo",

  "editor.app.notice.travel": "{action}: {label}",
  "editor.app.status.copiedObjects": "Copied {count} objects",

  "editor.app.status.exported": "Exported: {name}",
  "editor.app.status.eventPlaced": "Event placed",
  "editor.app.status.eventPlacementPending":
    "Move to the event end, press R or click to finish; Esc cancels",

  "editor.app.status.musicMissing":
    "Chart opened, but {name} was not found; choose the music by hand. Files outside the chart folder are not loaded by default.",
  "editor.app.status.savedTo": "Saved to {path}",
  "editor.app.status.savedToLibrary": "Saved to the chart library: {name}",
  "editor.app.status.savedWithPendingChanges": "Saved; later edits are not saved yet",
  "editor.app.transport.pause": "Pause",
  "editor.app.transport.play": "Play",

  "editor.home.action.archive": "Archive",

  "editor.home.action.rename": "Name / group",

  "editor.home.duplicateNameSuffix": "{name} copy",
  "editor.home.editBody":
    "This only changes what the local chart library records; the files on disk stay as they are.",
  "editor.home.editTitle": "Chart information",
  "editor.home.error.libraryServiceDown":
    "The local service is not running, so the chart library cannot be changed",

  "editor.home.error.nameRequired": "Enter a project name",
  "editor.home.field.groupLabel": "Group",
  "editor.home.field.nameLabel": "Name",
  "editor.home.removeBody":
    "Delete this chart? This removes the chart and its autosave snapshots from the chart library, and it cannot be undone.",
  "editor.home.removeTitle": "Delete chart",
  "editor.home.ungrouped": "Ungrouped",
  "editor.skin.loadFailed": "Note skin failed to load: {message}. The last working skin is kept.",
  "editor.skin.missingFile": "Missing {file}",
  "editor.skin.missingTexture": "Missing texture {name}",
  "editor.skin.invalidHoldAtlas": "Invalid Phira Hold atlas dimensions",
  "editor.skin.invalidHitFx": "Invalid Phira hit-effect atlas dimensions",
  "editor.commands.batchEdit.nudgeLabel": "Move selection with the arrow keys",
  "editor.commands.batchEdit.scaleLabel": "Scale selection horizontally",
  "editor.commands.batchEdit.lineLabel": "Move selection to another judgement line",
  "editor.commands.batchEdit.eventStartLabel": "Adjust event starts",
  "editor.commands.batchEdit.eventEndLabel": "Adjust event ends",
  "editor.commands.clipboard.cutLabel": "Cut selection",
  "editor.commands.clipboard.deleteLabel": "Delete selection",
  "editor.commands.clipboard.pasteLabel": "Paste selection",
  "editor.commands.clipboard.pasteMirrorLabel": "Paste mirrored",
  "editor.commands.clipboardHistory.untitledChart": "Untitled chart",
  "editor.commands.eventCommands.error.needLine": "Add a judge line first.",
  "editor.commands.eventCommands.error.endBeforeStart":
    "The event's end beat cannot be earlier than its start beat.",
  "editor.commands.eventCommands.error.overlap":
    "This time range overlaps an event or a whole trajectory on the same track. Adjust the end point, or press Esc to cancel.",
  "editor.commands.eventCommands.error.invalidTarget": "The event target is invalid",
  "editor.commands.eventCommands.commitAddEvent": "Add event",
  "editor.commands.eventCommands.commitDeleteEvents": "Delete events",
  "editor.commands.eventTools.error.densityZero":
    "Cut density and line division must be greater than zero.",
  "editor.commands.eventTools.error.tooManyParts":
    "Too many cut pieces; lower the density or cut in batches.",
  "editor.commands.eventTools.commitCut": "Cut selected events",
  "editor.commands.eventTools.commitStick": "Stick selected events",
  "editor.commands.lineCommands.error.invalidIndex": "Invalid judge line index.",
  "editor.commands.lineCommands.error.groupNotEmpty":
    "Delete or move this group's judgement lines first.",
  "editor.commands.lineCommands.error.parentCycle": "The parent relationship would form a cycle.",
  "editor.commands.lineCommands.defaultName": "Judge line",
  "editor.commands.lineCommands.duplicateNameSuffix": "{name} copy",
  "editor.commands.multiEdit.channel.x": "X, horizontal position",
  "editor.commands.multiEdit.channel.speed": "Speed, speed",
  "editor.commands.multiEdit.channel.size": "Size, size",
  "editor.commands.multiEdit.channel.yOffset": "YOffset, vertical offset",
  "editor.commands.multiEdit.channel.visibleTime": "VisibleTime, visible seconds",
  "editor.commands.multiEdit.channel.alpha": "Alpha, opacity",
  "editor.commands.multiEdit.channel.t1": "Time1, start beat",
  "editor.commands.multiEdit.channel.t2": "Time2, end beat",
  "editor.commands.multiEdit.channel.line": "Line, move to line",
  "editor.commands.multiEdit.channel.hitSound": "HitSound, hit sound",
  "editor.commands.multiEdit.channel.judgeArea": "judgeArea, judge width",
  "editor.commands.multiEdit.eventField.both": "Both, start and end value",
  "editor.commands.multiEdit.eventField.end": "End, end value",
  "editor.commands.multiEdit.eventField.start": "Start, start value",
  "editor.commands.multiEdit.eventField.easing": "Easing, easing",
  "editor.commands.multiEdit.eventField.t1": "StartTime, start beat",
  "editor.commands.multiEdit.eventField.t2": "EndTime, end beat",
  "editor.commands.multiEdit.eventField.line": "Line, copy to line",
  "editor.commands.multiEdit.eventField.linkgroup": "LinkGroup, link group",
  "editor.commands.multiEdit.eventField.duration": "Duration, duration, joined end to start",
  "editor.commands.multiEdit.eventField.order": "Order, reorder content (keeps time slots)",
  "editor.commands.multiEdit.operation.by": "By, add or subtract",
  "editor.commands.multiEdit.operation.to": "To, set to",
  "editor.commands.multiEdit.operation.times": "Times, multiply",
  "editor.commands.multiEdit.operation.max": "Max, lower bound",
  "editor.commands.multiEdit.operation.min": "Min, upper bound",
  "editor.commands.multiEdit.operation.flip": "Flip, mirror around the value",
  "editor.commands.multiEdit.error.unknownOperation": "Unknown edit operation",
  "editor.commands.multiEdit.error.easingRange": "The easing index must be 1–29.",
  "editor.commands.multiEdit.error.targetLineMissing": "Target line {index} does not exist.",
  "editor.commands.multiEdit.error.noteType":
    "The note type must be 1 Tap / 2 Hold / 3 Flick / 4 Drag.",
  "editor.commands.multiEdit.error.aboveIsFake": "above must be 0/1/2 and isFake must be 0/1.",
  "editor.commands.multiEdit.error.endBeforeStart":
    "The end beat cannot be earlier than the start beat.",
  "editor.commands.multiEdit.error.inst": "inst must be 0/1.",
  "editor.commands.multiEdit.error.notFinite": "{key} is not a finite number.",
  "editor.commands.multiEdit.error.easingResult":
    "The resulting easing index must be an integer from 1 to 29.",
  "editor.commands.multiEdit.error.hitSoundOperation": "HitSound only supports To.",
  "editor.commands.multiEdit.error.valueOnly":
    "Start and end value editing applies to numeric events; colour, text and shader events can edit time or be cloned.",
  "editor.commands.multiEdit.error.unsupportedField":
    "The current object does not support this numeric field.",
  "editor.commands.multiEdit.error.noMatch": "No selected object matches.",
  "editor.commands.multiEditParameters.error.storage":
    "Batch parameters could not be written to local storage; check the free space. They stay in this session.",
  "editor.commands.multiLineEdit.error.invalidRange": "Invalid line range: {range}",
  "editor.commands.multiLineEdit.error.unparsableLine": "Cannot parse line number: {token}",
  "editor.commands.trajectoryCommands.error.trajectoryRange":
    "The trajectory end beat must be greater than the start beat, and the start beat cannot be negative.",
  "editor.commands.trajectoryCommands.error.segments": "The segment count must be 4–8192.",
  "editor.commands.trajectoryCommands.error.targetLine":
    "The target judge line or base layer is invalid.",
  "editor.commands.trajectoryCommands.error.occupiedRange":
    "The target range already has move or rotate events; choose an empty range, or tick replace events in the range.",
  "editor.commands.trajectoryCommands.error.existingTrajectory":
    "The range already contains a whole trajectory; delete or split it first.",
  "editor.commands.trajectoryCommands.error.bezierCrossing":
    "The replaced range crosses a Bezier event; cut that event first.",
  "editor.commands.trajectoryCommands.error.selectTrajectory":
    "Select a whole-trajectory curve event.",
  "editor.session.addNotes": "Add notes",
  "editor.session.deleteNotes": "Delete notes",
  "editor.session.updateNotes": "Update notes",
  "editor.session.addLine": "Add judge line",
  "editor.session.selectionChanged": "Change selection",
  "editor.session.transaction": "Edit chart",
  "editor.session.sampleEvent": "Sample event value",
} as const;
