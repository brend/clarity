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

#[cfg(test)]
mod tests {
    use super::{
        validate_ai_suggest_request, validate_connect_request, validate_profile_request,
    };
    use crate::types::{
        DbAiSchemaContextObject, DbAiSuggestQueryRequest, DbConnectConnection, DbConnectRequest,
        DbConnectionProfile, NetworkConnectOptions, NetworkConnectionOptions,
        SaveConnectionProfileRequest,
    };

    fn valid_postgres_connect_request() -> DbConnectRequest {
        DbConnectRequest {
            connection: DbConnectConnection::Postgres(NetworkConnectOptions {
                host: "localhost".to_string(),
                port: Some(5432),
                database: "clarity".to_string(),
                username: "app_user".to_string(),
                password: "secret".to_string(),
                schema: Some("public".to_string()),
            }),
        }
    }

    fn valid_postgres_profile_request() -> SaveConnectionProfileRequest {
        SaveConnectionProfileRequest {
            id: None,
            name: "Local".to_string(),
            connection: DbConnectionProfile::Postgres(NetworkConnectionOptions {
                host: "localhost".to_string(),
                port: Some(5432),
                database: "clarity".to_string(),
                username: "app_user".to_string(),
                schema: Some("public".to_string()),
            }),
            save_password: false,
            password: None,
        }
    }

    fn valid_ai_suggest_request() -> DbAiSuggestQueryRequest {
        DbAiSuggestQueryRequest {
            current_sql: "select * from users".to_string(),
            connected_schema: "APP".to_string(),
            endpoint: "https://api.example.com/v1/chat/completions".to_string(),
            model: "gpt-4.1-mini".to_string(),
            schema_context: vec![DbAiSchemaContextObject {
                schema: "APP".to_string(),
                object_name: "USERS".to_string(),
                columns: vec!["ID".to_string(), "EMAIL".to_string()],
                is_referenced_in_query: true,
            }],
            cursor_clause: None,
        }
    }

    #[test]
    fn validate_connect_request_accepts_valid_postgres_input() {
        let request = valid_postgres_connect_request();
        assert_eq!(validate_connect_request(&request), Ok(()));
    }

    #[test]
    fn validate_profile_request_requires_name() {
        let mut request = valid_postgres_profile_request();
        request.name = " ".to_string();

        assert_eq!(
            validate_profile_request(&request),
            Err("Profile name is required".to_string())
        );
    }

    #[test]
    fn validate_ai_suggest_request_rejects_large_schema_context() {
        let mut request = valid_ai_suggest_request();
        request.schema_context = (0..301)
            .map(|index| DbAiSchemaContextObject {
                schema: "APP".to_string(),
                object_name: format!("OBJ_{index}"),
                columns: vec!["ID".to_string()],
                is_referenced_in_query: false,
            })
            .collect();

        assert_eq!(
            validate_ai_suggest_request(&request),
            Err("Schema context is too large.".to_string())
        );
    }
}
