use crate::{
    DbConnectRequest, OracleDdlUpdateRequest, OracleObjectEntry, OracleObjectRef,
    OracleQueryRequest, OracleQueryResult, OracleSourceSearchRequest, OracleSourceSearchResult,
};
use oracle::{Connection, Error as OracleError, InitParams, SqlValue};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_EXPLORER_OBJECTS: u32 = 5000;
const MAX_QUERY_ROWS: usize = 1000;
const DEFAULT_SOURCE_SEARCH_LIMIT: u32 = 200;
const MAX_SOURCE_SEARCH_RESULTS: u32 = 1000;

pub(crate) struct OracleSession {
    pub(crate) connection: Connection,
    target_schema: String,
}

pub(crate) fn connect(
    request: &DbConnectRequest,
) -> Result<(OracleSession, String, String), String> {
    ensure_oracle_client_initialized()?;

    let host = request.host.trim();
    let port = request.port.unwrap_or(1521);
    let service_name = request.service_name.trim();
    let username = request.username.trim();
    let password = request.password.as_str();
    let schema = normalize_schema_name(&request.schema)?;

    let connect_string = format!("//{}:{}/{}", host, port, service_name);
    let connection = Connection::connect(username, password, &connect_string)
        .map_err(|error| map_connect_error(error, host, port, service_name))?;
    let alter_schema_sql = format!("ALTER SESSION SET CURRENT_SCHEMA = {}", schema);
    connection
        .execute(alter_schema_sql.as_str(), &[])
        .map_err(map_oracle_error)?;

    let display_name = format!("{}@{} [{}]", username, connect_string, schema);
    let session = OracleSession {
        connection,
        target_schema: schema.clone(),
    };

    Ok((session, display_name, schema))
}

pub(crate) fn list_objects(session: &OracleSession) -> Result<Vec<OracleObjectEntry>, String> {
    let sql = r#"
        SELECT OWNER, OBJECT_TYPE, OBJECT_NAME
        FROM (
            SELECT OWNER, OBJECT_TYPE, OBJECT_NAME
            FROM ALL_OBJECTS
            WHERE OWNER = :1
              AND OBJECT_TYPE IN (
                  'TABLE',
                  'VIEW',
                  'PROCEDURE',
                  'FUNCTION',
                  'PACKAGE',
                  'PACKAGE BODY',
                  'TRIGGER',
                  'SEQUENCE'
              )
            ORDER BY OBJECT_TYPE, OBJECT_NAME
        )
        WHERE ROWNUM <= :2
    "#;

    let rows = session
        .connection
        .query(sql, &[&session.target_schema, &MAX_EXPLORER_OBJECTS])
        .map_err(map_oracle_error)?;

    let mut objects = Vec::new();
    for row_result in rows {
        let row = row_result.map_err(map_oracle_error)?;
        objects.push(OracleObjectEntry {
            schema: row.get::<usize, String>(0).map_err(map_oracle_error)?,
            object_type: row.get::<usize, String>(1).map_err(map_oracle_error)?,
            object_name: row.get::<usize, String>(2).map_err(map_oracle_error)?,
        });
    }

    Ok(objects)
}

pub(crate) fn get_object_ddl(
    session: &OracleSession,
    request: &OracleObjectRef,
) -> Result<String, String> {
    let schema = normalize_schema_name(&request.schema)?;
    ensure_schema_is_in_scope(&schema, session)?;
    let object_name = request.object_name.trim().to_ascii_uppercase();
    let source_type = normalize_source_type(&request.object_type);
    let metadata_type = normalize_metadata_type(&request.object_type);

    if let Some(source_ddl) = fetch_source_ddl(
        &session.connection,
        schema.as_str(),
        source_type.as_str(),
        object_name.as_str(),
    )
    .map_err(map_oracle_error)?
    {
        return Ok(source_ddl);
    }

    let ddl_sql = "SELECT DBMS_METADATA.GET_DDL(:1, :2, :3) FROM DUAL";
    session
        .connection
        .query_row_as::<String>(ddl_sql, &[&metadata_type, &object_name, &schema])
        .map_err(map_oracle_error)
}

