# Clarity — Backend Core Specification

The Rust core process (`clarity-core`) handles all database access, profile storage, file
operations, and AI integration. It receives commands via JSON-RPC 2.0 (see `04-ipc-contract.md`)
and responds with structured results. All data types are defined in `05-data-types.md`.

---

## 1. IPC Server

The core reads newline-delimited JSON-RPC messages from stdin and writes responses to stdout.
A single-threaded or async dispatch loop handles one message at a time from the transport layer.
DB operations are blocking (oracle-rs is synchronous); use a thread pool for concurrent sessions.

Startup sequence:
1. Initialize global state (session map, profile ID counter)
2. Emit `{"jsonrpc":"2.0","method":"event.ready","params":{"version":"<version>"}}` to stdout
3. Enter the read loop

---

## 2. Session Model

```
AppState {
    next_session_id: AtomicU64,           // monotonically increasing
    next_profile_id: AtomicU64,           // monotonically increasing
    sessions: Mutex<HashMap<u64, AppSession>>,
}

AppSession {
    provider: DatabaseProvider,
    session: ProviderSession,             // currently OracleSession
}

OracleSession {
    connection: oracle::Connection,       // oracle-rs Connection object
    target_schema: String,                // schema set at connect time (uppercase)
    transaction_active: bool,             // user-initiated transaction state
}
```

Session IDs start at 1 and increment. They are never reused within a process lifetime.

---

## 3. Command Catalog

### `db.connect`
**Params:** `DbConnectRequest`
**Result:** `DbSessionSummary`
**Errors:**
- `oracleClientMissing` — Oracle Instant Client not found (DPI-1047 in error message)
- `general` — all other connection failures

Steps:
1. Validate the request (see §8 Validation)
2. Call `ProviderRegistry::connect(request)` → returns `(AppSession, display_name, schema)`
3. Assign the next session ID via `next_session_id.fetch_add(1)`
4. Insert the session into the sessions map
5. Return `DbSessionSummary`

---

### `db.disconnect`
**Params:** `SessionRequest`
**Result:** `null`
**Errors:** `"Session not found"`

Remove the session from the map. The `oracle::Connection` is dropped, which closes the network
connection.

---

### `db.listObjects`
**Params:** `SessionRequest`
**Result:** `DbObjectEntry[]`

Returns all schema objects for the connected session's schema. See §4 Oracle Provider for SQL.

---

### `db.listObjectColumns`
**Params:** `SessionRequest`
**Result:** `DbObjectColumnEntry[]`

Returns all column metadata for all tables/views in the connected schema. See §4 for SQL.

---

### `db.runQuery`
**Params:** `DbQueryRequest`
**Result:** `DbQueryResult`

Execute arbitrary SQL. Detect statement type, execute, and return a `DbQueryResult`. Updates
`transaction_active` state for transaction-control statements. See §4 for full execution logic.

---

### `db.runQueryFiltered`
**Params:** `DbFilteredQueryRequest`
**Result:** `DbQueryResult`

Like `db.runQuery` but applies client-side row filtering after fetching:
- `globalSearch`: case-insensitive substring match across all columns (OR logic — row passes if any
  column contains the term)
- `columnFilters`: index-aligned array; each element is a case-insensitive substring match for the
  column at that index. Empty string means no filter for that column.

Filtering is applied before the row limit is enforced on the returned set, but after the DB row
limit (i.e., the DB still fetches up to `rowLimit` rows, then filtering reduces that set).

---

### `db.getObjectDdl`
**Params:** `DbObjectRef`
**Result:** `string` (DDL text)

Validate that `schema` matches the session's connected schema. Fetch DDL:
- For source objects (PROCEDURE, FUNCTION, PACKAGE, PACKAGE BODY, TRIGGER, TYPE, TYPE BODY):
  concatenate rows from `ALL_SOURCE` ordered by `LINE`.
- For all other objects: call `DBMS_METADATA.GET_DDL(metadata_type, object_name, schema)`.

`metadata_type` mapping:
| `objectType` | `metadata_type` for DBMS_METADATA |
|---|---|
| `TABLE` | `TABLE` |
| `VIEW` | `VIEW` |
| `SEQUENCE` | `SEQUENCE` |
| `TRIGGER` | (use ALL_SOURCE instead) |
| `SYNONYM` | `SYNONYM` |

---

