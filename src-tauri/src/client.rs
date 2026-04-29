use crate::model::{RequestCase, ResponseData};
use anyhow::{anyhow, Result};
use reqwest::Method;
use std::path::PathBuf;
use std::time::Instant;

pub async fn send(request: RequestCase) -> Result<ResponseData> {
    let method: Method = request
        .method
        .parse()
        .map_err(|_| anyhow!("Unsupported HTTP method: {}", request.method))?;

    let client = reqwest::Client::new();
    let mut builder = client.request(method, &request.url);

    for (key, value) in request.headers {
        builder = builder.header(key, value);
    }

    if let Some(body) = request.body {
        builder = builder.body(resolve_body_payload(&body)?);
    }

    let started = Instant::now();
    let response = builder.send().await?;
    let elapsed_ms = started.elapsed().as_millis();

    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .map(|(key, value)| {
            (
                key.to_string(),
                value.to_str().unwrap_or("<binary header>").to_string(),
            )
        })
        .collect();
    let body = response.text().await?;

    Ok(ResponseData {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("Unknown").to_string(),
        elapsed_ms,
        headers,
        body,
    })
}

fn resolve_body_payload(body: &str) -> Result<Vec<u8>> {
    let mut payload = Vec::new();
    let mut has_file_include = false;
    let lines: Vec<&str> = body.lines().collect();

    for (index, line) in lines.iter().enumerate() {
        if let Some(path) = parse_file_include(line) {
            has_file_include = true;
            let bytes = std::fs::read(&path).map_err(|err| {
                anyhow!("Failed to read request body file {}: {err}", path.display())
            })?;
            payload.extend(bytes);
        } else {
            payload.extend(line.as_bytes());
        }

        if index + 1 < lines.len() {
            payload.extend(b"\r\n");
        }
    }

    if has_file_include {
        Ok(payload)
    } else {
        Ok(body.as_bytes().to_vec())
    }
}

fn parse_file_include(line: &str) -> Option<PathBuf> {
    let trimmed = line.trim();
    if !trimmed.starts_with("< ") && !trimmed.starts_with("<\t") {
        return None;
    }

    let path = trimmed.strip_prefix('<')?.trim();

    if path.is_empty() {
        return None;
    }

    let path = path
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            path.strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(path);

    Some(PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_file_include_inside_body() {
        let temp_path = std::env::temp_dir().join(format!(
            "mini-rest-client-upload-{}.txt",
            std::process::id()
        ));
        std::fs::write(&temp_path, b"file-bytes").unwrap();

        let body = format!(
            "--boundary\nContent-Type: text/plain\n\n< {}\n--boundary--",
            temp_path.display()
        );
        let payload = resolve_body_payload(&body).unwrap();
        let payload = String::from_utf8(payload).unwrap();

        std::fs::remove_file(temp_path).ok();

        assert!(payload.contains("file-bytes\r\n--boundary--"));
        assert!(!payload.contains("< "));
    }

    #[test]
    fn leaves_regular_body_unchanged() {
        let body = "hello\nworld";

        assert_eq!(resolve_body_payload(body).unwrap(), b"hello\nworld");
    }
}
