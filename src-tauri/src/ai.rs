use crate::profiles::read_ai_api_key;
use crate::types::{DbAiSchemaContextObject, DbAiSuggestQueryRequest, DbAiSuggestQueryResult};
use serde::Deserialize;
use std::time::Duration;

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

pub(crate) async fn suggest_query(
    request: DbAiSuggestQueryRequest,
) -> Result<DbAiSuggestQueryResult, String> {
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
        "- Keep suggestions concise and focused - complete the current statement, do not add extra statements.",
        "- Tables marked with [REFERENCED] are already used in the query - strongly prefer their columns for completions.",
        "- suggestionText must be raw SQL continuation text only, without markdown fences and without prose.",
        "",
        "Return valid JSON only (no markdown) with keys: suggestionText, confidence (0.0-1.0), reasoningShort (one sentence), isPotentiallyMutating (boolean).",
    ]
    .join("\n");

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
