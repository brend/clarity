# Clarity — CLAUDE.md

Clarity is a Tauri v2 desktop database client targeting Oracle as the primary platform, with scaffolding for Postgres, MySQL, and SQLite. It is a single-window app with a SQL workbench UI.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Vue 3 + TypeScript, Vite, CodeMirror 6 |
| Backend | Rust (Tauri v2) |
| IPC | Tauri `invoke` commands |
| DB driver | `oracle` crate (Rust) |
| Secrets | `keyring` crate — OS keychain |
| Auto-update | `tauri-plugin-updater` against GitHub Releases |

## Project layout

```
src/                        Vue frontend
  App.vue                   Root component (single-page shell)
  main.ts                   Entry point
  components/               UI components
    ConnectionDialog.vue
    ExplorerSidebar.vue
    QueryResultsPane.vue
    SqlCodeEditor.vue
    WorkbenchHeader.vue
    WorkbenchSidebarNav.vue
    WorkbenchSummaryCards.vue
    WorkspaceSheet.vue
  composables/
    useClarityWorkspace.ts  ALL frontend state and business logic (large file)
    useKeyBindings.ts       User-configurable key bindings
    usePaneLayout.ts        Pane sizing logic
    useUserSettings.ts      Persisted user settings
  constants/
    createObjectTemplates.ts  SQL CREATE templates per object type
  services/
    updater.ts              Auto-update integration
  types/
    clarity.ts              Shared TypeScript types (canonical source of truth)
    settings.ts             Settings types

src-tauri/src/              Rust backend
  lib.rs                    App bootstrap, invoke_handler registration
  main.rs                   Binary entry point
  commands.rs               All #[tauri::command] handlers
  providers/
    mod.rs                  ProviderRegistry trait + dispatch
    oracle.rs               Oracle implementation (only real one)
  ai.rs                     AI query suggestion (calls external API)
  files.rs                  File pick/save/export helpers
  menu.rs                   Native app menu
  profiles.rs               Connection profile persistence + keychain
  state.rs                  AppState (session map, atomic counters)
  types.rs                  Rust-side types (mirror of clarity.ts)
  validation.rs             Input validation for commands

scripts/
  sync-version.js           Keeps version in sync across package.json,
                            Cargo.toml, and tauri.conf.json
```

## Key architectural patterns

### IPC boundary
Every backend capability is a named Tauri command registered in `lib.rs`. The frontend calls them via `invoke<ReturnType>("command_name", { request: ... })`. The request/response shapes are defined in both `src/types/clarity.ts` (TS) and `src-tauri/src/types.rs` (Rust) — keep them in sync manually.

### Frontend state
All workspace state lives in the `useClarityWorkspace()` composable (`src/composables/useClarityWorkspace.ts`). It is instantiated once in `App.vue` and passed down as props or provided via the composable. There is no Pinia/Vuex store.

Query sheet state (tab titles, SQL text, active tab) is persisted to `localStorage` under the key `clarity.query-sheets.v1` and restored on startup.

### Provider registry
`ProviderRegistry` in `src-tauri/src/providers/mod.rs` dispatches to the correct provider implementation. Currently only `oracle.rs` is real; Postgres/MySQL/SQLite are stubs. Sessions are stored in `AppState.sessions: Mutex<HashMap<u64, AppSession>>`.

### Connection profiles
Profiles are stored as JSON in the Tauri app data directory (no passwords). Passwords are stored separately in the OS keychain via `profiles::write_profile_secret` / `read_profile_secret`. Dev defaults can be set via `.env` (VITE_ORACLE_* vars) — these are never used in production builds.

### Data editing
Table rows in the Data tab are fetched with `rowidtochar(t.rowid) as "__CLARITY_ROWID__"` prepended. Updates and deletes are keyed by this rowid. The ROWID column is stripped from the visible result grid.

### SQL splitting
`splitQueryTextForExecution()` in `useClarityWorkspace.ts` handles multi-statement execution: it parses semicolons while respecting string literals and comments, and falls back to running the whole buffer as one statement when it detects PL/SQL block constructs (BEGIN/DECLARE).

## Commands reference

Every command exposed to the frontend:

