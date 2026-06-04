# Clarity — Windows UI Specification (WinUI 3 + C#)

This document describes the Windows-native implementation of the Clarity UI using WinUI 3. For
each screen or panel: the WinUI 3 layout and controls used, the label text, enabled/disabled
rules, and what each user action triggers.

Feature behavior (what happens in the backend) is in `01-features.md`. Data types are in
`05-data-types.md`. IPC calls are in `04-ipc-contract.md`.

---

## Window and App Shell

### Main Window

**Container:** `Window` with a `Grid` root layout.

```
┌─────────────────────────────────────────────────────────────┐
│  MenuBar                                                     │
├──────┬──────────────────────────────────────────────────────┤
│      │  Header / status bar                                  │
│ Nav  ├──────────────────────────────────────────────────────┤
│ View │  Workspace TabView                                    │
│      │  ─────────────────────────────────────── (splitter)  │
│      │  Query Results area                                   │
└──────┴──────────────────────────────────────────────────────┘
```

- **MenuBar**: `MenuBar` at the top (see §MenuBar)
- **Left panel**: `NavigationView` in compact/left mode (see §NavigationView Sidebar)
- **Right content**: `Grid` with two rows split by a `GridSplitter` (horizontal)
  - Row 1: workspace `TabView` + toolbar (see §Query Workspace)
  - GridSplitter: `GridSplitter` with a drag handle, min top row height 320px, min bottom row
    height 170px, default split: 70% top / 30% bottom
- **NavigationView** left pane width: 48px collapsed icons, 280–400px expanded (user-resizable
  via a `GridSplitter` between the nav pane and content area)

---

## MenuBar

`MenuBar` at the top of the window. On Windows, this is the WinUI 3 `MenuBar` control inside
the `TitleBar` area or below it.

### Query Menu

| Item | Accelerator | Action |
|------|-------------|--------|
| Save active query sheet... | Ctrl+S | `files.saveQuerySheet` with the current tab's SQL |
| Save all query sheets... | Ctrl+Shift+S | `files.saveQuerySheets` with all tabs |
| ─ (separator) | | |
| Navigate Back to Script Line | Ctrl+Alt+Left | Navigate DDL history backward |
| Navigate Forward to Script Line | Ctrl+Alt+Right | Navigate DDL history forward |

### Database Menu

| Item | Accelerator | Submenu / Action |
|------|-------------|------------------|
| Create Object ▶ | | Submenu (see below) |
| Find in Schema... | Ctrl+Shift+F | Open schema search tab and focus the search input |
| Export database... | | Open Schema Export dialog |

**Create Object submenu:**

| Item | Sends to UI |
|------|-------------|
| Table | Open Create Object dialog with type pre-set to TABLE |
| View | VIEW |
| Procedure | PROCEDURE |
| Function | FUNCTION |
| Package | PACKAGE |
| Package Body | PACKAGE BODY |
| Trigger | TRIGGER |
| Sequence | SEQUENCE |
| Type | TYPE |
| Synonym | SYNONYM |

### Tools Menu

| Item | Accelerator | Action |
|------|-------------|--------|
| Settings... | | Open Settings dialog |

### Help Menu

| Item | Action |
|------|--------|
| Check for Updates... | Open Settings dialog → Updates tab |

---

## NavigationView Sidebar

`NavigationView` in `Left` display mode.

**Header area (above nav items):**
- Clarity logo `Image` (32×32)
- Text: "Clarity" (`TextBlock`, semi-bold)

**Navigation items** (`NavigationViewItem`):

| Icon | Label | Panel shown when selected |
|------|-------|--------------------------|
| Plug / connection icon | Connections | Connection Panel |
| Tree / database icon | Explorer | Explorer Panel |
| Play / code icon | Workspace | (activates workspace tab view area) |
| Document / DDL icon | Object | (activates active DDL tab) |
| Gear icon | Settings | (opens Settings dialog) |

**Footer area (below nav items):**
- Label: "CONNECTION" (12px, uppercase, muted color, `TextBlock`)
- Status value: "Offline" / connected schema name (`TextBlock`, semi-bold)
- Provider: "Oracle" or provider name (`TextBlock`, 11px, muted) — shown only when connected
- Active object name (`TextBlock`, 11px, muted, with a `Border` top separator) — shown only when
  an object DDL tab is active

