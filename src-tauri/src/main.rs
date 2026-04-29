// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod client;
mod model;
mod parser;

use model::{FsNode, RequestCase, RequestSummary, ResponseData, WorkspaceData};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

#[tauri::command]
fn parse_requests(
    source: String,
    env_variables: HashMap<String, String>,
) -> Result<Vec<RequestSummary>, String> {
    parser::parse_http_file_with_variables(&source, env_variables)
        .map(|file| {
            file.requests
                .iter()
                .enumerate()
                .map(|(index, request)| RequestSummary {
                    index,
                    name: request.name.clone(),
                    method: request.method.clone(),
                    url: request.url.clone(),
                    headers: request.headers.clone(),
                    body: request.body.clone(),
                })
                .collect()
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn send_request(
    source: String,
    request_index: usize,
    env_variables: HashMap<String, String>,
) -> Result<ResponseData, String> {
    let file = parser::parse_http_file_with_variables(&source, env_variables)
        .map_err(|err| err.to_string())?;
    let request = file
        .requests
        .get(request_index)
        .ok_or_else(|| format!("Request {} was not found", request_index + 1))?
        .clone();

    client::send(request).await.map_err(format_client_error)
}

#[tauri::command]
async fn send_raw_request(request: RequestCase) -> Result<ResponseData, String> {
    client::send(request).await.map_err(format_client_error)
}

#[tauri::command]
fn copy_request_as_curl(
    source: String,
    request_index: usize,
    env_variables: HashMap<String, String>,
) -> Result<String, String> {
    let file = parser::parse_http_file_with_variables(&source, env_variables)
        .map_err(|err| err.to_string())?;
    let request = file
        .requests
        .get(request_index)
        .ok_or_else(|| format!("Request {} was not found", request_index + 1))?;

    Ok(parser::request_to_curl(request))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("Only http:// and https:// URLs can be opened.".to_string());
    }

    #[cfg(target_os = "windows")]
    let status = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", trimmed])
        .status();

    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(trimmed).status();

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open").arg(trimmed).status();

    match status {
        Ok(status) if status.success() => Ok(()),
        Ok(status) => Err(format!("Failed to open URL. Exit status: {status}")),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn open_workspace_folder() -> Result<Option<WorkspaceData>, String> {
    let Some(path) = rfd::FileDialog::new().pick_folder() else {
        return Ok(None);
    };

    read_workspace(path).map(Some)
}

#[tauri::command]
fn read_workspace_folder(root_path: String) -> Result<WorkspaceData, String> {
    read_workspace(PathBuf::from(root_path))
}

#[tauri::command]
fn create_workspace_folder(
    root_path: String,
    parent_path: String,
    name: String,
) -> Result<WorkspaceData, String> {
    validate_name(&name)?;
    let root = canonical_dir(&root_path)?;
    let parent = canonical_dir(&parent_path)?;
    ensure_inside_root(&root, &parent)?;

    std::fs::create_dir(parent.join(name)).map_err(|err| err.to_string())?;
    read_workspace(root)
}

#[tauri::command]
fn create_workspace_file(
    root_path: String,
    parent_path: String,
    name: String,
    content: String,
) -> Result<WorkspaceData, String> {
    validate_name(&name)?;
    let root = canonical_dir(&root_path)?;
    let parent = canonical_dir(&parent_path)?;
    ensure_inside_root(&root, &parent)?;

    let target = parent.join(name);
    if target.exists() {
        return Err("A file with that name already exists.".to_string());
    }

    std::fs::write(&target, content).map_err(|err| err.to_string())?;
    read_workspace(root)
}

#[tauri::command]
fn rename_workspace_item(
    root_path: String,
    item_path: String,
    new_name: String,
) -> Result<WorkspaceData, String> {
    validate_name(&new_name)?;
    let root = canonical_dir(&root_path)?;
    let item = canonical_existing_path(&item_path)?;
    ensure_inside_root(&root, &item)?;
    ensure_not_root(&root, &item)?;

    let parent = item
        .parent()
        .ok_or_else(|| "Invalid item path.".to_string())?;
    let target = parent.join(new_name);

    if item.is_file() {
        if !is_http_file(&item) {
            return Err("Only .http and .rest files can be renamed.".to_string());
        }

        if !is_http_file(&target) {
            return Err("Only .http and .rest files are supported.".to_string());
        }
    }

    if target.exists() {
        return Err("A folder or file with that name already exists.".to_string());
    }

    std::fs::rename(item, target).map_err(|err| err.to_string())?;
    read_workspace(root)
}

#[tauri::command]
fn rename_workspace_folder(
    root_path: String,
    folder_path: String,
    name: String,
) -> Result<WorkspaceData, String> {
    validate_name(&name)?;
    let root = canonical_dir(&root_path)?;
    let folder = canonical_dir(&folder_path)?;
    ensure_inside_root(&root, &folder)?;
    ensure_not_root(&root, &folder)?;

    let parent = folder
        .parent()
        .ok_or_else(|| "Invalid folder path.".to_string())?;
    let target = parent.join(name);

    if target.exists() {
        return Err("A folder or file with that name already exists.".to_string());
    }

    std::fs::rename(folder, target).map_err(|err| err.to_string())?;
    read_workspace(root)
}

#[tauri::command]
fn duplicate_workspace_folder(
    root_path: String,
    folder_path: String,
    name: String,
) -> Result<WorkspaceData, String> {
    validate_name(&name)?;
    let root = canonical_dir(&root_path)?;
    let folder = canonical_dir(&folder_path)?;
    ensure_inside_root(&root, &folder)?;
    ensure_not_root(&root, &folder)?;

    let parent = folder
        .parent()
        .ok_or_else(|| "Invalid folder path.".to_string())?;
    let target = parent.join(name);

    if target.exists() {
        return Err("A folder or file with that name already exists.".to_string());
    }

    copy_dir_recursive(&folder, &target).map_err(|err| err.to_string())?;
    read_workspace(root)
}

#[tauri::command]
fn delete_workspace_folder(
    root_path: String,
    folder_path: String,
) -> Result<WorkspaceData, String> {
    let root = canonical_dir(&root_path)?;
    let folder = canonical_dir(&folder_path)?;
    ensure_inside_root(&root, &folder)?;
    ensure_not_root(&root, &folder)?;

    std::fs::remove_dir_all(folder).map_err(|err| err.to_string())?;
    read_workspace(root)
}

#[tauri::command]
fn move_workspace_item(
    root_path: String,
    item_path: String,
    target_folder_path: String,
) -> Result<WorkspaceData, String> {
    let root = canonical_dir(&root_path)?;
    let item = canonical_existing_path(&item_path)?;
    let target_folder = canonical_dir(&target_folder_path)?;
    ensure_inside_root(&root, &item)?;
    ensure_inside_root(&root, &target_folder)?;
    ensure_not_root(&root, &item)?;

    if item.is_file() && !is_http_file(&item) {
        return Err("Only .http and .rest files can be moved.".to_string());
    }

    if item.is_dir() && target_folder.starts_with(&item) {
        return Err("A folder cannot be moved into itself.".to_string());
    }

    let name = item
        .file_name()
        .ok_or_else(|| "Invalid item path.".to_string())?;
    let target = target_folder.join(name);

    if target.exists() {
        return Err(
            "A file or folder with that name already exists in the target folder.".to_string(),
        );
    }

    std::fs::rename(item, target).map_err(|err| err.to_string())?;
    read_workspace(root)
}

#[tauri::command]
fn rename_workspace_file(
    root_path: String,
    file_path: String,
    name: String,
) -> Result<WorkspaceData, String> {
    validate_name(&name)?;
    let root = canonical_dir(&root_path)?;
    let path = canonical_file(&file_path)?;
    ensure_inside_root(&root, &path)?;

    if !is_http_file(&path) {
        return Err("Only .http and .rest files can be renamed.".to_string());
    }

    let parent = path
        .parent()
        .ok_or_else(|| "Invalid file path.".to_string())?;
    let target = parent.join(name);

    if !is_http_file(&target) {
        return Err("Only .http and .rest files are supported.".to_string());
    }

    if target.exists() {
        return Err("A file with that name already exists.".to_string());
    }

    std::fs::rename(path, target).map_err(|err| err.to_string())?;
    read_workspace(root)
}

#[tauri::command]
fn duplicate_workspace_file(
    root_path: String,
    file_path: String,
    name: String,
) -> Result<WorkspaceData, String> {
    validate_name(&name)?;
    let root = canonical_dir(&root_path)?;
    let path = canonical_file(&file_path)?;
    ensure_inside_root(&root, &path)?;

    if !is_http_file(&path) {
        return Err("Only .http and .rest files can be duplicated.".to_string());
    }

    let parent = path
        .parent()
        .ok_or_else(|| "Invalid file path.".to_string())?;
    let target = parent.join(name);

    if !is_http_file(&target) {
        return Err("Only .http and .rest files are supported.".to_string());
    }

    if target.exists() {
        return Err("A file with that name already exists.".to_string());
    }

    std::fs::copy(path, target).map_err(|err| err.to_string())?;
    read_workspace(root)
}

#[tauri::command]
fn delete_workspace_file(root_path: String, file_path: String) -> Result<WorkspaceData, String> {
    let root = canonical_dir(&root_path)?;
    let path = canonical_file(&file_path)?;
    ensure_inside_root(&root, &path)?;

    if !is_http_file(&path) {
        return Err("Only .http and .rest files can be deleted.".to_string());
    }

    std::fs::remove_file(path).map_err(|err| err.to_string())?;
    read_workspace(root)
}

#[tauri::command]
fn write_workspace_file(
    root_path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let root = canonical_dir(&root_path)?;
    let path = PathBuf::from(file_path);
    let parent = path
        .parent()
        .ok_or_else(|| "Invalid file path.".to_string())
        .and_then(canonical_dir)?;
    ensure_inside_root(&root, &parent)?;

    if !is_http_file(&path) {
        return Err("Only .http and .rest files can be saved.".to_string());
    }

    std::fs::write(path, content).map_err(|err| err.to_string())
}

fn read_workspace(root_path: PathBuf) -> Result<WorkspaceData, String> {
    let root = canonical_dir(root_path)?;
    let nodes = read_nodes(&root)?;

    Ok(WorkspaceData {
        root_path: display_path(&root),
        nodes,
    })
}

fn read_nodes(path: &Path) -> Result<Vec<FsNode>, String> {
    let mut folders = Vec::new();
    let mut files = Vec::new();

    for entry in std::fs::read_dir(path).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if entry_path.is_dir() {
            folders.push(FsNode::Folder {
                id: display_path(&entry_path),
                name,
                path: display_path(&entry_path),
                children: read_nodes(&entry_path)?,
            });
        } else if is_http_file(&entry_path) {
            files.push(FsNode::File {
                id: display_path(&entry_path),
                name,
                path: display_path(&entry_path),
                content: std::fs::read_to_string(&entry_path).unwrap_or_default(),
            });
        }
    }

    folders.sort_by_key(|node| node_name(node).to_ascii_lowercase());
    files.sort_by_key(|node| node_name(node).to_ascii_lowercase());
    folders.extend(files);
    Ok(folders)
}

fn node_name(node: &FsNode) -> &str {
    match node {
        FsNode::File { name, .. } | FsNode::Folder { name, .. } => name,
    }
}

fn is_http_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("http") | Some("rest")
    )
}

fn canonical_dir(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = path.as_ref();
    let canonical = path.canonicalize().map_err(|err| err.to_string())?;
    if !canonical.is_dir() {
        return Err("Expected a folder path.".to_string());
    }
    Ok(canonical)
}

fn canonical_file(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = path.as_ref();
    let canonical = path.canonicalize().map_err(|err| err.to_string())?;
    if !canonical.is_file() {
        return Err("Expected a file path.".to_string());
    }
    Ok(canonical)
}

fn canonical_existing_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = path.as_ref();
    let canonical = path.canonicalize().map_err(|err| err.to_string())?;
    if !canonical.is_file() && !canonical.is_dir() {
        return Err("Expected a file or folder path.".to_string());
    }
    Ok(canonical)
}

