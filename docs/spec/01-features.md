# Clarity — Feature Catalog

Platform-agnostic description of every feature. For each feature: what triggers it, what the user
experiences, what the backend does, and how errors are handled. Use this as an acceptance checklist
when verifying a new implementation.

---

## 1. Connection Management

### 1.1 Connection Profiles (CRUD)

**What it is:** Named connection configurations saved to disk so users don't re-enter credentials.

**Create:**
- User fills in connection form (host, service, username, schema, password) and gives it a name
- User optionally checks "Save password in OS keychain"
- On save: backend validates all required fields, writes profile JSON to disk, optionally stores
  password in keychain
- UI adds the new profile to the profile dropdown and selects it

**Read / Select:**
- On app launch: load the profile list and re-select the last-used profile ID from settings
- On profile selection: populate connection form fields with stored values
- If the profile has a saved password: retrieve it from the keychain and populate the password field
- If retrieval fails silently: leave password blank

**Update:**
- Same flow as Create but with an existing profile ID; replaces the stored record in place

**Delete:**
- User confirms deletion via a confirmation dialog
- Backend removes the profile from disk and clears the keychain entry
- UI clears the selection and resets the form

**Error states:**
- Save: profile name is required; backend validation errors shown inline
- Delete: "Profile not found" (should not occur in normal use)
- Keychain read failure: show status message but allow the user to enter password manually

### 1.2 Profile Selection and Application

- The profile dropdown shows all saved profiles by name
- Selecting a profile populates the connection form (without connecting)
- The "Connect" button remains the explicit connect trigger
- The last-used profile ID is stored in user settings and restored on next launch

---

## 2. Oracle Connection

### 2.1 Connect

**Trigger:** User clicks the Connect button or presses Enter in the connection form.

**Backend steps:**
1. Validate inputs (host, username, password, serviceName, schema non-empty; schema is valid Oracle
   identifier)
2. Initialize Oracle Client libraries (search order: explicit dir → env var → platform paths)
3. Connect: `//host:port/service_name` with auth mode
4. Execute `ALTER SESSION SET CURRENT_SCHEMA = {SCHEMA}`
5. Return session summary (sessionId, displayName, schema, provider)

**UI on success:**
- Update status chips (Connected, Oracle, schema name)
- Load the object tree (call `db.listObjects` and `db.listObjectColumns`)
- Update the first query tab's default SQL to use the connected schema
- Enable all workspace actions that require a connection

**UI on error:**
- If `oracleClientMissing`: show the Oracle Client Missing panel (see §2.3)
- Otherwise: show the error message in the connection panel; do not change connection state

### 2.2 Disconnect

**Trigger:** User clicks the Disconnect button while connected.

**Backend:** Removes the session from the session map (implicitly closes the DB connection).

**UI on disconnect:**
- Clear the object tree
- Clear all DDL tabs
- Close schema search results
- Reset active tab to the first query tab
- Update status chips to Offline / no schema
- Disable connection-required actions

### 2.3 Oracle Client Missing

When connection fails with `oracleClientMissing`:
- Show a warning panel inside the connection form (not a blocking dialog)
- Panel content:
  - Heading: "Oracle Instant Client Required"
  - Explanation: Oracle Client libraries must be installed
  - Link: Oracle Instant Client download page
  - Text field: "Oracle Client Library Directory" (optional override)
  - Button: "Retry Connection" — re-attempts connect with the given directory
- The directory entered here is used only for the retry; persisting it to settings requires the
  user to save it in the Oracle settings tab

### 2.4 Auth Mode

- Normal mode: standard authentication using username + password
- SYSDBA mode: uses `oracle::AuthMode::SysDba`; displayed as "username as SYSDBA" in the session
  display name

---

## 3. Schema Explorer

### 3.1 Object Tree

- Displays all schema objects grouped by type: TABLE, VIEW, PROCEDURE, FUNCTION, PACKAGE,
  PACKAGE BODY, TRIGGER, SEQUENCE (in alphabetical type order)
- Each type group shows a count badge (e.g., "TABLE  12")
- PACKAGE BODY objects are grouped under PACKAGE in the tree display (both types still shown)
- Groups are collapsible; state is not persisted (reset on reconnect)

### 3.2 Invalid Object Indicators

- Objects with `status == "INVALID"` show a red "INVALID" badge
- Hovering the badge shows a tooltip with `invalidReason` (compiler error details)

