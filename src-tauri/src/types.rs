use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DatabaseProvider {
    Oracle,
    Postgres,
    Mysql,
    Sqlite,
}

impl DatabaseProvider {
    pub(crate) fn label(self) -> &'static str {
        match self {
            DatabaseProvider::Oracle => "oracle",
            DatabaseProvider::Postgres => "postgres",
            DatabaseProvider::Mysql => "mysql",
            DatabaseProvider::Sqlite => "sqlite",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub(crate) enum OracleAuthMode {
    #[default]
    Normal,
    Sysdba,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OracleConnectionOptions {
    pub(crate) host: String,
    pub(crate) port: Option<u16>,
    pub(crate) service_name: String,
    pub(crate) username: String,
    pub(crate) schema: String,
    #[serde(default)]
    pub(crate) oracle_auth_mode: OracleAuthMode,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OracleConnectOptions {
    pub(crate) host: String,
    pub(crate) port: Option<u16>,
    pub(crate) service_name: String,
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) schema: String,
    #[serde(default)]
    pub(crate) oracle_auth_mode: OracleAuthMode,
    pub(crate) oracle_client_lib_dir: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionRequest {
    pub(crate) session_id: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkConnectionOptions {
    pub(crate) host: String,
    pub(crate) port: Option<u16>,
    pub(crate) database: String,
    pub(crate) username: String,
    pub(crate) schema: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NetworkConnectOptions {
    pub(crate) host: String,
    pub(crate) port: Option<u16>,
    pub(crate) database: String,
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) schema: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SqliteConnectionOptions {
    pub(crate) file_path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbConnectRequest {
    #[serde(flatten)]
    pub(crate) connection: DbConnectConnection,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "provider", content = "connection", rename_all = "lowercase")]
pub(crate) enum DbConnectConnection {
    Oracle(OracleConnectOptions),
    Postgres(NetworkConnectOptions),
    Mysql(NetworkConnectOptions),
    Sqlite(SqliteConnectionOptions),
}

impl DbConnectRequest {
    pub(crate) fn provider(&self) -> DatabaseProvider {
        self.connection.provider()
    }
}

impl DbConnectConnection {
    pub(crate) fn provider(&self) -> DatabaseProvider {
        match self {
            DbConnectConnection::Oracle(_) => DatabaseProvider::Oracle,
            DbConnectConnection::Postgres(_) => DatabaseProvider::Postgres,
            DbConnectConnection::Mysql(_) => DatabaseProvider::Mysql,
            DbConnectConnection::Sqlite(_) => DatabaseProvider::Sqlite,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbQueryRequest {
    pub(crate) session_id: u64,
    pub(crate) sql: String,
    pub(crate) row_limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbFilteredQueryRequest {
    pub(crate) session_id: u64,
    pub(crate) sql: String,
    pub(crate) row_limit: Option<u32>,
    pub(crate) global_search: Option<String>,
    pub(crate) column_filters: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbSchemaSearchRequest {
    pub(crate) session_id: u64,
    pub(crate) search_term: String,
    pub(crate) limit: Option<u32>,
    pub(crate) include_object_names: Option<bool>,
    pub(crate) include_source: Option<bool>,
    pub(crate) include_ddl: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbObjectRef {
    pub(crate) session_id: u64,
    pub(crate) schema: String,
    pub(crate) object_type: String,
    pub(crate) object_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbObjectDdlUpdateRequest {
    pub(crate) session_id: u64,
    pub(crate) schema: String,
    pub(crate) object_type: String,
    pub(crate) object_name: String,
    pub(crate) ddl: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbExportSchemaRequest {
    pub(crate) session_id: u64,
    pub(crate) destination_directory: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbSaveQuerySheetRequest {
    pub(crate) suggested_file_name: String,
    pub(crate) sql: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbSaveQuerySheetInput {
    pub(crate) title: String,
    pub(crate) sql: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbSaveQuerySheetsRequest {
    pub(crate) sheets: Vec<DbSaveQuerySheetInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionProfileRef {
    pub(crate) profile_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SaveConnectionProfileRequest {
    pub(crate) id: Option<String>,
    pub(crate) name: String,
    #[serde(flatten)]
    pub(crate) connection: DbConnectionProfile,
    pub(crate) save_password: bool,
    pub(crate) password: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbSessionSummary {
    pub(crate) session_id: u64,
    pub(crate) display_name: String,
    pub(crate) schema: String,
    pub(crate) provider: DatabaseProvider,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectionProfile {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(flatten)]
    pub(crate) connection: DbConnectionProfile,
    pub(crate) has_password: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredConnectionProfile {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(flatten)]
    pub(crate) connection: DbConnectionProfile,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "provider", content = "connection", rename_all = "lowercase")]
pub(crate) enum DbConnectionProfile {
    Oracle(OracleConnectionOptions),
    Postgres(NetworkConnectionOptions),
    Mysql(NetworkConnectionOptions),
    Sqlite(SqliteConnectionOptions),
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbObjectEntry {
    pub(crate) schema: String,
    pub(crate) object_type: String,
    pub(crate) object_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbObjectColumnEntry {
    pub(crate) schema: String,
    pub(crate) object_name: String,
    pub(crate) column_name: String,
    pub(crate) data_type: String,
    pub(crate) nullable: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbQueryResult {
    pub(crate) columns: Vec<String>,
    pub(crate) rows: Vec<Vec<String>>,
    pub(crate) rows_affected: Option<u64>,
    pub(crate) message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbTransactionState {
    pub(crate) active: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbSchemaSearchResult {
    pub(crate) schema: String,
    pub(crate) object_type: String,
    pub(crate) object_name: String,
    pub(crate) match_scope: String,
    pub(crate) line: Option<u32>,
    pub(crate) snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbSchemaExportResult {
    pub(crate) destination_directory: String,
    pub(crate) object_count: usize,
    pub(crate) file_count: usize,
    pub(crate) skipped_count: usize,
    pub(crate) message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbSaveQuerySheetsResult {
    pub(crate) directory: String,
    pub(crate) file_count: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbAiSchemaContextObject {
    pub(crate) schema: String,
    pub(crate) object_name: String,
    pub(crate) columns: Vec<String>,
    #[serde(default)]
    pub(crate) is_referenced_in_query: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbAiSuggestQueryRequest {
    pub(crate) current_sql: String,
    pub(crate) connected_schema: String,
    pub(crate) endpoint: String,
    pub(crate) model: String,
    pub(crate) schema_context: Vec<DbAiSchemaContextObject>,
    #[serde(default)]
    pub(crate) cursor_clause: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbAiSuggestQueryResult {
    pub(crate) suggestion_text: String,
    #[serde(default = "default_ai_confidence")]
    pub(crate) confidence: f32,
    #[serde(default)]
    pub(crate) reasoning_short: String,
    #[serde(default)]
    pub(crate) is_potentially_mutating: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbAiApiKeyPresence {
    pub(crate) configured: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DbSchemaExportProgress {
    pub(crate) processed_objects: usize,
    pub(crate) total_objects: usize,
    pub(crate) exported_files: usize,
    pub(crate) skipped_count: usize,
    pub(crate) current_object: String,
}

fn default_ai_confidence() -> f32 {
    0.5
}