| Command | Rust handler | Notes |
|---|---|---|
| `db_connect` | `commands::db_connect` | Returns `DbSessionSummary` with session ID |
| `db_disconnect` | `commands::db_disconnect` | Removes session from map |
| `db_list_objects` | `commands::db_list_objects` | All schema objects |
| `db_list_object_columns` | `commands::db_list_object_columns` | Column metadata |
| `db_run_query` | `commands::db_run_query` | Returns rows + message |
| `db_run_query_filtered` | `commands::db_run_query_filtered` | With server-side filter |
| `db_get_transaction_state` | `commands::db_get_transaction_state` | |
| `db_begin_transaction` | `commands::db_begin_transaction` | |
| `db_commit_transaction` | `commands::db_commit_transaction` | |
| `db_rollback_transaction` | `commands::db_rollback_transaction` | |
| `db_search_schema_text` | `commands::db_search_schema_text` | Object names, source, DDL |
| `db_get_object_ddl` | `commands::db_get_object_ddl` | |
| `db_update_object_ddl` | `commands::db_update_object_ddl` | Execute DDL + refresh |
| `db_list_connection_profiles` | `commands::db_list_connection_profiles` | |
| `db_save_connection_profile` | `commands::db_save_connection_profile` | Upsert by ID |
| `db_delete_connection_profile` | `commands::db_delete_connection_profile` | |
| `db_get_connection_profile_secret` | `commands::db_get_connection_profile_secret` | Reads keychain |
| `db_has_ai_api_key` | `commands::db_has_ai_api_key` | |
| `db_set_ai_api_key` | `commands::db_set_ai_api_key` | |
| `db_clear_ai_api_key` | `commands::db_clear_ai_api_key` | |
| `db_ai_suggest_query` | `commands::db_ai_suggest_query` | Async, calls external AI |
| `db_pick_directory` | `commands::db_pick_directory` | Native folder picker |
| `db_save_query_sheet` | `commands::db_save_query_sheet` | Save single .sql file |
| `db_save_query_sheets` | `commands::db_save_query_sheets` | Save all tabs to folder |
| `db_export_schema` | `commands::db_export_schema` | Export all schema DDL |

## Testing

```bash
npm run test              # Vitest unit tests (run once)
npm run test:watch        # Vitest in watch mode
npm run test:coverage     # With lcov coverage
npm run test:e2e          # Playwright E2E (headless)
npm run test:e2e:headed   # Playwright with browser visible
```

Unit tests live alongside source files (`*.test.ts`). E2E specs are in `e2e/`.

Rust tests: `cd src-tauri && cargo test`. CI enforces a line-coverage gate of ≥18% via `cargo llvm-cov --fail-under-lines 18`.

## Build and run

```bash
# Development (requires Oracle Instant Client)
export ORACLE_CLIENT_LIB_DIR=/opt/homebrew/lib/instantclient_23_3
npm run tauri dev

# Frontend only (no Tauri)
npm run dev

# Production build
npm run build             # TypeScript check + Vite bundle
cd src-tauri && cargo check
npm run tauri build       # Full Tauri bundle
```

## Version management

Version must be kept consistent across three files:
- `package.json` — `version`
- `src-tauri/Cargo.toml` — `[package] version`
- `src-tauri/tauri.conf.json` — `version`

Use `npm version <patch|minor|major>` which triggers `scripts/sync-version.js` to propagate the change and stage all three files automatically.

## CI/CD

- **CI** (`.github/workflows/ci.yml`): runs on push/PR to `main`. Runs Vitest with coverage, Playwright E2E, Vue frontend build, `cargo check`, and `cargo llvm-cov` Rust coverage gate.
- **Release** (`.github/workflows/release.yml`): triggered by a `v*` tag push. Builds Tauri bundles for Linux/macOS/Windows, creates a draft GitHub Release with signed updater artifacts. Publish the draft to make the update visible to installed apps.

Required GitHub secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Oracle runtime requirement

Oracle Instant Client must be available at runtime. If missing, connections fail with `DPI-1047`. Configure via `Tools → Settings → Oracle` in the app, or set `ORACLE_CLIENT_LIB_DIR` before launching.

## Notable constants (frontend)

| Constant | Value | Purpose |
|---|---|---|
| `QUERY_SHEETS_STORAGE_KEY` | `"clarity.query-sheets.v1"` | localStorage key |
| `OBJECT_DATA_PREVIEW_LIMIT` | 500 | Row cap for Data tab preview |
| `OBJECT_DATA_ROW_ID_COLUMN` | `"__CLARITY_ROWID__"` | Synthetic rowid column name |
| `DEFAULT_QUERY_ROW_LIMIT` | 1000 | Default query row cap |
| `MAX_QUERY_ROW_LIMIT` | 10000 | Hard cap on query rows |
| `SCRIPT_LINE_HISTORY_LIMIT` | 200 | DDL navigation history depth |