### 3.3 Object Selection and Opening

- Clicking an object in the tree selects it and opens its DDL tab in the workspace
- If a DDL tab for that object already exists, activate it (do not reload)
- Navigation is recorded in DDL history (see §10)

### 3.4 Refresh

- "Refresh" button reloads the object list and column metadata from the database
- Updates all DDL tab object references (status, invalid reason) to match the refreshed data
- Disabled when not connected or already loading

### 3.5 Context Menu

Right-clicking a type group or object opens a context menu:

**On a type group:**
- "Create [TYPE]..." → opens the Create Object dialog (see §15)
- "Refresh Explorer" → same as the Refresh button

**On a TABLE object:**
- "Create TABLE..." → Create Object dialog
- (separator)
- "Drop [SCHEMA.NAME]..." → Drop Table dialog (see §16), no options
- "Drop [SCHEMA.NAME] (Cascade Constraints)..." → Drop Table with CASCADE CONSTRAINTS
- "Drop [SCHEMA.NAME] (Cascade + Purge)..." → Drop Table with CASCADE CONSTRAINTS + PURGE
- (separator)
- "Refresh Explorer"

**On any non-TABLE object:**
- "Create [TYPE]..." → Create Object dialog
- (separator)
- "Refresh Explorer"

---

## 4. SQL Query Editor

### 4.1 Multi-Tab Query Sheets

- The workspace supports multiple named query tabs, each with its own SQL text and result panes
- Default first tab: "Query 1" with `select object_name, object_type from all_objects where owner = '{SCHEMA}' order by object_type, object_name fetch first 100 rows only`
- Additional tabs created via the "+" button; named "Query N" with incrementing N
- Minimum 1 tab (cannot close the last tab)
- Query tabs and their SQL content persist across app restarts (stored in app local state)

### 4.2 SQL Syntax Highlighting

- Keywords, string literals, numbers, comments highlighted in distinct colors
- Dark and light theme variants

### 4.3 Schema-Aware Autocomplete

- After connecting, the editor provides autocomplete for table names, view names, and column names
- Column completions are scoped to the referenced table when the table is already in the FROM clause
- Triggered by the standard editor autocomplete key (typically Ctrl+Space or Tab after a prefix)

### 4.4 Query Execution

**Trigger:** Execute keybinding (default: Ctrl+Enter) or the Execute button.

If text is selected: execute only the selected text. Otherwise execute the entire editor content.

**Multi-statement splitting:**
1. Split on `;` while respecting string literals (single and double quoted), block comments
   (`/* ... */`), and line comments (`-- ...`)
2. Normalize each statement: strip trailing `;`, preserve BEGIN/DECLARE blocks intact
3. If any statement starts with a non-standalone keyword (`END`, `EXCEPTION`, `WHEN`, `ELSE`,
   `ELSIF`, `LOOP`, `THEN`), fall back to executing the full text as a single statement
4. Filter out comment-only fragments

**Execution:**
- One result pane is created per statement
- Statements execute sequentially; on error, stop and mark the failed pane with the error
- Each result pane tracks the source SQL, session ID, and row limit used

### 4.5 Row Limit

- Configurable per session (not persisted); default 1000, max 10,000
- Shown as a number input in the toolbar
- Applied to all SELECT queries in the session
- Clamped silently to [1, 10,000]

---

## 5. Query Results

### 5.1 Result Panes

- Each executed statement gets its own result pane tab
- Pane title: "Result N" where N is the pane number within the tab
- All-time pane list replaces previous panes on re-execution

### 5.2 Results Table

- Column headers: fixed, showing column names from the query
- Column widths: resizable by dragging the column divider in the header
- Sort: click header to cycle asc → desc → no sort; sort indicator shown in header

### 5.3 Per-Column Filtering

- A secondary header row below column names contains one text input per column
- Typing in a column filter input applies a case-insensitive substring match to that column
- Filtering is client-side on the loaded result set (does not re-execute the query)

### 5.4 Global Search

- A search box above the table applies a case-insensitive substring match across all columns
  simultaneously (OR logic: row passes if any column matches)
- Row count updates to show "N filtered rows" or "N of M rows"

### 5.5 Virtual Scrolling

- Only the visible rows are rendered; the table supports datasets up to the row limit without
  performance degradation

### 5.6 Cell Selection and Copy