### `db.updateObjectDdl`
**Params:** `DbObjectDdlUpdateRequest`
**Result:** `DbQueryResult`

Steps:
1. Validate: `ddl` non-empty, schema matches connected schema
2. Normalize DDL: strip trailing blank lines and trailing `/`
3. For source objects: prepend `CREATE OR REPLACE` if not already present
4. Execute the DDL statement
5. Fetch compilation diagnostics from `ALL_ERRORS` (see §4)
6. Commit (ends any active transaction)
7. Return `DbQueryResult` with diagnostics as rows and a summary message

---

### `db.getTransactionState`
**Params:** `SessionRequest`
**Result:** `DbTransactionState`

Return `{ "active": transaction_active }` for the session.

---

### `db.beginTransaction`
**Params:** `SessionRequest`
**Result:** `DbTransactionState`

Set `transaction_active = true`. Oracle implicitly begins a transaction on the next DML statement,
so no explicit `BEGIN` is needed. Return `{ "active": true }`.

---

### `db.commitTransaction`
**Params:** `SessionRequest`
**Result:** `DbTransactionState`

Call `connection.commit()` if `transaction_active` is true. Set `transaction_active = false`.
Return `{ "active": false }`.

---

### `db.rollbackTransaction`
**Params:** `SessionRequest`
**Result:** `DbTransactionState`

Call `connection.rollback()` if `transaction_active` is true. Set `transaction_active = false`.
Return `{ "active": false }`.

---

### `db.searchSchemaText`
**Params:** `DbSchemaSearchRequest`
**Result:** `DbSchemaSearchResult[]`

Search across up to three scopes (object names, source code, DDL text). See §4 for SQL queries.

---

### `db.exportSchema`
**Params:** `DbExportSchemaRequest`
**Result:** `DbSchemaExportResult`

Export all schema DDL to the filesystem. This command returns its JSON-RPC result *after* export
completes, but emits unsolicited `event.schemaExportProgress` notifications during execution.

Steps:
1. Fetch the full object list (same query as `db.listObjects`)
2. For each object: fetch DDL, determine subdirectory, write file
3. Emit `event.schemaExportProgress` notification after each object
4. On any individual object failure: log to `export_warnings.log` in the output directory,
   increment `skippedCount`, continue
5. Return `DbSchemaExportResult`

Directory layout:
```
<destinationDirectory>/
  tables/
    EMPLOYEES.sql
    DEPARTMENTS.sql
  views/
    V_EMPLOYEE_SUMMARY.sql
  procedures/
    HIRE_EMPLOYEE.sql
  functions/
    GET_SALARY.sql
  packages/
    HR_PKG.sql
  package_body/
    HR_PKG.sql
  triggers/
    AUDIT_INSERT.sql
  sequences/
    EMP_SEQ.sql
  types/
    ADDRESS_T.sql
  synonyms/
    MY_SYN.sql
  export_warnings.log      (only if skippedCount > 0)
```

File naming:
- Sanitize object name: keep alphanumeric, `_`, `$`, `#`; replace other chars with `_`
- If a file already exists, append `_2`, `_3`, etc. (up to 10,000 attempts)
- Content: trimmed DDL text + single trailing newline

---

### `profiles.list`
**Params:** none (empty params or omitted)
**Result:** `ConnectionProfile[]`

Read `connection_profiles.json` from the app data directory. Apply legacy format migration if
needed. Return the list. Passwords are never included.

---

### `profiles.save`
**Params:** `SaveConnectionProfileRequest`
**Result:** `ConnectionProfile`

Upsert the profile:
- If `id` is null/empty: generate a new ID (`profile-N` where N is from `next_profile_id`)
- If `id` is provided: find the existing profile and replace it
- Normalize the connection (trim whitespace, uppercase schema for Oracle)
- Write the updated list to disk
- If `savePassword == true`: write password to keychain
- If `savePassword == false`: clear any existing keychain entry
- Return the saved profile (without password)

---

### `profiles.delete`
**Params:** `ConnectionProfileRef`
**Result:** `null`

Remove the profile from the list, write to disk, and clear the keychain entry.
Error if profile ID is not found.

---

### `profiles.getSecret`
**Params:** `ConnectionProfileRef`
**Result:** `string | null`

Read the password from the OS keychain. Return `null` if no entry exists.
Do not error if the entry is missing — return `null` instead.

---

### `ai.hasApiKey`
**Params:** none
**Result:** `DbAiApiKeyPresence`