pub(crate) fn search_source_code(
    session: &OracleSession,
    request: &OracleSourceSearchRequest,
) -> Result<Vec<OracleSourceSearchResult>, String> {
    let search_term = request.search_term.trim();
    if search_term.is_empty() {
        return Err("Search term is required".to_string());
    }

    let search_term = search_term.to_string();
    let limit = request
        .limit
        .unwrap_or(DEFAULT_SOURCE_SEARCH_LIMIT)
        .clamp(1, MAX_SOURCE_SEARCH_RESULTS);
    let sql = r#"
        SELECT OWNER, TYPE, NAME, LINE, TEXT
        FROM (
            SELECT OWNER, TYPE, NAME, LINE, TEXT
            FROM ALL_SOURCE
            WHERE OWNER = :1
              AND TYPE IN (
                  'PROCEDURE',
                  'FUNCTION',
                  'PACKAGE',
                  'PACKAGE BODY',
                  'TRIGGER',
                  'TYPE',
                  'TYPE BODY'
              )
              AND INSTR(UPPER(TEXT), UPPER(:2)) > 0
            ORDER BY TYPE, NAME, LINE
        )
        WHERE ROWNUM <= :3
    "#;

    let rows = session
        .connection
        .query(sql, &[&session.target_schema, &search_term, &limit])
        .map_err(map_oracle_error)?;
    let mut matches = Vec::new();

    for row_result in rows {
        let row = row_result.map_err(map_oracle_error)?;
        let raw_line: i64 = row.get::<usize, i64>(3).map_err(map_oracle_error)?;
        let line = raw_line.max(1).min(u32::MAX as i64) as u32;
        let text = row
            .get::<usize, String>(4)
            .map_err(map_oracle_error)?
            .trim_end_matches(&['\r', '\n'][..])
            .to_string();

        matches.push(OracleSourceSearchResult {
            schema: row.get::<usize, String>(0).map_err(map_oracle_error)?,
            object_type: row.get::<usize, String>(1).map_err(map_oracle_error)?,
            object_name: row.get::<usize, String>(2).map_err(map_oracle_error)?,
            line,
            text,
        });
    }

    Ok(matches)
}

pub(crate) fn update_object_ddl(
    session: &mut OracleSession,
    request: &OracleDdlUpdateRequest,
) -> Result<String, String> {
    let mut ddl = request.ddl.trim().to_string();
    if ddl.is_empty() {
        return Err("DDL cannot be empty".to_string());
    }

    ddl = normalize_ddl_for_execute(ddl);
    let schema = normalize_schema_name(&request.schema)?;
    ensure_schema_is_in_scope(&schema, session)?;

    session
        .connection
        .execute(ddl.as_str(), &[])
        .map_err(map_oracle_error)?;
    session.connection.commit().map_err(map_oracle_error)?;

    Ok(format!(
        "{} {}.{} updated",
        request.object_type.to_ascii_uppercase(),
        schema,
        request.object_name.to_ascii_uppercase()
    ))
}

pub(crate) fn run_query(
    session: &mut OracleSession,
    request: &OracleQueryRequest,
) -> Result<OracleQueryResult, String> {
    let sql = request.sql.trim();
    if sql.is_empty() {
        return Err("Query cannot be empty".to_string());
    }

    let mut statement = session
        .connection
        .statement(sql)
        .build()
        .map_err(map_oracle_error)?;

    if statement.is_query() {
        let result_set = statement.query(&[]).map_err(map_oracle_error)?;
        let columns = result_set
            .column_info()
            .iter()
            .map(|column| column.name().to_string())
            .collect::<Vec<_>>();

        let mut rows = Vec::new();
        let mut truncated = false;

        for (index, row_result) in result_set.enumerate() {
            if index >= MAX_QUERY_ROWS {
                truncated = true;
                break;
            }

            let row = row_result.map_err(map_oracle_error)?;
            let values = row
                .sql_values()
                .iter()
                .map(sql_value_to_string)
                .collect::<Vec<_>>();
            rows.push(values);
        }

        let mut message = format!("Query executed. Returned {} row(s).", rows.len());
        if truncated {
            message.push_str(&format!(" Results truncated at {} rows.", MAX_QUERY_ROWS));
        }

        return Ok(OracleQueryResult {
            columns,
            rows,
            rows_affected: None,
            message,
        });
    }

    statement.execute(&[]).map_err(map_oracle_error)?;
    let rows_affected = statement.row_count().map_err(map_oracle_error)?;

    if statement.is_dml() || statement.is_plsql() {
        session.connection.commit().map_err(map_oracle_error)?;
    }

    let message = if statement.is_dml() {
        format!("Statement executed. {} row(s) affected.", rows_affected)
    } else if statement.is_ddl() {
        "DDL executed.".to_string()
    } else if statement.is_plsql() {
        "PL/SQL block executed.".to_string()
    } else {
        "Statement executed.".to_string()
    };

    Ok(OracleQueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: Some(rows_affected),
        message,
    })
}

fn normalize_schema_name(schema: &str) -> Result<String, String> {
    let normalized = schema.trim().to_ascii_uppercase();
    if normalized.is_empty() {
        return Err("Schema is required".to_string());
    }

    if !normalized
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '$' || ch == '#')
    {
        return Err(
            "Schema must use unquoted Oracle identifier characters: A-Z, 0-9, _, $, #".to_string(),
        );
    }

    Ok(normalized)
}

fn ensure_schema_is_in_scope(schema: &str, session: &OracleSession) -> Result<(), String> {
    if schema != session.target_schema {
        return Err(format!(
            "Connected schema is {}. Object access is limited to that schema.",
            session.target_schema
        ));
    }

    Ok(())
}