- Click a cell to start a selection; click+drag or Shift+click to extend to a range
- Copy selection (Ctrl+C or button): outputs tab-separated values, rows separated by newlines
  (standard spreadsheet copy format)

### 5.7 CSV Export

- "Export CSV" button opens a save dialog pre-filled with `"{tab title}-{timestamp}.csv"`
- All rows in the current (filtered) result are written, including the header row
- Field values are quoted if they contain commas, quotes, or newlines

### 5.8 Result Messages

- Below the table: message from `DbQueryResult.message`, e.g., "Query executed. Returned 42 row(s)."
- Execution time may be tracked by the UI layer and appended if desired

### 5.9 Error Display

- If a pane has an error, show the error message in the pane header area (red text)
- The table area is empty or shows a "Query failed" placeholder

---

## 6. Object DDL View and Edit

### 6.1 Opening an Object

- Clicking an object in the explorer (or a search result) opens a DDL tab
- DDL is fetched asynchronously; a loading indicator shows while fetching
- The tab title is the object name

### 6.2 DDL Tab Contents

- A toolbar showing: object name, type, status badge ("VALID"/"INVALID"), "Refresh Detail" button
- Sub-tabs: Data (TABLE/VIEW only), DDL, Metadata (see §7 and §8)
- SQL editor with the DDL text (editable)
- The DDL editor supports the same syntax highlighting as the query editor

### 6.3 Saving DDL

- "Save DDL" button (or keybinding, default: Ctrl+S) submits the edited DDL to the backend
- Backend adds `CREATE OR REPLACE` prefix if not present (for source objects)
- Backend commits the change (any open transaction is ended)
- Backend returns compilation diagnostics as a `DbQueryResult`:
  - If successful: status message "OBJECT updated successfully."
  - If errors/warnings: diagnostic rows are shown in the "Save Result" pane
- After save: the object tree is refreshed to pick up status changes

### 6.4 DDL Navigation History

See §10.

---

## 7. Object Data Tab

### 7.1 Data Preview

- Available for TABLE and VIEW objects only
- Fetches up to 500 rows: for TABLE, includes `rowidtochar(t.rowid)` as a hidden first column
- The ROWID column is hidden from the user but used for row identification during edits

### 7.2 Editable Data (TABLE only)

- Tables with ROWID support in-grid editing
- **Edit a cell:** double-click (or press Enter with row selected) enters edit mode
- **Save row:** press Enter or click away from the row; triggers an UPDATE via ROWID
- **Revert row:** press Escape discards changes to the row
- **Add row:** "Add Row" button adds a draft row at the bottom; fill cells and commit
- **Delete row:** select one or more rows and click "Delete Selected (N)"; triggers DELETE via ROWID
- **Commit changes:** "Commit" button (or keybinding, default Ctrl+Shift+S) sends pending changes
- **Revert all:** Escape or "Revert" button discards all uncommitted changes

**Row states (visual):**
- Clean: default background
- Dirty (modified): yellow highlight
- New (added): green highlight
- Selected: blue highlight

### 7.3 SQL Generation for Data Operations

UPDATE:
```sql
UPDATE "SCHEMA"."TABLE" SET "COL1" = 'val1', "COL2" = 'val2'
WHERE rowidtochar(rowid) = 'AAAx...'
```

INSERT (only non-empty columns):
```sql
INSERT INTO "SCHEMA"."TABLE" ("COL1", "COL2") VALUES ('val1', NULL)
```
(Empty string → NULL for INSERT; non-empty string → quoted literal)

DELETE:
```sql
DELETE FROM "SCHEMA"."TABLE" WHERE rowidtochar(rowid) = 'AAAx...'
```

All identifiers are double-quoted; all values are single-quoted with `'` escaped as `''`. Empty
string values become `NULL` in INSERT; in UPDATE they become `NULL` as well (via `toSqlDataLiteral`).

### 7.4 Refresh

"Refresh Detail" re-fetches the data preview. If the table has been modified by the user or
another session, the fresh rows replace the current view.

---

## 8. Object Metadata Tab

### 8.1 Tables and Views

Runs:
```sql
SELECT column_id, column_name, data_type, data_length, data_precision, data_scale, nullable,
       data_default
FROM all_tab_columns
WHERE owner = '{SCHEMA}' AND table_name = '{NAME}'
ORDER BY column_id
```
Displayed as a read-only grid.

### 8.2 Other Object Types

