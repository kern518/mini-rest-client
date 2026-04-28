use crate::model::{HttpFile, RequestCase};
use anyhow::{anyhow, Result};
use std::collections::HashMap;

const METHODS: &[&str] = &["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

#[cfg_attr(not(test), allow(dead_code))]
pub fn parse_http_file(source: &str) -> Result<HttpFile> {
    parse_http_file_with_variables(source, HashMap::new())
}

pub fn parse_http_file_with_variables(
    source: &str,
    env_variables: HashMap<String, String>,
) -> Result<HttpFile> {
    let mut variables = env_variables;
    variables.extend(parse_variables(source));
    let mut requests = Vec::new();

    for block in split_request_blocks(source) {
        if let Some(request) = parse_request_block(&block, &variables)? {
            validate_resolved_variables(&request)?;
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
    let mut is_curl_request = false;

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

        if is_curl_command_line(line) {
            request_line_index = Some(index);
            is_curl_request = true;
            break;
        }
    }

    let Some(request_line_index) = request_line_index else {
        return Ok(None);
    };

    if is_curl_request {
        return parse_curl_request_block(&lines, request_line_index, variables, name);
    }

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

pub fn request_to_curl(request: &RequestCase) -> String {
    let mut parts = vec![
        "curl".to_string(),
        "-X".to_string(),
        shell_quote(&request.method),
        shell_quote(&request.url),
    ];

    for (key, value) in &request.headers {
        parts.push("-H".to_string());
        parts.push(shell_quote(&format!("{key}: {value}")));
    }

    if let Some(body) = &request.body {
        parts.push("--data-raw".to_string());
        parts.push(shell_quote(body));
    }

    parts.join(" ")
}

fn replace_variables(input: &str, variables: &HashMap<String, String>) -> String {
    let mut output = input.to_string();

    for (key, value) in variables {
        output = output.replace(&format!("{{{{{}}}}}", key), value);
    }

    output
}

fn is_curl_command_line(line: &str) -> bool {
    let first = line.split_whitespace().next().unwrap_or_default();
    first.eq_ignore_ascii_case("curl") || first.eq_ignore_ascii_case("curl.exe")
}

fn parse_curl_request_block(
    lines: &[&str],
    request_line_index: usize,
    variables: &HashMap<String, String>,
    mut name: String,
) -> Result<Option<RequestCase>> {
    if name.is_empty() {
        name = format!("cURL Request {}", request_line_index + 1);
    }

    let command = collect_curl_command(lines, request_line_index);
    let command = replace_variables(&command, variables);
    let tokens = tokenize_shell_words(&command)?;
    let request = parse_curl_tokens(&tokens, name)?;

    Ok(Some(request))
}

fn collect_curl_command(lines: &[&str], request_line_index: usize) -> String {
    let mut command = String::new();

    for raw_line in lines.iter().skip(request_line_index) {
        let line = raw_line.trim();

        if line.is_empty() || line.starts_with("###") {
            break;
        }

        if line.starts_with('#') || line.starts_with("//") {
            continue;
        }

        if !command.is_empty() {
            command.push(' ');
        }

        let line = line
            .strip_suffix('\\')
            .or_else(|| line.strip_suffix('`'))
            .or_else(|| line.strip_suffix('^'))
            .unwrap_or(line)
            .trim_end();
        command.push_str(line);
    }

    command
}

fn tokenize_shell_words(input: &str) -> Result<Vec<String>> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match quote {
            Some('\'') => {
                if ch == '\'' {
                    quote = None;
                } else {
                    current.push(ch);
                }
            }
            Some('"') => {
                if ch == '"' {
                    quote = None;
                } else if ch == '\\' {
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                } else {
                    current.push(ch);
                }
            }
            Some(_) => unreachable!(),
            None => {
                if ch.is_whitespace() {
                    if !current.is_empty() {
                        tokens.push(std::mem::take(&mut current));
                    }
                } else if ch == '\'' || ch == '"' {
                    quote = Some(ch);
                } else if ch == '\\' {
                    if let Some(next) = chars.next() {
                        current.push(next);
                    }
                } else {
                    current.push(ch);
                }
            }
        }
    }

    if let Some(ch) = quote {
        return Err(anyhow!("Unclosed {ch} quote in cURL command"));
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    Ok(tokens)
}

fn parse_curl_tokens(tokens: &[String], name: String) -> Result<RequestCase> {
    let Some(command) = tokens.first() else {
        return Err(anyhow!("Empty cURL command"));
    };

    if !command.eq_ignore_ascii_case("curl") && !command.eq_ignore_ascii_case("curl.exe") {
        return Err(anyhow!("Expected a cURL command"));
    }

    let mut method: Option<String> = None;
    let mut url: Option<String> = None;
    let mut headers = Vec::new();
    let mut body_parts = Vec::new();
    let mut index = 1;

    while index < tokens.len() {
        let token = &tokens[index];

        if token == "--" {
            index += 1;
            if let Some(next) = tokens.get(index) {
                url = Some(next.to_string());
            }
            break;
        }

        if let Some(value) = token.strip_prefix("--request=") {
            method = Some(value.to_ascii_uppercase());
        } else if token == "--request" || token == "-X" {
            index += 1;
            method = tokens.get(index).map(|value| value.to_ascii_uppercase());
        } else if token.starts_with("-X") && token.len() > 2 {
            method = Some(token[2..].to_ascii_uppercase());
        } else if let Some(value) = token.strip_prefix("--header=") {
            push_header(value, &mut headers)?;
        } else if token == "--header" || token == "-H" {
            index += 1;
            let value = tokens
                .get(index)
                .ok_or_else(|| anyhow!("Missing value after {token}"))?;
            push_header(value, &mut headers)?;
        } else if token.starts_with("-H") && token.len() > 2 {
            push_header(&token[2..], &mut headers)?;
        } else if let Some(value) = token.strip_prefix("--url=") {
            url = Some(value.to_string());
        } else if token == "--url" {
            index += 1;
            url = tokens.get(index).cloned();
        } else if token == "-I" || token == "--head" {
            method = Some("HEAD".to_string());
        } else if is_data_flag(token) {
            index += 1;
            let value = tokens
                .get(index)
                .ok_or_else(|| anyhow!("Missing value after {token}"))?;
            body_parts.push(value.to_string());
        } else if let Some(value) = inline_data_value(token) {
            body_parts.push(value.to_string());
        } else if token == "--user-agent" || token == "-A" {
            index += 1;
            let value = tokens
                .get(index)
                .ok_or_else(|| anyhow!("Missing value after {token}"))?;
            headers.push(("User-Agent".to_string(), value.to_string()));
        } else if let Some(value) = token.strip_prefix("--user-agent=") {
            headers.push(("User-Agent".to_string(), value.to_string()));
        } else if token == "--referer" || token == "-e" {
            index += 1;
            let value = tokens
                .get(index)
                .ok_or_else(|| anyhow!("Missing value after {token}"))?;
            headers.push(("Referer".to_string(), value.to_string()));
        } else if let Some(value) = token.strip_prefix("--referer=") {
            headers.push(("Referer".to_string(), value.to_string()));
        } else if token == "--user" || token == "-u" {
            index += 1;
            let value = tokens
                .get(index)
                .ok_or_else(|| anyhow!("Missing value after {token}"))?;
            headers.push((
                "Authorization".to_string(),
                format!("Basic {}", base64_encode(value.as_bytes())),
            ));
        } else if let Some(value) = token.strip_prefix("--user=") {
            headers.push((
                "Authorization".to_string(),
                format!("Basic {}", base64_encode(value.as_bytes())),
            ));
        } else if token == "--cookie" || token == "-b" {
            index += 1;
            let value = tokens
                .get(index)
                .ok_or_else(|| anyhow!("Missing value after {token}"))?;
            headers.push(("Cookie".to_string(), value.to_string()));
        } else if let Some(value) = token.strip_prefix("--cookie=") {
            headers.push(("Cookie".to_string(), value.to_string()));
        } else if matches!(
            token.as_str(),
            "--location" | "-L" | "--compressed" | "--insecure" | "-k"
        ) {
            // Compatible no-op flags: reqwest already follows redirects by default; compression is automatic.
        } else if token.starts_with('-') {
            if flag_takes_value(token) {
                index += 1;
            }
        } else if url.is_none() {
            url = Some(token.to_string());
        }

        index += 1;
    }

    let url = url.ok_or_else(|| anyhow!("Missing URL in cURL command"))?;
    let body = if body_parts.is_empty() {
        None
    } else {
        Some(body_parts.join("&"))
    };

    Ok(RequestCase {
        name,
        method: method.unwrap_or_else(|| if body.is_some() { "POST" } else { "GET" }.to_string()),
        url,
        headers,
        body,
    })
}

fn push_header(value: &str, headers: &mut Vec<(String, String)>) -> Result<()> {
    let Some((key, value)) = value.split_once(':') else {
        return Err(anyhow!("Invalid header in cURL command: {value}"));
    };

    headers.push((key.trim().to_string(), value.trim().to_string()));
    Ok(())
}

fn is_data_flag(token: &str) -> bool {
    matches!(
        token,
        "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-urlencode" | "--form" | "-F"
    )
}

fn inline_data_value(token: &str) -> Option<&str> {
    if token.starts_with("-d") && token.len() > 2 {
        return Some(&token[2..]);
    }

    for prefix in [
        "--data=",
        "--data-raw=",
        "--data-binary=",
        "--data-urlencode=",
        "--form=",
    ] {
        if let Some(value) = token.strip_prefix(prefix) {
            return Some(value);
        }
    }

    None
}

fn flag_takes_value(token: &str) -> bool {
    matches!(
        token,
        "-o" | "-x" | "-m" | "--output" | "--proxy" | "--max-time" | "--connect-timeout"
    )
}

fn validate_resolved_variables(request: &RequestCase) -> Result<()> {
    let mut unresolved = Vec::new();
    collect_unresolved_variables(&request.url, &mut unresolved);

    for (_, value) in &request.headers {
        collect_unresolved_variables(value, &mut unresolved);
    }

    if let Some(body) = &request.body {
        collect_unresolved_variables(body, &mut unresolved);
    }

    unresolved.sort();
    unresolved.dedup();

    if unresolved.is_empty() {
        Ok(())
    } else {
        Err(anyhow!("Undefined variable(s): {}", unresolved.join(", ")))
    }
}

fn collect_unresolved_variables(input: &str, unresolved: &mut Vec<String>) {
    let mut rest = input;

    while let Some(start) = rest.find("{{") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("}}") else {
            break;
        };
        let name = rest[..end].trim();
        if !name.is_empty() {
            unresolved.push(name.to_string());
        }
        rest = &rest[end + 2..];
    }
}

fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::new();

    for chunk in input.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);

        output.push(TABLE[(first >> 2) as usize] as char);
        output.push(TABLE[(((first & 0b0000_0011) << 4) | (second >> 4)) as usize] as char);

        if chunk.len() > 1 {
            output.push(TABLE[(((second & 0b0000_1111) << 2) | (third >> 6)) as usize] as char);
        } else {
            output.push('=');
        }

        if chunk.len() > 2 {
            output.push(TABLE[(third & 0b0011_1111) as usize] as char);
        } else {
            output.push('=');
        }
    }

    output
}

