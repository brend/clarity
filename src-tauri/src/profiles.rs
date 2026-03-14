use crate::types::{
    ConnectionProfile, DatabaseProvider, DbConnectionProfile, OracleAuthMode,
    OracleConnectionOptions, StoredConnectionProfile,
};
use keyring::{Entry, Error as KeyringError};
use serde::Deserialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const PROFILE_STORE_FILE: &str = "connection_profiles.json";
const KEYRING_SERVICE: &str = "com.waldencorp.clarity";
const KEYRING_AI_API_KEY_ACCOUNT: &str = "ai:openai:api_key";

pub(crate) fn read_profiles(app: &AppHandle) -> Result<Vec<StoredConnectionProfile>, String> {
    let path = profiles_file_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read profiles file: {error}"))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<Vec<StoredConnectionProfileRecord>>(&content)
        .map(|profiles| {
            profiles
                .into_iter()
                .map(StoredConnectionProfileRecord::into_current)
                .collect()
        })
        .map_err(|error| format!("Failed to parse profiles file: {error}"))
}

pub(crate) fn write_profiles(
    app: &AppHandle,
    profiles: &[StoredConnectionProfile],
) -> Result<(), String> {
    let path = profiles_file_path(app)?;
    let payload = serde_json::to_string_pretty(profiles)
        .map_err(|error| format!("Failed to serialize profiles: {error}"))?;
    fs::write(&path, payload).map_err(|error| format!("Failed to write profiles file: {error}"))
}

pub(crate) fn to_connection_profile(profile: StoredConnectionProfile) -> ConnectionProfile {
    let has_password = read_profile_secret(profile.id.as_str())
        .ok()
        .flatten()
        .is_some();
    ConnectionProfile {
        id: profile.id,
        name: profile.name,
        connection: profile.connection,
        has_password,
    }
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum StoredConnectionProfileRecord {
    Current(StoredConnectionProfile),
    Legacy(LegacyStoredConnectionProfile),
}

impl StoredConnectionProfileRecord {
    fn into_current(self) -> StoredConnectionProfile {
        match self {
            StoredConnectionProfileRecord::Current(profile) => profile,
            StoredConnectionProfileRecord::Legacy(profile) => profile.into_current(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyStoredConnectionProfile {
    id: String,
    name: String,
    provider: DatabaseProvider,
    host: String,
    port: Option<u16>,
    service_name: String,
    username: String,
    schema: String,
    #[serde(default)]
    oracle_auth_mode: OracleAuthMode,
}

impl LegacyStoredConnectionProfile {
    fn into_current(self) -> StoredConnectionProfile {
        let connection = match self.provider {
            DatabaseProvider::Oracle => DbConnectionProfile::Oracle(OracleConnectionOptions {
                host: self.host,
                port: self.port,
                service_name: self.service_name,
                username: self.username,
                schema: self.schema,
                oracle_auth_mode: self.oracle_auth_mode,
            }),
            DatabaseProvider::Postgres => {
                DbConnectionProfile::Postgres(crate::types::NetworkConnectionOptions {
                    host: self.host,
                    port: self.port,
                    database: self.service_name,
                    username: self.username,
                    schema: Some(self.schema),
                })
            }
            DatabaseProvider::Mysql => {
                DbConnectionProfile::Mysql(crate::types::NetworkConnectionOptions {
                    host: self.host,
                    port: self.port,
                    database: self.service_name,
                    username: self.username,
                    schema: Some(self.schema),
                })
            }
            DatabaseProvider::Sqlite => {
                DbConnectionProfile::Sqlite(crate::types::SqliteConnectionOptions {
                    file_path: self.service_name,
                })
            }
        };

        StoredConnectionProfile {
            id: self.id,
            name: self.name,
            connection,
        }
    }
}

pub(crate) fn read_profile_secret(profile_id: &str) -> Result<Option<String>, String> {
    match keyring_entry(profile_id)?.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read keychain secret: {error}")),
    }
}

pub(crate) fn write_profile_secret(profile_id: &str, password: &str) -> Result<(), String> {
    keyring_entry(profile_id)?
        .set_password(password)
        .map_err(|error| format!("Failed to write keychain secret: {error}"))
}

pub(crate) fn clear_profile_secret(profile_id: &str) -> Result<(), String> {
    match keyring_entry(profile_id)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to clear keychain secret: {error}")),
    }
}

pub(crate) fn read_ai_api_key() -> Result<Option<String>, String> {
    match ai_keyring_entry()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Failed to read AI API key from keychain: {error}")),
    }
}

pub(crate) fn write_ai_api_key(api_key: &str) -> Result<(), String> {
    ai_keyring_entry()?
        .set_password(api_key)
        .map_err(|error| format!("Failed to write AI API key to keychain: {error}"))
}

pub(crate) fn clear_ai_api_key() -> Result<(), String> {
    match ai_keyring_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Failed to clear AI API key from keychain: {error}")),
    }
}

fn profiles_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;
    app_dir.push(PROFILE_STORE_FILE);
    Ok(app_dir)
}

fn keyring_entry(profile_id: &str) -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, &format!("profile:{profile_id}:password"))
        .map_err(|error| format!("Failed to initialize keyring entry: {error}"))
}

fn ai_keyring_entry() -> Result<Entry, String> {
    Entry::new(KEYRING_SERVICE, KEYRING_AI_API_KEY_ACCOUNT)
        .map_err(|error| format!("Failed to initialize AI keyring entry: {error}"))
}
