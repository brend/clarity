use crate::ai;
use crate::files;
use crate::profiles;
use crate::providers::{AppSession, ProviderRegistry};
use crate::state::AppState;
use crate::types::{
    ConnectionProfile, ConnectionProfileRef, DbAiApiKeyPresence, DbAiSuggestQueryRequest,
    DbAiSuggestQueryResult, DbConnectRequest, DbConnectionProfile, DbExportSchemaRequest,
    DbObjectColumnEntry, DbObjectDdlUpdateRequest, DbObjectEntry, DbObjectRef, DbQueryRequest,
    DbQueryResult, DbSaveQuerySheetRequest, DbSaveQuerySheetsRequest, DbSaveQuerySheetsResult,
    DbSchemaExportResult, DbSchemaSearchRequest, DbSchemaSearchResult, DbSessionSummary,
    DbTransactionState, NetworkConnectionOptions, OracleConnectionOptions,
    SaveConnectionProfileRequest, SessionRequest, StoredConnectionProfile,
};
use crate::validation::{
    validate_ai_suggest_request, validate_connect_request, validate_profile_request,
};
use std::sync::atomic::Ordering;

#[tauri::command]
pub(crate) fn db_connect(
    request: DbConnectRequest,
    state: tauri::State<'_, AppState>,
) -> Result<DbSessionSummary, String> {
    validate_connect_request(&request)?;
    let (session, display_name, schema) = ProviderRegistry::connect(&request)?;

    let session_id = state.next_session_id.fetch_add(1, Ordering::Relaxed);
    let summary = DbSessionSummary {
        session_id,
        display_name,
        schema,
        provider: request.provider(),
    };

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    sessions.insert(session_id, session);

    Ok(summary)
}

