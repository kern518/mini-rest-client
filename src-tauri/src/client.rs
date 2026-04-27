use crate::model::{RequestCase, ResponseData};
use anyhow::{anyhow, Result};
use reqwest::Method;
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
        builder = builder.body(body);
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
