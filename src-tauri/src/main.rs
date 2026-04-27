// Prevents additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod client;
mod model;
mod parser;

use model::{FsNode, RequestSummary, ResponseData, WorkspaceData};
use std::path::{Path, PathBuf};

#[tauri::command]
fn parse_requests(source: String) -> Result<Vec<RequestSummary>, String> {
    parser::parse_http_file(&source)
        .map(|file| {
            file.requests
                .iter()
                .enumerate()
                .map(|(index, request)| RequestSummary {
                    index,
                    name: request.name.clone(),
                    method: request.method.clone(),
                    url: request.url.clone(),
                })
                .collect()
        })
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn send_request(source: String, request_index: usize) -> Result<ResponseData, String> {
    let file = parser::parse_http_file(&source).map_err(|err| err.to_string())?;
    let request = file
        .requests
        .get(request_index)
        .ok_or_else(|| format!("Request {} was not found", request_index + 1))?
        .clone();

    client::send(request).await.map_err(|err| err.to_string())
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
fn create_workspace_folder(root_path: String, parent_path: String, name: String) -> Result<WorkspaceData, String> {
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
fn write_workspace_file(root_path: String, file_path: String, content: String) -> Result<(), String> {
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

fn ensure_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    if path.starts_with(root) {
        Ok(())
    } else {
        Err("Path must stay inside the opened workspace folder.".to_string())
    }
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
    path.display().to_string().trim_start_matches(r"\\?\").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            parse_requests,
            send_request,
            open_workspace_folder,
            read_workspace_folder,
            create_workspace_folder,
            create_workspace_file,
            write_workspace_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