**Selected state:** The active nav item has an accent-color left border indicator (WinUI 3
`NavigationViewItem` default selected visual).

---

## Connection Panel

Shown when the user selects "Connections" in the nav.

### Profile Toolbar

```
[Profile ComboBox ▼]  [Connect / Disconnect Button]  [Edit ✎]  [New +]
```

- **Profile ComboBox** (`ComboBox`): lists all saved profiles by name; placeholder "(No profile
  selected)" when none is selected or list is empty. Width: fill available.
- **Connect Button** (`Button`, primary style):
  - Label: "Connect" when disconnected, "Disconnect" when connected, "Connecting..." while
    connecting. Width: 100px fixed.
  - Disabled when: actively connecting (`busy.connecting`)
- **Edit Button** (`Button`, icon only, tooltip "Edit profile"):
  - Disabled when no profile is selected or connected
- **New Button** (`Button`, icon only, tooltip "New profile"):
  - Always enabled

Clicking Connect → calls `db.connect` with form values.
Clicking Disconnect → calls `db.disconnect`.
Clicking Edit → opens Connection Dialog in edit mode with the selected profile.
Clicking New → opens Connection Dialog in create mode.

### Connection Form

Displayed below the profile toolbar. Fields:

| Control | Type | Label | Placeholder | Notes |
|---------|------|-------|-------------|-------|
| Host | `TextBox` | "Host" | "db.example.com" | Required |
| Service | `TextBox` | "Service" | "XEPDB1" | Required |
| Username | `TextBox` | "Username" | "hr" | Required |
| Schema | `TextBox` | "Schema" | "HR" | Required; uppercased on blur |
| Password | `PasswordBox` | "Password" | | Required |

**Advanced Options** (`Expander`, collapsed by default, header "Advanced options"):
| Control | Type | Label | Default |
|---------|------|-------|---------|
| Port | `NumberBox` | "Port" | 1521, range 1–65535 |
| Auth Mode | `ComboBox` | "Auth mode" | "Normal" / "SYSDBA" |

**Oracle Client Missing InfoBar** (shown only when last connect failed with `oracleClientMissing`):
- `InfoBar` with severity `Error`
- Title: "Oracle Instant Client Required"
- Message: "Oracle Client libraries could not be found. Install Oracle Instant Client to connect."
- Additional `TextBox` labeled "Client Library Directory" (placeholder:
  "/opt/oracle/instantclient")
- `Button` "Retry Connection" — re-attempts `db.connect` with the entered directory passed as
  `oracleClientLibDir`
- `HyperlinkButton` "Download Oracle Instant Client" → opens Oracle download page

**Error message** (`TextBlock`, red): appears below the form when connection fails with a general
error. Hidden when no error.

---

## Connection Dialog

`ContentDialog` opened when creating or editing a profile.

**Title:** "New Connection" (create) / "Edit Connection" (edit)

**Content:**

| Control | Type | Label | Placeholder / Notes |
|---------|------|-------|---------------------|
| Profile Name | `TextBox` | "Profile Name" | Required |
| Host | `TextBox` | "Host" | "db.example.com" |
| Service | `TextBox` | "Service" | "XEPDB1" |
| Username | `TextBox` | "Username" | "hr" |
| Schema | `TextBox` | "Schema" | "HR" |
| Password | `PasswordBox` | "Password" | |
| Save password | `CheckBox` | "Save password in OS keychain" | Default: checked |
| Advanced (`Expander`) | | "Advanced options" | Collapsed by default |
| ↳ Port | `NumberBox` | "Port" | 1521 |
| ↳ Auth Mode | `ComboBox` | "Auth mode" | Normal / SYSDBA |

Oracle Client Missing section (same as above, shown when last attempt failed with
`oracleClientMissing`).

**Error TextBlock** (red): validation or backend errors shown here.

**Primary Button:** "Save" — disabled while saving. Label changes to "Saving..." while in flight.
**Secondary Button:** "Cancel"
**Delete Button** (`Button`, destructive style, shown only in edit mode): "Delete profile..." —
shows confirmation `ContentDialog` before proceeding. Label: "Deleting..." while in flight.