Check whether an AI API key is stored in the keychain. Return `{ "configured": true/false }`.

---

### `ai.setApiKey`
**Params:** `{ "apiKey": string }`
**Result:** `null`

Validate non-empty, then write to keychain.

---

### `ai.clearApiKey`
**Params:** none
**Result:** `null`

Remove the AI API key from the keychain. No error if not present.

---

### `ai.suggestQuery`
**Params:** `AiQuerySuggestionRequest`
**Result:** `AiQuerySuggestionResponse`

Make an HTTP request to the configured AI endpoint. See §6 AI Integration for full details.

---

### `files.pickDirectory`
**Params:** none
**Result:** `string | null`

Open the native directory picker dialog. Return the selected path, or `null` if cancelled.

On Windows: use `IFileOpenDialog` with `FOS_PICKFOLDERS`.
On macOS: use `NSOpenPanel` with `canChooseDirectories = true`.
On Linux: use `zenity --file-selection --directory` or `kdialog --getexistingdirectory`.

---

### `files.saveQuerySheet`
**Params:** `DbSaveQuerySheetRequest`
**Result:** `string | null`

Open the native save file dialog with the suggested filename. Write SQL content to the chosen
path. Return the saved path, or `null` if cancelled.

File is written as UTF-8, trimmed, with a single trailing newline.

---

### `files.saveQuerySheets`
**Params:** `DbSaveQuerySheetsRequest`
**Result:** `DbSaveQuerySheetsResult | null`

Open the directory picker. Write each sheet as a separate `.sql` file. Return result, or `null`
if cancelled.

File naming: derive from `title` with sanitization. Append `_2`, `_3` etc. if collisions exist.

---

## 4. Oracle Provider

### Connection

```
connect(OracleConnectOptions) -> Result<(OracleSession, display_name, schema), DbConnectError>
```

1. Initialize the Oracle Client (see Oracle Client Initialization below)
2. Build connect string: `//host:port/service_name` (port defaults to 1521 if null)
3. Build `oracle::Connector` with username, password, and connect descriptor
4. Set auth mode (`oracle::AuthMode::SysDba` if `oracleAuthMode == "sysdba"`)
5. Connect → `oracle::Connection`
6. Execute `ALTER SESSION SET CURRENT_SCHEMA = {normalized_schema}`
   - `normalized_schema` = schema.trim().to_uppercase()
   - Validate schema: only ASCII `A-Z`, `0-9`, `_`, `$`, `#`; error on violation
7. Build `display_name`:
   - Normal: `{username}@//host:port/service_name [{SCHEMA}]`
   - SYSDBA: `{username} as SYSDBA@//host:port/service_name [{SCHEMA}]`
8. Return `(OracleSession { connection, target_schema, transaction_active: false }, display_name, SCHEMA)`

**DPI-1047 detection:** If the error message from the oracle crate contains `"DPI-1047"`, return
`DbConnectError::OracleClientMissing`. All other errors become `DbConnectError::General`.

### Oracle Client Initialization

Called once before the first connection attempt. Search for Instant Client in this order:
1. `oracleClientLibDir` parameter (if non-empty)
2. `ORACLE_CLIENT_LIB_DIR` environment variable
3. Platform-specific paths:
   - **Windows:** `C:\oracle\instantclient`, `C:\instantclient`, `%USERPROFILE%\instantclient`
   - **macOS:** `/opt/homebrew/lib`, `/usr/local/lib`, `/opt/oracle`, `/opt/oracle/instantclient`
   - **Linux:** `/usr/lib/oracle/*/client64/lib`, `/opt/oracle/instantclient`

For each path: check if it contains `libclntsh.dylib` (macOS), `libclntsh.so.*` (Linux), or
`oci.dll` (Windows). If found, pass the directory to `oracle::client::set_lib_dir()`.

### Schema Validation

Oracle schema identifier rules:
- After trimming and uppercasing, must be non-empty
- Allowed characters: `A–Z`, `0–9`, `_`, `$`, `#`
- Error message: `"Schema must use unquoted Oracle identifier characters: A-Z, 0-9, _, $, #"`

### List Objects

