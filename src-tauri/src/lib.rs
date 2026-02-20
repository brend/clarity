mod providers;

use keyring::{Entry, Error as KeyringError};
use providers::{AppSession, DatabaseProvider, ProviderRegistry};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Manager;

const PROFILE_STORE_FILE: &str = "connection_profiles.json";
const KEYRING_SERVICE: &str = "com.waldencorp.clarity";

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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OracleSourceSearchRequest {
    session_id: u64,
    search_term: String,
    limit: Option<u32>,
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
struct OracleSourceSearchResult {
    schema: String,
    object_type: String,
    object_name: String,
    line: u32,
    text: String,
}

struct AppState {
    next_session_id: AtomicU64,
    next_profile_id: AtomicU64,
    sessions: Mutex<HashMap<u64, AppSession>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            next_session_id: AtomicU64::new(1),
            next_profile_id: AtomicU64::new(1),
            sessions: Mutex::new(HashMap::new()),
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
fn db_search_source_code(
    request: OracleSourceSearchRequest,
    state: tauri::State<AppState>,
) -> Result<Vec<OracleSourceSearchResult>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    let session = sessions
        .get(&request.session_id)
        .ok_or_else(|| "Session not found".to_string())?;

    ProviderRegistry::search_source_code(session, &request)
}

#[tauri::command]
fn db_list_connection_profiles(app: tauri::AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    let stored_profiles = read_profiles(&app)?;
    Ok(stored_profiles.into_iter().map(to_connection_profile).collect())
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
            let mut candidate =
                format!("profile-{}", state.next_profile_id.fetch_add(1, Ordering::Relaxed));
            while profiles.iter().any(|profile| profile.id == candidate) {
                candidate = format!("profile-{}", state.next_profile_id.fetch_add(1, Ordering::Relaxed));
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
fn db_get_connection_profile_secret(request: ConnectionProfileRef) -> Result<Option<String>, String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("Profile id is required".to_string());
    }

    read_profile_secret(profile_id)
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

    let content =
        fs::read_to_string(&path).map_err(|error| format!("Failed to read profiles file: {error}"))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<Vec<StoredConnectionProfile>>(&content)
        .map_err(|error| format!("Failed to parse profiles file: {error}"))
}

fn write_profiles(app: &tauri::AppHandle, profiles: &[StoredConnectionProfile]) -> Result<(), String> {
    let path = profiles_file_path(app)?;
    let payload = serde_json::to_string_pretty(profiles)
        .map_err(|error| format!("Failed to serialize profiles: {error}"))?;
    fs::write(&path, payload).map_err(|error| format!("Failed to write profiles file: {error}"))
}

fn to_connection_profile(profile: StoredConnectionProfile) -> ConnectionProfile {
    // Listing profiles should still work even if keychain lookup is unavailable.
    let has_password = read_profile_secret(profile.id.as_str()).ok().flatten().is_some();
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            db_connect,
            db_disconnect,
            db_list_objects,
            db_run_query,
            db_search_source_code,
            db_get_object_ddl,
            db_update_object_ddl,
            db_list_connection_profiles,
            db_save_connection_profile,
            db_delete_connection_profile,
            db_get_connection_profile_secret
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
