# RPE-Redux Grouping Research

> Research date: 2026-11-14  
> Scope: the library project `group` field and its behavior across scanning, import, the library page, persistence, backup, and tests.  
> Constraint: this research did not modify product code. Existing uncommitted import/open changes in the worktree are outside this research.

## Executive summary

“Grouping” is currently a plain string on `projects.grp`. It is not a managed group entity: there is no groups table, group ID, hierarchy, group ordering, or group-level operation. The frontend treats it as project metadata: the detail pane displays it and the edit dialog can change it. The library page does not render group sections, collapsible groups, group creation/deletion/rename controls, or drag-and-drop moves.

The Go service, browser SQLite worker, and public SDK already support exact `group` filtering, but the welcome page does not connect that capability to a filter control. Library search does not match group, and the available sort fields do not include group.

Import sources are inconsistent:

1. RPE `Info.txt` group is carried into the scan and passed to new library projects.
2. PhiEditer scan data puts source `level` into `PeChart.group`, but the actual import hard-codes `"PhiEditer"`; the scanned level is not used as the library project group.
3. Official JSON/PEC imports use hard-coded `"Phigros"` or `"PhiEdit"`; ordinary file import omits group and therefore creates an empty group.

## 1. Data model and persistence

### 1.1 A project field, not a group entity