---

## Explorer Panel

Shown when the user selects "Explorer" in the nav.

### Explorer Header

```
Schema Explorer    [HR]
Browse objects...     [Refresh ↺]
```

- `TextBlock` "Database Explorer" (heading, semi-bold)
- Schema chip: `Border` with `TextBlock` showing the connected schema name (or "No schema")
- Status line: `TextBlock` with selected object name or instructional text
- `Button` "Refresh" (icon + label): calls `db.listObjects` + `db.listObjectColumns`
  - Disabled when: not connected, or `busy.loadingObjects`
  - Label: "Refreshing..." while loading

### Object Tree

`TreeView` with two levels:

**Level 1 — Object Type nodes:**
- `TreeViewItem` with: type label (`TextBlock`) + count badge (`Border` with `TextBlock`)
- Count badge: "N" in a rounded rectangle (accent color)
- Clicking: toggle expand/collapse
- Right-click: `MenuFlyout` (see §Explorer Context Menu)

**Level 2 — Object nodes (under each type):**
- `TreeViewItem` with: object name (`TextBlock`) + optional "INVALID" badge
- "INVALID" badge: `Border` (red), `TextBlock` "INVALID", `ToolTip` showing `invalidReason`
- PACKAGE BODY objects: shown as "[Name] (Body)" in display
- Clicking: calls `db.getObjectDdl` and opens/activates DDL tab, then triggers navigation record
- Right-click: `MenuFlyout` (see §Explorer Context Menu)

**Empty state** (`TextBlock`, centered, muted):
"Connect and refresh to load objects for this schema." — shown when not connected or no objects.

**Loading state:** `ProgressRing` (small, centered) shown while `busy.loadingObjects`.

### Explorer Context Menu

`MenuFlyout` appears on right-click.

**On a type group (e.g., TABLE):**
```
Create TABLE...
──────────────
Refresh Explorer
```

**On a TABLE object:**
```
Create TABLE...
──────────────
Drop SCHEMA.NAME...
Drop SCHEMA.NAME (Cascade Constraints)...
Drop SCHEMA.NAME (Cascade + Purge)...
──────────────
Refresh Explorer
```

**On any other object:**
```
Create [TYPE]...
──────────────
Refresh Explorer
```

"Create [TYPE]..." triggers the Create Object dialog with the type pre-filled.
"Drop..." variants trigger the Drop Table confirmation dialog.

---

## Create Object Dialog

`ContentDialog`

**Title:** "Create Object"

**Content:**
- `ComboBox` labeled "Object Type" — items: Table, View, Procedure, Function, Package,
  Package Body, Trigger, Sequence, Type, Synonym
- `TextBox` labeled "Object Name" — placeholder "NEW_OBJECT"
- Help `TextBlock` (muted): "A SQL template will open in a new query sheet for schema [SCHEMA]."
- Error `TextBlock` (red): validation errors

**Primary Button:** "Open Template" — creates a new query tab with the DDL template
**Secondary Button:** "Cancel"

When the type changes and the user hasn't modified the name field: reset the name to a type-
appropriate default (e.g., "NEW_TABLE", "NEW_VIEW"). Once the user manually edits the name,
stop auto-updating it on type change.

---

## Drop Table Confirmation Dialog

`ContentDialog`

**Title:** "Drop Table"

**Content:**
- `TextBlock`: "Are you sure you want to drop [SCHEMA].[NAME]?"
- Variant description:
  - Plain: "This action cannot be undone."
  - Cascade: "This will also drop all dependent constraints."
  - Cascade + Purge: "This will drop dependent constraints and immediately purge the table."

**Primary Button:** "Drop Table" (destructive / red style)
**Secondary Button:** "Cancel"

On confirm: calls `db.runQuery` with the appropriate DROP SQL, then refreshes the explorer.

---

## Query Workspace

Occupies the upper-right area of the main window (above the horizontal splitter).

### Workspace Toolbar

`CommandBar` or `StackPanel` (horizontal) at the top of the workspace area:

| Control | Type | Label / Content | Enabled When | Action |
|---------|------|-----------------|--------------|--------|
| Row limit | `NumberBox` | "Rows" label + number input, 1–10000 | Always | Updates row limit for next execution |
| Execute | `Button` (primary) | "Execute" / "Running..." | Connected + active query tab | `db.runQuery` with current SQL |
| Find | `Button` (icon) | Ctrl+F tooltip | Active query tab | Open editor find panel |
| Begin | `Button` | "Begin" | Connected, no active transaction | `db.beginTransaction` |
| Commit | `Button` | "Commit" | Connected, transaction active | `db.commitTransaction` |
| Rollback | `Button` | "Rollback" | Connected, transaction active | `db.rollbackTransaction` |
| AI Suggest | `Button` | "Suggest" / "Suggesting..." | Connected + AI configured | `ai.suggestQuery` |
| Save DDL | `Button` | "Save DDL" / "Saving..." | Active DDL tab | `db.updateObjectDdl` |

Transaction state chip: `Border` with `TextBlock`:
- "Transaction" (amber background) when `transactionActive`
- "Auto-commit" (neutral) otherwise

Schema chip: `TextBlock` showing connected schema or "No schema".

### Workspace TabView

`TabView` below the toolbar. Tabs:

**Query tabs** (format: "Query N"):
- `TabViewItem` with close button (X); close button hidden when only 1 query tab remains
- Tab content: SQL editor (see §SQL Editor)
- AI suggestion banner above the editor (see §AI Suggestion Banner)
- Selected: underline accent indicator (WinUI 3 default)

**"+" Tab** (always last):
- A fixed tab-like `Button` styled to look like a tab; clicking adds a new query tab
- Not a real `TabViewItem`

**DDL tabs** (format: object name, e.g., "EMPLOYEES"):
- `TabViewItem` with close button
- Loading indicator: pulsing dot (`Ellipse` with animation) while DDL is loading
- Tab content: DDL panel (see §DDL Tab)

**Search tab** (icon + "Search"):
- `TabViewItem` with no close button (always present)
- Tab content: Schema Search Panel (see §Schema Search Panel)

---

## SQL Editor

The SQL editor is the primary input area for query tabs.

**Control choice:** Use a third-party WinUI 3-compatible code editor control with SQL syntax
highlighting support (e.g., `AvalonEdit` for WPF-compatible, or a WebView2-hosted CodeMirror if
a native WinUI control is unavailable). The control must support:
- Line numbers
- SQL syntax highlighting (keywords, strings, numbers, comments)
- Configurable font family and size
- Current line highlighting
- Text selection
- Find/Replace panel (built-in or custom)
- Read/write access to selection and full text from C# code

**Placeholder:** "Write SQL here" — shown when the editor content is empty.

**Keybindings applied to the editor:**
- Execute Query binding (default Ctrl+Enter): trigger query execution
- Find in Editor binding (default Ctrl+F): open find panel
- Ctrl+Space: request AI suggestion (if connected and AI configured)
- Tab (when AI suggestion is pending): accept suggestion
- Escape (when AI suggestion is pending): dismiss suggestion

**Font:** uses `queryEditorFontFamily` and `queryEditorFontSize` from user settings.

---

## AI Suggestion Banner

`InfoBar` placed between the editor toolbar and the editor area. Hidden when no suggestion is
active.

**States:**

| State | Severity | Content |
|-------|----------|---------|
| Generating | Informational | `ProgressRing` (small, inline) + "Generating suggestion..." |
| Available | Informational | Suggestion text + confidence indicator + reasoning line + Apply/Dismiss buttons |
| Mutating warning | Warning | Same as Available but with warning styling |
| Error | Error | Error message text |

**When Available:**
- `TextBlock` with the suggested SQL (monospace font, scrollable if long)
- `TextBlock` confidence: "Confidence: N%" or a `ProgressBar` at N%
- `TextBlock` reasoning: one sentence (muted, smaller)
- `Button` "Apply (Tab)" — inserts suggestion at cursor position, closes banner
- `Button` "Dismiss (Esc)" — closes banner without inserting
- If `isPotentiallyMutating`: `InfoBar` severity changes to Warning, add icon + "This suggestion
  may modify data."