Runs:
```sql
SELECT owner, object_name, object_type, status, created, last_ddl_time
FROM all_objects
WHERE owner = '{SCHEMA}' AND object_name = '{NAME}' AND object_type = '{TYPE}'
```
Displayed as a read-only grid.

---

## 9. Schema Text Search

### 9.1 Search Input

- Text input for the search term (required, non-empty to search)
- Three scope checkboxes (all checked by default):
  - "Object names" — searches `ALL_OBJECTS.OBJECT_NAME`
  - "Source" — searches `ALL_SOURCE.TEXT` for PROCEDURE/FUNCTION/PACKAGE/TRIGGER/TYPE
  - "DDL" — searches `DBMS_METADATA.GET_DDL` output line-by-line
- At least one scope must be checked to enable the Search button

### 9.2 Results Display

- Results shown in a table with columns: Object, Type, Scope, Line, Snippet
- Maximum 500 results returned from the backend (first 500 across all scopes)
- "No matches found." shown when search returns empty
- "Run a schema search to see results." shown before any search is performed

### 9.3 Opening a Result

- Clicking a result row opens the object's DDL tab (or activates it if already open)
- If `line` is set: the editor scrolls to and highlights that line
- Navigation is recorded in DDL history (see §10)

---

## 10. DDL Navigation History

### 10.1 Back and Forward

- The app maintains a back stack and a forward stack of script line locations
- Each entry records: object reference (schema, type, name) + optional line number
- Maximum 200 entries per stack

### 10.2 What Triggers a History Entry

A navigation is recorded when:
- User opens an object from the Explorer (records the previous location → back stack)
- User opens a schema search result (records the previous location → back stack)

Going back:
1. Pop from back stack → target location
2. Load DDL at target (scrolling to line if present)
3. Push former current location → forward stack

Going forward:
1. Pop from forward stack → target location
2. Load DDL at target
3. Push former current location → back stack

Opening a new object from the explorer clears the forward stack.

### 10.3 Deduplication

Consecutive identical locations (same object + same line) are not added to the stack.

### 10.4 Cleanup

When a DDL tab is closed:
- All entries referencing that object are removed from both the back and forward stacks

---

## 11. Transaction Management

### 11.1 Explicit Transactions

Three toolbar buttons (disabled when disconnected):
- **Begin**: sets `transaction_active = true` (the next DML will implicitly begin the Oracle
  transaction). Button disabled while a transaction is active.
- **Commit**: calls `db.commitTransaction`. Button disabled when no transaction is active.
- **Rollback**: calls `db.rollbackTransaction`. Button disabled when no transaction is active.

### 11.2 Automatic State Sync

After every query execution (`db.runQuery`), the UI calls `db.getTransactionState` to sync
`transactionActive`. This catches implicit BEGIN/COMMIT/ROLLBACK inside executed SQL.

### 11.3 Status Indicator

A chip in the header/toolbar shows:
- "Transaction" (orange/amber) — when a transaction is active
- "Auto-commit" (neutral) — when no transaction is active

---

## 12. Schema Export

### 12.1 Starting an Export

- "Export" button in the header opens the Schema Export dialog
- Available only when connected

### 12.2 Export Flow

1. User selects the destination directory via the "Browse..." button (native folder picker)
2. User clicks "Export Schema"
3. Progress bar and object name display update as each object is processed
4. On completion: summary message shows object count, file count, skipped count
5. If any objects were skipped: an `export_warnings.log` is written to the output directory

### 12.3 Output Format

- One `.sql` file per object, organized in subdirectories by type:
  `tables/`, `views/`, `procedures/`, `functions/`, `packages/`, `package_body/`,
  `triggers/`, `sequences/`, `types/`, `synonyms/`
- File name is the object name (sanitized for the filesystem)
- File content is the DDL text, trimmed, with a trailing newline
- Data rows are not exported

---

## 13. Query Sheet Persistence

### 13.1 What is Persisted

Across app restarts, the following are restored:
- All open query tab IDs, titles, and SQL content
- The active tab ID

### 13.2 Persistence Storage

- C# host stores in a JSON file in the app's local state directory
- File: `clarity-query-sheets.v1.json`
- Written on every change (debounced is acceptable)

### 13.3 Restore Behavior

On startup:
1. Read the JSON file
2. Validate each tab record (ID format, non-empty)
3. Restore valid tabs; skip malformed records
4. If no valid tabs: create a default "Query 1" tab
5. Restore the active tab (or default to the first tab)
6. Restore the next tab counter (must exceed all existing tab numbers)