```sql
SELECT OWNER, OBJECT_TYPE, OBJECT_NAME, STATUS
FROM (
    SELECT OWNER, OBJECT_TYPE, OBJECT_NAME, STATUS
    FROM ALL_OBJECTS
    WHERE OWNER = :1
      AND OBJECT_TYPE IN (
          'TABLE', 'VIEW', 'PROCEDURE', 'FUNCTION',
          'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'SEQUENCE'
      )
    ORDER BY OBJECT_TYPE, OBJECT_NAME
)
WHERE ROWNUM <= :2
```
Parameters: `[schema, 5000]`

For objects with `STATUS = 'INVALID'`, fetch the first compiler error:

```sql
SELECT TYPE, NAME, INVALID_REASON
FROM (
    SELECT
        TYPE,
        NAME,
        'Line ' || TO_CHAR(LINE) ||
            CASE WHEN POSITION > 0 THEN ', Col ' || TO_CHAR(POSITION) ELSE '' END ||
            ': ' ||
            REPLACE(REPLACE(TRIM(TEXT), CHR(13), ' '), CHR(10), ' ') AS INVALID_REASON,
        ROW_NUMBER() OVER (
            PARTITION BY NAME, TYPE ORDER BY SEQUENCE, LINE, POSITION
        ) AS RN
    FROM ALL_ERRORS
    WHERE OWNER = :1
)
WHERE RN = 1
```
Parameters: `[schema]`

Map results: for each invalid object, find matching `(TYPE, NAME)` in the error result and set
`invalidReason`. If no error found: `invalidReason = "Oracle reports this object as invalid, but no compiler details were returned."`.

### List Object Columns

```sql
SELECT OWNER, TABLE_NAME, COLUMN_NAME, DATA_TYPE, NULLABLE
FROM ALL_TAB_COLUMNS
WHERE OWNER = :1
ORDER BY TABLE_NAME, COLUMN_ID
```
Parameters: `[schema]`

### Get Object DDL

**Source-based objects** (PROCEDURE, FUNCTION, PACKAGE, PACKAGE BODY, TRIGGER, TYPE, TYPE BODY):

```sql
SELECT TEXT
FROM ALL_SOURCE
WHERE OWNER = :1
  AND TYPE = :2
  AND NAME = :3
ORDER BY LINE
```
Concatenate all `TEXT` rows. The result is the complete source text.

**Metadata-based objects** (TABLE, VIEW, SEQUENCE, SYNONYM, and others):

```sql
SELECT DBMS_METADATA.GET_DDL(:1, :2, :3) FROM DUAL
```
Parameters: `[metadata_type, object_name, schema]`

`metadata_type` mapping (Oracle DBMS_METADATA type names):

| Object Type | Metadata Type |
|---|---|
| TABLE | TABLE |
| VIEW | VIEW |
| SEQUENCE | SEQUENCE |
| SYNONYM | SYNONYM |
| (anything else) | same as object type |

### Query Execution

Statement type detection (check leading keyword after stripping comments):

| Leading keyword | Type | Behavior |
|---|---|---|
| SELECT, WITH | SELECT | Fetch rows up to `rowLimit` |
| INSERT, UPDATE, DELETE, MERGE | DML | Execute; auto-commit unless `transaction_active`; return `rowsAffected` |
| CREATE, ALTER, DROP, TRUNCATE, RENAME, COMMENT, GRANT, REVOKE | DDL | Execute; auto-commit; set `transaction_active = false` |
| BEGIN, DECLARE | PL/SQL | Execute as anonymous block |
| COMMIT | Transaction | Execute; set `transaction_active = false` |
| ROLLBACK | Transaction | Execute; set `transaction_active = false` (detect if `ROLLBACK TO` → savepoint, keep active) |
| SAVEPOINT | Transaction | Execute; set `transaction_active = true` |
| SET TRANSACTION | Transaction | Execute; set `transaction_active = true` |
| SHOW | Intercepted | See SHOW Commands below |

Row limit: clamp to `[1, 10000]`, default 1000.

**SELECT results:** `DbQueryResult { columns, rows, rows_affected: null, message: "Query executed. Returned N row(s).[  Results truncated at M rows.]" }`

Truncation message appended when returned row count equals `rowLimit`.

**DML results:** `DbQueryResult { columns: [], rows: [], rows_affected: Some(n), message: "Statement executed. N row(s) affected." }`

**DDL results:** `DbQueryResult { columns: [], rows: [], rows_affected: None, message: "DDL executed." }`

**PL/SQL results:** `DbQueryResult { columns: [], rows: [], rows_affected: None, message: "PL/SQL block executed." }`

