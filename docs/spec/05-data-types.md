# Clarity — Data Types Reference

All types that cross the IPC boundary between the C# host and the Rust core. Field names are in
`camelCase` as they appear in JSON. For C#, use `[JsonPropertyName("fieldName")]`. For Rust, use
`#[serde(rename_all = "camelCase")]`.

`null` and a missing field must be treated equivalently for all optional fields.

---

## Enumerations

### `DatabaseProvider`
String enum.

| Value | Meaning |
|-------|---------|
| `"oracle"` | Oracle Database |
| `"postgres"` | PostgreSQL (not yet implemented in core) |
| `"mysql"` | MySQL / MariaDB (not yet implemented in core) |
| `"sqlite"` | SQLite (not yet implemented in core) |

### `OracleAuthMode`
String enum.

| Value | Meaning |
|-------|---------|
| `"normal"` | Standard database authentication |
| `"sysdba"` | Connect with SYSDBA privilege |

### `SchemaSearchMatchScope`
String enum — indicates where a schema search match was found.

| Value | Meaning |
|-------|---------|
| `"object_name"` | Match found in the object name |
| `"source"` | Match found in the PL/SQL source code |
| `"ddl"` | Match found in the DDL text |

### `ObjectDetailTabId`
String enum — which detail tab is active for an opened object.

| Value | Meaning |
|-------|---------|
| `"data"` | Data preview tab (TABLE and VIEW only) |
| `"ddl"` | DDL text tab (all objects) |
| `"metadata"` | Metadata tab (all objects) |

---

## Connection Types

### `OracleConnectionOptions`
Connection details for Oracle (no password). Used in stored profiles.

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `host` | string | yes | non-empty | Database host or IP |
| `port` | number \| null | no | integer, 1–65535 | Defaults to 1521 |
| `serviceName` | string | yes | non-empty | Oracle service name (e.g., `XEPDB1`) |
| `username` | string | yes | non-empty | Database username |
| `schema` | string | yes | non-empty, Oracle identifier | Schema to set as current after connect |
| `oracleAuthMode` | `OracleAuthMode` | yes | | Authentication mode |

### `OracleConnectOptions`
Extends `OracleConnectionOptions` — adds secret fields. Used only in `db.connect` requests.

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| *(all OracleConnectionOptions fields)* | | | | |
| `password` | string | yes | non-empty | Database password |
| `oracleClientLibDir` | string \| null | no | | Override path to Oracle Instant Client directory |

### `NetworkConnectionOptions`
Connection details for Postgres/MySQL (no password). Used in stored profiles.

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `host` | string | yes | non-empty | Database host |
| `port` | number \| null | no | integer, 1–65535 | Provider default if omitted |
| `database` | string | yes | non-empty | Database name |
| `username` | string | yes | non-empty | Database username |
| `schema` | string \| null | no | | Optional default schema |

### `NetworkConnectOptions`
Extends `NetworkConnectionOptions`. Used in `db.connect` requests.

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| *(all NetworkConnectionOptions fields)* | | | | |
| `password` | string | yes | non-empty | Database password |

### `SqliteConnectionOptions`
Used in both profile storage and `db.connect`.

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `filePath` | string | yes | non-empty | Absolute path to the SQLite file |

---

## Connect Request / Response

### `DbConnectRequest`
Discriminated union on the `provider` field.

```json
{
  "provider": "oracle",
  "connection": { /* OracleConnectOptions */ }
}
```

or

```json
{
  "provider": "postgres",
  "connection": { /* NetworkConnectOptions */ }
}
```

or

```json
{
  "provider": "sqlite",
  "connection": { /* SqliteConnectionOptions */ }
}
```

### `DbSessionSummary`
Returned by `db.connect` on success.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | number | yes | Integer ID. Use in all subsequent session-scoped requests. |
| `displayName` | string | yes | Human-readable connection label, e.g., `hr@//localhost:1521/XEPDB1 [HR]` |
| `schema` | string | yes | Active schema (uppercased Oracle identifier) |
| `provider` | `DatabaseProvider` | yes | |

