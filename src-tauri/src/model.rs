use serde::{Deserialize, Serialize};
#[derive(Debug, Clone)]
pub struct HttpFile {
    pub requests: Vec<RequestCase>,
}

#[derive(Debug, Clone)]
pub struct RequestCase {
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RequestSummary {
    pub index: usize,
    pub name: String,
    pub method: String,
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct ResponseData {
    pub status: u16,
    pub status_text: String,
    pub elapsed_ms: u128,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum FsNode {
    #[serde(rename = "file")]
    File {
        id: String,
        name: String,
        path: String,
        content: String,
    },
    #[serde(rename = "folder")]
    Folder {
        id: String,
        name: String,
        path: String,
        children: Vec<FsNode>,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceData {
    pub root_path: String,
    pub nodes: Vec<FsNode>,
}