All cell values are converted to strings. Oracle `NULL` → empty string `""`.

### SHOW Commands

Intercept SQL where the first token (case-insensitive) is `SHOW`.

**`SHOW CON_NAME`:**
```sql
SELECT SYS_CONTEXT('USERENV', 'CON_NAME') AS CON_NAME FROM DUAL
```
Message: `"SHOW CON_NAME executed."`

**`SHOW USER`:**
```sql
SELECT USER AS "USER" FROM DUAL
```
Message: `"SHOW USER executed."`

**`SHOW PDBS`:**
```sql
SELECT CON_ID, NAME AS CON_NAME, OPEN_MODE, RESTRICTED
FROM V$PDBS
ORDER BY CON_ID
```
Message: `"SHOW PDBS executed. Returned N row(s)."`

**`SHOW PARAMETER [filter]`:**
```sql
SELECT NAME, TYPE, VALUE, ISDEFAULT, ISSES_MODIFIABLE, ISSYS_MODIFIABLE
FROM V$PARAMETER
WHERE UPPER(NAME) LIKE UPPER(:1)
ORDER BY NAME
```
Filter processing: strip leading/trailing quotes (single or double). If the filter contains no `%`
or `_` wildcards, wrap it: `%filter%`. Message: `"SHOW PARAMETER executed. Returned N row(s)."`

### DDL Update and Compilation Diagnostics

After executing the DDL:

```sql
SELECT ATTRIBUTE, LINE, POSITION, TEXT
FROM ALL_ERRORS
WHERE OWNER = :1
  AND TYPE = :2
  AND NAME = :3
ORDER BY SEQUENCE, LINE, POSITION
```
Parameters: `[schema, object_type, object_name]`

`ATTRIBUTE` values: `"ERROR"` or `"WARNING"`.

**Result message patterns:**
- No diagnostics: `"{TYPE} {SCHEMA}.{NAME} updated successfully."`
- No diagnostics but execute returned error: `"{TYPE} {SCHEMA}.{NAME} updated, but Oracle did not return compilation details."`
- Only errors: `"{TYPE} {SCHEMA}.{NAME} updated with N compilation error(s)."`
- Only warnings: `"{TYPE} {SCHEMA}.{NAME} updated with N compilation warning(s)."`
- Both: `"{TYPE} {SCHEMA}.{NAME} updated with N compilation error(s) and M warning(s)."`

Return diagnostics as rows:
- `columns: ["ATTRIBUTE", "LINE", "POSITION", "TEXT"]`
- Each `ALL_ERRORS` row becomes one result row

### Schema Text Search

Returns up to `limit` results total, distributed across enabled scopes.

**Scope 1 — Object Names** (if `includeObjectNames`):
```sql
SELECT OWNER, OBJECT_TYPE, OBJECT_NAME
FROM (
    SELECT OWNER, OBJECT_TYPE, OBJECT_NAME
    FROM ALL_OBJECTS
    WHERE OWNER = :1
      AND INSTR(UPPER(OBJECT_NAME), UPPER(:2)) > 0
    ORDER BY OBJECT_TYPE, OBJECT_NAME
)
WHERE ROWNUM <= :3
```
`matchScope = "object_name"`, `line = null`, `snippet = object_name`

**Scope 2 — Source Code** (if `includeSource`):
```sql
SELECT OWNER, TYPE, NAME, LINE, TEXT
FROM (
    SELECT OWNER, TYPE, NAME, LINE, TEXT
    FROM ALL_SOURCE
    WHERE OWNER = :1
      AND TYPE IN ('PROCEDURE','FUNCTION','PACKAGE','PACKAGE BODY','TRIGGER','TYPE','TYPE BODY')
      AND INSTR(UPPER(TEXT), UPPER(:2)) > 0
    ORDER BY TYPE, NAME, LINE
)
WHERE ROWNUM <= :3
```
`matchScope = "source"`, `line = LINE`, `snippet = TEXT.trim()` truncated to 220 chars

**Scope 3 — DDL Text** (if `includeDdl`):
For up to 2,000 schema objects: fetch DDL via `DBMS_METADATA.GET_DDL`, then search line-by-line.
On first matching line: emit result with `matchScope = "ddl"`, `line = matching_line_number`.

Results are collected and returned in order: object_name matches, then source matches, then DDL
matches, up to `limit` total.