### `DbConnectError`
Returned as the JSON-RPC error `data` field when `db.connect` fails.

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `"oracleClientMissing"` \| `"general"` | Discriminant |
| `message` | string | Human-readable error detail |

`"oracleClientMissing"` is raised when the Oracle Instant Client libraries cannot be found
(DPI-1047). The UI must show a special panel guiding the user to install / configure the client.

---

## Session Request

Many commands require only a session ID. This wrapper is the `params` object for those commands.

### `SessionRequest`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | number | yes | Session ID from `DbSessionSummary` |

---

## Query Types

### `DbQueryRequest`

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `sessionId` | number | yes | | |
| `sql` | string | yes | non-empty | SQL to execute |
| `rowLimit` | number \| null | no | integer, 1–10000 | Defaults to 1000 |

### `DbFilteredQueryRequest`

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `sessionId` | number | yes | | |
| `sql` | string | yes | non-empty | SQL to execute |
| `rowLimit` | number \| null | no | integer, 1–10000 | Defaults to 1000 |
| `globalSearch` | string \| null | no | | Case-insensitive substring match across all columns |
| `columnFilters` | string[] \| null | no | | Per-column case-insensitive substring filters (index-aligned with result columns) |

### `DbQueryResult`
Returned by `db.runQuery`, `db.runQueryFiltered`, `db.updateObjectDdl`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `columns` | string[] | yes | Column name list |
| `rows` | string[][] | yes | Row data; every value is a string (nulls become `""`) |
| `rowsAffected` | number \| null | yes | Set for DML/DDL; null for SELECT |
| `message` | string | yes | Human-readable result, e.g., `"Query executed. Returned 42 row(s)."` |

---

## Object Metadata Types

### `DbObjectEntry`
Represents a database object in the schema explorer.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema` | string | yes | Owner schema (uppercase) |
| `objectType` | string | yes | One of: `TABLE`, `VIEW`, `PROCEDURE`, `FUNCTION`, `PACKAGE`, `PACKAGE BODY`, `TRIGGER`, `SEQUENCE` |
| `objectName` | string | yes | Object name (uppercase) |
| `status` | string \| null | yes | `"VALID"`, `"INVALID"`, or null |
| `invalidReason` | string \| null | yes | Compiler error detail if `status == "INVALID"`, else null |

### `DbObjectColumnEntry`
Column metadata for a table or view.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema` | string | yes | Owner schema |
| `objectName` | string | yes | Table or view name |
| `columnName` | string | yes | Column name |
| `dataType` | string | yes | Oracle data type string (e.g., `VARCHAR2`, `NUMBER`) |
| `nullable` | string | yes | `"Y"` or `"N"` |

### `DbObjectRef`
Used in `db.getObjectDdl` and `db.updateObjectDdl`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | number | yes | |
| `schema` | string | yes | Must match connected schema |
| `objectType` | string | yes | |
| `objectName` | string | yes | |

### `DbObjectDdlUpdateRequest`
Used in `db.updateObjectDdl`.

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `sessionId` | number | yes | | |
| `schema` | string | yes | Must match connected schema | |
| `objectType` | string | yes | | |
| `objectName` | string | yes | | |
| `ddl` | string | yes | non-empty | DDL text to execute |

---

## Transaction Types

### `DbTransactionState`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `active` | boolean | yes | Whether a user-initiated transaction is currently open |

---

## Schema Search Types

### `DbSchemaSearchRequest`

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `sessionId` | number | yes | | |
| `searchTerm` | string | yes | non-empty | Text to search for |
| `limit` | number \| null | no | integer, 1–1000 | Max results. Defaults to 200. |
| `includeObjectNames` | boolean \| null | no | | Search in object names. Defaults to true. |
| `includeSource` | boolean \| null | no | | Search in PL/SQL source. Defaults to true. |
| `includeDdl` | boolean \| null | no | | Search in DDL text. Defaults to true. |

At least one of `includeObjectNames`, `includeSource`, `includeDdl` must be true.

