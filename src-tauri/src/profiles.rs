use crate::types::{
    ConnectionProfile, DatabaseProvider, DbConnectionProfile, OracleAuthMode,
    OracleConnectionOptions, StoredConnectionProfile,
};
use keyring::{Entry, Error as KeyringError};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const PROFILE_STORE_FILE: &str = "connection_profiles.json";
const KEYRING_SERVICE: &str = "com.waldencorp.clarity";
const KEYRING_AI_API_KEY_ACCOUNT: &str = "ai:openai:api_key";

pub(crate) fn read_profiles(app: &AppHandle) -> Result<Vec<StoredConnectionProfile>, String> {
    let path = profiles_file_path(app)?;
    read_profiles_from_path(path.as_path())
}

pub(crate) fn write_profiles(
    app: &AppHandle,
    profiles: &[StoredConnectionProfile],
) -> Result<(), String> {
    let path = profiles_file_path(app)?;
    write_profiles_to_path(path.as_path(), profiles)
}

fn read_profiles_from_path(path: &Path) -> Result<Vec<StoredConnectionProfile>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(path)
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

fn write_profiles_to_path(path: &Path, profiles: &[StoredConnectionProfile]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create app data directory: {error}"))?;
    }

    let payload = serde_json::to_string_pretty(profiles)
        .map_err(|error| format!("Failed to serialize profiles: {error}"))?;
    fs::write(path, payload).map_err(|error| format!("Failed to write profiles file: {error}"))
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

#[cfg(test)]
mod tests {
    use super::{
        read_profiles_from_path, write_profiles_to_path, DbConnectionProfile, OracleAuthMode,
        OracleConnectionOptions, StoredConnectionProfile,
    };
    use crate::types::NetworkConnectionOptions;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempTestDir {
        path: PathBuf,
    }

    impl TempTestDir {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be after unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "clarity_profiles_tests_{name}_{}_{}",
                std::process::id(),
                unique
            ));
            fs::create_dir_all(&path).expect("failed to create temp test directory");
            Self { path }
        }
    }

    impl Drop for TempTestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn sample_profiles() -> Vec<StoredConnectionProfile> {
        vec![
            StoredConnectionProfile {
                id: "profile-1".to_string(),
                name: "Oracle Dev".to_string(),
                connection: DbConnectionProfile::Oracle(OracleConnectionOptions {
                    host: "localhost".to_string(),
                    port: Some(1521),
                    service_name: "XE".to_string(),
                    username: "system".to_string(),
                    schema: "APP".to_string(),
                    oracle_auth_mode: OracleAuthMode::Normal,
                }),
            },
            StoredConnectionProfile {
                id: "profile-2".to_string(),
                name: "Postgres Dev".to_string(),
                connection: DbConnectionProfile::Postgres(NetworkConnectionOptions {
                    host: "localhost".to_string(),
                    port: Some(5432),
                    database: "clarity".to_string(),
                    username: "app_user".to_string(),
                    schema: Some("public".to_string()),
                }),
            },
        ]
    }

    #[test]
    fn write_and_read_profiles_round_trip_current_format() {
        let temp_dir = TempTestDir::new("round_trip");
        let path = temp_dir.path.join("connection_profiles.json");
        let expected = sample_profiles();

        write_profiles_to_path(path.as_path(), &expected).expect("write should succeed");
        let actual = read_profiles_from_path(path.as_path()).expect("read should succeed");

        assert_eq!(actual.len(), expected.len());
        assert_eq!(actual[0].id, expected[0].id);
        assert_eq!(actual[1].name, expected[1].name);
    }

    #[test]
    fn read_profiles_returns_empty_for_missing_or_blank_file() {
        let temp_dir = TempTestDir::new("empty");
        let path = temp_dir.path.join("connection_profiles.json");

        let missing = read_profiles_from_path(path.as_path()).expect("missing file should succeed");
        assert!(missing.is_empty());

        fs::write(path.as_path(), " \n\t").expect("failed to write blank file");
        let blank = read_profiles_from_path(path.as_path()).expect("blank file should succeed");
        assert!(blank.is_empty());
    }

    #[test]
    fn read_profiles_supports_legacy_shape() {
        let temp_dir = TempTestDir::new("legacy");
        let path = temp_dir.path.join("connection_profiles.json");
        let payload = r#"
[
  {
    "id": "legacy-1",
    "name": "Legacy Pg",
    "provider": "postgres",
    "host": "localhost",
    "port": 5432,
    "serviceName": "clarity_db",
    "username": "legacy_user",
    "schema": "public"
  }
]
"#;

        fs::write(path.as_path(), payload).expect("failed to write legacy payload");
        let profiles =
            read_profiles_from_path(path.as_path()).expect("legacy parse should succeed");

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, "legacy-1");
        match &profiles[0].connection {
            DbConnectionProfile::Postgres(connection) => {
                assert_eq!(connection.database, "clarity_db");
                assert_eq!(connection.username, "legacy_user");
                assert_eq!(connection.schema.as_deref(), Some("public"));
            }
            _ => panic!("expected postgres profile"),
        }
    }

    #[test]
    fn read_profiles_returns_error_for_invalid_json() {
        let temp_dir = TempTestDir::new("invalid_json");
        let path = temp_dir.path.join("connection_profiles.json");
        fs::write(path.as_path(), "{not_json").expect("failed to write invalid payload");

        let error = read_profiles_from_path(path.as_path()).expect_err("expected parse error");
        assert!(error.contains("Failed to parse profiles file"));
    }
}