---

## 5. Profile Persistence

### File Location

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\clarity\connection_profiles.json` |
| macOS | `~/Library/Application Support/clarity/connection_profiles.json` |
| Linux | `~/.config/clarity/connection_profiles.json` |

Use `tauri::PathResolver::app_data_dir()` equivalent on each platform.

### File Format (current)

JSON array of `StoredConnectionProfile`:

```json
[
  {
    "id": "profile-1",
    "name": "Dev Oracle",
    "provider": "oracle",
    "connection": {
      "host": "localhost",
      "port": 1521,
      "serviceName": "XEPDB1",
      "username": "hr",
      "schema": "HR",
      "oracleAuthMode": "normal"
    }
  }
]
```

`provider` and `connection` are stored together as a tagged enum. The tag is the `provider` field
at the `StoredConnectionProfile` level (not nested inside `connection`).

### Legacy Format Migration

Old profiles had connection fields flattened into the root object (no nested `connection` key).
On read, if a profile has no `connection` key but has `host` at the root level, migrate:

```json
// Old
{"id":"x","name":"n","provider":"oracle","host":"h","serviceName":"s","username":"u","schema":"S","port":1521,"oracleAuthMode":"normal"}

// Migrated (in memory only; write the new format back on next save)
{"id":"x","name":"n","provider":"oracle","connection":{"host":"h","serviceName":"s","username":"u","schema":"S","port":1521,"oracleAuthMode":"normal"}}
```

### Keychain Entries

| Entry | Service | Account |
|-------|---------|---------|
| Connection password | `com.waldencorp.clarity` | `profile:{profile_id}:password` |
| AI API key | `com.waldencorp.clarity` | `ai:openai:api_key` |

Use the platform's native keychain (Windows Credential Manager, macOS Keychain, Linux
libsecret/kwallet via the `keyring` crate).

---

## 6. AI Integration

### Endpoint Normalization

Given the configured `endpoint`:
- If it ends with `/chat/completions` → use as-is
- Else if it ends with `/v1` → append `/chat/completions`
- Else → append `/v1/chat/completions`

### Authentication

Read the API key from the keychain (account: `ai:openai:api_key`). Send as:
`Authorization: Bearer {api_key}`

If no key is configured: return error `"AI API key is not configured. Add it in Settings -> AI."`

### Request Payload

```json
{
  "model": "{model}",
  "temperature": 0.05,
  "max_tokens": 300,
  "response_format": { "type": "json_object" },
  "messages": [
    {
      "role": "system",
      "content": "You are an expert Oracle SQL assistant that suggests query completions.\nThe user is writing an Oracle SQL query and needs a natural continuation.\n\nRules:\n- Suggest ONLY the continuation text that comes AFTER what the user has already typed.\n- Do NOT repeat any part of the current SQL.\n- Use ONLY columns and tables from the provided schema context.\n- Prefer read-only SQL (SELECT) unless the user's intent clearly requires DML.\n- Use correct Oracle SQL syntax (NVL instead of COALESCE, ROWNUM or FETCH FIRST instead of LIMIT, etc.).\n- When joining tables, use the correct column names from the schema context.\n- Keep suggestions concise and focused - complete the current statement, do not add extra statements.\n- Tables marked with [REFERENCED] are already used in the query - strongly prefer their columns for completions.\n- suggestionText must be raw SQL continuation text only, without markdown fences and without prose.\n\nReturn valid JSON only (no markdown) with keys: suggestionText, confidence (0.0-1.0), reasoningShort (one sentence), isPotentiallyMutating (boolean)."
    },
    {
      "role": "user",
      "content": "{user_message}"
    }
  ]
}
```

User message construction:
```
Connected schema: {connectedSchema}
Current SQL:
{currentSql}

Schema context:
{for each object in schemaContext (up to 120):}
- {[REFERENCED] if isReferencedInQuery}{schema}.{objectName} ({column1}, {column2}, ...)
{if cursorClause:}