---

## 14. SHOW Commands

The backend intercepts these SQL strings before sending to Oracle:

| SQL | Backend behavior |
|-----|-----------------|
| `SHOW CON_NAME` | Queries `SYS_CONTEXT('USERENV', 'CON_NAME')` |
| `SHOW USER` | Queries `USER` from DUAL |
| `SHOW PDBS` | Queries `V$PDBS` |
| `SHOW PARAMETER [filter]` | Queries `V$PARAMETER` with optional filter |

These are case-insensitive. Results are returned as normal `DbQueryResult` objects.

---

## 15. Create Object Templates

### 15.1 Trigger

"Create [TYPE]..." from the context menu, or the Database menu.

### 15.2 Object Types Supported

TABLE, VIEW, PROCEDURE, FUNCTION, PACKAGE, PACKAGE BODY, TRIGGER, SEQUENCE, TYPE, SYNONYM

### 15.3 Flow

1. The Create Object dialog opens (object type + name fields)
2. The object name is normalized: invalid Oracle identifier characters replaced with `_`;
   prefix `_` if name starts with a digit; uppercased
3. A new query tab is created titled "Create [TYPE]: [NAME]"
4. The tab's SQL is populated with a pre-written template for the type

### 15.4 Templates

Each template is a minimal, valid Oracle DDL statement that a developer can start editing:

| Type | Template pattern |
|------|-----------------|
| TABLE | `CREATE TABLE "SCHEMA"."NAME" (id NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at TIMESTAMP DEFAULT SYSTIMESTAMP)` |
| VIEW | `CREATE OR REPLACE VIEW "SCHEMA"."NAME" AS SELECT * FROM DUAL` |
| PROCEDURE | `CREATE OR REPLACE PROCEDURE "SCHEMA"."NAME" AS BEGIN NULL; END "NAME";` |
| FUNCTION | `CREATE OR REPLACE FUNCTION "SCHEMA"."NAME" RETURN NUMBER AS BEGIN RETURN NULL; END "NAME";` |
| PACKAGE | `CREATE OR REPLACE PACKAGE "SCHEMA"."NAME" AS PROCEDURE run; END "NAME";` |
| PACKAGE BODY | `CREATE OR REPLACE PACKAGE BODY "SCHEMA"."NAME" AS PROCEDURE run AS BEGIN NULL; END run; END "NAME";` |
| TRIGGER | `CREATE OR REPLACE TRIGGER "SCHEMA"."NAME" BEFORE INSERT ON "SCHEMA"."TABLE_NAME" FOR EACH ROW BEGIN NULL; END;` |
| SEQUENCE | `CREATE SEQUENCE "SCHEMA"."NAME" START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE` |
| TYPE | `CREATE OR REPLACE TYPE "SCHEMA"."NAME" AS OBJECT (id NUMBER)` |
| SYNONYM | `CREATE OR REPLACE SYNONYM "SCHEMA"."NAME" FOR "SCHEMA"."OBJECT_NAME"` |

---

## 16. Drop Table

### 16.1 Variants

Three context menu options for TABLE objects:
1. Plain drop: `DROP TABLE "SCHEMA"."NAME"`
2. Cascade: `DROP TABLE "SCHEMA"."NAME" CASCADE CONSTRAINTS`
3. Cascade + Purge: `DROP TABLE "SCHEMA"."NAME" CASCADE CONSTRAINTS PURGE`

### 16.2 Flow

1. User selects a drop variant from the context menu
2. A confirmation dialog appears: "Drop [SCHEMA.NAME]?" with a description of the variant
3. User confirms
4. Backend executes the DROP via `db.runQuery`
5. On success: close any open DDL tab for the table, remove from navigation history, refresh
   the object tree
6. Status message: "[SCHEMA.NAME]: DDL executed."

---

## 17. AI Query Suggestions

### 17.1 Prerequisites

- AI suggestions must be enabled in Settings
- An AI API key must be configured (stored in keychain)
- The user must be connected to a database
- The query editor must have non-empty content

### 17.2 Auto-Suggest

- After the user stops typing for ~700ms, the UI automatically requests a suggestion
- The request includes:
  - The current SQL text
  - The connected schema name
  - Schema context: up to 120 objects (tables/views with column lists), marking which are
    referenced in the current SQL
  - The SQL clause at the cursor position (e.g., "WHERE", "SELECT")