fn ensure_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("Path must stay inside the opened workspace folder.".to_string())
    }
}

fn ensure_not_root(root: &Path, path: &Path) -> Result<(), String> {
    if path == root {
        Err("The workspace root cannot be changed by this operation.".to_string())
    } else {
        Ok(())
    }
}

fn copy_dir_recursive(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::create_dir(target)?;

    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else {
            std::fs::copy(&source_path, &target_path)?;
        }
    }

    Ok(())
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
        || name == "."
        || name == ".."
    {
        return Err("Invalid name.".to_string());
    }
    Ok(())
}

fn display_path(path: &Path) -> String {
    path.display()
        .to_string()
        .trim_start_matches(r"\\?\")
        .to_string()
}

fn format_client_error(err: anyhow::Error) -> String {
    let message = err.to_string();
    let lower = message.to_ascii_lowercase();

    if lower.contains("relative url") {
        return "请求地址不是完整 URL，请使用 http:// 或 https:// 开头的地址。".to_string();
    }

    if lower.contains("dns") || lower.contains("failed to lookup address information") {
        return format!("无法解析请求域名，请检查 URL 或网络连接。\n\n原始错误：{message}");
    }

    if lower.contains("connection refused") || lower.contains("actively refused") {
        return format!(
            "目标服务拒绝连接，请确认服务已启动、端口正确且网络可达。\n\n原始错误：{message}"
        );
    }

    if lower.contains("timed out") || lower.contains("timeout") {
        return format!("请求超时，请检查服务响应时间或网络连通性。\n\n原始错误：{message}");
    }

    if lower.contains("certificate") || lower.contains("tls") || lower.contains("ssl") {
        return format!("HTTPS 证书或 TLS 握手失败，请检查证书配置。\n\n原始错误：{message}");
    }

    if lower.contains("builder error") || lower.contains("invalid url") {
        return format!(
            "请求 URL 或请求配置无效，请检查请求行、Header 和变量替换结果。\n\n原始错误：{message}"
        );
    }

    format!("请求失败。\n\n原始错误：{message}")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            parse_requests,
            send_request,
            send_raw_request,
            copy_request_as_curl,
            open_external_url,
            open_workspace_folder,
            read_workspace_folder,
            create_workspace_folder,
            create_workspace_file,
            rename_workspace_item,
            rename_workspace_folder,
            duplicate_workspace_folder,
            delete_workspace_folder,
            move_workspace_item,
            rename_workspace_file,
            duplicate_workspace_file,
            delete_workspace_file,
            write_workspace_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