---

## Query Results Area

Occupies the lower-right area (below the horizontal splitter).

### Results Toolbar

`StackPanel` (horizontal) at the top:
- `TextBox` "Search visible result rows" — filters all visible rows across all columns
- `TextBlock` row count: "N rows" / "N filtered rows" / "N of M rows" — updated as filters apply
- `Button` "Clear" — clears search input and all column filters; disabled when nothing to clear
- `Button` "Copy Selection" — copies selected cell range as tab-separated text; disabled when
  nothing selected
- `Button` "Export CSV" — opens save dialog, writes CSV; disabled when no result loaded

### Results TabView

`TabView` (compact/no-close tabs style):
- One `TabViewItem` per result pane: "Result 1", "Result 2", etc.
- Error state: tab header shows red indicator; content area shows error message (`TextBlock`, red)

### Results DataGrid

`DataGrid` (WinUI 3 Community Toolkit `DataGrid` or equivalent):

**Header row:**
- Column headers are clickable for sort
- Sort ascending: "▲" indicator in header; sort descending: "▼"; third click: no indicator
- Column dividers are draggable to resize

**Filter row** (secondary header):
- One `TextBox` per column; typing applies a case-insensitive substring filter on that column

**Data rows:**
- Virtual scrolling: only visible rows rendered
- Right-aligned text for numeric data (detect with: `trim → strip commas → is-numeric regex`)
- Alternating row background (subtle)
- Hover: row highlight
- Click + drag / Shift+click: cell range selection
- Ctrl+C (or system shortcut): copy selection as tab-separated values

**Footer:**
- `TextBlock`: message from `DbQueryResult.message`

**Empty state (`TextBlock`, centered, muted):**
- Before any query: "Run a query to see results."
- After a query with 0 rows: "No rows returned."
- After filtering with 0 matches: "No rows match the current filters."

**Font:** uses `dataFontFamily` and `dataFontSize` from user settings.

---

## DDL Tab

Content of a DDL `TabViewItem`.

### DDL Tab Header

`StackPanel` (horizontal):
- `TextBlock` "[SCHEMA].[OBJECT_NAME]" (semi-bold)
- `TextBlock` "([TYPE])" (muted)
- Status badge `Border`: green "VALID" or red "INVALID"; `ToolTip` shows `invalidReason` if invalid
- `Button` "Refresh Detail" — reloads DDL, data, and metadata for the current object; disabled
  while loading

### Object Detail Tabs

`Pivot` (or `TabView`, compact style) with items:
- "Data" — shown only for TABLE and VIEW objects
- "DDL" — always shown
- "Metadata" — always shown

Switching tabs loads the content on demand (lazy load on first activation).

### DDL Sub-tab

- SQL editor (same control as query editor) with the DDL text
- Read/write: user can edit the text
- "Save DDL" action in the toolbar applies to this editor
- After a successful save: show the save result pane (see §DDL Save Result Pane)

### Data Sub-tab (TABLE / VIEW)

`DataGrid` with the first 500 rows. For TABLE objects, the ROWID column is fetched but hidden.

**Editing (TABLE only):**
- Double-click a cell: enter edit mode (`TextBox` appears in-cell)
- Enter: save edits to the row (calls `db.runQuery` with UPDATE)
- Escape: revert the row's edits
- Row states: clean (default), dirty (yellow background), new (green background), selected (blue)

**Toolbar for editable tables:**
- `Button` "Add Row" — appends a blank draft row
- `TextBlock` "N pending change(s)" — count of dirty + new rows
- `Button` "Delete Selected (N)" — deletes selected rows (calls `db.runQuery` with DELETE for each)
- `Button` "Revert" — discards all pending changes; disabled when no pending changes
- `Button` "Commit" (primary) / "Committing..." — sends all pending changes; disabled when no
  pending changes

**Commit Data Changes keybinding:** triggers the Commit action.

### Metadata Sub-tab

Read-only `DataGrid` with column metadata (for tables/views) or object metadata (for others).
No toolbar. No editing.

### DDL Save Result Pane

