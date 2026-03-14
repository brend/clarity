use crate::types::{
    DatabaseProvider, DbAiSuggestQueryRequest, DbConnectRequest, SaveConnectionProfileRequest,
};

pub(crate) fn validate_connect_request(request: &DbConnectRequest) -> Result<(), String> {
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

pub(crate) fn validate_profile_request(
    request: &SaveConnectionProfileRequest,
) -> Result<(), String> {
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
