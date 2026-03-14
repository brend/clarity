use crate::types::{
    DbAiSuggestQueryRequest, DbConnectConnection, DbConnectRequest, DbConnectionProfile,
    SaveConnectionProfileRequest,
};

pub(crate) fn validate_connect_request(request: &DbConnectRequest) -> Result<(), String> {
    match &request.connection {
        DbConnectConnection::Oracle(connection) => {
            if connection.host.trim().is_empty() {
                return Err("Host is required".to_string());
            }

            if connection.username.trim().is_empty() {
                return Err("Username is required".to_string());
            }

            if connection.password.is_empty() {
                return Err("Password is required".to_string());
            }

            if connection.service_name.trim().is_empty() {
                return Err("Service name is required".to_string());
            }

            if connection.schema.trim().is_empty() {
                return Err("Schema is required".to_string());
            }
        }
        DbConnectConnection::Postgres(connection) | DbConnectConnection::Mysql(connection) => {
            if connection.host.trim().is_empty() {
                return Err("Host is required".to_string());
            }

            if connection.username.trim().is_empty() {
                return Err("Username is required".to_string());
            }

            if connection.password.is_empty() {
                return Err("Password is required".to_string());
            }

            if connection.database.trim().is_empty() {
                return Err("Database is required".to_string());
            }
        }
        DbConnectConnection::Sqlite(connection) => {
            if connection.file_path.trim().is_empty() {
                return Err("File path is required".to_string());
            }
        }
    }

    Ok(())
}

pub(crate) fn validate_profile_request(
    request: &SaveConnectionProfileRequest,
) -> Result<(), String> {
    if request.name.trim().is_empty() {
        return Err("Profile name is required".to_string());
    }

    match &request.connection {
        DbConnectionProfile::Oracle(connection) => {
            if connection.host.trim().is_empty() {
                return Err("Host is required".to_string());
            }

            if connection.username.trim().is_empty() {
                return Err("Username is required".to_string());
            }

            if connection.service_name.trim().is_empty() {
                return Err("Service name is required".to_string());
            }

            if connection.schema.trim().is_empty() {
                return Err("Schema is required".to_string());
            }
        }
        DbConnectionProfile::Postgres(connection) | DbConnectionProfile::Mysql(connection) => {
            if connection.host.trim().is_empty() {
                return Err("Host is required".to_string());
            }

            if connection.username.trim().is_empty() {
                return Err("Username is required".to_string());
            }

            if connection.database.trim().is_empty() {
                return Err("Database is required".to_string());
            }
        }
        DbConnectionProfile::Sqlite(connection) => {
            if connection.file_path.trim().is_empty() {
                return Err("File path is required".to_string());
            }
        }
    }

    Ok(())
}

pub(crate) fn validate_ai_suggest_request(request: &DbAiSuggestQueryRequest) -> Result<(), String> {
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