After saving DDL, a collapsible `Expander` appears below the DDL editor:
- Title: save result message (e.g., "PROCEDURE HR.HIRE_EMPLOYEE updated successfully.")
- Content: `DataGrid` showing compilation diagnostics (ATTRIBUTE, LINE, POSITION, TEXT columns)
- Hidden before first save attempt

---

## Schema Search Panel

Content of the Search `TabViewItem`.

### Search Input Area

`StackPanel` (vertical):
- `TextBox` "Search term" — full width, placeholder "Search object names, source, and DDL in this
  schema"; Enter key triggers search
- Scope row (`StackPanel` horizontal):
  - `CheckBox` "Object names" (default: checked)
  - `CheckBox` "Source" (default: checked)
  - `CheckBox` "DDL" (default: checked)
- `Button` "Search" — disabled when: no search term, all scopes unchecked, or `busy.searchingSchema`
  Label: "Searching..." while busy

### Search Results

`DataGrid` with columns:
| Column | Content |
|--------|---------|
| Object | `objectName` |
| Type | `objectType` |
| Scope | `matchScope` ("Object Name" / "Source" / "DDL") |
| Line | `line` (or blank if null) |
| Snippet | `snippet` (truncated, monospace) |

Row click: opens object DDL tab at the matching line.

**Empty states:**
- Before search: "Run a schema search to see results." (`TextBlock`, centered, muted)
- After search with 0 matches: "No matches found." (`TextBlock`, centered, muted)
- Search disabled when not connected

---

## Settings Dialog

`ContentDialog` (large, approx. 680×600px) with a `Pivot` for tabs.

**Title:** "Settings"

### Tab 1: Appearance

| Control | Type | Label | Options / Constraints |
|---------|------|-------|-----------------------|
| Theme | `RadioButtons` | "Theme" | "Light" / "Dark" |
| UI Font Family | `TextBox` | "UI Font" | |
| UI Font Size | `NumberBox` | "UI Font Size" | 10–24, integer step |
| Editor Font Family | `TextBox` | "Editor Font" | |
| Editor Font Size | `NumberBox` | "Editor Font Size" | 10–24 |
| Data Font Family | `TextBox` | "Data Font" | |
| Data Font Size | `NumberBox` | "Data Font Size" | 10–24 |

Theme radio changes apply immediately for preview (live `ElementTheme` switch). Reverting (Cancel)
restores the previous theme.

### Tab 2: AI

| Control | Type | Label | Notes |
|---------|------|-------|-------|
| Enable suggestions | `ToggleSwitch` | "Enable suggestions while typing" | |
| AI Model | `TextBox` | "Model" | Placeholder "gpt-4o-mini" |
| Endpoint | `TextBox` | "Endpoint" | Placeholder OpenAI URL |
| API Key | `PasswordBox` | "API Key" | |
| Key status | `TextBlock` | | "Key stored in OS keychain" / "No key configured" |

When the API key field is non-empty on Save: calls `ai.setApiKey`.
When empty on Save (and key was previously set): calls `ai.clearApiKey`.

### Tab 3: Database

| Control | Type | Label | Notes |
|---------|------|-------|-------|
| Oracle Client Dir | `TextBox` | "Oracle Instant Client Directory" | Placeholder: platform path example |
| Help | `TextBlock` | | "Optional. Overrides the ORACLE_CLIENT_LIB_DIR environment variable." |

### Tab 4: Key Bindings

`ListView` with one row per configurable action:

| Column | Content |
|--------|---------|
| Action | Action label (`TextBlock`) |
| Binding | Current binding string (`TextBox` in read-only / recording-active states) |
| Reset | `Button` "Reset" — restores this action's default |

**Recording mode** (entered by clicking the Binding TextBox):
- `TextBox` shows: "Press a key combination..." (placeholder-style)
- App captures the next `KeyDown` event that includes at least one modifier (Ctrl/Shift/Alt)
- Escape while recording: cancel without saving
- Any other key combo: record and show in the TextBox

`Button` "Reset All to Defaults" at the bottom: restores all four actions to defaults.

### Tab 5: Updates