### `DbSchemaSearchResult`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema` | string | yes | |
| `objectType` | string | yes | |
| `objectName` | string | yes | |
| `matchScope` | `SchemaSearchMatchScope` | yes | Where the match was found |
| `line` | number \| null | yes | 1-indexed line number in source or DDL; null for object name matches |
| `snippet` | string | yes | Surrounding text, truncated to 220 characters |

---

## Profile Types

### `ConnectionProfile`
Returned by `profiles.list`. Never contains a password.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Stable profile identifier |
| `name` | string | yes | User-assigned display name |
| `hasPassword` | boolean | yes | Whether a password is stored in the OS keychain |
| `provider` | `DatabaseProvider` | yes | |
| `connection` | `OracleConnectionOptions` \| `NetworkConnectionOptions` \| `SqliteConnectionOptions` | yes | Provider-specific connection details (no password) |

### `SaveConnectionProfileRequest`
Used in `profiles.save`.

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `id` | string \| null | no | | Existing profile ID to update; null/omitted to create new |
| `name` | string | yes | non-empty | Display name |
| `provider` | `DatabaseProvider` | yes | | |
| `connection` | *provider-appropriate options type* | yes | | Connection details (no password) |
| `savePassword` | boolean | yes | | Whether to store password in keychain |
| `password` | string \| null | no | Required if `savePassword == true` | Password to store |

### `ConnectionProfileRef`
Used in `profiles.delete` and `profiles.getSecret`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `profileId` | string | yes | Profile ID |

---

## Schema Export Types

### `DbExportSchemaRequest`

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `sessionId` | number | yes | | |
| `destinationDirectory` | string | yes | non-empty | Absolute path to export directory |

### `DbSchemaExportResult`
Returned by `db.exportSchema` when complete.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `destinationDirectory` | string | yes | Directory used |
| `objectCount` | number | yes | Total schema objects found |
| `fileCount` | number | yes | Files successfully written |
| `skippedCount` | number | yes | Objects that could not be exported |
| `message` | string | yes | Human-readable summary |

### `DbSchemaExportProgress`
Emitted as a JSON-RPC notification (`event.schemaExportProgress`) during export.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `processedObjects` | number | yes | Objects processed so far |
| `totalObjects` | number | yes | Total objects to process |
| `exportedFiles` | number | yes | Files written so far |
| `skippedCount` | number | yes | Objects skipped so far |
| `currentObject` | string | yes | Description of the currently-processing object, e.g., `"TABLE HR.EMPLOYEES"` |

---

## File Operation Types

### `DbSaveQuerySheetRequest`
Used in `files.saveQuerySheet`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `suggestedFileName` | string | yes | Default filename for the save dialog (e.g., `"Query 1.sql"`) |
| `sql` | string | yes | SQL content to write |

### `DbSaveQuerySheetsRequest`
Used in `files.saveQuerySheets`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sheets` | `DbSaveQuerySheetInput[]` | yes | All query sheets to save |

### `DbSaveQuerySheetInput`
One element of `DbSaveQuerySheetsRequest.sheets`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Sheet title (used to derive filename) |
| `sql` | string | yes | SQL content |

### `DbSaveQuerySheetsResult`
Returned by `files.saveQuerySheets` when at least one file was saved.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `directory` | string | yes | Directory files were written to |
| `fileCount` | number | yes | Number of files written |

---

## AI Types

### `AiQuerySuggestionRequest`
Used in `ai.suggestQuery`.

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `currentSql` | string | yes | non-empty | SQL text the user has written so far |
| `connectedSchema` | string | yes | non-empty | Current schema name |
| `endpoint` | string | yes | non-empty | AI API endpoint URL |
| `model` | string | yes | non-empty | AI model identifier (e.g., `gpt-4o-mini`) |
| `schemaContext` | `AiSchemaContextObject[]` | yes | max 300 items | Schema objects for context |
| `cursorClause` | string \| null | no | | SQL clause at cursor position (e.g., `"WHERE"`) |

### `AiSchemaContextObject`
One element of `AiQuerySuggestionRequest.schemaContext`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema` | string | yes | Owner schema |
| `objectName` | string | yes | Table or view name |
| `columns` | string[] | yes | Column names |
| `isReferencedInQuery` | boolean | yes | Whether this object appears in the current SQL |