### 17.3 Manual Trigger

- Ctrl+Space (or configured keybinding) requests a suggestion immediately

### 17.4 Suggestion Display

- A banner appears below the toolbar (or inline at the cursor) showing:
  - The suggested SQL text
  - Confidence level (as a percentage or bar)
  - One-sentence reasoning
  - Warning badge if `isPotentiallyMutating == true`
  - "Apply (Tab)" button
  - "Dismiss (Esc)" button
- "Generating suggestion..." placeholder shown while loading

### 17.5 Accepting / Dismissing

- Tab key (or "Apply" button): insert the suggestion text at the current cursor position
- Esc (or "Dismiss" button): close the suggestion banner without inserting

### 17.6 Error States

- If the AI request fails: show the error message in the suggestion banner (not a dialog)
- If the endpoint or model is not configured: disable AI features and show a hint in the banner

---

## 18. Application Settings

### 18.1 Settings Dialog Tabs

**Appearance:**
- Theme: Light / Dark radio buttons (changes apply immediately for preview; reverted on Cancel)
- UI Font Family: text input with examples
- UI Font Size: numeric input, 10–24 px
- Query Editor Font Family: text input
- Query Editor Font Size: numeric input, 10–24 px
- Data View Font Family: text input
- Data View Font Size: numeric input, 10–24 px

**AI:**
- Enable suggestions while typing: checkbox
- AI Model: text input (e.g., "gpt-4o-mini")
- Endpoint URL: text input
- API Key: password input
- Status: "Key stored in OS keychain" / "No key configured" / "Key saved successfully"

**Database:**
- Oracle Instant Client Directory: text input (optional override for `ORACLE_CLIENT_LIB_DIR`)

**Key Bindings:**
- Table of four bindable actions: Execute Query, Save DDL, Find in Editor, Commit Data Changes
- Each row: action label, current binding string, "Reset" button
- Click the binding field → enter recording mode ("Press a key combination...")
- Press Escape → cancel recording
- Press any key combination → record and display it
- "Reset All to Defaults" button restores all bindings

**Updates:**
- Current version display
- "Check for Updates" button
- Status messages: checking / up-to-date / error / update available
- If update available: version, publish date, release notes, "Download and Install" button

### 18.2 Save / Cancel

- "Save" applies all changes permanently (writes settings file, sets keychain entry)
- "Cancel" reverts all unsaved changes, including the theme preview

---

## 19. Auto-Updater

### 19.1 Check Mechanism

- The app checks the latest GitHub Release JSON: `https://github.com/brend/clarity/releases/latest/download/latest.json`
- This happens when the user clicks "Check for Updates" in Settings
- The check runs on a background thread; the UI shows "Checking..." during the request

### 19.2 Update Found

If the remote version is newer than the running version:
- Show an update card with: version number, published date, release notes
- "Download and Install" button initiates download
- Progress indicator during download
- On completion: app relaunches with the new version installed

### 19.3 No Update

If the running version is current:
- Show: "Clarity {version} is already up to date."

### 19.4 Error

If the check fails (network error, parse error):
- Show the error message in the Updates tab
- Do not crash; the user can retry

---

## 20. Key Bindings

### 20.1 Configurable Actions

| Action | Default Binding |
|--------|-----------------|
| Execute Query | Ctrl+Enter |
| Save DDL | Ctrl+S |
| Find in Editor | Ctrl+F |
| Commit Data Changes | Ctrl+Shift+S |

### 20.2 Recording New Bindings

- Click the binding field for an action to enter recording mode
- Any subsequent key combination (modifier + key) is captured and saved
- Escape cancels recording without saving
- Bindings are stored in the user settings JSON as strings in the format `"Ctrl+Shift+Enter"`

### 20.3 Application

- The SQL editor uses the configured Execute Query binding instead of a hardcoded one
- The DDL save button's keybinding hint updates to reflect the configured binding
- The Find in Editor binding opens the editor search panel
- The Commit Data Changes binding triggers the data grid commit in the Data tab

### 20.4 Non-Configurable Bindings

The following are fixed and are not exposed for user customization:
- Ctrl+Alt+Left: Navigate Script Line Back
- Ctrl+Alt+Right: Navigate Script Line Forward
- Ctrl+Shift+F: Open Schema Search
- Ctrl+S (app menu): Save active query sheet to disk
- Ctrl+Shift+S (app menu): Save all query sheets to disk