Current clause: {cursorClause}
```

### Response Parsing

Expected structure:
```json
{
  "choices": [{ "message": { "content": "{json_string}" } }]
}
```

1. Extract `choices[0].message.content`
2. Parse content as JSON:
   - Try direct parse
   - If wrapped in markdown code fence (` ```json ... ``` `): strip and parse
   - If wrapped in outer object with a single key whose value is an object: unwrap
3. Extract fields: `suggestionText`, `confidence`, `reasoningShort`, `isPotentiallyMutating`
4. Sanitize `suggestionText`:
   - Strip markdown code fences
   - Strip any prefix that exactly matches the current SQL (case-insensitive)
5. Clamp `confidence` to `[0.0, 1.0]`; default to `0.5` if missing or invalid

### Mutation Detection

After the suggestion is parsed, detect if it is potentially mutating even if `isPotentiallyMutating`
is false (defense in depth). Strip SQL comments and string literals, then check if any of the
following appear as word-boundary tokens (case-insensitive):

`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `TRUNCATE`, `DROP`, `ALTER`, `CREATE`, `RENAME`,
`GRANT`, `REVOKE`, `COMMENT`, `BEGIN`, `DECLARE`, `CALL`, `EXECUTE`

If found, set `isPotentiallyMutating = true` in the result regardless of the model's value.

### Timeout

20 seconds. On timeout: return error `"AI request timed out after 20 seconds."`.

### Error Messages

| Condition | Message |
|-----------|---------|
| No API key | `"AI API key is not configured. Add it in Settings -> AI."` |
| HTTP error (4xx/5xx) | `"AI request failed with status {code}: {detail}"` (detail truncated to 350 chars) |
| JSON parse failure | `"Failed to parse AI response envelope: {error}"` |
| No choices in response | `"AI response did not include a suggestion."` |
| Empty `suggestionText` | `"AI response did not include suggestion text."` |
| Timeout | `"AI request timed out after 20 seconds."` |

---

## 7. File Operations

### File Name Sanitization

**Forbidden characters by platform:**
- Windows: `/ \ : * ? " < > |` plus control characters
- macOS/Linux: `/` and null byte

**Sanitization algorithm:**
1. Take the file stem (name without extension)
2. Replace forbidden characters with `_`
3. Collapse consecutive `_` into one
4. Strip leading/trailing `_`
5. If empty after sanitization: use `"query"`
6. Append `.sql` extension

### Unique File Path

If the target path already exists:
1. Try `{stem}_2.sql`, `{stem}_3.sql`, ..., `{stem}_10000.sql`
2. If still not unique after 10,000 attempts: use `{stem}_{u64_max}.sql` (overflow fallback)

### File Content

UTF-8 encoded. Trailing whitespace on each line is preserved. Ensure exactly one trailing newline.
If content is empty, write an empty file.

### Directory Picker (Windows-specific)

Use `IFileOpenDialog` with `FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM`. If the user cancels, return
`null`. On error, propagate as a JSON-RPC error string.

### Save File Dialog (Windows-specific)

Use `IFileSaveDialog` with a `.sql` filter. Pass `suggestedFileName` as the initial filename.
Return the selected path or `null` on cancel.

---

## 8. Validation Rules

All validation errors return JSON-RPC error code `-32602` (Invalid params).

### Connection Validation

| Provider | Field | Rule |
|----------|-------|------|
| Oracle | `host` | Required, non-empty after trim |
| Oracle | `username` | Required, non-empty after trim |
| Oracle | `password` | Required, non-empty after trim |
| Oracle | `serviceName` | Required, non-empty after trim |
| Oracle | `schema` | Required, non-empty; only `A-Z`, `0-9`, `_`, `$`, `#` after trim+uppercase |
| Postgres/MySQL | `host` | Required, non-empty |
| Postgres/MySQL | `username` | Required, non-empty |
| Postgres/MySQL | `password` | Required, non-empty |
| Postgres/MySQL | `database` | Required, non-empty |
| SQLite | `filePath` | Required, non-empty |

### Profile Validation

Same as connection validation, plus:
- `name`: required, non-empty after trim
- If `savePassword == true`: `password` must be present and non-empty

### Query Validation

- `sql`: required, non-empty after trim. Error: `"Query cannot be empty"`
- `rowLimit`: clamped to `[1, 10000]` (not an error — silently clamped)

### Schema Search Validation

- `searchTerm`: required, non-empty. Error: `"Search term is required"`
- At least one scope must be true. Error: `"Select at least one search scope"`
- `limit`: clamped to `[1, 1000]` (silently clamped)

### DDL Update Validation

- `ddl`: required, non-empty. Error: `"DDL cannot be empty"`
- `schema`: must match the session's `target_schema` (case-insensitive). Error: `"Connected schema is {schema}. Object access is limited to that schema."`

