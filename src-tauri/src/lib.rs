mod providers;

use keyring::{Entry, Error as KeyringError};
use providers::{AppSession, DatabaseProvider, ProviderRegistry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};

const PROFILE_STORE_FILE: &str = "connection_profiles.json";
const KEYRING_SERVICE: &str = "com.waldencorp.clarity";
const KEYRING_AI_API_KEY_ACCOUNT: &str = "ai:openai:api_key";
const MENU_ID_TOOLS_SETTINGS: &str = "tools.settings";
const MENU_ID_TOOLS_FIND_IN_SCHEMA: &str = "tools.find_in_schema";
const MENU_ID_TOOLS_EXPORT_DATABASE: &str = "tools.export_database";
const EVENT_OPEN_SETTINGS_DIALOG: &str = "clarity://open-settings-dialog";
const EVENT_OPEN_SCHEMA_SEARCH: &str = "clarity://open-schema-search";
const EVENT_OPEN_EXPORT_DATABASE_DIALOG: &str = "clarity://open-export-database-dialog";
const EVENT_SCHEMA_EXPORT_PROGRESS: &str = "clarity://schema-export-progress";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbConnectRequest {
    provider: DatabaseProvider,
    host: String,
    port: Option<u16>,
    service_name: String,
    username: String,
    password: String,
    schema: String,
    oracle_client_lib_dir: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionRequest {
    session_id: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleQueryRequest {
    session_id: u64,
    sql: String,
    row_limit: Option<u32>,
    allow_destructive: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbSchemaSearchRequest {
    session_id: u64,
    search_term: String,
    limit: Option<u32>,
    include_object_names: Option<bool>,
    include_source: Option<bool>,
    include_ddl: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleObjectRef {
    session_id: u64,
    schema: String,
    object_type: String,
    object_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleDdlUpdateRequest {
    session_id: u64,
    schema: String,
    object_type: String,
    object_name: String,
    ddl: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbExportSchemaRequest {
    session_id: u64,
    destination_directory: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionProfileRef {
    profile_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveConnectionProfileRequest {
    id: Option<String>,
    name: String,
    provider: DatabaseProvider,
    host: String,
    port: Option<u16>,
    service_name: String,
    username: String,
    schema: String,
    save_password: bool,
    password: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DbSessionSummary {
    session_id: u64,
    display_name: String,
    schema: String,
    provider: DatabaseProvider,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectionProfile {
    id: String,
    name: String,
    provider: DatabaseProvider,
    host: String,
    port: Option<u16>,
    service_name: String,
    username: String,
    schema: String,
    has_password: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredConnectionProfile {
    id: String,
    name: String,
    provider: DatabaseProvider,
    host: String,
    port: Option<u16>,
    service_name: String,
    username: String,
    schema: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OracleObjectEntry {
    schema: String,
    object_type: String,
    object_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OracleObjectColumnEntry {
    schema: String,
    object_name: String,
    column_name: String,
    data_type: String,
    nullable: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OracleQueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<String>>,
    rows_affected: Option<u64>,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DbSchemaSearchResult {
    schema: String,
    object_type: String,
    object_name: String,
    match_scope: String,
    line: Option<u32>,
    snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DbSchemaExportResult {
    destination_directory: String,
    object_count: usize,
    file_count: usize,
    skipped_count: usize,
    message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbAiSchemaContextObject {
    schema: String,
    object_name: String,
    columns: Vec<String>,
    #[serde(default)]
    is_referenced_in_query: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbAiSuggestQueryRequest {
    current_sql: String,
    connected_schema: String,
    endpoint: String,
    model: String,
    schema_context: Vec<DbAiSchemaContextObject>,
    #[serde(default)]
    cursor_clause: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DbAiSuggestQueryResult {
    suggestion_text: String,
    #[serde(default = "default_ai_confidence")]
    confidence: f32,
    #[serde(default)]
    reasoning_short: String,
    #[serde(default)]
    is_potentially_mutating: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DbAiApiKeyPresence {
    configured: bool,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatCompletionResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    content: String,
}

fn default_ai_confidence() -> f32 {
    0.5
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DbSchemaExportProgress {
    processed_objects: usize,
    total_objects: usize,
    exported_files: usize,
    skipped_count: usize,
    current_object: String,
}

struct AppState {
    next_session_id: AtomicU64,
    next_profile_id: AtomicU64,
    sessions: Arc<Mutex<HashMap<u64, AppSession>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            next_session_id: AtomicU64::new(1),
            next_profile_id: AtomicU64::new(1),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
fn db_connect(
    request: DbConnectRequest,
    state: tauri::State<AppState>,
) -> Result<DbSessionSummary, String> {
    validate_connect_request(&request)?;
    let (session, display_name, schema) = ProviderRegistry::connect(&request)?;

    let session_id = state.next_session_id.fetch_add(1, Ordering::Relaxed);
    let summary = DbSessionSummary {
        session_id,
        display_name,
        schema,
        provider: request.provider,
    };

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    sessions.insert(session_id, session);

    Ok(summary)
}

#[tauri::command]
fn db_disconnect(request: SessionRequest, state: tauri::State<AppState>) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;

    match sessions.remove(&request.session_id) {
        Some(_) => Ok(()),
        None => Err("Session not found".to_string()),
    }
}

#[tauri::command]
fn db_list_objects(
    request: SessionRequest,
    state: tauri::State<AppState>,
) -> Result<Vec<OracleObjectEntry>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    let session = sessions
        .get(&request.session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    ProviderRegistry::list_objects(session)
}

#[tauri::command]
fn db_list_object_columns(
    request: SessionRequest,
    state: tauri::State<AppState>,
) -> Result<Vec<OracleObjectColumnEntry>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    let session = sessions
        .get(&request.session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    ProviderRegistry::list_object_columns(session)
}

#[tauri::command]
fn db_get_object_ddl(
    request: OracleObjectRef,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    let session = sessions
        .get(&request.session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    ProviderRegistry::get_object_ddl(session, &request)
}

#[tauri::command]
fn db_update_object_ddl(
    request: OracleDdlUpdateRequest,
    state: tauri::State<AppState>,
) -> Result<String, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    let session = sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    ProviderRegistry::update_object_ddl(session, &request)
}

#[tauri::command]
fn db_run_query(
    request: OracleQueryRequest,
    state: tauri::State<AppState>,
) -> Result<OracleQueryResult, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    let session = sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    ProviderRegistry::run_query(session, &request)
}

#[tauri::command]
fn db_search_schema_text(
    request: DbSchemaSearchRequest,
    state: tauri::State<AppState>,
) -> Result<Vec<DbSchemaSearchResult>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    let session = sessions
        .get(&request.session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    ProviderRegistry::search_schema_text(session, &request)
}

#[tauri::command]
fn db_has_ai_api_key() -> Result<DbAiApiKeyPresence, String> {
    let configured = read_ai_api_key()?.is_some();
    Ok(DbAiApiKeyPresence { configured })
}

#[tauri::command]
fn db_set_ai_api_key(api_key: String) -> Result<(), String> {
    let normalized = api_key.trim();
    if normalized.is_empty() {
        return Err("API key is required.".to_string());
    }

    write_ai_api_key(normalized)
}

#[tauri::command]
fn db_clear_ai_api_key() -> Result<(), String> {
    clear_ai_api_key()
}

#[tauri::command]
async fn db_ai_suggest_query(
    request: DbAiSuggestQueryRequest,
) -> Result<DbAiSuggestQueryResult, String> {
    validate_ai_suggest_request(&request)?;
    let api_key = read_ai_api_key()?
        .ok_or_else(|| "AI API key is not configured. Add it in Settings -> AI.".to_string())?;

    let endpoint = normalize_ai_endpoint(request.endpoint.as_str());
    let schema_context_prompt = build_ai_schema_context_prompt(&request.schema_context);
    let clause_hint = request
        .cursor_clause
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|clause| format!("\nThe user is currently writing the {} clause.", clause))
        .unwrap_or_default();
    let user_message = format!(
        "Connected schema: {}\nCurrent SQL:\n{}\n{}{}",
        request.connected_schema.trim(),
        request.current_sql,
        schema_context_prompt,
        clause_hint
    );

    let system_prompt = [
        "You are an expert Oracle SQL assistant that suggests query completions.",
        "The user is writing an Oracle SQL query and needs a natural continuation.",
        "",
        "Rules:",
        "- Suggest ONLY the continuation text that comes AFTER what the user has already typed.",
        "- Do NOT repeat any part of the current SQL.",
        "- Use ONLY columns and tables from the provided schema context.",
        "- Prefer read-only SQL (SELECT) unless the user's intent clearly requires DML.",
        "- Use correct Oracle SQL syntax (NVL instead of COALESCE, ROWNUM or FETCH FIRST instead of LIMIT, etc.).",
        "- When joining tables, use the correct column names from the schema context.",
        "- Keep suggestions concise and focused — complete the current statement, do not add extra statements.",
        "- Tables marked with [REFERENCED] are already used in the query — strongly prefer their columns for completions.",
        "- suggestionText must be raw SQL continuation text only, without markdown fences and without prose.",
        "",
        "Return valid JSON only (no markdown) with keys: suggestionText, confidence (0.0-1.0), reasoningShort (one sentence), isPotentiallyMutating (boolean).",
    ].join("\n");

    let payload = serde_json::json!({
        "model": request.model.trim(),
        "temperature": 0.05,
        "max_tokens": 300,
        "response_format": { "type": "json_object" },
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": user_message
            }
        ]
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Failed to initialize AI HTTP client: {error}"))?;
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("AI request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_else(|_| String::new());
        let trimmed = body.trim();
        let detail = if trimmed.is_empty() {
            "No response body provided.".to_string()
        } else {
            trimmed.chars().take(350).collect()
        };
        return Err(format!("AI request failed with status {status}: {detail}"));
    }

    let parsed = response
        .json::<OpenAiChatCompletionResponse>()
        .await
        .map_err(|error| format!("Failed to parse AI response envelope: {error}"))?;
    let content = parsed
        .choices
        .first()
        .map(|choice| choice.message.content.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "AI response did not include a suggestion.".to_string())?;

    let mut result = parse_ai_suggestion_payload(content, request.current_sql.as_str())?;
    result.is_potentially_mutating = result.is_potentially_mutating
        || is_potentially_mutating_sql(result.suggestion_text.as_str());

    if result.suggestion_text.is_empty() {
        return Err("AI response did not include suggestion text.".to_string());
    }

    Ok(result)
}

#[tauri::command]
fn db_list_connection_profiles(app: tauri::AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    let stored_profiles = read_profiles(&app)?;
    Ok(stored_profiles
        .into_iter()
        .map(to_connection_profile)
        .collect())
}

#[tauri::command]
fn db_save_connection_profile(
    request: SaveConnectionProfileRequest,
    state: tauri::State<AppState>,
    app: tauri::AppHandle,
) -> Result<ConnectionProfile, String> {
    validate_profile_request(&request)?;
    let mut profiles = read_profiles(&app)?;

    let id = request
        .id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            let mut candidate = format!(
                "profile-{}",
                state.next_profile_id.fetch_add(1, Ordering::Relaxed)
            );
            while profiles.iter().any(|profile| profile.id == candidate) {
                candidate = format!(
                    "profile-{}",
                    state.next_profile_id.fetch_add(1, Ordering::Relaxed)
                );
            }
            candidate
        });

    let updated = StoredConnectionProfile {
        id: id.clone(),
        name: request.name.trim().to_string(),
        provider: request.provider,
        host: request.host.trim().to_string(),
        port: request.port,
        service_name: request.service_name.trim().to_string(),
        username: request.username.trim().to_string(),
        schema: request.schema.trim().to_uppercase(),
    };

    if let Some(position) = profiles.iter().position(|profile| profile.id == id) {
        profiles[position] = updated.clone();
    } else {
        profiles.push(updated.clone());
    }

    write_profiles(&app, &profiles)?;

    if request.save_password {
        let password = request
            .password
            .as_deref()
            .ok_or_else(|| "Password is required when 'savePassword' is enabled.".to_string())?;
        write_profile_secret(id.as_str(), password)?;
    } else {
        clear_profile_secret(id.as_str())?;
    }

    Ok(to_connection_profile(updated))
}

#[tauri::command]
fn db_delete_connection_profile(
    request: ConnectionProfileRef,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("Profile id is required".to_string());
    }

    let mut profiles = read_profiles(&app)?;
    let before = profiles.len();
    profiles.retain(|profile| profile.id != profile_id);

    if profiles.len() == before {
        return Err("Profile not found".to_string());
    }

    write_profiles(&app, &profiles)?;
    clear_profile_secret(profile_id)?;
    Ok(())
}

#[tauri::command]
fn db_get_connection_profile_secret(
    request: ConnectionProfileRef,
) -> Result<Option<String>, String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("Profile id is required".to_string());
    }

    read_profile_secret(profile_id)
}

#[tauri::command]
fn db_pick_directory() -> Result<Option<String>, String> {
    pick_directory_os()
}

#[tauri::command]
async fn db_export_schema(
    request: DbExportSchemaRequest,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<DbSchemaExportResult, String> {
    let sessions = Arc::clone(&state.sessions);
    tauri::async_runtime::spawn_blocking(move || db_export_schema_blocking(request, sessions, app))
        .await
        .map_err(|error| format!("Schema export task failed: {error}"))?
}

fn db_export_schema_blocking(
    request: DbExportSchemaRequest,
    sessions: Arc<Mutex<HashMap<u64, AppSession>>>,
    app: tauri::AppHandle,
) -> Result<DbSchemaExportResult, String> {
    let destination_directory = request.destination_directory.trim();
    if destination_directory.is_empty() {
        return Err("Destination directory is required".to_string());
    }

    let destination_path = PathBuf::from(destination_directory);
    fs::create_dir_all(&destination_path)
        .map_err(|error| format!("Failed to create export directory: {error}"))?;

    let sessions = sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    let session = sessions
        .get(&request.session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    let objects = ProviderRegistry::list_objects(session)?;
    let object_count = objects.len();
    let mut file_count = 0usize;
    let mut processed_objects = 0usize;
    let mut warnings: Vec<String> = Vec::new();
    let _ = app.emit(
        EVENT_SCHEMA_EXPORT_PROGRESS,
        DbSchemaExportProgress {
            processed_objects,
            total_objects: object_count,
            exported_files: file_count,
            skipped_count: 0,
            current_object: String::new(),
        },
    );

    for object in &objects {
        let object_label = format!(
            "{} {}.{}",
            object.object_type, object.schema, object.object_name
        );
        let object_ref = OracleObjectRef {
            session_id: request.session_id,
            schema: object.schema.clone(),
            object_type: object.object_type.clone(),
            object_name: object.object_name.clone(),
        };
        let ddl = match ProviderRegistry::get_object_ddl(session, &object_ref) {
            Ok(ddl) => ddl,
            Err(error) => {
                warnings.push(format!("{}: {}", object_label, error));
                processed_objects += 1;
                let skipped_count = processed_objects.saturating_sub(file_count);
                let _ = app.emit(
                    EVENT_SCHEMA_EXPORT_PROGRESS,
                    DbSchemaExportProgress {
                        processed_objects,
                        total_objects: object_count,
                        exported_files: file_count,
                        skipped_count,
                        current_object: object_label.clone(),
                    },
                );
                continue;
            }
        };

        let object_type_dir = destination_path.join(normalize_export_object_type_dir_name(
            object.object_type.as_str(),
        ));
        if let Err(error) = fs::create_dir_all(&object_type_dir) {
            warnings.push(format!(
                "{} {}.{}: Failed to create directory '{}': {}",
                object.object_type,
                object.schema,
                object.object_name,
                object_type_dir.to_string_lossy(),
                error
            ));
            processed_objects += 1;
            let skipped_count = processed_objects.saturating_sub(file_count);
            let _ = app.emit(
                EVENT_SCHEMA_EXPORT_PROGRESS,
                DbSchemaExportProgress {
                    processed_objects,
                    total_objects: object_count,
                    exported_files: file_count,
                    skipped_count,
                    current_object: object_label.clone(),
                },
            );
            continue;
        }

        let file_stem = sanitize_export_file_stem(object.object_name.as_str());
        let file_path = unique_export_file_path(object_type_dir.join(format!("{file_stem}.sql")));
        if let Err(error) = fs::write(&file_path, normalize_export_file_content(ddl.as_str())) {
            warnings.push(format!(
                "{} {}.{}: Failed to write '{}': {}",
                object.object_type,
                object.schema,
                object.object_name,
                file_path.to_string_lossy(),
                error
            ));
            processed_objects += 1;
            let skipped_count = processed_objects.saturating_sub(file_count);
            let _ = app.emit(
                EVENT_SCHEMA_EXPORT_PROGRESS,
                DbSchemaExportProgress {
                    processed_objects,
                    total_objects: object_count,
                    exported_files: file_count,
                    skipped_count,
                    current_object: object_label.clone(),
                },
            );
            continue;
        }
        file_count += 1;
        processed_objects += 1;
        let skipped_count = processed_objects.saturating_sub(file_count);
        let _ = app.emit(
            EVENT_SCHEMA_EXPORT_PROGRESS,
            DbSchemaExportProgress {
                processed_objects,
                total_objects: object_count,
                exported_files: file_count,
                skipped_count,
                current_object: object_label,
            },
        );
    }

    let skipped_count = object_count.saturating_sub(file_count);
    let warning_report_path = if warnings.is_empty() {
        None
    } else {
        let report_path = unique_export_file_path(destination_path.join("export_warnings.log"));
        let report_header = format!(
            "Schema export warnings\nDestination: {}\nTotal objects: {}\nExported files: {}\nSkipped: {}\n\n",
            destination_path.to_string_lossy(),
            object_count,
            file_count,
            skipped_count
        );
        let report_body = warnings
            .iter()
            .enumerate()
            .map(|(index, warning)| format!("{}. {}", index + 1, warning))
            .collect::<Vec<_>>()
            .join("\n");
        let report_content = format!("{report_header}{report_body}\n");

        match fs::write(&report_path, report_content) {
            Ok(_) => Some(report_path),
            Err(_) => None,
        }
    };

    let message = if object_count == 0 {
        format!(
            "No schema objects found to export. Destination: {}",
            destination_path.to_string_lossy()
        )
    } else if skipped_count == 0 {
        format!(
            "Schema export complete. Wrote {} file(s) for {} object(s) to {}.",
            file_count,
            object_count,
            destination_path.to_string_lossy()
        )
    } else {
        let mut summary = format!(
            "Schema export completed with warnings. Wrote {} file(s), skipped {} object(s), out of {} object(s). Destination: {}.",
            file_count,
            skipped_count,
            object_count,
            destination_path.to_string_lossy()
        );
        if let Some(path) = warning_report_path {
            summary.push_str(&format!(" See warning log: {}", path.to_string_lossy()));
        }
        summary
    };

    Ok(DbSchemaExportResult {
        destination_directory: destination_path.to_string_lossy().to_string(),
        object_count,
        file_count,
        skipped_count,
        message,
    })
}

fn normalize_export_object_type_dir_name(object_type: &str) -> String {
    let normalized = object_type.trim().to_ascii_lowercase();
    let mapped = normalized
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch
            } else if ch == ' ' || ch == '-' {
                '_'
            } else {
                '_'
            }
        })
        .collect::<String>();

    let collapsed = mapped
        .split('_')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("_");

    if collapsed.is_empty() {
        "objects".to_string()
    } else {
        collapsed
    }
}

fn sanitize_export_file_stem(name: &str) -> String {
    let sanitized = name
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == '$' || ch == '#' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    if sanitized.is_empty() {
        "object".to_string()
    } else {
        sanitized
    }
}

fn unique_export_file_path(base_path: PathBuf) -> PathBuf {
    if !base_path.exists() {
        return base_path;
    }

    let parent = base_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(PathBuf::new);
    let stem = base_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("object");
    let extension = base_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("sql");

    for index in 2..=10_000 {
        let candidate = parent.join(format!("{stem}_{index}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    parent.join(format!("{stem}_overflow.{extension}"))
}

fn normalize_export_file_content(ddl: &str) -> String {
    let trimmed_end = ddl.trim_end();
    if trimmed_end.is_empty() {
        String::new()
    } else {
        format!("{trimmed_end}\n")
    }
}

fn parse_directory_picker_output(
    output: std::process::Output,
    cancel_exit_codes: &[i32],
    fallback_error: &str,
) -> Result<Option<String>, String> {
    if !output.status.success() {
        if let Some(code) = output.status.code() {
            if cancel_exit_codes.contains(&code) {
                return Ok(None);
            }
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            fallback_error.to_string()
        } else {
            format!("{fallback_error}: {stderr}")
        });
    }

    let selected_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if selected_path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(selected_path))
    }
}

#[cfg(target_os = "macos")]
fn pick_directory_os() -> Result<Option<String>, String> {
    let script = r#"try
POSIX path of (choose folder with prompt "Select Export Directory")
on error number -128
return ""
end try"#;

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|error| format!("Failed to open directory picker: {error}"))?;

    parse_directory_picker_output(
        output,
        &[],
        "Directory picker returned a non-zero exit code.",
    )
}

#[cfg(target_os = "windows")]
fn pick_directory_os() -> Result<Option<String>, String> {
    let script = r#"
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select Export Directory"
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
} elseif ($result -eq [System.Windows.Forms.DialogResult]::Cancel) {
  [Console]::Out.Write("")
} else {
  [Console]::Error.Write("Directory picker returned unexpected result: $result")
  exit 1
}
"#;

    let output = std::process::Command::new("powershell")
        .arg("-NoProfile")
        .arg("-STA")
        .arg("-Command")
        .arg(script)
        .output()
        .map_err(|error| format!("Failed to open directory picker: {error}"))?;

    parse_directory_picker_output(
        output,
        &[],
        "Directory picker returned a non-zero exit code.",
    )
}

#[cfg(target_os = "linux")]
fn pick_directory_os() -> Result<Option<String>, String> {
    match std::process::Command::new("zenity")
        .arg("--file-selection")
        .arg("--directory")
        .arg("--title=Select Export Directory")
        .output()
    {
        Ok(output) => {
            return parse_directory_picker_output(output, &[1], "Directory picker failed")
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Failed to open directory picker: {error}")),
    }

    match std::process::Command::new("kdialog")
        .arg("--getexistingdirectory")
        .arg(".")
        .arg("Select Export Directory")
        .output()
    {
        Ok(output) => parse_directory_picker_output(output, &[1], "Directory picker failed"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(
            "Failed to open directory picker: neither 'zenity' nor 'kdialog' is installed."
                .to_string(),
        ),
        Err(error) => Err(format!("Failed to open directory picker: {error}")),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn pick_directory_os() -> Result<Option<String>, String> {
    Err("Directory picker is not currently supported on this operating system.".to_string())
}

fn validate_connect_request(request: &DbConnectRequest) -> Result<(), String> {
    if request.provider == DatabaseProvider::Sqlite {
        return Ok(());
    }

    if request.host.trim().is_empty() {
        return Err("Host is required".to_string());
    }

    if request.username.trim().is_empty() {
        return Err("Username is required".to_string());
    }

    if request.password.is_empty() {
        return Err("Password is required".to_string());
    }

    if request.provider == DatabaseProvider::Oracle {
        if request.service_name.trim().is_empty() {
            return Err("Service name is required".to_string());
        }

        if request.schema.trim().is_empty() {
            return Err("Schema is required".to_string());
        }
    }

    Ok(())
}

fn validate_profile_request(request: &SaveConnectionProfileRequest) -> Result<(), String> {
    if request.name.trim().is_empty() {
        return Err("Profile name is required".to_string());
    }

    if request.provider == DatabaseProvider::Sqlite {
        return Ok(());
    }

    if request.host.trim().is_empty() {
        return Err("Host is required".to_string());
    }

    if request.username.trim().is_empty() {
        return Err("Username is required".to_string());
    }

    if request.provider == DatabaseProvider::Oracle {
        if request.service_name.trim().is_empty() {
            return Err("Service name is required".to_string());
        }

        if request.schema.trim().is_empty() {
            return Err("Schema is required".to_string());
        }
    }

    Ok(())
}

fn validate_ai_suggest_request(request: &DbAiSuggestQueryRequest) -> Result<(), String> {
    if request.current_sql.trim().is_empty() {
        return Err("Current SQL is required.".to_string());
    }

    if request.connected_schema.trim().is_empty() {
        return Err("Connected schema is required.".to_string());
    }

    if request.model.trim().is_empty() {
        return Err("AI model is required.".to_string());
    }

    if request.endpoint.trim().is_empty() {
        return Err("AI endpoint is required.".to_string());
    }

    if request.schema_context.len() > 300 {
        return Err("Schema context is too large.".to_string());
    }

    Ok(())
}

fn normalize_ai_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        return trimmed.to_string();
    }
    if trimmed.ends_with("/v1") {
        return format!("{trimmed}/chat/completions");
    }

    format!("{trimmed}/v1/chat/completions")
}

fn parse_ai_suggestion_payload(
    content: &str,
    current_sql: &str,
) -> Result<DbAiSuggestQueryResult, String> {
    let mut candidates = Vec::new();
    let trimmed = content.trim();
    if !trimmed.is_empty() {
        candidates.push(trimmed.to_string());
    }
    if let Some(code_fence_inner) = strip_markdown_code_fence(trimmed) {
        if !candidates.contains(&code_fence_inner) {
            candidates.push(code_fence_inner);
        }
    }
    if let Some(json_object) = extract_first_json_object(trimmed) {
        if !candidates.contains(&json_object) {
            candidates.push(json_object);
        }
    }

    let mut parse_errors = Vec::new();
    for payload in candidates {
        match serde_json::from_str::<DbAiSuggestQueryResult>(payload.as_str()) {
            Ok(mut result) => {
                result.suggestion_text =
                    sanitize_ai_suggestion_text(result.suggestion_text.as_str(), current_sql);
                result.reasoning_short = result.reasoning_short.trim().to_string();
                result.confidence = result.confidence.clamp(0.0, 1.0);
                return Ok(result);
            }
            Err(error) => parse_errors.push(error.to_string()),
        }
    }

    Err(format!(
        "Failed to parse AI suggestion payload: {}",
        parse_errors
            .into_iter()
            .next()
            .unwrap_or_else(|| "No JSON object found in response.".to_string())
    ))
}

fn strip_markdown_code_fence(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if !trimmed.starts_with("```") {
        return None;
    }
    let without_opening = trimmed.get(3..)?;
    let content_start = without_opening
        .find('\n')
        .map(|index| index + 1)
        .unwrap_or(0);
    let maybe_with_closing = without_opening.get(content_start..)?.trim();
    let inner = maybe_with_closing
        .strip_suffix("```")
        .map(str::trim)
        .unwrap_or(maybe_with_closing);

    if inner.is_empty() {
        None
    } else {
        Some(inner.to_string())
    }
}

fn extract_first_json_object(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut start = None;
    let mut depth: i32 = 0;
    let mut in_string = false;
    let mut escaped = false;

    for (index, byte) in bytes.iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
                continue;
            }
            match byte {
                b'\\' => escaped = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match byte {
            b'"' => in_string = true,
            b'{' => {
                if depth == 0 {
                    start = Some(index);
                }
                depth += 1;
            }
            b'}' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    if let Some(start_index) = start {
                        return value.get(start_index..=index).map(str::to_string);
                    }
                }
            }
            _ => {}
        }
    }

    None
}

fn sanitize_ai_suggestion_text(suggestion_text: &str, current_sql: &str) -> String {
    let mut sanitized = suggestion_text.trim().to_string();
    if let Some(inner) = strip_markdown_code_fence(sanitized.as_str()) {
        sanitized = inner;
    }
    sanitized = sanitized.trim().to_string();
    sanitized = strip_repeated_current_sql_prefix(current_sql, sanitized.as_str());
    sanitized.trim().to_string()
}

fn strip_repeated_current_sql_prefix(current_sql: &str, suggestion_text: &str) -> String {
    let suggestion = suggestion_text.trim();
    if suggestion.is_empty() {
        return String::new();
    }

    let current_trimmed = current_sql.trim();
    let current_without_semicolon = current_trimmed.trim_end_matches(';').trim_end();

    for prefix in [current_trimmed, current_without_semicolon] {
        if prefix.is_empty() {
            continue;
        }
        if let Some(stripped) = strip_case_insensitive_prefix(suggestion, prefix) {
            let candidate = stripped.trim_start();
            if !candidate.is_empty() {
                return candidate.to_string();
            }
        }
    }

    suggestion.to_string()
}

fn strip_case_insensitive_prefix<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    if value.len() < prefix.len() {
        return None;
    }
    let start = value.get(..prefix.len())?;
    if !start.eq_ignore_ascii_case(prefix) {
        return None;
    }

    value.get(prefix.len()..)
}

fn build_ai_schema_context_prompt(schema_context: &[DbAiSchemaContextObject]) -> String {
    if schema_context.is_empty() {
        return "\nNo schema context available.".to_string();
    }

    let mut referenced = Vec::new();
    let mut other = Vec::new();

    for entry in schema_context.iter().take(120) {
        let schema = entry.schema.trim();
        let object_name = entry.object_name.trim();
        let columns = entry
            .columns
            .iter()
            .filter_map(|value| {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            })
            .collect::<Vec<_>>();

        let formatted = if columns.is_empty() {
            format!("- {schema}.{object_name}")
        } else {
            format!("- {schema}.{object_name} ({})", columns.join(", "))
        };

        if entry.is_referenced_in_query {
            referenced.push(formatted);
        } else {
            other.push(formatted);
        }
    }

    let mut result = String::new();
    if !referenced.is_empty() {
        result.push_str("\n\nTables referenced in the current query [REFERENCED]:\n");
        result.push_str(&referenced.join("\n"));
    }
    if !other.is_empty() {
        result.push_str("\n\nOther available tables in schema:\n");
        result.push_str(&other.join("\n"));
    }

    result
}

fn is_potentially_mutating_sql(sql: &str) -> bool {
    let normalized = strip_sql_comments_and_literals(sql).to_ascii_uppercase();
    let keywords = [
        "INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "DROP", "ALTER", "CREATE", "RENAME",
        "GRANT", "REVOKE", "COMMENT", "BEGIN", "DECLARE", "CALL", "EXECUTE",
    ];

    keywords
        .iter()
        .any(|keyword| contains_sql_keyword(normalized.as_str(), keyword))
}

fn strip_sql_comments_and_literals(sql: &str) -> String {
    let chars: Vec<char> = sql.chars().collect();
    let mut cleaned = String::with_capacity(sql.len());
    let mut index = 0usize;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while index < chars.len() {
        let current = chars[index];
        let next = chars.get(index + 1).copied().unwrap_or('\0');

        if in_line_comment {
            if current == '\n' {
                cleaned.push('\n');
                in_line_comment = false;
            }
            index += 1;
            continue;
        }

        if in_block_comment {
            if current == '*' && next == '/' {
                in_block_comment = false;
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }

        if in_single_quote {
            if current == '\'' && next == '\'' {
                index += 2;
                continue;
            }
            if current == '\'' {
                in_single_quote = false;
            }
            index += 1;
            continue;
        }

        if in_double_quote {
            if current == '"' && next == '"' {
                index += 2;
                continue;
            }
            if current == '"' {
                in_double_quote = false;
            }
            index += 1;
            continue;
        }

        if current == '-' && next == '-' {
            cleaned.push(' ');
            in_line_comment = true;
            index += 2;
            continue;
        }

        if current == '/' && next == '*' {
            cleaned.push(' ');
            in_block_comment = true;
            index += 2;
            continue;
        }

        if current == '\'' {
            cleaned.push(' ');
            in_single_quote = true;
            index += 1;
            continue;
        }

        if current == '"' {
            cleaned.push(' ');
            in_double_quote = true;
            index += 1;
            continue;
        }

        cleaned.push(current);
        index += 1;
    }

    cleaned
}

fn contains_sql_keyword(sql: &str, keyword: &str) -> bool {
    let mut start_index = 0usize;
    while let Some(relative_match) = sql[start_index..].find(keyword) {
        let absolute_match = start_index + relative_match;
        let after_index = absolute_match + keyword.len();
        let has_left_boundary = sql[..absolute_match]
            .chars()
            .next_back()
            .map(|ch| !is_sql_identifier_char(ch))
            .unwrap_or(true);
        let has_right_boundary = sql[after_index..]
            .chars()
            .next()
            .map(|ch| !is_sql_identifier_char(ch))
            .unwrap_or(true);
        if has_left_boundary && has_right_boundary {
            return true;
        }
        start_index = after_index;
    }

    false
}

fn is_sql_identifier_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '$' || ch == '#'
}

fn profiles_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;
    app_dir.push(PROFILE_STORE_FILE);
    Ok(app_dir)
}

fn read_profiles(app: &tauri::AppHandle) -> Result<Vec<StoredConnectionProfile>, String> {
    let path = profiles_file_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read profiles file: {error}"))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<Vec<StoredConnectionProfile>>(&content)
        .map_err(|error| format!("Failed to parse profiles file: {error}"))
}

fn write_profiles(
    app: &tauri::AppHandle,
    profiles: &[StoredConnectionProfile],
) -> Result<(), String> {
    let path = profiles_file_path(app)?;
    let payload = serde_json::to_string_pretty(profiles)
        .map_err(|error| format!("Failed to serialize profiles: {error}"))?;
    fs::write(&path, payload).map_err(|error| format!("Failed to write profiles file: {error}"))
}

fn to_connection_profile(profile: StoredConnectionProfile) -> ConnectionProfile {
    // Listing profiles should still work even if keychain lookup is unavailable.
    let has_password = read_profile_secret(profile.id.as_str())
        .ok()
        .flatten()
        .is_some();
    ConnectionProfile {
        id: profile.id,
        name: profile.name,
        provider: profile.provider,
        host: profile.host,
        port: profile.port,
        service_name: profile.service_name,
        username: profile.username,
        schema: profile.schema,
        has_password,
    }
}

fn keyring_entry(profile_id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, &format!("profile:{profile_id}:password"))
        .map_err(|error| format!("Failed to initialize keyring entry: {error}"))
}

fn ai_keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_AI_API_KEY_ACCOUNT)
        .map_err(|error| format!("Failed to initialize AI keyring entry: {error}"))
}

fn read_profile_secret(profile_id: &str) -> Result<Option<String>, String> {
    match keyring_entry(profile_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read keychain secret: {error}")),
    }
}

fn write_profile_secret(profile_id: &str, password: &str) -> Result<(), String> {
    keyring_entry(profile_id)?
        .set_password(password)
        .map_err(|error| format!("Failed to write keychain secret: {error}"))
}

fn clear_profile_secret(profile_id: &str) -> Result<(), String> {
    match keyring_entry(profile_id)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to clear keychain secret: {error}")),
    }
}

fn read_ai_api_key() -> Result<Option<String>, String> {
    match ai_keyring_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read AI API key from keychain: {error}")),
    }
}

fn write_ai_api_key(api_key: &str) -> Result<(), String> {
    ai_keyring_entry()?
        .set_password(api_key)
        .map_err(|error| format!("Failed to write AI API key to keychain: {error}"))
}

fn clear_ai_api_key() -> Result<(), String> {
    match ai_keyring_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to clear AI API key from keychain: {error}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(|app| {
            let settings = tauri::menu::MenuItem::with_id(
                app,
                MENU_ID_TOOLS_SETTINGS,
                "Settings...",
                true,
                None::<&str>,
            )?;
            let find_in_schema = tauri::menu::MenuItem::with_id(
                app,
                MENU_ID_TOOLS_FIND_IN_SCHEMA,
                "Find in Schema...",
                true,
                Some("CmdOrCtrl+Shift+F"),
            )?;
            let export_database = tauri::menu::MenuItem::with_id(
                app,
                MENU_ID_TOOLS_EXPORT_DATABASE,
                "Export database...",
                true,
                None::<&str>,
            )?;
            let tools_menu = tauri::menu::Submenu::with_items(
                app,
                "Tools",
                true,
                &[&settings, &find_in_schema, &export_database],
            )?;
            let menu = tauri::menu::Menu::default(app)?;
            let existing_items = menu.items()?;
            let help_position = existing_items
                .iter()
                .position(|item| item.id() == tauri::menu::HELP_SUBMENU_ID)
                .unwrap_or(existing_items.len());
            menu.insert(&tools_menu, help_position)?;
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id() == MENU_ID_TOOLS_SETTINGS {
                if let Err(error) = app.emit(EVENT_OPEN_SETTINGS_DIALOG, ()) {
                    eprintln!("failed to emit open settings event: {error}");
                }
            } else if event.id() == MENU_ID_TOOLS_FIND_IN_SCHEMA {
                if let Err(error) = app.emit(EVENT_OPEN_SCHEMA_SEARCH, ()) {
                    eprintln!("failed to emit open schema search event: {error}");
                }
            } else if event.id() == MENU_ID_TOOLS_EXPORT_DATABASE {
                if let Err(error) = app.emit(EVENT_OPEN_EXPORT_DATABASE_DIALOG, ()) {
                    eprintln!("failed to emit export database event: {error}");
                }
            }
        })
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            db_connect,
            db_disconnect,
            db_list_objects,
            db_list_object_columns,
            db_run_query,
            db_search_schema_text,
            db_get_object_ddl,
            db_update_object_ddl,
            db_list_connection_profiles,
            db_save_connection_profile,
            db_delete_connection_profile,
            db_get_connection_profile_secret,
            db_has_ai_api_key,
            db_set_ai_api_key,
            db_clear_ai_api_key,
            db_ai_suggest_query,
            db_pick_directory,
            db_export_schema
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