### `AiQuerySuggestionResponse`
Returned by `ai.suggestQuery`.

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `suggestionText` | string | yes | non-empty | SQL continuation text to insert after the cursor |
| `confidence` | number | yes | 0.0–1.0 | Model confidence in the suggestion |
| `reasoningShort` | string | yes | | One-sentence explanation |
| `isPotentiallyMutating` | boolean | yes | | True if suggestion includes INSERT/UPDATE/DELETE/DDL |

### `DbAiApiKeyPresence`
Returned by `ai.hasApiKey`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `configured` | boolean | yes | Whether an AI API key is stored in the keychain |

---

## Settings Types

Settings are persisted by the C# host (not the Rust core). They are stored as a JSON file in the
app's local data directory. This section documents the schema for that file.

### `UserSettings`
Root object of the settings file.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| `theme` | `"light"` \| `"dark"` | no | `"light"` | | App color scheme |
| `uiFontFamily` | string | no | `"Segoe UI"` (Windows) | | Font for UI chrome |
| `uiFontSize` | number | no | `16` | integer, 10–24 | UI font size in px |
| `queryEditorFontFamily` | string | no | `"Consolas"` | | Font for SQL editor |
| `queryEditorFontSize` | number | no | `15` | integer, 10–24 | Editor font size in px |
| `dataFontFamily` | string | no | `"Consolas"` | | Font for data/result grids |
| `dataFontSize` | number | no | `11` | integer, 10–24 | Data grid font size in px |
| `oracleClientLibDir` | string | no | `""` | | Override path for Oracle Instant Client |
| `aiSuggestionsEnabled` | boolean | no | `false` | | Whether AI suggestions are active |
| `aiModel` | string | no | `"gpt-4o-mini"` | | AI model identifier |
| `aiEndpoint` | string | no | `"https://api.openai.com/v1/chat/completions"` | | AI API endpoint |
| `lastUsedConnectionProfileId` | string | no | `""` | | Profile ID to restore on launch |
| `keyBindings` | `KeyBindings` | no | (see below) | | Custom keyboard shortcuts |

### `KeyBindings`
Nested within `UserSettings`.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `executeQuery` | string | no | `"Ctrl+Enter"` | Execute current query or selection |
| `saveDdl` | string | no | `"Ctrl+S"` | Save active object DDL |
| `findInEditor` | string | no | `"Ctrl+F"` | Open find panel in SQL editor |
| `commitDataChanges` | string | no | `"Ctrl+Shift+S"` | Commit pending grid data changes |

Key binding strings use the format `"Modifier+Modifier+Key"` where modifiers are `Ctrl`, `Shift`,
`Alt`, and key is a standard key name (e.g., `Enter`, `F5`, `S`). On Windows, `Ctrl` maps to
the Control key.

---

## Query Sheet Persistence

Query sheets are persisted by the C# host in a separate JSON file.

### `PersistedQuerySheetState`
Root object.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `queryTabs` | `PersistedQuerySheet[]` | yes | All open query tabs |
| `activeWorkspaceTabId` | string | yes | ID of the currently-active tab |
| `queryTabNumber` | number | yes | Next tab number to use when creating a new tab |

### `PersistedQuerySheet`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Tab ID, format `"query:N"` where N is a positive integer |
| `title` | string | yes | User-visible tab title, e.g., `"Query 1"` |
| `queryText` | string | yes | Current SQL content |

**Validation on load:**
- `queryTabs` must be an array; invalid items are skipped
- Tab `id` must match `^query:\d+$`
- Duplicate IDs are skipped
- If all tabs are invalid, create a default first tab
- `activeWorkspaceTabId` must match an existing tab; if not, use first tab
- `queryTabNumber` must exceed the maximum tab number seen; if not, use max+1

**Storage key:** File name `clarity-query-sheets.v1.json` in the app local state directory.
