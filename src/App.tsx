import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import HttpEditor from "./editor/HttpEditor";
import ResponsePanel from "./response/ResponsePanel";

type RequestSummary = {
  index: number;
  name: string;
  method: string;
  url: string;
};

type ResponseData = {
  status: number;
  status_text: string;
  elapsed_ms: number;
  headers: [string, string][];
  body: string;
};

type WorkspaceFile = {
  id: string;
  type: "file";
  name: string;
  path: string;
  content: string;
};

type WorkspaceFolder = {
  id: string;
  type: "folder";
  name: string;
  path: string;
  children: WorkspaceNode[];
};

type WorkspaceNode = WorkspaceFile | WorkspaceFolder;

type WorkspaceData = {
  root_path: string;
  nodes: WorkspaceNode[];
};

const starterHttp = `### New request
GET https://example.com
`;

const rootPathStorageKey = "mini-rest-client.root-path";
const activeFileStorageKey = "mini-rest-client.active-file";
const expandedFoldersStorageKey = "mini-rest-client.expanded-folders";
const sidebarWidthStorageKey = "mini-rest-client.sidebar-width";
const responseWidthStorageKey = "mini-rest-client.response-width";

export default function App() {
  const [rootPath, setRootPath] = useState(() => window.localStorage.getItem(rootPathStorageKey) ?? "");
  const [workspaceNodes, setWorkspaceNodes] = useState<WorkspaceNode[]>([]);
  const [activeFileId, setActiveFileId] = useState(() => window.localStorage.getItem(activeFileStorageKey) ?? "");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(loadExpandedFolders);
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [sidebarWidth, setSidebarWidth] = useState(() => loadStoredNumber(sidebarWidthStorageKey, 240));
  const [responseWidth, setResponseWidth] = useState(() => loadStoredNumber(responseWidthStorageKey, 520));
  const [draggingPane, setDraggingPane] = useState<"sidebar" | "response" | null>(null);

  const activeFile = useMemo(() => findFile(workspaceNodes, activeFileId), [workspaceNodes, activeFileId]);
  const source = activeFile?.content ?? "";

  useEffect(() => {
    if (!rootPath) return;
    invoke<WorkspaceData>("read_workspace_folder", { rootPath })
      .then((workspace) => applyWorkspace(workspace))
      .catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    if (rootPath) window.localStorage.setItem(rootPathStorageKey, rootPath);
  }, [rootPath]);

  useEffect(() => {
    if (activeFileId) window.localStorage.setItem(activeFileStorageKey, activeFileId);
  }, [activeFileId]);

  useEffect(() => {
    window.localStorage.setItem(expandedFoldersStorageKey, JSON.stringify([...expandedFolders]));
  }, [expandedFolders]);

  useEffect(() => {
    window.localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(responseWidthStorageKey, String(responseWidth));
  }, [responseWidth]);

  useEffect(() => {
    if (!draggingPane) return;

    document.body.classList.add("isResizing");

    function handleMouseMove(event: MouseEvent) {
      const availableWidth = window.innerWidth;
      const minEditorWidth = 420;

      if (draggingPane === "sidebar") {
        const maxSidebarWidth = Math.max(180, availableWidth - responseWidth - minEditorWidth - 12);
        setSidebarWidth(clamp(event.clientX, 180, Math.min(460, maxSidebarWidth)));
        return;
      }

      const maxResponseWidth = Math.max(320, availableWidth - sidebarWidth - minEditorWidth - 12);
      setResponseWidth(clamp(availableWidth - event.clientX, 320, Math.min(840, maxResponseWidth)));
    }

    function handleMouseUp() {
      setDraggingPane(null);
      document.body.classList.remove("isResizing");
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.classList.remove("isResizing");
    };
  }, [draggingPane, responseWidth, sidebarWidth]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!source.trim()) {
        setRequests([]);
        setError(null);
        return;
      }

      invoke<RequestSummary[]>("parse_requests", { source })
        .then((nextRequests) => {
          setRequests(nextRequests);
          setError(null);
          if (nextRequests.length && !nextRequests.some((item) => item.index === selectedIndex)) {
            setSelectedIndex(nextRequests[0].index);
          }
        })
        .catch((err) => {
          setRequests([]);
          setError(String(err));
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [source, selectedIndex]);

  useEffect(() => {
    if (!rootPath || !activeFile) return;

    setSaveState("saving");
    const timer = window.setTimeout(() => {
      invoke<void>("write_workspace_file", {
        rootPath,
        filePath: activeFile.path,
        content: activeFile.content
      })
        .then(() => setSaveState("saved"))
        .catch((err) => {
          setSaveState("error");
          setError(String(err));
        });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [activeFile?.content, activeFile?.path, rootPath]);

  const title = useMemo(() => activeFile?.name ?? "No file", [activeFile]);

  async function openFolder() {
    const workspace = await invoke<WorkspaceData | null>("open_workspace_folder");
    if (!workspace) return;

    window.localStorage.setItem(rootPathStorageKey, workspace.root_path);
    applyWorkspace(workspace, true);
    setResponse(null);
    setError(null);
  }

  async function addFolder() {
    if (!rootPath) return;
    const name = window.prompt("Folder name", "New Folder")?.trim();
    if (!name) return;

    const workspace = await invoke<WorkspaceData>("create_workspace_folder", {
      rootPath,
      parentPath: selectedFolderId ?? rootPath,
      name
    });
    setExpandedFolders((folders) => new Set([...folders, selectedFolderId ?? rootPath]));
    applyWorkspace(workspace);
  }

  async function addFile() {
    if (!rootPath) return;
    const name = window.prompt("File name", "request.http")?.trim();
    if (!name) return;

    const fileName = /\.(http|rest)$/i.test(name) ? name : `${name}.http`;
    const workspace = await invoke<WorkspaceData>("create_workspace_file", {
      rootPath,
      parentPath: selectedFolderId ?? rootPath,
      name: fileName,
      content: starterHttp
    });
    const createdPath = joinPath(selectedFolderId ?? rootPath, fileName);
    setExpandedFolders((folders) => new Set([...folders, selectedFolderId ?? rootPath]));
    applyWorkspace(workspace);
    setActiveFileId(createdPath);
    setResponse(null);
    setError(null);
  }

  function updateActiveSource(nextSource: string) {
    if (!activeFile) return;
    setWorkspaceNodes((nodes) => updateFileContent(nodes, activeFile.id, nextSource));
  }

  function toggleFolder(folderId: string) {
    setSelectedFolderId(folderId);
    setExpandedFolders((folders) => {
      const next = new Set(folders);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  async function sendRequest(index: number) {
    if (!requests.length) return;
    setLoading(true);
    setError(null);

    try {
      const data = await invoke<ResponseData>("send_request", {
        source,
        requestIndex: index
      });
      setResponse(data);
    } catch (err) {
      setResponse(null);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function applyWorkspace(workspace: WorkspaceData, forceFirstFile = false) {
    setRootPath(workspace.root_path);
    setWorkspaceNodes(workspace.nodes);
    setSelectedFolderId(workspace.root_path);
    setExpandedFolders((folders) => new Set([...folders, workspace.root_path]));

    const existingActiveFile = findFile(workspace.nodes, activeFileId);
    const firstFileId = findFirstFileId(workspace.nodes);
    if (forceFirstFile || !existingActiveFile) {
      setActiveFileId(firstFileId ?? "");
    }
  }

  return (
    <main className="appRoot">
      <header className="toolbar">
        <div className="titleGroup">
          <strong>Mini REST Client</strong>
          <span>{title}</span>
          <span className="muted">{saveState === "saving" ? "Saving..." : saveState === "error" ? "Save failed" : "Saved"}</span>
        </div>
        <div className="toolbarActions">
          <button onClick={openFolder}>Open Folder</button>
          <select
            value={selectedIndex}
            onChange={(event) => setSelectedIndex(Number(event.target.value))}
            disabled={!requests.length}
          >
            {requests.map((request) => (
              <option value={request.index} key={request.index}>
                {request.method} {request.name || request.url}
              </option>
            ))}
          </select>
          <button className="primary" disabled={!requests.length || loading} onClick={() => sendRequest(selectedIndex)}>
            Send
          </button>
        </div>
      </header>

      <section
        className="workspace"
        style={{
          gridTemplateColumns: `${sidebarWidth}px 6px minmax(420px, 1fr) 6px ${responseWidth}px`
        }}
      >
        <aside className="workspaceSidebar">
          <div className="sidebarHeader">
            <span>Files</span>
            <div className="sidebarActions">
              <button onClick={addFolder} disabled={!rootPath} title="New folder">Folder</button>
              <button onClick={addFile} disabled={!rootPath} title="New HTTP file">File</button>
            </div>
          </div>
          <div className="rootPath" title={rootPath}>{rootPath || "Open a folder to start"}</div>
          <div className="fileTree">
            {workspaceNodes.map((node) => (
              <WorkspaceTreeNode
                key={node.id}
                node={node}
                level={0}
                activeFileId={activeFileId}
                selectedFolderId={selectedFolderId}
                expandedFolders={expandedFolders}
                onSelectFile={(fileId) => {
                  setActiveFileId(fileId);
                  setResponse(null);
                  setError(null);
                }}
                onToggleFolder={toggleFolder}
                onSelectFolder={setSelectedFolderId}
              />
            ))}
          </div>
        </aside>

        <div className="paneResizer" role="separator" aria-label="Resize files panel" onMouseDown={() => setDraggingPane("sidebar")} />

        <HttpEditor
          value={source}
          selectedIndex={selectedIndex}
          onChange={updateActiveSource}
          onSelect={setSelectedIndex}
          onSend={sendRequest}
        />

        <div className="paneResizer" role="separator" aria-label="Resize response panel" onMouseDown={() => setDraggingPane("response")} />

        <ResponsePanel response={response} error={error} loading={loading} />
      </section>
    </main>
  );
}

type WorkspaceTreeNodeProps = {
  node: WorkspaceNode;
  level: number;
  activeFileId: string;
  selectedFolderId: string | null;
  expandedFolders: Set<string>;
  onSelectFile: (fileId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onSelectFolder: (folderId: string) => void;
};

function WorkspaceTreeNode({
  node,
  level,
  activeFileId,
  selectedFolderId,
  expandedFolders,
  onSelectFile,
  onToggleFolder,
  onSelectFolder
}: WorkspaceTreeNodeProps) {
  const indent = { paddingLeft: 10 + level * 14 };

  if (node.type === "folder") {
    const expanded = expandedFolders.has(node.id);
    return (
      <div>
        <button
          className={node.id === selectedFolderId ? "treeItem folder active" : "treeItem folder"}
          style={indent}
          onClick={() => onSelectFolder(node.id)}
          onDoubleClick={() => onToggleFolder(node.id)}
          title="Double click to expand or collapse"
        >
          <span className="treeIcon">{expanded ? "v" : ">"}</span>
          <span>{node.name}</span>
        </button>
        {expanded &&
          node.children.map((child) => (
            <WorkspaceTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              activeFileId={activeFileId}
              selectedFolderId={selectedFolderId}
              expandedFolders={expandedFolders}
              onSelectFile={onSelectFile}
              onToggleFolder={onToggleFolder}
              onSelectFolder={onSelectFolder}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      className={node.id === activeFileId ? "treeItem file active" : "treeItem file"}
      style={indent}
      onClick={() => onSelectFile(node.id)}
      title={node.path}
    >
      <span className="treeIcon">HTTP</span>
      <span>{node.name}</span>
    </button>
  );
}

function loadExpandedFolders() {
  try {
    const saved = window.localStorage.getItem(expandedFoldersStorageKey);
    return new Set<string>(saved ? JSON.parse(saved) : []);
  } catch {
    return new Set<string>();
  }
}

function loadStoredNumber(key: string, fallback: number) {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function joinPath(parent: string, name: string) {
  const separator = parent.includes("/") ? "/" : "\\";
  return `${parent.replace(/[\\/]$/, "")}${separator}${name}`;
}

function findFirstFileId(nodes: WorkspaceNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file") return node.id;
    const childFileId = findFirstFileId(node.children);
    if (childFileId) return childFileId;
  }

  return null;
}

function findFile(nodes: WorkspaceNode[], fileId: string): WorkspaceFile | null {
  for (const node of nodes) {
    if (node.type === "file" && node.id === fileId) return node;
    if (node.type === "folder") {
      const file = findFile(node.children, fileId);
      if (file) return file;
    }
  }

  return null;
}

function updateFileContent(nodes: WorkspaceNode[], fileId: string, content: string): WorkspaceNode[] {
  return nodes.map((node) => {
    if (node.type === "file") {
      return node.id === fileId ? { ...node, content } : node;
    }

    return { ...node, children: updateFileContent(node.children, fileId, content) };
  });
}
