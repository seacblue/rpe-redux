/**
 * The workspace surface: the timeline header, the canvas stage, the welcome
 * page and the dialogs the shell renders around them.
 *
 * `src/frontend/screens/editor/workspace/runtime/` is the imperative editor and keeps its own
 * namespace; everything here is rendered by the React shell, so a reviewer
 * looking at `src/frontend/screens/editor/workspace/stage/` finds its text in `workspace.stage.*`.
 *
 * Generic words are not repeated here: the modal's delete and apply buttons and
 * its close tooltip are the same words everywhere and come from `common.*`.
 */
export default {
  "workspace.loading.title": "Loading chart…",
  "workspace.loading.failed": "Unable to open chart",
  "workspace.loading.progress": "Chart loading progress",
  "workspace.loading.solution": "Solution",
  "workspace.loading.errorCode": "Error code",
  "workspace.loading.read": "Reading file",
  "workspace.loading.unpack": "Reading package",
  "workspace.loading.notes": "Parsing notes",
  "workspace.loading.events": "Parsing events",
  "workspace.loading.render": "Rendering first frame",
  "workspace.loading.parse": "Validating chart",
  "workspace.loading.textures": "Loading textures",
  "workspace.loading.audio": "Loading audio",
  "workspace.loading.ready": "Ready",
  "workspace.document.compatibility.title": "Chart conversion",
  "workspace.document.compatibility.description":
    "RPE {version} must be converted to the current format. Exports may no longer open in the original editor.",
  "workspace.document.compatibility.descriptionUnknown":
    "This file has no usable RPE version. Conversion is required; exports may no longer open in the original editor.",
  "workspace.document.compatibility.detail":
    "Converts the chart to RPE {version} and fills {count} missing line field(s).",
  "workspace.document.compatibility.convert": "Convert and open",
  "workspace.document.compatibility.cancel": "Cancel",
  "workspace.document.compatibility.newerTitle": "Newer chart version",
  "workspace.document.compatibility.newerDescription":
    "Made with Redux {version}; this app is {current}. Some fields may be ignored.",
  "workspace.document.compatibility.openAnyway": "Open anyway",
  "workspace.document.occupancy.title": "Chart in use",
  "workspace.document.occupancy.description":
    '"{name}" is already open in another editor window. If that window crashed, its lock may be stale.',
  "workspace.document.occupancy.detail":
    "Other window: frontend port {frontend}, backend port {backend}",
  "workspace.document.occupancy.unknownPort": "unknown",
  "workspace.document.occupancy.frontend": "Release other window",
  "workspace.document.occupancy.backend": "Clear backend record",
  "workspace.document.occupancy.reconcile": "Repair and retry",
  "workspace.document.occupancy.clearFailed":
    "The backend did not release the lock. Try clearing this chart's backend record, or cancel opening.",
  "workspace.document.error.createCancelled": "Document creation was cancelled by an extension.",
  "workspace.document.error.openCancelled": "Document opening was cancelled by an extension.",
  "workspace.document.error.closeCancelled": "Document closing was cancelled by an extension.",
  "workspace.document.error.pathUnavailable":
    "Path documents are only available in the desktop runtime.",
  "workspace.document.error.bytesMissing": "No document bytes were provided.",
  "workspace.document.error.noDocument": "No document is open.",
  "workspace.document.error.readOnly": "This chart is read-only.",
  "workspace.document.error.saveFailed": "The document was not saved.",
  "workspace.document.error.libraryRevisionConflict":
    "The library project changed in another edit, so this save was not applied.",
  "workspace.document.saving": "Saving chart…",
  "workspace.document.error.saveBaselineUnavailable":
    "The document's disk baseline could not be read, so the save was not applied.",
  "workspace.document.error.saveSessionMissing": "The save session expired before it completed.",
  "workspace.document.error.saveAssetsBinaryRequired":
    "Document resources must be sent as binary data.",
  "workspace.document.error.invalidSaveAssetData": "The document resource data is invalid.",
  "workspace.document.error.saveExportDirectoryRequired":
    "Choose an export directory before extracting document resources.",
  "workspace.document.error.saveAssetMissing": "A document resource is missing.",
  "workspace.document.error.duplicateSaveAsset": "A document resource was uploaded twice.",
  "workspace.document.error.saveDestinationExists":
    "A document resource already exists at the export destination.",
  "workspace.document.error.saveAssetFilenameMissing": "A document resource path has no file name.",
  "workspace.document.error.unsafeSaveAssetPath":
    "This chart references a file outside its folder, so it cannot be packaged. Copy external resources into the chart folder, then save again.",
  "workspace.document.error.saveConflict":
    "The file changed on disk, so the save was not applied. Your current edits are still open.",
  "workspace.document.notice.externalResources":
    "This chart may reference files outside its folder. External files are not loaded by default; copy them into the chart folder before opening or saving as PEZ.",
  "workspace.document.externalResources.title": "External files are not loaded",
  "workspace.document.externalResources.description":
    "This chart references {count} file(s) outside its document folder. They stay unloaded unless you allow them for this document.",
  "workspace.document.externalResources.more": "{count} more",
  "workspace.document.externalResources.allow": "Allow and reopen",
  "workspace.document.externalResources.keep": "Keep unloaded",
  "workspace.document.externalResources.unavailableTitle": "Some files cannot be allowed",
  "workspace.document.externalResources.unavailableDescription":
    "{count} reference(s) cannot be authorized because their paths leave the document folder. They stay unloaded.",
  "workspace.document.diskChange.title": "Document changed on disk",
  "workspace.document.diskChange.cleanBody":
    "Another program modified this file. Reload the disk copy or keep your local version?",
  "workspace.document.diskChange.dirtyBody":
    "Another program changed this document or one of its resources while you have local edits. Choose carefully.",
  "workspace.document.diskChange.limitation":
    "Automatic three-way merge and full resource-aware undo are not available yet.",
  "workspace.document.diskChange.reload": "Reload from disk",
  "workspace.document.diskChange.keepLocal": "Keep local version",
  "workspace.document.diskChange.saveAs": "Save local version as…",
  "workspace.document.diskChange.stale":
    "The document changed again before that choice could be applied. Nothing was discarded.",
  "workspace.document.diskChange.retained":
    "The local version was kept. Save it explicitly or use Save As when ready.",
  "workspace.dialogs.timelineMenu": "Timeline menu",
  "workspace.dialogs.addMarker": "Add a time marker",
  "workspace.dialogs.splitTrajectory": "Split the curve trajectory",
  "workspace.dialogs.deleteMarker": "Delete this marker",
  "workspace.dialogs.editMarker": "Edit a time marker",
  /** The dialog's "neither apply nor delete, just get me out" button. */
  "workspace.dialogs.dismiss": "Cancel",
  "workspace.timeline.historyTooltip": "{label}, {count} affected objects",

  "workspace.scripts.source": "Provided by {source}",
  "workspace.scripts.run": "Run",
  "workspace.scripts.parameters.title": "Run {script} with parameters",
  "workspace.scripts.parameters.description": "Enter valid values before running this script.",
  "workspace.scripts.parameters.fields": "Fields: {value}",
  "workspace.scripts.parameters.functions": "Functions: {value}",
  "workspace.scripts.parameters.judgeLine.option": "Line {index}, {name}",
  "workspace.scripts.parameters.judgeLine.allocate": "Assign free judge line",
  "workspace.scripts.parameters.judgeLine.allocateHint":
    "Choose a free judge line for this parameter. Reuse an empty line and add one only when none is free.",
  "workspace.scripts.parameters.judgeLine.createdName": "Script line",
  "workspace.scripts.parameters.judgeLine.remove": "Remove unused script line",
  "workspace.scripts.parameters.judgeLine.modeLabel": "Judge-line input mode",
  "workspace.scripts.parameters.judgeLine.mode.exact": "Exact",
  "workspace.scripts.parameters.judgeLine.mode.range": "Range",
  "workspace.scripts.parameters.judgeLine.mode.global": "Global",
  "workspace.scripts.parameters.judgeLine.mode.exactHint":
    "Use exactly the lines written here, in this order.",
  "workspace.scripts.parameters.judgeLine.mode.rangeHint":
    "Write candidate lines; the host randomly picks the required amount.",
  "workspace.scripts.parameters.judgeLine.mode.globalHint":
    "Ignore written lines; the host randomly picks from every line in the chart.",
  "workspace.scripts.parameters.judgeLine.placeholder": "Line list, e.g. 1,3:5",
  "workspace.scripts.parameters.judgeLine.globalHint":
    "Randomly pick {count} line(s) from every judge line in the chart when the script runs.",
  "workspace.scripts.recipe.distributeNotes": "Distribute notes",
  "workspace.scripts.recipe.distributeNotesDescription":
    "Place selected notes between two X positions.",
  "workspace.scripts.recipe.staggerEvents": "Stagger events",
  "workspace.scripts.recipe.staggerEventsDescription": "Offset the selected event values.",
  "workspace.scripts.recipe.fadeNotes": "Fade notes",
  "workspace.scripts.recipe.fadeNotesDescription": "Scale the alpha of selected notes.",

  "workspace.history.title": "Edit history",
  "workspace.history.emptyTitle": "No edit history yet",
  "workspace.history.empty": "Undo history appears after your first edit.",
  "workspace.history.undo": "Undo history",
  "workspace.history.redo": "Redo branch",
  "workspace.history.affected": "{count} affected objects",
  "workspace.history.revert": "Revert to this step",
  "workspace.history.collaborativeUndo": "Collaborative undo",
  "workspace.history.undoUnavailable": "There is no edit of yours to undo in this room.",
  "workspace.history.undoConflict": "Cannot undo because these paths changed: {paths}",
  "workspace.history.undoRejected": "The undo could not be applied.",
  "workspace.history.redoUnavailable": "Redo is unavailable while editing a room.",
  "workspace.history.codeCell": "Code cell",
  "workspace.history.discarded": "Snapshot discarded",

  /** Not shown: the library menu carries the reachable copy of these actions. */

  "workspace.welcome.settings": "Settings",
  "workspace.welcome.more": "More",
  "workspace.welcome.moreMenu": "More actions",
  "workspace.welcome.importRpe": "Import from RPE…",
  "workspace.welcome.importDialog.title": "Import charts",
  "workspace.welcome.importDialog.dropTitle": "Drop a folder or file",
  "workspace.welcome.importDialog.dropFormats":
    "Supports RPE JSON / PEZ, PhiEdit PEC, and Phigros official JSON",
  "workspace.welcome.importDialog.dropActive": "Release to import",
  "workspace.welcome.importDialog.rpe": "Choose RPE folder",
  "workspace.welcome.importDialog.external": "Choose another chart",
  "workspace.welcome.drop.title": "Drop to import",
  "workspace.welcome.drop.imported": "Imported {name}",
  "workspace.welcome.drop.extensionDetected": "Detected Extension: {name}",
  "workspace.welcome.drop.skinDetected": "Detected note skin: {name}",
  "workspace.welcome.drop.openSettings": "Open settings",
  "workspace.welcome.drop.invalidPackage": "The package {name} could not be validated.",
  "workspace.welcome.drop.unsupported": "This drop is not a chart, Extension, or note skin: {name}",
  "workspace.welcome.rpe.title": "Migrate from RPE",
  "workspace.welcome.rpe.viewHotkeys": "View key mapping",
  "workspace.welcome.rpe.pickFolder": "Choose an RPE installation folder",
  "workspace.welcome.rpe.chartCount": "{count} chart(s)",
  "workspace.welcome.rpe.settingsFound": "Settings.json",
  "workspace.welcome.rpe.hotkeysFound": "Hotkey.txt",
  "workspace.welcome.rpe.confirmTitle": "Import from RPE?",
  "workspace.welcome.rpe.confirmDescription":
    "This will import {summary} and merge recognized settings and hotkeys into the current configuration.",
  "workspace.welcome.rpe.confirm": "Start import",
  "workspace.welcome.rpe.importing": "Importing {count} chart(s)…",
  "workspace.welcome.rpe.importingChart": "Importing {name}…",
  "workspace.welcome.rpe.done":
    "Imported {charts} chart(s), migrated {settings} setting(s) and {shortcuts} shortcut(s) with {warnings} warning(s).",
  "workspace.welcome.rpe.desktopOnly": "RPE import is available in the desktop application.",
  "workspace.welcome.rpe.notFound":
    "No RPE Settings.json, Hotkey.txt, or Resources chart folders were found.",
  "workspace.welcome.external.title": "Import official or PhiEdit chart",
  "workspace.welcome.external.importing": "Importing {name}…",
  "workspace.welcome.external.done": "Imported {name} with {warnings} warning(s).",
  "workspace.welcome.external.desktopOnly":
    "Official and PhiEdit imports are available in the desktop application.",
  "workspace.welcome.external.notFound":
    "No Phigros official JSON or PhiEdit PEC chart was found in that file or folder.",
  "workspace.welcome.external.missingChart": "No chart file was found in the package.",
  "workspace.welcome.external.multipleCharts":
    "The package contains several chart files: {names}. Import them one at a time.",
  "workspace.welcome.external.mediaLimit":
    "The chart media exceeds 512 MB; later files were ignored.",
  "workspace.welcome.external.mediaUnreadable": "Could not read media: {name}",
  "workspace.welcome.importReport.title": "Import compatibility report",
  "workspace.welcome.importReport.description":
    "{source}: {count} details differ from the source chart.",
  "workspace.welcome.importReport.action": "View compatibility report",
  "workspace.welcome.importReport.badge": "Compatibility: {count}",
  "workspace.welcome.importReport.badgeHint": "See what this import carried differently",
  "workspace.welcome.importReport.more": "{count} more differences are not shown.",
  "workspace.welcome.importReport.moreGroups": "{count} more chart reports are not shown.",

  "workspace.welcome.library.empty": "No charts here yet",
  "workspace.welcome.library.emptyDescription": "Create or open a chart to find it here.",
  "workspace.welcome.library.unavailable": "The chart library is unavailable",
  "workspace.welcome.library.retry": "Try again",
  "workspace.welcome.library.stale":
    "Showing the last loaded charts. The refresh failed: {message}",
  "workspace.welcome.library.field.charter": "Charter",
  "workspace.welcome.library.field.level": "Difficulty",
  "workspace.welcome.library.detail.select": "Select a chart to view details",
  "workspace.welcome.library.open": "Open",
  "workspace.welcome.library.export": "Export",
  "workspace.welcome.library.delete": "Delete",
  "workspace.welcome.library.action.new": "New chart",
  "workspace.welcome.library.action.import": "Import a chart",
  "workspace.welcome.library.sort.label": "Sort charts",
  "workspace.welcome.library.sort.updated": "Last modified",
  "workspace.welcome.library.sort.created": "Date created",
  "workspace.welcome.library.sort.name": "Name",
  "workspace.welcome.library.sort.composer": "Composer",
  "workspace.welcome.library.sort.charter": "Charter",
  "workspace.welcome.library.sort.newest": "Newest first",
  "workspace.welcome.library.sort.oldest": "Oldest first",
  "workspace.welcome.library.sort.az": "A > Z",
  "workspace.welcome.library.sort.za": "Z > A",
  "workspace.welcome.library.view.label": "Chart view",
  "workspace.welcome.library.view.list": "List",
  "workspace.welcome.library.view.grid": "Grid",
  "workspace.welcome.search.placeholder": "Search charts",
  "workspace.welcome.search.empty": "No charts found. Try a different search.",

  "workspace.welcome.menu.label": "Chart menu",

  "workspace.collaboration.title": "Collaboration",
  "workspace.collaboration.defaultName": "Member",
  "workspace.collaboration.createTab": "Create room",
  "workspace.collaboration.joinTab": "Join room",
  "workspace.collaboration.create": "Create room",
  "workspace.collaboration.join": "Request to join",
  "workspace.collaboration.leave": "Leave room",
  "workspace.collaboration.leaveTitle": "Leave this room?",
  "workspace.collaboration.leaveBody":
    "The temporary room chart and its unsaved changes will be deleted from this device. Export the chart first if you need to keep a copy.",
  "workspace.collaboration.leaveConfirm": "Leave room",
  "workspace.collaboration.closeRoom": "Close room",
  "workspace.collaboration.closeRoomTitle": "Close this room?",
  "workspace.collaboration.closeRoomBody":
    "Everyone will be disconnected. The room and every temporary room chart will be deleted from their devices.",
  "workspace.collaboration.closeRoomConfirm": "Close room",
  "workspace.collaboration.roomClosed": "The host closed the room.",
  "workspace.collaboration.displayName": "Display name",
  "workspace.collaboration.color": "Pointer colour",
  "workspace.collaboration.hostMode": "Hosting",
  "workspace.collaboration.hostMode.tunnel": "Cloudflare Tunnel",
  "workspace.collaboration.hostMode.lan": "LAN",
  "workspace.collaboration.lanPort": "LAN port",
  "workspace.collaboration.joinMethod": "Join with",
  "workspace.collaboration.joinMethod.link": "Invitation link",
  "workspace.collaboration.joinMethod.custom": "Custom address",
  "workspace.collaboration.serverUrl": "Server address",
  "workspace.collaboration.serverUrlPlaceholder": "ws://192.168.1.10:51234",
  "workspace.collaboration.serverUrlWebPlaceholder": "wss://room.example.com",
  "workspace.collaboration.serverUrlWebHint":
    "GitHub Pages only serves static files. Use a room server reachable over wss://; this HTTPS page cannot connect to a local or LAN ws:// address.",
  "workspace.collaboration.changePassword": "Change room password",
  "workspace.collaboration.changePasswordHint":
    "Set a new room password. Members already in the room stay connected, but the old invitation link stops working.",
  "workspace.collaboration.changePasswordPlaceholder": "New password",
  "workspace.collaboration.newPassword": "New password",
  "workspace.collaboration.updatePassword": "Update password",
  "workspace.collaboration.showSecret": "Show",
  "workspace.collaboration.hideSecret": "Hide",
  "workspace.collaboration.password": "Room password",
  "workspace.collaboration.invalidServerUrl": "Enter a ws:// or wss:// server address.",
  "workspace.collaboration.hostFailed": "Could not create the room: {detail}",
  "workspace.collaboration.assetsRequiredTitle": "Chart assets are incomplete",
  "workspace.collaboration.assetsRequiredBody":
    "Add the chart's audio and images before creating a room: {names}",
  "workspace.collaboration.sessionBusyTitle": "This device is already in a room",
  "workspace.collaboration.sessionBusyBody":
    "One backend can host or join only one room at a time. Leave the room in the other window, or close it, then try again.",
  "workspace.collaboration.sessionClaimFailed":
    "Could not verify the room session. Close other Redux windows and try again.",
  "workspace.collaboration.startingRoom": "Starting room…",
  "workspace.collaboration.joinInviteTitle": "Join this room?",
  "workspace.collaboration.joinInviteMembers": "People in this room",
  "workspace.collaboration.joinInviteCapacity": "{count} of {max} members",
  "workspace.collaboration.joinInviteOnline": "Online",
  "workspace.collaboration.joinInviteOffline": "Offline",
  "workspace.collaboration.joinInviteNoMembers": "No members are currently visible.",
  "workspace.collaboration.joinInviteMembersUnavailable":
    "The room could not be previewed. You can still try joining with this invitation.",
  "workspace.collaboration.joinInviteConfirm": "Join room",
  "workspace.collaboration.joinInviteCancel": "Not now",
  "workspace.collaboration.members": "Members",
  "workspace.collaboration.pending": "Waiting for approval",
  "workspace.collaboration.you": "you",
  "workspace.collaboration.role.host": "Host",
  "workspace.collaboration.role.editor": "Editor",
  "workspace.collaboration.role.viewer": "Read only",
  "workspace.collaboration.roleLabel": "Access for {name}",
  "workspace.collaboration.kick": "Dismiss member",
  "workspace.collaboration.kickTitle": "Dismiss this member?",
  "workspace.collaboration.kickBody": "Ask {name} to leave the room?",
  "workspace.collaboration.kickConfirm": "Dismiss",
  "workspace.collaboration.maxMembers": "Maximum members",
  "workspace.collaboration.maxMembersBelowTitle": "Limit below the current member count?",
  "workspace.collaboration.maxMembersBelowBody":
    "You are setting the limit below the current member count. This will not remove members who already joined, but other members will not be able to join. Change the limit anyway?",
  "workspace.collaboration.maxMembersBelowConfirm": "Change limit",
  "workspace.collaboration.approveEditor": "Allow editing",
  "workspace.collaboration.approveViewer": "Allow viewing",
  "workspace.collaboration.reject": "Decline",
  "workspace.collaboration.copyInviteLink": "Copy invite link",
  "workspace.collaboration.inviteLink": "Invite link",
  "workspace.collaboration.inviteLinkPlaceholder": "rperedux://join?...",
  "workspace.collaboration.inviteLinkCopied": "Invite link copied.",
  "workspace.collaboration.invalidInviteLink": "This invitation link is invalid.",
  "workspace.collaboration.invalidRoomDetails": "Enter the server address and room password.",
  "workspace.collaboration.autoApproveEditor": "Allow new members to edit",
  "workspace.collaboration.copyFailed": "The invite link could not be copied.",
  "workspace.collaboration.e2eOverwrite":
    "Encrypted rooms apply changes in revision order. A concurrent edit replaced a field in this document; a recovery copy is kept.",
  "workspace.collaboration.recovery": "Recovery copy",
  "workspace.collaboration.recoveryHint":
    "A rejected local edit is kept for this room session only. Download it before discarding it.",
  "workspace.collaboration.reapplyMine": "Reapply my version",
  "workspace.collaboration.resumeTitle": "Resume the collaboration room?",
  "workspace.collaboration.resumeBody":
    "The last hosted room is still available on this device. Resuming restores its authoritative chart and replaces the current document.",
  "workspace.collaboration.resumeAction": "Resume room",
  "workspace.collaboration.resumeGuestTitle": "Rejoin the collaboration room?",
  "workspace.collaboration.resumeGuestBody":
    "Your last joined room is still available. Rejoining restores the room chart and its assets.",
  "workspace.collaboration.lockDeniedRetry":
    "The room could not reserve this edit. Retry when the other member releases it.",
  "workspace.collaboration.rebaseLabel": "Reapply: {label}",
  "workspace.collaboration.unsent": "Unsent changes",
  "workspace.collaboration.unsentHint":
    "The room did not accept these edits. Retry them, reapply them over the current room chart, or discard them.",
  "workspace.collaboration.unsentRetry": "Retry",
  "workspace.collaboration.unsentRebase": "Reapply",
  "workspace.collaboration.unsentDiscard": "Discard",
  "workspace.collaboration.downloadRecovery": "Download copy",
  "workspace.collaboration.clearRecovery": "Discard copy",
  "workspace.collaboration.invalidSnapshot": "The room snapshot is invalid: {detail}",
  "workspace.collaboration.roomChartSaveBlocked":
    "Room charts are not saved to the local library and are deleted when you leave. Export the chart to keep a copy.",
  "workspace.collaboration.joined": "Joined the collaboration room.",
  "workspace.collaboration.memberLeft": "{name} left the room.",
  "workspace.collaboration.waitingApproval":
    "Connected. Waiting for the host to approve this device…",
  "workspace.collaboration.reconnecting": "Connection lost. Reconnecting…",
  "workspace.collaboration.reconnected": "Reconnected to the collaboration room.",
  "workspace.collaboration.connectionLost": "The collaboration connection was lost.",
  "workspace.collaboration.connectionFailed": "Could not connect to the collaboration server.",
  "workspace.collaboration.versionMismatch":
    "Both devices must run the same RPE Redux version to join this room.",
  "workspace.collaboration.versionNewerThanHost":
    "Your RPE Redux version is newer than the host's. Ask the host to update RPE Redux, or use the host's version to join.",
  "workspace.collaboration.versionOlderThanHost":
    "Your RPE Redux version is older than the host's. Update RPE Redux to join this room.",
  "workspace.collaboration.hostMustClose":
    "The host cannot leave the room. Close the room instead.",
  "workspace.collaboration.roomLimit":
    "This device has reached its collaboration room limit. Close an old room and try again.",
  "workspace.collaboration.roomFull": "This room is full.",
  "workspace.collaboration.removed": "You were dismissed from the room.",
  "workspace.collaboration.left": "Left the room. The temporary room chart was deleted.",
  "workspace.collaboration.connectionTimeout":
    "Timed out connecting to the collaboration server. Check the address and network.",
  "workspace.collaboration.handshakeTimeout":
    "The collaboration server accepted the connection but did not answer in time. Try again.",
  "workspace.collaboration.connectionClosed":
    "The collaboration connection closed before the room was ready.",
  "workspace.collaboration.heartbeatTimeout":
    "The collaboration connection stopped answering. Reconnecting…",
  "workspace.collaboration.statusLabel": "Status",
  "workspace.collaboration.joiningRoom": "Joining room…",
  "workspace.collaboration.remoteSnapshot": "Room snapshot",
  "workspace.collaboration.applyFailed": "The room change could not be applied.",
  "workspace.collaboration.conflictNotice":
    "Another member changed the same content. The current room revision was requested.",
  "workspace.collaboration.invalidRemoteChange":
    "A remote change produced an invalid chart. The current room revision was requested.",
  "workspace.collaboration.roleChanged": "Your room access is now {role}.",
  "workspace.collaboration.roleChangedReason": "Your room access is now {role}: {reason}",
  "workspace.collaboration.replaceDirtyTitle": "Join the room and replace this document?",
  "workspace.collaboration.replaceDirtyBody":
    "This chart has unsaved changes. It is written to the local recovery store before the temporary room chart replaces this document. The room chart is never saved to the local library and is deleted when you leave the room.",
  "workspace.collaboration.recoveryWriteFailed":
    "The local recovery copy could not be saved, so the room was not joined. Save or export this chart, then try again.",
  "workspace.collaboration.continue": "Continue",
  "workspace.collaboration.status.idle": "Not connected",
  "workspace.collaboration.status.connecting": "Connecting",
  "workspace.collaboration.status.waiting": "Waiting for host approval",
  "workspace.collaboration.status.connected": "Connected",
  "workspace.collaboration.status.reconnecting": "Reconnecting",
  "workspace.collaboration.status.offline": "Offline",
  "workspace.collaboration.status.error": "Connection error",
  "workspace.collaboration.queued": "{count} change(s) waiting for confirmation",
  "workspace.collaboration.location.none": "No active location",
  "workspace.collaboration.location.global": "Global, {section}",
  "workspace.collaboration.location.edit": "Edit, beat {beat}",
  "workspace.collaboration.location.design": "Design",
  "workspace.collaboration.assets": "Resources",
  "workspace.collaboration.assetSyncing": "Syncing",
  "workspace.collaboration.locks": "Edit locks",
  "workspace.collaboration.locked": "{owners} is editing {objects}. Wait or ask them to finish.",
  "workspace.collaboration.lockedUntil":
    "{owners} is editing {objects}. The earliest lock releases in about {seconds}s.",
  "workspace.collaboration.lockReleases": "releases in {seconds}s",
  "workspace.collaboration.lockExpired": "released",
  "workspace.collaboration.lockObject.chart": "the chart",
  "workspace.collaboration.lockObject.line": "line {name}",
  "workspace.collaboration.lockObject.note": "note {name}",
  "workspace.collaboration.lockTimeout":
    "The room did not answer the edit-lock request. Your change was not sent; try again when the connection settles.",
  "workspace.collaboration.queueFull":
    "Too many changes are waiting to be sent. Save the chart, then reconnect before trying again.",
  "workspace.collaboration.someone": "Another member",
  "workspace.collaboration.assetUploadFailed":
    "Chart resources could not be uploaded. The edit was kept local; check the connection and try again.",

  "guide.title": "Complete onboarding guide",
  "guide.navigation": "Guide topics",
  "guide.search.label": "Search help",
  "guide.search.placeholder": "Search help topics",
  "guide.search.empty": "No help topic matches this search.",
  "guide.category.workflow": "Workflow",
  "guide.category.editing": "Editing",
  "guide.category.tools": "Tools",
  "guide.category.collaboration": "AI & collaboration",
  "guide.category.app": "Application",
  "guide.category.extensions": "Extensions",
  "guide.sectionCount": "{current} / {total}",
  "guide.section.overview.title": "Start here",
  "guide.section.overview.summary":
    "RPE Redux is organised around one loop: prepare a chart, place content on the timeline, shape it in the stage, then check and export the result.",
  "guide.section.overview.tip1":
    "The home screen manages chart files and the library; the editor window owns one open chart at a time.",
  "guide.section.overview.tip2":
    "The toolbar controls what is visible and how time is divided. The timeline is for precise selection; the stage is for visual placement.",
  "guide.section.overview.tip3":
    "Most editing is reversible. Use Ctrl+Z, the History panel, and Chart issues before exporting.",
  "guide.section.inspector.title": "Inspector basics",
  "guide.section.inspector.summary":
    "The Inspector is the context-sensitive property surface on the right. It changes with the selected note, event, line, or tool.",
  "guide.section.inspector.tip1":
    "When nothing is selected, use the panel tiles to open metadata, timing, lines, assets, history, and other workflows.",
  "guide.section.inspector.tip2":
    "When a pane is open, the title-bar question mark jumps to that pane's guide section; the X closes it and returns focus to the editor.",
  "guide.section.inspector.tip3":
    "Fields commit through the owning feature. Invalid values stay visible with an explanation instead of silently changing the chart.",
  "guide.section.inspector.tip4":
    "The Inspector and the sidebar are two views of the same registered destinations, so a panel opened from either place behaves the same.",
  "guide.section.home.title": "Home and chart library",
  "guide.section.home.summary":
    "Create a blank chart, import an existing RPE chart, reopen recent work, and manage the local library from the home screen.",
  "guide.section.home.tip1":
    "New chart creates a blank document. Import accepts an RPE folder or another supported chart file, and the home screen also accepts dropped files.",
  "guide.section.home.tip2":
    "Open a library card to continue editing; the library keeps the chart identity while the editor owns unsaved changes.",
  "guide.section.home.tip3":
    "Save often. Export is for a finished chart or a hand-off copy; it is separate from saving the working document.",
  "guide.section.toolbar.title": "Toolbar and transport",
  "guide.section.toolbar.summary":
    "The first row controls playback and the current editing context. The second row controls visible regions and the stage camera.",
  "guide.section.toolbar.tip1":
    "Choose the judge line, beat division, and playback rate before placing notes. The line field accepts a line number, range, or union.",
  "guide.section.toolbar.tip2":
    "Use the Notes, Events, and Preview buttons to give each canvas enough room for the task at hand.",
  "guide.section.toolbar.tip3":
    "Grid count changes the horizontal lane subdivision; preview ratio changes the rendered preview frame.",
  "guide.section.toolbar.tip4":
    "Free camera enables zoom and pan in the stage. Center returns to the useful framing; Reset restores the default view.",
  "guide.section.timeline.title": "Timeline",
  "guide.section.timeline.summary":
    "The timeline is the precise editing surface for notes and events. Its ruler, playhead, selection, and context menu work together.",
  "guide.section.timeline.tip1":
    "Move the pointer over the notes canvas to read beat and lane, then click to select or use the note shortcuts to place content.",
  "guide.section.timeline.tip2":
    "Use the event canvas for judge-line changes and drag across a range when an operation should affect multiple objects.",
  "guide.section.timeline.tip3":
    "The playhead and transport share the same chart time. Markers and jump actions are useful when checking a long chart.",
  "guide.section.timeline.tip4":
    "Right-click a timeline object for context actions. Ctrl+C/V, Delete, and Ctrl+Z follow the same selection model.",
  "guide.section.stage.title": "Stage and preview",
  "guide.section.stage.summary":
    "The stage shows how the chart will look and gives direct manipulation tools for judge lines, curve workflows, sampling, and preview overlays.",
  "guide.section.stage.tip1":
    "Toggle the preview region when you need to compare the authored chart with the live game-like result.",
  "guide.section.stage.tip2":
    "Drag judge-line handles and use the line information overlay to confirm which line is active.",
  "guide.section.stage.tip3":
    "Sampling tools expose start/end anchors and easing. Hold Shift while dragging to temporarily hide guide lines.",
  "guide.section.stage.tip4":
    "The stage is also where curve previews, batch controls, audio analysis, and Extension overlays appear.",
  "guide.section.metadata.title": "Chart information",
  "guide.section.metadata.summary":
    "Chart information is the first Inspector destination for a document: identity, authoring metadata, difficulty, timing, and media references.",
  "guide.section.metadata.tip1":
    "Fill in title, composer, charter, difficulty, and timing early so exports and library cards remain recognisable.",
  "guide.section.metadata.tip2":
    "Changing metadata is a normal chart edit and is saved with the document; it does not alter note timing by itself.",
  "guide.section.metadata.tip3":
    "When a chart comes from another format, use this panel to verify the imported values before editing content.",
  "guide.section.notes.title": "Note editing",
  "guide.section.notes.summary":
    "The Note editing panel exposes the properties of the selected note while the timeline and stage show the same selection visually.",
  "guide.section.notes.tip1":
    "Select a note first, then edit beat, lane position, type, size, color, and other fields in one place.",
  "guide.section.notes.tip2":
    "Tap, Drag, Flick, and Hold have different required fields. Hold uses a start and end time; Esc cancels an unfinished placement.",
  "guide.section.notes.tip3":
    "Use the timeline for exact beat placement and the stage for spatial intuition. Undo covers both changes.",
  "guide.section.notes.tip4":
    "Multi-edit applies one property change to a selection; check the preview before committing a broad change.",
  "guide.section.events.title": "Event editing",
  "guide.section.events.summary":
    "Events animate judge-line properties and visual effects over a beat range. The Inspector edits the selected event and its easing.",
  "guide.section.events.tip1":
    "Set the start and end beat before tuning values. A range must remain ordered and inside the chart's usable timeline.",
  "guide.section.events.tip2":
    "Choose an easing preset or edit the curve when the change needs a custom acceleration profile.",
  "guide.section.events.tip3":
    "Shader events expose parameters in their own sections. Keep the global flag and event order intentional when layering effects.",
  "guide.section.lines.title": "Judge lines and multi-line editing",
  "guide.section.lines.summary":
    "Judge lines own the playfield geometry and their events. The Lines drawer edits one line; Multi-line editing compares several lines together.",
  "guide.section.lines.tip1":
    "Use the line picker in the toolbar to jump to a line. The Inspector line form is the source of truth for its properties.",
  "guide.section.lines.tip2":
    "Multi-line editing is useful for applying a shared expression or comparing values without leaving the current document.",
  "guide.section.lines.tip3":
    "Keep line order and parent relationships clear; a visual change can affect every note attached to that line.",
  "guide.section.timing.title": "Timing and BPM",
  "guide.section.timing.summary":
    "Timing points define the beat-to-time conversion used by the timeline, playback, and exported chart.",
  "guide.section.timing.tip1":
    "Create or select a timing point in the left list, then edit BPM and offset in the properties column.",
  "guide.section.timing.tip2":
    "Use auto timing detection as a starting point, then listen and verify against the actual audio before placing dense patterns.",
  "guide.section.timing.tip3":
    "A timing change moves the interpretation of beats, not the authored beat numbers. Save a checkpoint before making a large change.",
  "guide.section.assets.title": "Asset library",
  "guide.section.assets.summary":
    "The Assets drawer keeps chart images, audio, skins, and other resources organised and exposes properties for the selected asset.",
  "guide.section.assets.tip1":
    "Use the list column to select an asset and the properties column to inspect its role, path, or chart reference.",
  "guide.section.assets.tip2":
    "Prefer stable chart-local resources when sharing or exporting so another machine can resolve the same files.",
  "guide.section.assets.tip3":
    "If an imported resource looks wrong, check the asset entry before changing note or line data.",
  "guide.section.curve.title": "Curve notes",
  "guide.section.curve.summary":
    "Curve notes turn a start/end selection into a shaped note sequence. The Curve notes panel owns the generation settings.",
  "guide.section.curve.tip1":
    "Choose the curve endpoints in the timeline or stage, then open Curve notes to set density, path, and direction.",
  "guide.section.curve.tip2":
    "Preview the generated sequence before committing. Generated notes remain ordinary editable notes afterwards.",
  "guide.section.curve.tip3":
    "Use the curve trajectory panel when you need to inspect or refine the path independently from note generation.",
  "guide.section.trajectory.title": "Curve trajectory",
  "guide.section.trajectory.summary":
    "Trajectory tools describe the path between curve endpoints and help you preview how a curve will travel through the stage.",
  "guide.section.trajectory.tip1":
    "Pick a start and end note in the requested order so the trajectory has an unambiguous range.",
  "guide.section.trajectory.tip2":
    "Use the preview to catch a path that leaves the intended lane or crosses an unexpected judge-line region.",
  "guide.section.trajectory.tip3":
    "When the trajectory looks right, return to Curve notes to generate or adjust the actual note sequence.",
  "guide.section.history.title": "History and undo",
  "guide.section.history.summary":
    "History shows the editor's reversible changes and lets you inspect or revert a meaningful edit without losing the rest of the document.",
  "guide.section.history.tip1":
    "Ctrl+Z and Ctrl+Y are the fastest path for local edits; the History panel is better when you need to identify a specific change.",
  "guide.section.history.tip2":
    "Reverting an older entry creates a new state rather than silently rewriting the document's past.",
  "guide.section.history.tip3":
    "In collaboration, remote changes and local undo permissions are kept distinct so one member cannot erase another member's work accidentally.",
  "guide.section.issues.title": "Chart issues",
  "guide.section.issues.summary":
    "Chart issues collects suspicious overlaps and invalid combinations and lets you locate the affected objects in the editor.",
  "guide.section.issues.tip1":
    "Open an issue row to jump to its objects, then correct the source note or event instead of hiding the warning.",
  "guide.section.issues.tip2":
    "Run the issue check after bulk edits, curve generation, or timing changes.",
  "guide.section.issues.tip3":
    "An empty panel means the current chart has no issues of the kinds the checker knows about; it is not a substitute for visual review.",
  "guide.section.multiEdit.title": "Multi editing",
  "guide.section.multiEdit.summary":
    "Multi editing applies one property change to several selected notes or events while keeping a preview of the pending result.",
  "guide.section.multiEdit.tip1":
    "Marquee-select several objects on the timeline, or extend a selection with the platform selection modifiers before opening the panel.",
  "guide.section.multiEdit.tip2":
    "Only fields shared by the selection are offered. A mixed value is shown as mixed until you choose a replacement.",
  "guide.section.multiEdit.tip3":
    "Review the preview and apply once; the whole batch becomes one undoable history entry.",
  "guide.section.audio.title": "Audio, waveform, and spectrum",
  "guide.section.audio.summary":
    "Audio surfaces help align the chart with the song and inspect transients without changing chart objects by themselves.",
  "guide.section.audio.tip1":
    "The waveform and spectrum follow the current chart audio and time range; use them to spot attacks and quiet sections.",
  "guide.section.audio.tip2":
    "Audio analysis is visual reference. Confirm a beat against playback and timing points before committing dense note patterns.",
  "guide.section.audio.tip3":
    "If the audio looks wrong, check the chart metadata and Assets panel first; changing a note will not repair a missing resource.",
  "guide.section.scripts.title": "Extensions and scripts",
  "guide.section.scripts.summary":
    "The Scripts panel runs installed Extension actions and exposes the parameters those actions declare.",
  "guide.section.scripts.tip1":
    "Read an Extension's description and requested capabilities before running it on a chart.",
  "guide.section.scripts.tip2":
    "Parameter forms validate at the boundary. If an action fails, the chart remains unchanged unless the action reports a committed edit.",
  "guide.section.scripts.tip3":
    "Use settings to manage Extensions and permissions; the panel is the execution surface, not the package manager.",
  "guide.section.ai.title": "AI activity",
  "guide.section.ai.summary":
    "AI activity shows requests sent through the local code-cell bridge and makes the editor-side audit trail visible.",
  "guide.section.ai.tip1":
    "The panel is available only when the related AI access setting is enabled and a client has made a request.",
  "guide.section.ai.tip2":
    "Review the requested operation and result before trusting a broad edit. The bridge still follows the editor's transaction rules.",
  "guide.section.ai.tip3":
    "AI activity is session-oriented. Save the chart if a generated change is worth keeping; do not treat the activity list as durable history.",
  "guide.section.collaboration.title": "Collaboration",
  "guide.section.collaboration.summary":
    "Collaboration connects multiple editors to one room with presence, edit locks, invitations, and asset synchronisation.",
  "guide.section.collaboration.tip1":
    "Create a room or join an invitation from the Collaboration panel, then verify the member list and role before editing.",
  "guide.section.collaboration.tip2":
    "Edit locks protect objects while another member is changing them. Wait for the lock to clear instead of retrying a rejected edit repeatedly.",
  "guide.section.collaboration.tip3":
    "Room links, passwords, and uploaded media are shared-room credentials. Leave the room when the session is finished.",
  "guide.section.recording.title": "Recording and export",
  "guide.section.recording.summary":
    "Recording captures the stage for review or presentation. Export creates a chart hand-off while the working document remains editable.",
  "guide.section.recording.tip1":
    "Set the visible regions, preview ratio, and camera framing before recording so the output matches the intended composition.",
  "guide.section.recording.tip2":
    "Use the playback controls to choose the exact range and verify audio or visual overlays before starting a capture.",
  "guide.section.recording.tip3":
    "Treat the recorded video and exported chart as outputs; continue saving the source chart as the canonical editable file.",
  "guide.section.document.title": "Save, export, and recovery",
  "guide.section.document.summary":
    "The document commands distinguish the editable working chart from exported packages, backups, and recovery snapshots.",
  "guide.section.document.tip1":
    "Save writes the current chart to its working project. Save As creates a new destination without changing the authored content.",
  "guide.section.document.tip2":
    "Export creates a hand-off package in a supported chart format; verify metadata, timing, assets, and issues before sharing it.",
  "guide.section.document.tip3":
    "If the app or service recovers a draft, compare it with the last saved project before replacing a known-good file.",
  "guide.section.settings.title": "Settings and appearance",
  "guide.section.settings.summary":
    "Settings control application behavior, editor density, keyboard bindings, audio, Extensions, language, themes, and help entry points.",
  "guide.section.settings.tip1":
    "Use Settings search to find a preference quickly; descriptions explain whether a value affects the home screen, editor, or runtime.",
  "guide.section.settings.tip2":
    "The Shortcuts page changes command bindings without changing the command itself. Restore defaults when a migration leaves an unfamiliar key.",
  "guide.section.settings.tip3":
    "Appearance and language changes are live. The Help page contains this guide, release notes, and product information.",
  "guide.section.shortcuts.title": "Keyboard workflow",
  "guide.section.shortcuts.summary":
    "Keyboard shortcuts keep precise editing fast, while every toolbar action remains available from menus and visible controls.",
  "guide.section.shortcuts.tip1":
    "Q/W/E/R place Tap, Drag, Flick, and Hold notes when the notes canvas is active. Esc cancels an unfinished operation.",
  "guide.section.shortcuts.tip2":
    "Ctrl+Z/Y undo and redo; Ctrl+C/V and Delete follow the current selection. Use the shortcut settings page to rebind commands.",
  "guide.section.shortcuts.tip3":
    "Arrow keys move through the interactive tutorial steps; shortcut settings let you change the rest of the keyboard workflow.",

  "tutorial.metadata.identity.title": "Fill in chart identity",
  "tutorial.metadata.identity.body":
    "Start with the title, composer, charter, and difficulty. These values appear in the library, exports, and collaboration details; changing them does not rewrite notes.",
  "tutorial.metadata.timing.title": "Complete the production credits",
  "tutorial.metadata.timing.body":
    "Fill in the composer, charter, illustrator, and difficulty. These values appear in the library, exports, and collaboration details; changing them does not rewrite notes.",
  "tutorial.metadata.resources.title": "Check media references",
  "tutorial.metadata.resources.body":
    "Confirm that the song and background files belong to this chart. Recheck paths and the preview after importing or moving a file instead of mistaking a missing resource for a note or line issue.",

  "tutorial.timing.open.title": "Understand the timing workspace",
  "tutorial.timing.open.body":
    "The left side lists timing points and the right side edits the selected point. Timing points are chart data: they define how beats become real time.",
  "tutorial.timing.select.title": "Select a timing point",
  "tutorial.timing.select.body":
    "Select a row to move the playhead to its beat. The offset row applies to the whole chart's audio alignment; it is not a property of one timing point.",
  "tutorial.timing.edit.title": "Edit BPM and start beat",
  "tutorial.timing.edit.body":
    "Change the start beat and BPM in the properties column; the value commits when the field loses focus. New points use the playhead and nearby tempo, so verify the result before adding dense notes.",
  "tutorial.timing.verify.title": "Verify against the audio",
  "tutorial.timing.verify.body":
    "Automatic timing detection is only a starting point. Play the audio and compare the timeline and stage at several clear attacks before trusting a dense pattern.",
  "tutorial.lines.choose.title": "Choose a judge line",
  "tutorial.lines.choose.body":
    "The tree lists judge lines and groups. Select a line to open its properties; selecting a group shows group actions instead of pretending the group is one line.",
  "tutorial.lines.edit.title": "Edit line properties",
  "tutorial.lines.edit.body":
    "Edit the name, anchors, z-order, mask, texture, and BPM factor in the properties face. These are chart values and can affect every note and event attached to the line.",
  "tutorial.lines.organize.title": "Organise groups and parents",
  "tutorial.lines.organize.body":
    "Use groups for structure and parent relationships for inherited motion. A multi-selection exposes only safe shared fields; mixed values are written only after you choose a replacement.",
  "tutorial.lines.check.title": "Check the stage",
  "tutorial.lines.check.body":
    "After a line edit, inspect position, masking, and texture on the stage, then play a short range to ensure notes still land in the intended area. Keep a history checkpoint before broad edits.",
  "tutorial.assets.browse.title": "Browse the asset library",
  "tutorial.assets.browse.body":
    "The list contains this chart's asset entries and the properties face edits the selected entry. The library manages file references; it does not rewrite notes or judge lines for you.",
  "tutorial.assets.inspect.title": "Inspect an asset entry",
  "tutorial.assets.inspect.body":
    "Select an entry and inspect its type, path, and chart references. Audio, backgrounds, and textures have different roles, so do not infer usage from the filename alone.",
  "tutorial.assets.import.title": "Import with stable paths",
  "tutorial.assets.import.body":
    "Use the library import action and prefer stable chart-local relative resources. Before sharing or exporting, confirm that another machine can resolve the same files.",
  "tutorial.assets.verify.title": "Verify the real reference",
  "tutorial.assets.verify.body":
    "After importing, check chart information and the stage to confirm that the audio, cover, or texture is actually used. Fix the asset entry and path before changing chart data.",

  "onboarding.title": "Quick-start guide",
  "onboarding.kicker": "Quick start",
  "onboarding.progress": "{current} / {total}",
  "onboarding.choice.title": "How should we introduce the editor?",
  "onboarding.choice.note":
    "You can replay this walkthrough later from Settings > Help > Show the onboarding guide.",
  "onboarding.choice.rpe.title": "I already use RPE",
  "onboarding.choice.rpe.description":
    "Import an existing chart, then learn where this editor differs from RPE.",
  "onboarding.choice.new.title": "I have never charted before",
  "onboarding.choice.new.description":
    "Create a chart and learn the basic workflow: metadata, the sidebar, views, notes, and parameters.",
  "onboarding.choice.none.title": "No guide",
  "onboarding.choice.none.description": "Go straight to the home screen.",
  "onboarding.start.rpe.title": "Import your RPE chart",
  "onboarding.start.rpe.body":
    "Choose Import from the highlighted More menu at any time. The dialog accepts an RPE folder or another supported chart file, and the home screen also accepts dropped folders and files. Imported charts land in the library; open one and the guide continues automatically.",
  "onboarding.start.new.title": "Create a new chart",
  "onboarding.start.new.body":
    "Click the highlighted New chart button. The guide continues automatically after the blank chart opens.",
  "onboarding.metadata.title": "Fill in the chart metadata",
  "onboarding.metadata.body":
    "Click the highlighted input and fill in the title, composer, charter, and difficulty. Every field can be changed later.",
  "onboarding.sidebar.title": "The right sidebar",
  "onboarding.sidebar.body":
    "Click an icon to widen the rail and open its destination. Each entry owns one workflow.",
  "onboarding.sidebar.history": "Undo history and the list of edits.",
  "onboarding.sidebar.multiLine": "Edit several judge lines side by side.",
  "onboarding.sidebar.curve": "Draw and edit curve notes.",
  "onboarding.sidebar.trajectory": "Curve trajectory tools and preview.",
  "onboarding.sidebar.scripts": "Run Extension scripts and actions.",
  "onboarding.sidebar.codeCell": "Inspect the requests AI clients sent to the editor.",
  "onboarding.sidebar.collaboration": "Collaboration room and member controls.",
  "onboarding.sidebar.recording": "Recording and export controls.",
  "onboarding.sidebar.generic": "Open this page.",
  "onboarding.view.title": "Switch the view",
  "onboarding.view.body":
    "The second toolbar row shows or hides the note area, the event area, and the live preview. Use it when the canvas feels crowded.",
  "onboarding.camera.title": "Free camera",
  "onboarding.camera.body":
    "Turn on Free camera from the second toolbar row. Wheel to zoom, drag to pan, Center re-centers, and Reset restores the default view.",
  "onboarding.notes.title": "Place notes",
  "onboarding.notes.newBody":
    "Move over the note area to choose beat and lane. Q/W/E/R place Tap/Drag/Flick/Hold; Hold needs two clicks, Esc cancels.",
  "onboarding.notes.rpeBody":
    "Move to the target beat and lane, then press Q/W/E/R for Tap/Drag/Flick/Hold. Hold needs two clicks; Esc cancels.",
  "onboarding.parameters.title": "Edit note parameters",
  "onboarding.parameters.body":
    "Select a note on the timeline, then adjust its beat, position, type, and other fields in the inspector on the right. Undo with Ctrl+Z.",
  "onboarding.finish.title": "You're ready",
  "onboarding.finish.body":
    "Create or import a chart from the home screen. Replay this guide whenever you need it from Settings > Help.",
  "onboarding.action.previous": "Back",
  "onboarding.action.next": "Next",
  "onboarding.action.skip": "Skip guide",
  "onboarding.action.finish": "Start editing",
} as const;