fn shell_quote(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }

    if value.chars().all(|ch| {
        ch.is_ascii_alphanumeric()
            || matches!(ch, '-' | '_' | '.' | '/' | ':' | '?' | '&' | '=' | '%')
    }) {
        return value.to_string();
    }

    format!("'{}'", value.replace('\'', r#"'\''"#))
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
    fn parses_curl_requests() {
        let source = r#"@host = http://example.com

### Login
curl -X POST "{{host}}/login" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Lang: zh-CN" \
  --data-raw "username=ada&password=secret"
"#;

        let file = parse_http_file(source).unwrap();
        assert_eq!(file.requests.len(), 1);
        assert_eq!(file.requests[0].name, "Login");
        assert_eq!(file.requests[0].method, "POST");
        assert_eq!(file.requests[0].url, "http://example.com/login");
        assert_eq!(
            file.requests[0].headers,
            vec![
                (
                    "Content-Type".to_string(),
                    "application/x-www-form-urlencoded".to_string()
                ),
                ("Lang".to_string(), "zh-CN".to_string())
            ]
        );
        assert_eq!(
            file.requests[0].body.as_deref(),
            Some("username=ada&password=secret")
        );
    }

    #[test]
    fn renders_request_as_curl() {
        let request = RequestCase {
            name: "Login".to_string(),
            method: "POST".to_string(),
            url: "http://example.com/login".to_string(),
            headers: vec![("Content-Type".to_string(), "application/json".to_string())],
            body: Some(r#"{"name":"Ada"}"#.to_string()),
        };

        assert_eq!(
            request_to_curl(&request),
            r#"curl -X POST http://example.com/login -H 'Content-Type: application/json' --data-raw '{"name":"Ada"}'"#
        );
    }

    #[test]
    fn file_variables_override_environment_variables() {
        let source = r#"@host = http://file.example.com

GET {{host}}/users
"#;

        let file = parse_http_file_with_variables(
            source,
            HashMap::from([("host".to_string(), "http://env.example.com".to_string())]),
        )
        .unwrap();

        assert_eq!(file.requests[0].url, "http://file.example.com/users");
    }

    #[test]
    fn reports_undefined_variables() {
        let source = "GET {{missing}}/users";

        let err = parse_http_file(source).unwrap_err();
        assert_eq!(err.to_string(), "Undefined variable(s): missing");
    }

    #[test]
    fn parses_curl_basic_auth_and_cmd_continuation() {
        let source = r#"curl --location --compressed -u ada:secret ^
  -H "Accept: application/json" ^
  http://example.com/users
"#;

        let file = parse_http_file(source).unwrap();

        assert_eq!(file.requests[0].method, "GET");
        assert_eq!(file.requests[0].url, "http://example.com/users");
        assert_eq!(
            file.requests[0].headers,
            vec![
                (
                    "Authorization".to_string(),
                    "Basic YWRhOnNlY3JldA==".to_string()
                ),
                ("Accept".to_string(), "application/json".to_string())
            ]
        );
    }
}