| Control | Description |
|---------|-------------|
| `TextBlock` | "Current version: v{version}" |
| `Button` "Check for Updates" | Calls the GitHub Releases API; label "Checking..." while busy |
| `TextBlock` status | Neutral / success / error, color-coded |
| Update card (`Border`, shown only when update available) | Version, publish date, `TextBlock` release notes (scrollable), `Button` "Download and Install" |

"Download and Install" downloads the update, installs it, and relaunches the app.
Label: "Installing..." while in progress.

### Dialog Footer

- `Button` "Save" (primary) — persists all changes; disabled while saving
- `Button` "Cancel" — reverts all unsaved changes (including theme preview)

---

## Schema Export Dialog

`ContentDialog` (medium size, approximately 520×400px).

**Title:** "Export Database Schema"

**Content:**

| Control | Type | Label | Notes |
|---------|------|-------|-------|
| Database | `ComboBox` | "Database" | Lists connected sessions (usually one entry) |
| Directory | `TextBox` (read-only) + `Button` "Browse..." | "Destination Directory" | Browse triggers `files.pickDirectory` |
| Help | `TextBlock` | | "Exports DDL to .sql files by object type. Data is not exported." |
| Progress | `ProgressBar` (indeterminate while running, hidden otherwise) | | |
| Progress text | `TextBlock` | | "N / M objects (N%)" — updated via `event.schemaExportProgress` |
| Current object | `TextBlock` | | "Current: [OBJECT_TYPE SCHEMA.NAME]" |
| Error / summary | `TextBlock` | | Error in red; summary in neutral after completion |

**Primary Button:** "Export Schema" — calls `db.exportSchema`; disabled until a directory is
selected and a session is chosen; label "Exporting..." while in progress.
**Secondary Button:** "Close" — disabled while exporting.

Progress updates arrive as `event.schemaExportProgress` notifications. The dialog subscribes to
these and updates the `ProgressBar` and text accordingly.

After completion: show `DbSchemaExportResult.message`. If `skippedCount > 0`: add note "See
export_warnings.log for skipped objects."

---

## Status Chips

Used in the toolbar and header to show connection state at a glance.

| Chip | When shown | Style |
|------|------------|-------|
| "Connected" | When a session is active | Green `Border` |
| "Offline" | When not connected | Gray `Border` |
| "Oracle Database" | When connected (provider label) | Neutral `Border` |
| "HR" (schema name) | When connected | Neutral `Border` |
| "Transaction" | When `transactionActive` | Amber `Border` |
| "Auto-commit" | When connected, not in transaction | Neutral `Border` |

All chips are `Border` + `TextBlock` with rounded corners. Not interactive.

---

## Pane Layout

Two user-resizable splitters:

**Vertical splitter** (between NavigationView content pane and workspace):
- `GridSplitter` with `ResizeDirection = Columns`
- Minimum sidebar width: 300px
- Maximum sidebar width: window width − 560px (ensures workspace has at least 560px)
- Default sidebar width: 350px

**Horizontal splitter** (between workspace and results):
- `GridSplitter` with `ResizeDirection = Rows`
- Minimum workspace height: 320px
- Minimum results height: 170px
- Default: 70% workspace / 30% results

Splitter positions are not persisted across app restarts (reset to defaults on launch).

---

## Theming

Apply the user's theme setting to `Application.RequestedTheme` or `FrameworkElement.RequestedTheme`:
- `"light"` → `ElementTheme.Light`
- `"dark"` → `ElementTheme.Dark`

The app follows Windows system theme by default; the user setting overrides it.

Font settings are applied as CSS-like variables using XAML `Style` resources or directly on
container elements:
- UI font: `FontFamily` and `FontSize` on the root `Grid` or `Application.Resources`
- Editor font: set on the code editor control instance
- Data font: set on all `DataGrid` instances via a shared `Style`

---

## Accessibility

- All interactive controls must have accessible names (`AutomationProperties.Name`)
- Use `ToolTip` for icon-only buttons
- Keyboard navigation must work for all dialogs (Tab order, Enter/Escape on dialogs)
- High contrast mode is handled automatically by WinUI 3 system brushes; do not override colors
  with hardcoded values — use semantic brushes (`SystemFillColorCriticalBackgroundBrush`, etc.)
