use crate::model::{HttpFile, RequestCase};
use anyhow::{anyhow, Result};
use std::collections::HashMap;

const METHODS: &[&str] = &["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

pub fn parse_http_file(source: &str) -> Result<HttpFile> {
    let variables = parse_variables(source);
    let mut requests = Vec::new();

    for block in split_request_blocks(source) {
        if let Some(request) = parse_request_block(&block, &variables)? {
            requests.push(request);
        }
    }

    if requests.is_empty() {
        return Err(anyhow!(
            "No HTTP request found. Add a line like: GET https://example.com"
        ));
    }

    Ok(HttpFile { requests })
}

fn parse_variables(source: &str) -> HashMap<String, String> {
    let mut variables = HashMap::new();

    for line in source.lines() {
        let line = line.trim();
        if !line.starts_with('@') {
            continue;
        }

        if let Some((name, value)) = line[1..].split_once('=') {
            variables.insert(name.trim().to_string(), value.trim().to_string());
        }
    }

    variables
}

fn split_request_blocks(source: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut current = Vec::new();

    for line in source.lines() {
        if line.trim_start().starts_with("###") {
            if !current.is_empty() {
                blocks.push(current.join("\n"));
                current.clear();
            }
            current.push(line.to_string());
        } else {
            current.push(line.to_string());
        }
    }

    if !current.is_empty() {
        blocks.push(current.join("\n"));
    }

    blocks
}

fn parse_request_block(
    block: &str,
    variables: &HashMap<String, String>,
) -> Result<Option<RequestCase>> {
    let mut name = String::new();
    let lines: Vec<&str> = block.lines().collect();
    let mut request_line_index = None;

    for (index, raw_line) in lines.iter().enumerate() {
        let line = raw_line.trim();

        if line.is_empty()
            || line.starts_with('@')
            || line.starts_with('#') && !line.starts_with("###")
            || line.starts_with("//")
        {
            continue;
        }

        if line.starts_with("###") {
            name = line.trim_start_matches('#').trim().to_string();
            continue;
        }

        let first = line
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        if METHODS.contains(&first.as_str()) {
            request_line_index = Some(index);
            break;
        }
    }

    let Some(request_line_index) = request_line_index else {
        return Ok(None);
    };

    if name.is_empty() {
        name = format!("Request {}", request_line_index + 1);
    }

    let request_line = lines[request_line_index].trim();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| anyhow!("Missing HTTP method"))?
        .to_ascii_uppercase();
    let url = request_parts
        .next()
        .ok_or_else(|| anyhow!("Missing URL after {}", method))?;

    let mut headers = Vec::new();
    let mut body_lines = Vec::new();
    let mut in_body = false;

    for raw_line in lines.iter().skip(request_line_index + 1) {
        let line = *raw_line;
        if !in_body && line.trim().is_empty() {
            in_body = true;
            continue;
        }

        if in_body {
            body_lines.push(line);
            continue;
        }

        if line.trim().is_empty()
            || line.trim_start().starts_with('#')
            || line.trim_start().starts_with("//")
        {
            continue;
        }

        if let Some((key, value)) = line.split_once(':') {
            headers.push((
                key.trim().to_string(),
                replace_variables(value.trim(), variables),
            ));
        }
    }

    let body = if body_lines.iter().any(|line| !line.trim().is_empty()) {
        Some(replace_variables(&body_lines.join("\n"), variables))
    } else {
        None
    };

    Ok(Some(RequestCase {
        name,
        method,
        url: replace_variables(url, variables),
        headers,
        body,
    }))
}

fn replace_variables(input: &str, variables: &HashMap<String, String>) -> String {
    let mut output = input.to_string();

    for (key, value) in variables {
        output = output.replace(&format!("{{{{{}}}}}", key), value);
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_variables_and_multiple_requests() {
        let source = r#"@baseUrl = https://example.com

### Get user
GET {{baseUrl}}/users/1
Accept: application/json

### Create user
POST {{baseUrl}}/users
Content-Type: application/json

{"name":"Ada"}
"#;

        let file = parse_http_file(source).unwrap();
        assert_eq!(file.requests.len(), 2);
        assert_eq!(file.requests[0].name, "Get user");
        assert_eq!(file.requests[0].url, "https://example.com/users/1");
        assert_eq!(file.requests[1].method, "POST");
        assert_eq!(file.requests[1].body.as_deref(), Some("{\"name\":\"Ada\"}"));
    }

    #[test]
    fn parses_single_request_without_separator() {
        let source = r#"GET https://example.com/health
Accept: application/json
"#;

        let file = parse_http_file(source).unwrap();
        assert_eq!(file.requests.len(), 1);
        assert_eq!(file.requests[0].method, "GET");
        assert_eq!(file.requests[0].url, "https://example.com/health");
        assert_eq!(
            file.requests[0].headers[0],
            ("Accept".to_string(), "application/json".to_string())
        );
    }

    #[test]
    fn replaces_variables_in_headers_and_body() {
        let source = r#"@baseUrl = https://example.com
@token = abc123

### Create user
POST {{baseUrl}}/users
Authorization: Bearer {{token}}
Content-Type: application/json

{
  "token": "{{token}}"
}
"#;

        let file = parse_http_file(source).unwrap();
        let request = &file.requests[0];

        assert_eq!(request.url, "https://example.com/users");
        assert_eq!(
            request.headers[0],
            ("Authorization".to_string(), "Bearer abc123".to_string())
        );
        assert_eq!(
            request.body.as_deref(),
            Some("{\n  \"token\": \"abc123\"\n}")
        );
    }

    #[test]
    fn preserves_blank_lines_inside_body() {
        let source = r#"### Markdown
POST https://example.com/posts
Content-Type: text/plain

hello

world
"#;

        let file = parse_http_file(source).unwrap();
        assert_eq!(file.requests[0].body.as_deref(), Some("hello\n\nworld"));
    }
}