The Go service serializes `Group` as `group` beside name, author, and difficulty metadata: [store.go](../../src/backend/internal/store/store.go#L60-L78). The SQLite schema stores it in `grp` as `TEXT NOT NULL DEFAULT ''`; there is no foreign key or separate groups table: [store.go](../../src/backend/internal/store/store.go#L219-L245).

The shared frontend type also defines it as a string: [client.ts](../../src/core/global/library/client.ts#L34-L58). Project creation accepts an optional group and project patch accepts `group`: [client.ts](../../src/core/global/library/client.ts#L289-L295), [client.ts](../../src/core/global/library/client.ts#L657-L691). An empty string is therefore a valid unset value, not a persisted “ungrouped” object.

### 1.2 Create, edit, and duplicate

- Project creation writes the supplied group directly into the project row: [store.go](../../src/backend/internal/store/store.go#L856-L872).
- Project updates write the supplied string to `grp` without normalization, case folding, or deduplication: [store.go](../../src/backend/internal/store/store.go#L1174-L1201).
- Duplicating a project copies its existing `grp`: [store.go](../../src/backend/internal/store/store.go#L1748-L1763).
- The library edit dialog exposes group as a normal text input: [HomeProjectDialogView.tsx](../../src/frontend/screens/welcome/library/HomeProjectDialogView.tsx#L27-L63). The controller trims the value and, when empty, stores the localized “ungrouped” fallback instead of an empty string: [libraryProjectsController.ts](../../src/frontend/screens/welcome/libraryProjectsController.ts#L140-L152), [libraryProjectsController.ts](../../src/frontend/screens/welcome/libraryProjectsController.ts#L189-L221).

This means an unset project can have two practical states: raw `""`, or a localized fallback string written after editing and saving.

### 1.3 Browser library and backup

The browser OPFS SQLite worker uses the same `grp` column and maps it back to `project.group`: [db.worker.ts](../../src/core/platform/browser/library/db.worker.ts#L488-L505). Its list implementation supports exact group filtering: [db.worker.ts](../../src/core/platform/browser/library/db.worker.ts#L1806-L1842), and its patch implementation writes group: [db.worker.ts](../../src/core/platform/browser/library/db.worker.ts#L1900-L1916).

The backup manifest includes group as part of each project’s portable state: [format.go](../../src/backend/internal/librarybackup/format.go#L91-L115), and restore writes it back into `grp`: [restore.go](../../src/backend/internal/librarybackup/restore.go#L121-L137). Existing group strings therefore survive restart, backup/restore, and desktop/browser library storage; these mechanisms still do not provide group lifecycle management.

## 2. Group sources during scanning and import

### 2.1 RPE

The RPE scanner reads each chart folder’s `Info.txt`. The `group` field is trimmed; empty or `-` values fall back to `"RPE"`: [rpe.go](../../src/backend/internal/intake/rpe.go#L188-L222). Scan results are sorted by group and then name: [rpe.go](../../src/backend/internal/intake/rpe.go#L141-L153).

The RPE review row displays the scan group as the native editor collection, but the row only exposes path, title, author, and group text; it has no editable group input: [rpeImportReview.ts](../../src/frontend/screens/welcome/rpeImportReview.ts#L30-L50), [rpeImportReview.ts](../../src/frontend/screens/welcome/rpeImportReview.ts#L146-L157). After confirmation, RPE import passes `chart.group` to `importChartToLibrary`: [rpeImport.ts](../../src/frontend/screens/welcome/rpeImport.ts#L139-L149).

If the path is already mapped to an existing project, the save path performs an update commit. Group is used by the create request, but the update commit input has no group field. Thus source group reliably affects new projects, but re-importing an existing project does not automatically overwrite its library group: [save.ts](../../src/core/global/library/save.ts#L39-L82), [save.ts](../../src/core/global/library/save.ts#L88-L125), [libraryCatalog.ts](../../src/core/global/library/libraryCatalog.ts#L30-L53).

### 2.2 PhiEditer

The PhiEditer scanner reads `level` from each `Settings.txt` chart block and stores it in `PeChart.Group`; missing values fall back to `"PhiEditer"`: [pe.go](../../src/backend/internal/intake/pe.go#L230-L260). This already mixes two source concepts: a chart difficulty/level is temporarily named group in the scan result.

During migration, however, `migratePeScan` passes the hard-coded group `"PhiEditer"` to `importPeChart` instead of using `chart.group`: [peImport.ts](../../src/frontend/screens/welcome/peImport.ts#L141-L170). `importPeChart` then uses that parameter as the library project group: [peImport.ts](../../src/frontend/screens/welcome/peImport.ts#L74-L119).

Current result:

- converted chart `META.level` still uses `chart.group`, so the source level may be retained as chart metadata;
- library project `group` is always `PhiEditer`;
- charts from different PhiEditer levels do not become corresponding library groups.

### 2.3 Official JSON, PEC, and ordinary file import

External format import hard-codes the library group from the conversion format: official format becomes `Phigros`, and the other supported external format becomes `PhiEdit`: [externalImport.ts](../../src/frontend/screens/welcome/externalImport.ts#L386-L398).

Ordinary file import calls `importChartToLibrary` without a group: [editorHome.ts](../../src/frontend/screens/welcome/editorHome.ts#L291-L333). During project creation, the omitted value reaches the service as the default empty string: [save.ts](../../src/core/global/library/save.ts#L66-L80), [store.go](../../src/backend/internal/store/store.go#L862-L870).

## 3. Library grouping, filtering, sorting, and editing

### 3.1 User-visible capabilities

The library toolbar currently contains search, sort, and list/grid view controls. It has no group selector or group navigation: [LibraryPanel.tsx](../../src/frontend/screens/welcome/library/LibraryPanel.tsx#L79-L105), [LibraryPanel.tsx](../../src/frontend/screens/welcome/library/LibraryPanel.tsx#L136-L205).

Each project is mapped to one flat card entry in the service-returned order: [libraryEntries.ts](../../src/frontend/screens/welcome/library/libraryEntries.ts#L20-L49). Cards have no group badge or group heading. The detail pane only displays the group field: [LibraryDetail.tsx](../../src/frontend/screens/welcome/library/LibraryDetail.tsx#L154-L159), [LibraryDetail.tsx](../../src/frontend/screens/welcome/library/LibraryDetail.tsx#L201-L220).

The project edit dialog can change group text, but this is project metadata editing, not group management: [ProjectDialogs.tsx](../../src/frontend/screens/welcome/library/ProjectDialogs.tsx#L69-L97), [HomeProjectDialogView.tsx](../../src/frontend/screens/welcome/library/HomeProjectDialogView.tsx#L56-L63). Delete removes a project only; there is no “delete group but keep projects” or bulk move action: [libraryProjectsController.ts](../../src/frontend/screens/welcome/libraryProjectsController.ts#L130-L187).

### 3.2 Existing query support not connected to the page

The shared client `ListQuery` includes `group`: [client.ts](../../src/core/global/library/client.ts#L273-L287), and `LocalLibrary.list` encodes it into `/api/projects`: [client.ts](../../src/core/global/library/client.ts#L530-L537). The Go HTTP API accepts the query parameter and forwards it to the store: [api.go](../../src/backend/internal/httpapi/api.go#L425-L483). The store performs exact `grp = ?` matching: [store.go](../../src/backend/internal/store/store.go#L1067-L1091).

The browser library has the same exact-match behavior: [db.worker.ts](../../src/core/platform/browser/library/db.worker.ts#L1810-L1820). The welcome controller’s initial list request only passes sort, direction, and `limit: 500`; it has no group state: [libraryProjectsController.ts](../../src/frontend/screens/welcome/libraryProjectsController.ts#L51-L68). Backend/SDK support therefore exists independently of the current welcome-page UI.

### 3.3 Search and sort exclude group

Backend search matches name, charter, composer, and level, but not `grp`: [store.go](../../src/backend/internal/store/store.go#L1083-L1086). The browser worker uses the same four fields: [db.worker.ts](../../src/core/platform/browser/library/db.worker.ts#L1810-L1816). The welcome page’s local entry filter also matches only title, composer, charter, and level: [libraryEntries.ts](../../src/frontend/screens/welcome/library/libraryEntries.ts#L52-L61).

Available sort fields are created, updated, name, composer, and charter; group is absent: [client.ts](../../src/core/global/library/client.ts#L273-L276), [librarySort.ts](../../src/frontend/screens/welcome/librarySort.ts#L13-L29). Users cannot sort by group to cluster related projects.

## 4. Documentation and test coverage

### 4.1 Documentation

- Architecture documentation identifies the library owner and the RPE, PhiEditer, and external import owners, but does not define group semantics or library-page interaction: [architecture.md](../architecture.md#L80-L105).
- The backup manifest includes `group` in each project snapshot, but the backup implementation focuses on persistence rather than grouping behavior: [format.go](../../src/backend/internal/librarybackup/format.go#L91-L115).
- The SDK guide exposes group in list/create/update shapes: [llm-guide.md](../../sdk/llm-guide.md#L454-L483), [llm-guide.md](../../sdk/llm-guide.md#L528-L545). It does not expose a groups API.
- No existing document found in the repository describes the library grouping product behavior. This file is the first focused record of the current state.

### 4.2 Tests

Existing tests cover the field’s presence and parts of library navigation, but do not form a complete grouping contract:

- `welcomeLibrary.test.mjs` verifies service order becomes card order, snapshot publication, and default sort directions. Its fixture group is empty and it has no group filter/search/edit assertions: [welcomeLibrary.test.mjs](../../src/test/library/navigation/welcomeLibrary.test.mjs#L14-L81).
- `store_test.go` covers the five project sort fields, but creates projects without groups and has no group-filter test: [store_test.go](../../src/backend/internal/store/store_test.go#L224-L275).
- RPE/PE migration tests primarily cover migration plans and format mapping; no scan-to-library-group end-to-end assertion was found: [rpeMigration.test.mjs](../../src/test/chart/migration/rpeMigration.test.mjs), [peMigration.test.mjs](../../src/test/chart/migration/peMigration.test.mjs).
- Library save, catalog, and browser-library tests cover persistence, path mapping, and database shape, but do not make group a behavior under test: [librarySaveCleanup.test.mjs](../../src/test/library/save/librarySaveCleanup.test.mjs), [libraryCatalog.test.mjs](../../src/test/library/catalog/libraryCatalog.test.mjs), [streamedChartImport.test.mjs](../../src/test/library/import/streamedChartImport.test.mjs).

## 5. Current limitations

1. There is no independent group entity, so stable group IDs, separate display/internal names, group ordering, group colors, group descriptions, group archive state, and group-level permissions cannot be represented.
2. The welcome page has no group filter or group sections; an existing backend filter is unused by the page.
3. Group is excluded from search and sort, so users cannot find a group by name or cluster cards by group.
4. RPE group is naturally written for new projects, but an existing catalog-mapped project is not updated with a new source group during re-import.
5. PhiEditer source level and library group are mixed in the scan type, then the actual library group is hard-coded to `PhiEditer`.
6. External imports use format constants, while ordinary single-file imports use an empty group. There is no common source-to-group policy.
7. The empty-group display fallback is localized, and saving an empty edit writes that localized text to the database. This can create raw `""`, Chinese “Ungrouped”, and English “Ungrouped” as different stored values.
8. There are no UI, import-pipeline, or backend regression tests for the complete path from scanned group to project group to library filtering.

## 6. Recommendations

### Short term: complete the existing string capability

1. Define the product meaning of `group`: user collection/tag, or import-source category. If it is a user collection, importers should only provide an initial value and later library edits should be authoritative.
2. Add a group filter to the welcome page. Derive available values from the current list or expose a dedicated list query, and pass the selected value through `LibraryProjectsController` rather than filtering only the 500-item frontend snapshot. Keep Go and browser-worker matching semantics identical.
3. Either include group in search or explicitly make the filter the only group entry point. If search is expanded, update the backend, browser worker, and `matchesLibraryQuery` together.
4. Add group sorting or grouped rendering so filtering is not the only way to browse related projects.
5. Normalize the unset policy: keep empty string in storage, use a localized fallback only at display time, and save empty input as empty string.
6. Decide the PhiEditer rule. If source level should become the group, pass `chart.group`; if level is only difficulty, set the library group to an explicit source default and use distinct names for the two concepts.
7. Decide re-import semantics: preserve a user-edited group, or overwrite from source. Make the decision explicit in the save/patch path and tests.

### Medium term: introduce real group management if required

If the product needs create, delete, rename, bulk move, ordering, or group-level operations, replace the string-only model with a `groups` entity and migrate existing strings. The minimum contract would include stable group IDs, name uniqueness, project-to-group relation, an ungrouped policy, backup format versioning, matching Go/browser implementations, SDK methods, and UI/end-to-end tests.

## 7. Minimal recommended test matrix

| Layer | Contract to fix | Suggested location |
| --- | --- | --- |
| Go store/API | exact group filtering, empty group, case behavior, paged total | `src/backend/internal/store/store_test.go`, HTTP API tests |
| Browser library | same filtering, sorting, and empty-value behavior as Go | `src/test/library/...` |
| Import | RPE Info.txt group, PE level/group decision, external defaults, ordinary empty group | `src/test/chart/migration/`, import-pipeline tests |
| Library page | display, edit, search/filter, grouped view, non-persisted empty fallback | `src/test/library/navigation/` or a new UI contract test |
| Backup | group export, restore, and old-version migration | `src/backend/internal/librarybackup/` and browser-worker tests |

## 8. Source index

- Model and CRUD: [store.go](../../src/backend/internal/store/store.go), [client.ts](../../src/core/global/library/client.ts)
- RPE scan/import: [rpe.go](../../src/backend/internal/intake/rpe.go), [rpeImport.ts](../../src/frontend/screens/welcome/rpeImport.ts), [rpeImportReview.ts](../../src/frontend/screens/welcome/rpeImportReview.ts)
- PhiEditer scan/import: [pe.go](../../src/backend/internal/intake/pe.go), [peImport.ts](../../src/frontend/screens/welcome/peImport.ts)
- External/ordinary import: [externalImport.ts](../../src/frontend/screens/welcome/externalImport.ts), [editorHome.ts](../../src/frontend/screens/welcome/editorHome.ts)
- Library page: [LibraryPanel.tsx](../../src/frontend/screens/welcome/library/LibraryPanel.tsx), [libraryEntries.ts](../../src/frontend/screens/welcome/library/libraryEntries.ts), [LibraryDetail.tsx](../../src/frontend/screens/welcome/library/LibraryDetail.tsx), [libraryProjectsController.ts](../../src/frontend/screens/welcome/libraryProjectsController.ts)
- Browser library and backup: [db.worker.ts](../../src/core/platform/browser/library/db.worker.ts), [format.go](../../src/backend/internal/librarybackup/format.go)
- Existing tests: [welcomeLibrary.test.mjs](../../src/test/library/navigation/welcomeLibrary.test.mjs), [store_test.go](../../src/backend/internal/store/store_test.go)