### AI Request Validation

- `currentSql`: required, non-empty. Error: `"Current SQL is required"`
- `connectedSchema`: required, non-empty. Error: `"Connected schema is required"`
- `model`: required, non-empty. Error: `"AI model is required"`
- `endpoint`: required, non-empty. Error: `"AI endpoint is required"`
- `schemaContext`: max 300 items. Error: `"Schema context is too large."`

---

## 9. Progress Events

### `event.schemaExportProgress`

Emitted as a JSON-RPC notification (no `id`) after each object is processed during schema export.

```json
{
  "jsonrpc": "2.0",
  "method": "event.schemaExportProgress",
  "params": {
    "processedObjects": 15,
    "totalObjects": 84,
    "exportedFiles": 14,
    "skippedCount": 1,
    "currentObject": "TABLE HR.EMPLOYEES"
  }
}
```

`currentObject` format: `"{OBJECT_TYPE} {SCHEMA}.{OBJECT_NAME}"`

---

## 10. Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_EXPLORER_OBJECTS` | 5000 | Max objects returned by `db.listObjects` |
| `DEFAULT_QUERY_ROW_LIMIT` | 1000 | Default row limit for queries |
| `MAX_QUERY_ROW_LIMIT` | 10000 | Hard cap on query row limit |
| `DEFAULT_SCHEMA_SEARCH_LIMIT` | 200 | Default max results from schema search |
| `MAX_SCHEMA_SEARCH_RESULTS` | 1000 | Hard cap on schema search results |
| `MAX_DDL_SEARCH_OBJECTS` | 2000 | Max objects scanned in DDL text search |
| `MAX_SEARCH_SNIPPET_CHARS` | 220 | Max characters in a search result snippet |
| `MAX_AI_SCHEMA_CONTEXT_OBJECTS_DISPLAY` | 120 | Max objects included in AI context |
| `MAX_AI_SCHEMA_CONTEXT_OBJECTS_TOTAL` | 300 | Hard cap for validation |
| `AI_REQUEST_TIMEOUT_SECS` | 20 | Timeout for AI HTTP requests |
| `PROFILE_FILE_NAME` | `connection_profiles.json` | Profile storage filename |
| `KEYCHAIN_SERVICE` | `com.waldencorp.clarity` | Keychain service name |
| `KEYCHAIN_AI_KEY_ACCOUNT` | `ai:openai:api_key` | Keychain account for AI key |
| `KEYCHAIN_PROFILE_PASSWORD_PREFIX` | `profile:` | Prefix for profile password entries |

---

## 11. Error Message Strings (Reference)

### Session / Command Errors
- `"Session not found"`
- `"Failed to acquire session lock"`

### Profile Errors
- `"Failed to read profiles file: {error}"`
- `"Failed to parse profiles file: {error}"`
- `"Failed to write profiles file: {error}"`
- `"Profile not found"`
- `"Profile id is required"`

### Keychain Errors
- `"Failed to read keychain secret: {error}"`
- `"Failed to write keychain secret: {error}"`
- `"Failed to clear keychain secret: {error}"`
- `"Failed to read AI API key from keychain: {error}"`
- `"Failed to write AI API key to keychain: {error}"`
- `"Failed to clear AI API key from keychain: {error}"`

### Query Result Messages
- `"Query executed. Returned {n} row(s)."` (+ `" Results truncated at {n} rows."` if at limit)
- `"Statement executed. {n} row(s) affected."`
- `"DDL executed."`
- `"PL/SQL block executed."`
- `"Statement executed."`
- `"SHOW CON_NAME executed."`
- `"SHOW USER executed."`
- `"SHOW PDBS executed. Returned {n} row(s)."`
- `"SHOW PARAMETER executed. Returned {n} row(s)."`

### DDL Compilation Messages
- `"{TYPE} {SCHEMA}.{NAME} updated successfully."`
- `"{TYPE} {SCHEMA}.{NAME} updated, but Oracle did not return compilation details."`
- `"{TYPE} {SCHEMA}.{NAME} updated with {n} compilation warning(s)."`
- `"{TYPE} {SCHEMA}.{NAME} updated with {n} compilation error(s)."`
- `"{TYPE} {SCHEMA}.{NAME} updated with {n} compilation error(s) and {m} warning(s)."`

### Provider Not Implemented
- `"Provider '{provider}' is not implemented yet."`
