# Clarity — IPC Contract (C# Host ↔ Rust Core)

This document is the primary reference for the C# developer. It describes exactly how the WinUI 3
host communicates with the Rust core process, without requiring the developer to read Rust code.

All data type definitions are in `05-data-types.md`. The JSON-RPC transport is described in
`00-architecture.md`.

---

## Transport

The Rust core (`clarity-core.exe`) is launched by the C# host as a child process:

```csharp
var psi = new ProcessStartInfo
{
    FileName = "clarity-core.exe",
    RedirectStandardInput = true,
    RedirectStandardOutput = true,
    RedirectStandardError = false,     // core uses stderr for internal diagnostics only
    UseShellExecute = false,
    CreateNoWindow = true,
};
// Pass Oracle client dir override via environment if needed:
psi.Environment["ORACLE_CLIENT_LIB_DIR"] = userSettings.OracleClientLibDir;
```

**Startup handshake:**
After spawning the process, read from stdout until the ready notification arrives:
```json
{"jsonrpc":"2.0","method":"event.ready","params":{"version":"0.1.27"}}
```
Do not send any requests before receiving this line. If the process exits before sending `event.ready`,
display an error dialog.

**Framing:** Each message is one JSON object followed by `\n` (LF). No BOM. UTF-8.

**Multiplexing:** Requests and responses are correlated by the `id` field. Assign a monotonically
increasing integer ID to each request from the C# side. Process incoming lines as they arrive;
match responses to pending requests by ID. Lines with no `id` (or `id: null`) are notifications.

---

## C# Client Structure

Recommended implementation:

```csharp
public class ClarityClient : IDisposable
{
    // Send a request and await the typed result
    public Task<TResult> SendAsync<TResult>(string method, object? @params = null, CancellationToken ct = default);

    // Subscribe to a specific notification method
    public IObservable<T> Notifications<T>(string method);

    // Graceful shutdown
    public Task ShutdownAsync();
}
```

`SendAsync` throws `ClarityException` (wraps the JSON-RPC error) on error responses.

`ClarityException` should carry:
- `Code`: JSON-RPC error code (int)
- `Message`: error message string
- `Kind`: extracted from `data.kind` when present (`"oracleClientMissing"` or `"general"`)

---

## Method Reference Table

| JSON-RPC Method | C# Request Type | C# Result Type | Notes |
|---|---|---|---|
| `db.connect` | `DbConnectRequest` | `DbSessionSummary` | Throws `ClarityException` with `Kind = "oracleClientMissing"` on DPI-1047 |
| `db.disconnect` | `SessionRequest` | `void` | |
| `db.listObjects` | `SessionRequest` | `DbObjectEntry[]` | |
| `db.listObjectColumns` | `SessionRequest` | `DbObjectColumnEntry[]` | |
| `db.runQuery` | `DbQueryRequest` | `DbQueryResult` | |
| `db.runQueryFiltered` | `DbFilteredQueryRequest` | `DbQueryResult` | |
| `db.getObjectDdl` | `DbObjectRef` | `string` | Returns raw DDL text |
| `db.updateObjectDdl` | `DbObjectDdlUpdateRequest` | `DbQueryResult` | Result contains compilation diagnostics |
| `db.getTransactionState` | `SessionRequest` | `DbTransactionState` | |
| `db.beginTransaction` | `SessionRequest` | `DbTransactionState` | |
| `db.commitTransaction` | `SessionRequest` | `DbTransactionState` | |
| `db.rollbackTransaction` | `SessionRequest` | `DbTransactionState` | |
| `db.searchSchemaText` | `DbSchemaSearchRequest` | `DbSchemaSearchResult[]` | |
| `db.exportSchema` | `DbExportSchemaRequest` | `DbSchemaExportResult` | Also emits `event.schemaExportProgress` notifications |
| `profiles.list` | `null` | `ConnectionProfile[]` | |
| `profiles.save` | `SaveConnectionProfileRequest` | `ConnectionProfile` | |
| `profiles.delete` | `ConnectionProfileRef` | `void` | |
| `profiles.getSecret` | `ConnectionProfileRef` | `string?` | Returns `null` if no password stored |
| `ai.hasApiKey` | `null` | `DbAiApiKeyPresence` | |
| `ai.setApiKey` | `{ "apiKey": string }` | `void` | |
| `ai.clearApiKey` | `null` | `void` | |
| `ai.suggestQuery` | `AiQuerySuggestionRequest` | `AiQuerySuggestionResponse` | |
| `files.pickDirectory` | `null` | `string?` | Returns `null` if user cancels |
| `files.saveQuerySheet` | `DbSaveQuerySheetRequest` | `string?` | Returns saved path or `null` |
| `files.saveQuerySheets` | `DbSaveQuerySheetsRequest` | `DbSaveQuerySheetsResult?` | Returns `null` if user cancels |

---

## Wire Format Examples

### Request

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "db.connect",
  "params": {
    "provider": "oracle",
    "connection": {
      "host": "localhost",
      "port": 1521,
      "serviceName": "XEPDB1",
      "username": "hr",
      "password": "secret",
      "schema": "HR",
      "oracleAuthMode": "normal",
      "oracleClientLibDir": null
    }
  }
}
```

### Success Response

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sessionId": 1,
    "displayName": "hr@//localhost:1521/XEPDB1 [HR]",
    "schema": "HR",
    "provider": "oracle"
  }
}
```