fn map_oracle_error(error: OracleError) -> String {
    error.to_string()
}

fn map_connect_error(error: OracleError, host: &str, port: u16, service_name: &str) -> String {
    let base = error.to_string();

    if base.contains("DPI-1047") {
        return format!(
            "{} Oracle Client libraries are required. Install Oracle Instant Client and ensure the client library path is configured for this app process.",
            base
        );
    }

    format!("{} (target: //{}:{}/{})", base, host, port, service_name)
}

fn normalize_metadata_type(object_type: &str) -> String {
    object_type.trim().to_ascii_uppercase().replace(' ', "_")
}

fn normalize_source_type(object_type: &str) -> String {
    object_type.trim().to_ascii_uppercase()
}

fn is_source_supported(object_type: &str) -> bool {
    matches!(
        object_type,
        "PROCEDURE" | "FUNCTION" | "PACKAGE" | "PACKAGE BODY" | "TRIGGER" | "TYPE" | "TYPE BODY"
    )
}

fn fetch_source_ddl(
    connection: &Connection,
    schema: &str,
    object_type: &str,
    object_name: &str,
) -> Result<Option<String>, OracleError> {
    if !is_source_supported(object_type) {
        return Ok(None);
    }

    let sql = r#"
        SELECT TEXT
        FROM ALL_SOURCE
        WHERE OWNER = :1
          AND TYPE = :2
          AND NAME = :3
        ORDER BY LINE
    "#;

    let rows = connection.query(sql, &[&schema, &object_type, &object_name])?;

    let mut ddl = String::new();
    for row_result in rows {
        let row = row_result?;
        let text: String = row.get(0)?;
        ddl.push_str(&text);
        if !text.ends_with('\n') {
            ddl.push('\n');
        }
    }

    if ddl.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(ddl))
    }
}

fn sql_value_to_string(value: &SqlValue<'_>) -> String {
    value.to_string()
}

fn normalize_ddl_for_execute(ddl: String) -> String {
    let mut lines = ddl.lines().map(str::to_string).collect::<Vec<_>>();

    while lines
        .last()
        .is_some_and(|line| line.trim().is_empty() || line.trim() == "/")
    {
        lines.pop();
    }

    lines.join("\n")
}

fn ensure_oracle_client_initialized() -> Result<(), String> {
    if InitParams::is_initialized() {
        return Ok(());
    }

    let mut params = InitParams::new();
    let mut chosen_lib_dir: Option<PathBuf> = None;

    if let Some(path) = env::var_os("ORACLE_CLIENT_LIB_DIR").map(PathBuf::from) {
        chosen_lib_dir = Some(path);
    } else if cfg!(target_os = "macos") {
        chosen_lib_dir = detect_macos_instant_client_dir();
    }

    if let Some(dir) = chosen_lib_dir.as_ref() {
        params
            .oracle_client_lib_dir(dir)
            .map_err(map_oracle_error)?;
    }

    if let Some(tns_admin) = env::var_os("TNS_ADMIN") {
        params
            .oracle_client_config_dir(tns_admin)
            .map_err(map_oracle_error)?;
    }

    params.init().map_err(|error| {
        let base = error.to_string();
        if base.contains("DPI-1047") {
            let env_hint = if let Some(dir) = chosen_lib_dir {
                format!(" Tried ORACLE client dir: {}.", dir.to_string_lossy())
            } else {
                " Set ORACLE_CLIENT_LIB_DIR to your Instant Client directory.".to_string()
            };

            return format!(
                "{} Oracle Client libraries are required.{} On macOS, install Instant Client and start the app with ORACLE_CLIENT_LIB_DIR set.",
                base, env_hint
            );
        }

        base
    })?;

    Ok(())
}

fn detect_macos_instant_client_dir() -> Option<PathBuf> {
    let candidates = [
        Path::new("/opt/homebrew/lib"),
        Path::new("/usr/local/lib"),
        Path::new("/opt/oracle"),
        Path::new("/opt/oracle/instantclient"),
    ];

    for base in candidates {
        if let Some(found) = find_instant_client_dir(base) {
            return Some(found);
        }
    }

    None
}

fn find_instant_client_dir(base: &Path) -> Option<PathBuf> {
    if !base.exists() || !base.is_dir() {
        return None;
    }

    if contains_libclntsh(base) {
        return Some(base.to_path_buf());
    }

    let entries = fs::read_dir(base).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();

        if path.is_dir() && file_name.starts_with("instantclient") && contains_libclntsh(&path) {
            return Some(path);
        }
    }

    None
}

fn contains_libclntsh(dir: &Path) -> bool {
    if dir.join("libclntsh.dylib").exists() {
        return true;
    }

    if let Ok(entries) = fs::read_dir(dir) {
        return entries.flatten().any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("libclntsh.dylib.")
        });
    }

    false
}