#[tauri::command]
pub(crate) fn db_disconnect(
    request: SessionRequest,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
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
pub(crate) fn db_list_objects(
    request: SessionRequest,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DbObjectEntry>, String> {
    with_session(&state, request.session_id, ProviderRegistry::list_objects)
}

#[tauri::command]
pub(crate) fn db_list_object_columns(
    request: SessionRequest,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DbObjectColumnEntry>, String> {
    with_session(
        &state,
        request.session_id,
        ProviderRegistry::list_object_columns,
    )
}

#[tauri::command]
pub(crate) fn db_get_object_ddl(
    request: DbObjectRef,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    with_session(&state, request.session_id, |session| {
        ProviderRegistry::get_object_ddl(session, &request)
    })
}

#[tauri::command]
pub(crate) fn db_update_object_ddl(
    request: DbObjectDdlUpdateRequest,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
    with_session_mut(&state, request.session_id, |session| {
        ProviderRegistry::update_object_ddl(session, &request)
    })
}

#[tauri::command]
pub(crate) fn db_run_query(
    request: DbQueryRequest,
    state: tauri::State<'_, AppState>,
) -> Result<DbQueryResult, String> {
    with_session_mut(&state, request.session_id, |session| {
        ProviderRegistry::run_query(session, &request)
    })
}

#[tauri::command]
pub(crate) fn db_run_query_filtered(
    request: crate::types::DbFilteredQueryRequest,
    state: tauri::State<'_, AppState>,
) -> Result<DbQueryResult, String> {
    with_session_mut(&state, request.session_id, |session| {
        ProviderRegistry::run_filtered_query(session, &request)
    })
}

#[tauri::command]
pub(crate) fn db_get_transaction_state(
    request: SessionRequest,
    state: tauri::State<'_, AppState>,
) -> Result<DbTransactionState, String> {
    let active = with_session(
        &state,
        request.session_id,
        ProviderRegistry::transaction_active,
    )?;
    Ok(DbTransactionState { active })
}

#[tauri::command]
pub(crate) fn db_begin_transaction(
    request: SessionRequest,
    state: tauri::State<'_, AppState>,
) -> Result<DbTransactionState, String> {
    let active = with_session_mut(
        &state,
        request.session_id,
        ProviderRegistry::begin_transaction,
    )?;
    Ok(DbTransactionState { active })
}

#[tauri::command]
pub(crate) fn db_commit_transaction(
    request: SessionRequest,
    state: tauri::State<'_, AppState>,
) -> Result<DbTransactionState, String> {
    let active = with_session_mut(
        &state,
        request.session_id,
        ProviderRegistry::commit_transaction,
    )?;
    Ok(DbTransactionState { active })
}

#[tauri::command]
pub(crate) fn db_rollback_transaction(
    request: SessionRequest,
    state: tauri::State<'_, AppState>,
) -> Result<DbTransactionState, String> {
    let active = with_session_mut(
        &state,
        request.session_id,
        ProviderRegistry::rollback_transaction,
    )?;
    Ok(DbTransactionState { active })
}

#[tauri::command]
pub(crate) fn db_search_schema_text(
    request: DbSchemaSearchRequest,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DbSchemaSearchResult>, String> {
    with_session(&state, request.session_id, |session| {
        ProviderRegistry::search_schema_text(session, &request)
    })
}

#[tauri::command]
pub(crate) fn db_has_ai_api_key() -> Result<DbAiApiKeyPresence, String> {
    let configured = profiles::read_ai_api_key()?.is_some();
    Ok(DbAiApiKeyPresence { configured })
}

#[tauri::command]
pub(crate) fn db_set_ai_api_key(api_key: String) -> Result<(), String> {
    let normalized = api_key.trim();
    if normalized.is_empty() {
        return Err("API key is required.".to_string());
    }

    profiles::write_ai_api_key(normalized)
}

#[tauri::command]
pub(crate) fn db_clear_ai_api_key() -> Result<(), String> {
    profiles::clear_ai_api_key()
}

#[tauri::command]
pub(crate) async fn db_ai_suggest_query(
    request: DbAiSuggestQueryRequest,
) -> Result<DbAiSuggestQueryResult, String> {
    validate_ai_suggest_request(&request)?;
    ai::suggest_query(request).await
}

#[tauri::command]
pub(crate) fn db_list_connection_profiles(
    app: tauri::AppHandle,
) -> Result<Vec<ConnectionProfile>, String> {
    let stored_profiles = profiles::read_profiles(&app)?;
    Ok(stored_profiles
        .into_iter()
        .map(profiles::to_connection_profile)
        .collect())
}

#[tauri::command]
pub(crate) fn db_save_connection_profile(
    request: SaveConnectionProfileRequest,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<ConnectionProfile, String> {
    validate_profile_request(&request)?;
    let mut profiles_list = profiles::read_profiles(&app)?;

    let id = request
        .id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| next_profile_id(&state, &profiles_list));

    let updated = StoredConnectionProfile {
        id: id.clone(),
        name: request.name.trim().to_string(),
        connection: normalize_profile_connection(&request.connection),
    };

    if let Some(position) = profiles_list.iter().position(|profile| profile.id == id) {
        profiles_list[position] = updated.clone();
    } else {
        profiles_list.push(updated.clone());
    }

    profiles::write_profiles(&app, &profiles_list)?;

    if request.save_password {
        let password = request
            .password
            .as_deref()
            .ok_or_else(|| "Password is required when 'savePassword' is enabled.".to_string())?;
        profiles::write_profile_secret(id.as_str(), password)?;
    } else {
        profiles::clear_profile_secret(id.as_str())?;
    }

    Ok(profiles::to_connection_profile(updated))
}

#[tauri::command]
pub(crate) fn db_delete_connection_profile(
    request: ConnectionProfileRef,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("Profile id is required".to_string());
    }

    let mut profiles_list = profiles::read_profiles(&app)?;
    let before = profiles_list.len();
    profiles_list.retain(|profile| profile.id != profile_id);

    if profiles_list.len() == before {
        return Err("Profile not found".to_string());
    }

    profiles::write_profiles(&app, &profiles_list)?;
    profiles::clear_profile_secret(profile_id)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn db_get_connection_profile_secret(
    request: ConnectionProfileRef,
) -> Result<Option<String>, String> {
    let profile_id = request.profile_id.trim();
    if profile_id.is_empty() {
        return Err("Profile id is required".to_string());
    }

    profiles::read_profile_secret(profile_id)
}

#[tauri::command]
pub(crate) fn db_pick_directory() -> Result<Option<String>, String> {
    files::pick_directory()
}

#[tauri::command]
pub(crate) fn db_save_query_sheet(
    request: DbSaveQuerySheetRequest,
) -> Result<Option<String>, String> {
    files::save_query_sheet(request)
}

#[tauri::command]
pub(crate) fn db_save_query_sheets(
    request: DbSaveQuerySheetsRequest,
) -> Result<Option<DbSaveQuerySheetsResult>, String> {
    files::save_query_sheets(request)
}

#[tauri::command]
pub(crate) async fn db_export_schema(
    request: DbExportSchemaRequest,
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<DbSchemaExportResult, String> {
    files::export_schema(request, state.sessions.clone(), app).await
}

fn with_session<T>(
    state: &tauri::State<'_, AppState>,
    session_id: u64,
    f: impl FnOnce(&AppSession) -> Result<T, String>,
) -> Result<T, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    f(session)
}

fn with_session_mut<T>(
    state: &tauri::State<'_, AppState>,
    session_id: u64,
    f: impl FnOnce(&mut AppSession) -> Result<T, String>,
) -> Result<T, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Failed to acquire session lock".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    f(session)
}

fn next_profile_id(
    state: &tauri::State<'_, AppState>,
    profiles_list: &[StoredConnectionProfile],
) -> String {
    let mut candidate = format!(
        "profile-{}",
        state.next_profile_id.fetch_add(1, Ordering::Relaxed)
    );
    while profiles_list.iter().any(|profile| profile.id == candidate) {
        candidate = format!(
            "profile-{}",
            state.next_profile_id.fetch_add(1, Ordering::Relaxed)
        );
    }
    candidate
}

fn normalize_profile_connection(connection: &DbConnectionProfile) -> DbConnectionProfile {
    match connection {
        DbConnectionProfile::Oracle(details) => {
            DbConnectionProfile::Oracle(OracleConnectionOptions {
                host: details.host.trim().to_string(),
                port: details.port,
                service_name: details.service_name.trim().to_string(),
                username: details.username.trim().to_string(),
                schema: details.schema.trim().to_uppercase(),
                oracle_auth_mode: details.oracle_auth_mode,
            })
        }
        DbConnectionProfile::Postgres(details) => {
            DbConnectionProfile::Postgres(normalize_network_connection(details))
        }
        DbConnectionProfile::Mysql(details) => {
            DbConnectionProfile::Mysql(normalize_network_connection(details))
        }
        DbConnectionProfile::Sqlite(details) => DbConnectionProfile::Sqlite(details.clone()),
    }
}

fn normalize_network_connection(details: &NetworkConnectionOptions) -> NetworkConnectionOptions {
    NetworkConnectionOptions {
        host: details.host.trim().to_string(),
        port: details.port,
        database: details.database.trim().to_string(),
        username: details.username.trim().to_string(),
        schema: details
            .schema
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    }
}