### Error Response (general)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32000,
    "message": "ORA-01017: invalid username/password; logon denied",
    "data": {
      "kind": "general",
      "message": "ORA-01017: invalid username/password; logon denied"
    }
  }
}
```

### Error Response (oracleClientMissing)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32000,
    "message": "Oracle Client libraries not found (DPI-1047)",
    "data": {
      "kind": "oracleClientMissing",
      "message": "DPI-1047: Cannot locate a 64-bit Oracle Client library. See https://oracle.github.io/odpi/doc/installation.html for help."
    }
  }
}
```

### Notification (no id)

```json
{
  "jsonrpc": "2.0",
  "method": "event.schemaExportProgress",
  "params": {
    "processedObjects": 10,
    "totalObjects": 84,
    "exportedFiles": 9,
    "skippedCount": 1,
    "currentObject": "TABLE HR.EMPLOYEES"
  }
}
```

### Null-result response

For methods that return `void`, the result field is `null`:

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": null
}
```

### Null-valued optional result

For methods that may return a null value (e.g., `profiles.getSecret`, `files.pickDirectory`):

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "result": null
}
```

The C# generic type parameter for these calls is `string?` (nullable). A `null` result is
successful — it is not an error.

---

## Notification Handling

The C# read loop must handle two message types on the same stream:

1. **Responses** — have an `id` field that matches a pending request. Resolve the corresponding
   `TaskCompletionSource`.
2. **Notifications** — have no `id` (field absent or `null`). Dispatch to registered subscribers
   based on the `method` field.

Example subscriber registration:

```csharp
_client.Notifications<DbSchemaExportProgress>("event.schemaExportProgress")
       .Subscribe(progress => UpdateExportDialog(progress));
```

Notifications to handle:

| Method | Params Type | When |
|--------|-------------|------|
| `event.ready` | `{ "version": string }` | Once, immediately after core starts |
| `event.schemaExportProgress` | `DbSchemaExportProgress` | During `db.exportSchema` |

---

## Error Handling

### `ClarityException`

```csharp
public class ClarityException : Exception
{
    public int Code { get; }           // JSON-RPC error code
    public string? Kind { get; }       // data.kind if present
    // Message inherited from Exception
}
```

### Handling `oracleClientMissing`

```csharp
try
{
    session = await _client.SendAsync<DbSessionSummary>("db.connect", request);
}
catch (ClarityException ex) when (ex.Kind == "oracleClientMissing")
{
    ShowOracleClientMissingPanel(ex.Message);
}
catch (ClarityException ex)
{
    ShowConnectionError(ex.Message);
}
```

The `oracleClientMissing` case must show a dedicated UI panel (see `02-ui-windows.md §Connection
Dialog`) that guides the user to install Oracle Instant Client or configure the library path.

---

## Process Management

### Starting the Core

```csharp
_coreProcess = Process.Start(psi)!;
_reader = new StreamReader(_coreProcess.StandardOutput.BaseStream, Encoding.UTF8);
_writer = new StreamWriter(_coreProcess.StandardInput.BaseStream, Encoding.UTF8) { AutoFlush = false };

// Wait for event.ready (with timeout)
var readyLine = await ReadLineWithTimeoutAsync(_reader, TimeSpan.FromSeconds(10));
// Parse and verify readyLine is event.ready before proceeding
```

### Passing Environment Variables

Before starting, set the environment for the child process:

```csharp
if (!string.IsNullOrWhiteSpace(userSettings.OracleClientLibDir))
    psi.Environment["ORACLE_CLIENT_LIB_DIR"] = userSettings.OracleClientLibDir;
```

The core also reads `ORACLE_CLIENT_LIB_DIR` from its own environment as part of the client search
order.

### Graceful Shutdown

```csharp
// Option A: send shutdown method
await _client.SendAsync<object?>("system.shutdown");

// Option B: close stdin — core detects EOF and exits
_coreProcess.StandardInput.Close();

// Wait for clean exit
await Task.Run(() => _coreProcess.WaitForExit(3000));
if (!_coreProcess.HasExited)
    _coreProcess.Kill();
```

### Crash Recovery

If `_coreProcess.HasExited` becomes true unexpectedly:
1. Fail all pending requests with a `ClarityException("Core process terminated unexpectedly")`
2. Show a non-dismissible error bar at the bottom of the main window
3. Offer a "Restart" button that re-spawns the core

---

## Serialization Notes

- All JSON field names are `camelCase`
- C# models use `[JsonPropertyName("fieldName")]` on each property
- `null` and missing optional fields are treated equivalently on both ends
- `number` in JSON maps to `long` (for session IDs, row counts) or `double` (for confidence)
  depending on context — see `05-data-types.md` for per-field types
- Boolean `false` is different from `null` — do not omit boolean fields
- Arrays are never `null` in responses; they are `[]` when empty

Recommended library: `System.Text.Json` with `JsonSerializerOptions`:

```csharp
var options = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
};
```

---

## Concurrency

The C# host may send multiple requests concurrently (different `id` values). The core processes
them and may respond out of order. The C# `ClarityClient` must handle out-of-order responses
by matching `id` values, not by assuming FIFO ordering.

However, operations within a single session that modify session state (query execution, DDL save,
transaction management) should be serialized on the C# side to avoid race conditions. Use a
per-session `SemaphoreSlim(1)` or similar.

Read-only operations (`listObjects`, `listObjectColumns`, `getObjectDdl`) are safe to parallelize.
