import { useEffect, useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import HttpEditor from "./editor/HttpEditor";
import ResponsePanel from "./response/ResponsePanel";

type RequestSummary = {
  index: number;
  name: string;
  method: string;
  url: string;
  headers: [string, string][];
  body?: string | null;
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

type EnvironmentVariable = {
  id: string;
  key: string;
  value: string;
  secret: boolean;
};

type EnvironmentMap = Record<string, EnvironmentVariable[]>;

type RequestSnapshot = {
  name: string;
  method: string;
  url: string;
  headers: [string, string][];
  body?: string | null;
};

type HistoryEntry = {
  id: string;
  timestamp: number;
  environment: string;
  name: string;
  method: string;
  url: string;
  request?: RequestSnapshot;
  response?: ResponseData;
  status?: number;
  status_text?: string;
  elapsed_ms?: number;
  error?: string;
};

type FileContextMenu = {
  file: WorkspaceFile;
  x: number;
  y: number;
};

type FolderContextMenu = {
  folder: WorkspaceFolder;
  x: number;
  y: number;
};

const starterHttp = `### New request
GET https://example.com
`;

const defaultEnvironments: EnvironmentMap = {
  dev: [],
  test: [],
  prod: []
};

const rootPathStorageKey = "mini-rest-client.root-path";
const activeFileStorageKey = "mini-rest-client.active-file";
const expandedFoldersStorageKey = "mini-rest-client.expanded-folders";
const sidebarWidthStorageKey = "mini-rest-client.sidebar-width";
const responseWidthStorageKey = "mini-rest-client.response-width";
const environmentsStorageKey = "mini-rest-client.environments";
const activeEnvironmentStorageKey = "mini-rest-client.active-environment";
const historyStorageKey = "mini-rest-client.history";

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
  const [environments, setEnvironments] = useState<EnvironmentMap>(() => loadEnvironments());
  const [activeEnvironment, setActiveEnvironment] = useState(
    () => window.localStorage.getItem(activeEnvironmentStorageKey) ?? ""
  );
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenu | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenu | null>(null);
  const [envPanelOpen, setEnvPanelOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<"all" | "success" | "error">("all");
  const [locateVariable, setLocateVariable] = useState<string | null>(null);

  const activeFile = useMemo(() => findFile(workspaceNodes, activeFileId), [workspaceNodes, activeFileId]);
  const source = activeFile?.content ?? "";
  const envVariables = useMemo(
    () => environmentVariablesToRecord(activeEnvironment ? environments[activeEnvironment] ?? [] : []),
    [activeEnvironment, environments]
  );
  const fileVariables = useMemo(() => parseFileVariables(source), [source]);
  const variableConflicts = useMemo(
    () => Object.keys(envVariables).filter((key) => Object.prototype.hasOwnProperty.call(fileVariables, key)),
    [envVariables, fileVariables]
  );
  const knownVariables = useMemo(
    () => [...new Set([...Object.keys(envVariables), ...Object.keys(fileVariables)])],
    [envVariables, fileVariables]
  );

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
    window.localStorage.setItem(environmentsStorageKey, JSON.stringify(environments));
  }, [environments]);

  useEffect(() => {
    window.localStorage.setItem(activeEnvironmentStorageKey, activeEnvironment);
  }, [activeEnvironment]);

  useEffect(() => {
    window.localStorage.setItem(historyStorageKey, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    if (!fileContextMenu && !folderContextMenu) return;

    function closeMenu() {
      setFileContextMenu(null);
      setFolderContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("contextmenu", closeMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fileContextMenu, folderContextMenu]);

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

      invoke<RequestSummary[]>("parse_requests", { source, envVariables })
        .then((nextRequests) => {
          setRequests(nextRequests);
          setError(null);
          if (nextRequests.length && !nextRequests.some((item) => item.index === selectedIndex)) {
            setSelectedIndex(nextRequests[0].index);
          }
        })
        .catch((err) => {
          setRequests([]);
          const message = String(err);
          setError(message);
          setLocateVariable(extractUndefinedVariable(message));
        });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [source, selectedIndex, envVariables]);

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

    try {
      const workspace = await invoke<WorkspaceData>("create_workspace_folder", {
        rootPath,
        parentPath: selectedFolderId ?? rootPath,
        name
      });
      setExpandedFolders((folders) => new Set([...folders, selectedFolderId ?? rootPath]));
      applyWorkspace(workspace);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function addFile() {
    if (!rootPath) return;
    const parentPath = selectedFolderId ?? rootPath;
    const name = window.prompt("File name", nextHttpFileName(workspaceNodes, parentPath))?.trim();
    if (!name) return;

    const fileName = /\.(http|rest)$/i.test(name) ? name : `${name}.http`;
    const template = chooseRequestTemplate();

    try {
      const workspace = await invoke<WorkspaceData>("create_workspace_file", {
        rootPath,
        parentPath,
        name: fileName,
        content: template
      });
      const createdPath = joinPath(parentPath, fileName);
      setExpandedFolders((folders) => new Set([...folders, parentPath]));
      applyWorkspace(workspace);
      setActiveFileId(createdPath);
      setResponse(null);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function renameFolder(folder: WorkspaceFolder) {
    if (!rootPath || folder.id === rootPath) return;
    const name = window.prompt("Folder name", folder.name)?.trim();
    if (!name || name === folder.name) return;

    try {
      const workspace = await invoke<WorkspaceData>("rename_workspace_folder", {
        rootPath,
        folderPath: folder.path,
        name
      });
      applyWorkspace(workspace);
      setSelectedFolderId(joinPath(parentPathOf(folder.path), name));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function duplicateFolder(folder: WorkspaceFolder) {
    if (!rootPath || folder.id === rootPath) return;
    const parentPath = parentPathOf(folder.path);
    const name = window.prompt("Folder name", nextCopyFolderName(workspaceNodes, parentPath, folder.name))?.trim();
    if (!name) return;

    try {
      const workspace = await invoke<WorkspaceData>("duplicate_workspace_folder", {
        rootPath,
        folderPath: folder.path,
        name
      });
      applyWorkspace(workspace);
      setSelectedFolderId(joinPath(parentPath, name));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function deleteFolder(folder: WorkspaceFolder) {
    if (!rootPath || folder.id === rootPath) return;
    const fileCount = countFiles(folder);
    const folderCount = countFolders(folder);
    if (!window.confirm(`Delete ${folder.name}? It contains ${fileCount} file(s) and ${folderCount} folder(s).`)) return;

    try {
      const workspace = await invoke<WorkspaceData>("delete_workspace_folder", {
        rootPath,
        folderPath: folder.path
      });
      applyWorkspace(workspace);
      setActiveFileId(findFirstFileId(workspace.nodes) ?? "");
      setResponse(null);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function moveItem(itemPath: string, targetFolderPath: string) {
    if (!rootPath || itemPath === targetFolderPath || parentPathOf(itemPath) === targetFolderPath) return;

    try {
      const workspace = await invoke<WorkspaceData>("move_workspace_item", {
        rootPath,
        itemPath,
        targetFolderPath
      });
      applyWorkspace(workspace);
      setExpandedFolders((folders) => new Set([...folders, targetFolderPath]));
      const activeName = activeFile ? fileNameOf(activeFile.path) : "";
      if (activeFile && activeFile.path === itemPath) {
        setActiveFileId(joinPath(targetFolderPath, activeName));
      }
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function renameFile(file: WorkspaceFile) {
    if (!rootPath) return;
    const name = window.prompt("File name", file.name)?.trim();
    if (!name || name === file.name) return;

    const fileName = /\.(http|rest)$/i.test(name) ? name : `${name}.http`;
    const parentPath = parentPathOf(file.path);
    const nextPath = joinPath(parentPath, fileName);

    try {
      const workspace = await invoke<WorkspaceData>("rename_workspace_file", {
        rootPath,
        filePath: file.path,
        name: fileName
      });
      applyWorkspace(workspace);
      setActiveFileId(nextPath);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function duplicateFile(file: WorkspaceFile) {
    if (!rootPath) return;
    const parentPath = parentPathOf(file.path);
    const name = window.prompt("File name", nextCopyFileName(workspaceNodes, parentPath, file.name))?.trim();
    if (!name) return;

    const fileName = /\.(http|rest)$/i.test(name) ? name : `${name}.http`;
    const createdPath = joinPath(parentPath, fileName);

    try {
      const workspace = await invoke<WorkspaceData>("duplicate_workspace_file", {
        rootPath,
        filePath: file.path,
        name: fileName
      });
      applyWorkspace(workspace);
      setActiveFileId(createdPath);
      setResponse(null);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function deleteFile(file: WorkspaceFile) {
    if (!rootPath) return;
    if (!window.confirm(`Delete ${file.name}?`)) return;

    try {
      const workspace = await invoke<WorkspaceData>("delete_workspace_file", {
        rootPath,
        filePath: file.path
      });
      applyWorkspace(workspace);
      if (activeFileId === file.id) {
        setActiveFileId(findFirstFileId(workspace.nodes) ?? "");
        setResponse(null);
      }
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }

  function addEnvironment() {
    const name = window.prompt("Environment name", "local")?.trim();
    if (!name) return;
    if (environments[name]) {
      setError(`Environment "${name}" already exists.`);
      return;
    }
    setEnvironments((items) => ({ ...items, [name]: [] }));
    setActiveEnvironment(name);
  }

  function renameEnvironment(name: string) {
    const nextName = window.prompt("Environment name", name)?.trim();
    if (!nextName || nextName === name) return;
    if (environments[nextName]) {
      setError(`Environment "${nextName}" already exists.`);
      return;
    }

    setEnvironments((items) => {
      const { [name]: variables, ...rest } = items;
      return { ...rest, [nextName]: variables ?? [] };
    });
    if (activeEnvironment === name) setActiveEnvironment(nextName);
  }

  function deleteEnvironment(name: string) {
    if (!window.confirm(`Delete environment ${name}?`)) return;
    setEnvironments((items) => {
      const { [name]: _removed, ...rest } = items;
      return Object.keys(rest).length ? rest : defaultEnvironments;
    });
    if (activeEnvironment === name) setActiveEnvironment("");
  }

  function updateEnvironmentVariables(name: string, variables: EnvironmentVariable[]) {
    setEnvironments((items) => ({ ...items, [name]: variables }));
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
    const request = requests.find((item) => item.index === index);
    setLoading(true);
    setError(null);

    try {
      const data = await invoke<ResponseData>("send_request", {
        source,
        requestIndex: index,
        envVariables
      });
      setResponse(data);
      addHistory({
        request,
        response: data,
        error: null
      });
    } catch (err) {
      setResponse(null);
      const message = String(err);
      setError(message);
      addHistory({
        request,
        response: null,
        error: message
      });
    } finally {
      setLoading(false);
    }
  }

  async function copyRequestAsCurl(index: number) {
    if (!requests.length) return;
    setError(null);

    try {
      const command = await invoke<string>("copy_request_as_curl", {
        source,
        requestIndex: index,
        envVariables
      });
      await writeClipboardText(command);
    } catch (err) {
      setError(String(err));
    }
  }

  function clearResponse() {
    setResponse(null);
    setError(null);
  }

  function clearHistory() {
    setHistory([]);
  }

  async function resendHistoryEntry(entry: HistoryEntry) {
    if (!entry.request) {
      setError("No request was recorded for this history item.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await invoke<ResponseData>("send_raw_request", {
        request: {
          ...entry.request,
          body: entry.request.body ?? null
        }
      });
      setResponse(data);
      addHistory({
        request: entry.request,
        response: data,
        error: null
      });
    } catch (err) {
      const message = String(err);
      setResponse(null);
      setError(message);
      addHistory({
        request: entry.request,
        response: null,
        error: message
      });
    } finally {
      setLoading(false);
    }
  }

  function createRequestFromHistory(entry: HistoryEntry) {
    if (!entry.request || !activeFile) {
      setError("Open a request file before creating a request from history.");
      return;
    }

    updateActiveSource(`${source.trimEnd()}\n\n${requestToHttpBlock(entry.request)}\n`);
  }

  function showHistoryEntry(entry: HistoryEntry) {
    setLoading(false);
    if (entry.response) {
      setResponse(entry.response);
      setError(null);
      return;
    }

    setResponse(null);
    setError(entry.error ?? "No response was recorded for this history item.");
  }

  function addHistory({
    request,
    response,
    error
  }: {
    request: RequestSummary | RequestSnapshot | undefined;
    response: ResponseData | null;
    error: string | null;
  }) {
    if (!request) return;
    const snapshot = toRequestSnapshot(request);

    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
      environment: activeEnvironment,
      name: snapshot.name,
      method: snapshot.method,
      url: snapshot.url,
      request: snapshot,
      response: response ?? undefined,
      status: response?.status,
      status_text: response?.status_text,
      elapsed_ms: response?.elapsed_ms,
      error: error ?? undefined
    };

    setHistory((items) => [entry, ...items].slice(0, 50));
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
            className="envSelect"
            value={activeEnvironment}
            onChange={(event) => setActiveEnvironment(event.target.value)}
            title="Environment"
          >
            <option value="">No env</option>
            {Object.keys(environments).map((name) => (
              <option value={name} key={name}>
                {name}
              </option>
            ))}
          </select>
          <button onClick={() => setEnvPanelOpen(true)}>Env</button>
          <select
            className="requestSelect"
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
                onFileContextMenu={(file, event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setFileContextMenu({
                    file,
                    x: event.clientX,
                    y: event.clientY
                  });
                }}
                onFolderContextMenu={(folder, event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (folder.id === rootPath) return;
                  setFolderContextMenu({
                    folder,
                    x: event.clientX,
                    y: event.clientY
                  });
                }}
                onMoveItem={moveItem}
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
          knownVariables={knownVariables}
          locateVariable={locateVariable}
          onChange={updateActiveSource}
          onSelect={setSelectedIndex}
          onSend={sendRequest}
          onCopyCurl={copyRequestAsCurl}
        />

        <div className="paneResizer" role="separator" aria-label="Resize response panel" onMouseDown={() => setDraggingPane("response")} />

        <ResponsePanel
          response={response}
          error={error}
          loading={loading}
          history={history}
          onClear={clearResponse}
          onClearHistory={clearHistory}
          onSelectHistory={showHistoryEntry}
          onResendHistory={resendHistoryEntry}
          onCreateRequestFromHistory={createRequestFromHistory}
          historyQuery={historyQuery}
          onHistoryQueryChange={setHistoryQuery}
          historyStatusFilter={historyStatusFilter}
          onHistoryStatusFilterChange={setHistoryStatusFilter}
          onLocateError={() => {
            const variable = extractUndefinedVariable(error ?? "");
            if (variable) setLocateVariable(`${variable}:${Date.now()}`);
          }}
        />
      </section>

      {envPanelOpen && (
        <EnvironmentPanel
          environments={environments}
          activeEnvironment={activeEnvironment}
          conflicts={variableConflicts}
          onActiveEnvironmentChange={setActiveEnvironment}
          onClose={() => setEnvPanelOpen(false)}
          onAddEnvironment={addEnvironment}
          onRenameEnvironment={renameEnvironment}
          onDeleteEnvironment={deleteEnvironment}
          onChangeVariables={updateEnvironmentVariables}
        />
      )}

      {fileContextMenu && (
        <div
          className="contextMenu"
          style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button onClick={() => {
            const { file } = fileContextMenu;
            setFileContextMenu(null);
            renameFile(file);
          }}>Rename</button>
          <button onClick={() => {
            const { file } = fileContextMenu;
            setFileContextMenu(null);
            duplicateFile(file);
          }}>Duplicate</button>
          <button className="danger" onClick={() => {
            const { file } = fileContextMenu;
            setFileContextMenu(null);
            deleteFile(file);
          }}>Delete</button>
        </div>
      )}

      {folderContextMenu && (
        <div
          className="contextMenu"
          style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button onClick={() => {
            const { folder } = folderContextMenu;
            setFolderContextMenu(null);
            renameFolder(folder);
          }}>Rename</button>
          <button onClick={() => {
            const { folder } = folderContextMenu;
            setFolderContextMenu(null);
            duplicateFolder(folder);
          }}>Duplicate</button>
          <button className="danger" onClick={() => {
            const { folder } = folderContextMenu;
            setFolderContextMenu(null);
            deleteFolder(folder);
          }}>Delete</button>
        </div>
      )}
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
  onFileContextMenu: (file: WorkspaceFile, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onFolderContextMenu: (folder: WorkspaceFolder, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onMoveItem: (itemPath: string, targetFolderPath: string) => void;
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
  onFileContextMenu,
  onFolderContextMenu,
  onMoveItem,
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
          onContextMenu={(event) => onFolderContextMenu(node, event)}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", node.path);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const itemPath = event.dataTransfer.getData("text/plain");
            if (itemPath) onMoveItem(itemPath, node.path);
          }}
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
              onFileContextMenu={onFileContextMenu}
              onFolderContextMenu={onFolderContextMenu}
              onMoveItem={onMoveItem}
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
      onContextMenu={(event) => onFileContextMenu(node, event)}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", node.path);
        event.dataTransfer.effectAllowed = "move";
      }}
      title={node.path}
    >
      <span className="treeIcon">HTTP</span>
      <span>{node.name}</span>
    </button>
  );
}

type EnvironmentPanelProps = {
  environments: EnvironmentMap;
  activeEnvironment: string;
  conflicts: string[];
  onActiveEnvironmentChange: (name: string) => void;
  onClose: () => void;
  onAddEnvironment: () => void;
  onRenameEnvironment: (name: string) => void;
  onDeleteEnvironment: (name: string) => void;
  onChangeVariables: (name: string, variables: EnvironmentVariable[]) => void;
};

function EnvironmentPanel({
  environments,
  activeEnvironment,
  conflicts,
  onActiveEnvironmentChange,
  onClose,
  onAddEnvironment,
  onRenameEnvironment,
  onDeleteEnvironment,
  onChangeVariables
}: EnvironmentPanelProps) {
  const names = Object.keys(environments);
  const selectedName = activeEnvironment && environments[activeEnvironment] ? activeEnvironment : names[0] ?? "";
  const variables = selectedName ? environments[selectedName] ?? [] : [];

  function updateVariable(id: string, patch: Partial<EnvironmentVariable>) {
    onChangeVariables(
      selectedName,
      variables.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  }

  function addVariable() {
    onChangeVariables(selectedName, [
      ...variables,
      {
        id: createId(),
        key: "",
        value: "",
        secret: false
      }
    ]);
  }

  function removeVariable(id: string) {
    onChangeVariables(selectedName, variables.filter((item) => item.id !== id));
  }

  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section className="envPanel" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <h2>Environments</h2>
          <button onClick={onClose}>Close</button>
        </header>

        <div className="envPanelBody">
          <aside className="envList">
            {names.map((name) => (
              <button
                className={name === selectedName ? "active" : ""}
                key={name}
                onClick={() => onActiveEnvironmentChange(name)}
              >
                {name}
              </button>
            ))}
            <button onClick={onAddEnvironment}>New Env</button>
          </aside>

          <section className="envEditor">
            <div className="envEditorHeader">
              <strong>{selectedName || "No environment"}</strong>
              <div>
                <button disabled={!selectedName} onClick={() => onRenameEnvironment(selectedName)}>Rename</button>
                <button disabled={!selectedName} onClick={() => onDeleteEnvironment(selectedName)}>Delete</button>
                <button disabled={!selectedName} onClick={addVariable}>Add Variable</button>
              </div>
            </div>

            {conflicts.length > 0 && selectedName === activeEnvironment && (
              <div className="envConflict">
                File variables override environment values: {conflicts.join(", ")}
              </div>
            )}

            <div className="envTable">
              <div className="envTableHead">
                <span>Key</span>
                <span>Value</span>
                <span>Secret</span>
                <span />
              </div>
              {variables.map((variable) => (
                <div className="envRow" key={variable.id}>
                  <input
                    value={variable.key}
                    onChange={(event) => updateVariable(variable.id, { key: event.target.value })}
                    placeholder="key"
                  />
                  <input
                    value={variable.value}
                    type={variable.secret ? "password" : "text"}
                    onChange={(event) => updateVariable(variable.id, { value: event.target.value })}
                    placeholder="value"
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={variable.secret}
                      onChange={(event) => updateVariable(variable.id, { secret: event.target.checked })}
                    />
                  </label>
                  <button onClick={() => removeVariable(variable.id)}>Remove</button>
                </div>
              ))}
              {!variables.length && <div className="envEmpty">No variables in this environment.</div>}
            </div>
          </section>
        </div>
      </section>
    </div>
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

function loadEnvironments(): EnvironmentMap {
  try {
    const saved = window.localStorage.getItem(environmentsStorageKey);
    if (!saved) return defaultEnvironments;
    const parsed = JSON.parse(saved) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaultEnvironments;
    const next: EnvironmentMap = { ...defaultEnvironments };

    for (const [name, value] of Object.entries(parsed)) {
      if (Array.isArray(value) && value.every(isEnvironmentVariable)) {
        next[name] = value;
      } else if (isStringRecord(value)) {
        next[name] = Object.entries(value).map(([key, item]) => ({
          id: createId(),
          key,
          value: item,
          secret: false
        }));
      }
    }

    return next;
  } catch {
    return defaultEnvironments;
  }
}

function loadHistory(): HistoryEntry[] {
  try {
    const saved = window.localStorage.getItem(historyStorageKey);
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryEntry).slice(0, 50);
  } catch {
    return [];
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  return Object.entries(value).every(([key, item]) => key.trim() && typeof item === "string");
}

function isEnvironmentVariable(value: unknown): value is EnvironmentVariable {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<EnvironmentVariable>;
  return (
    typeof item.id === "string" &&
    typeof item.key === "string" &&
    typeof item.value === "string" &&
    typeof item.secret === "boolean"
  );
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<HistoryEntry>;
  return (
    typeof item.id === "string" &&
    typeof item.timestamp === "number" &&
    typeof item.method === "string" &&
    typeof item.url === "string" &&
    (item.response === undefined || isResponseData(item.response))
  );
}

function isResponseData(value: unknown): value is ResponseData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<ResponseData>;
  return (
    typeof item.status === "number" &&
    typeof item.status_text === "string" &&
    typeof item.elapsed_ms === "number" &&
    Array.isArray(item.headers) &&
    item.headers.every((header) => Array.isArray(header) && typeof header[0] === "string" && typeof header[1] === "string") &&
    typeof item.body === "string"
  );
}

function environmentVariablesToRecord(variables: EnvironmentVariable[]) {
  return variables.reduce<Record<string, string>>((record, variable) => {
    const key = variable.key.trim();
    if (key) record[key] = variable.value;
    return record;
  }, {});
}

function parseFileVariables(source: string) {
  const variables: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*@([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (match) variables[match[1].trim()] = match[2].trim();
  }
  return variables;
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function joinPath(parent: string, name: string) {
  const separator = parent.includes("/") ? "/" : "\\";
  return `${parent.replace(/[\\/]$/, "")}${separator}${name}`;
}

function parentPathOf(path: string) {
  const normalized = path.replace(/[\\/]$/, "");
  const slashIndex = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : normalized;
}

function fileNameOf(path: string) {
  const normalized = path.replace(/[\\/]$/, "");
  const slashIndex = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
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

function findFolder(nodes: WorkspaceNode[], folderId: string): WorkspaceFolder | null {
  for (const node of nodes) {
    if (node.type === "folder" && node.id === folderId) return node;
    if (node.type === "folder") {
      const folder = findFolder(node.children, folderId);
      if (folder) return folder;
    }
  }

  return null;
}

function nextHttpFileName(nodes: WorkspaceNode[], parentPath: string) {
  const parentFolder = findFolder(nodes, parentPath);
  const siblings = parentFolder?.children ?? nodes;
  const existingNames = new Set(
    siblings
      .filter((node): node is WorkspaceFile => node.type === "file")
      .map((node) => node.name.toLowerCase())
  );

  if (!existingNames.has("request.http")) {
    return "request.http";
  }

  for (let index = 2; index < 10_000; index += 1) {
    const name = `request-${index}.http`;
    if (!existingNames.has(name)) {
      return name;
    }
  }

  return `request-${Date.now()}.http`;
}

function nextCopyFileName(nodes: WorkspaceNode[], parentPath: string, sourceName: string) {
  const parentFolder = findFolder(nodes, parentPath);
  const siblings = parentFolder?.children ?? nodes;
  const existingNames = new Set(
    siblings
      .filter((node): node is WorkspaceFile => node.type === "file")
      .map((node) => node.name.toLowerCase())
  );
  const match = /^(.*?)(\.(?:http|rest))$/i.exec(sourceName);
  const base = match?.[1] || sourceName;
  const extension = match?.[2] || ".http";
  const firstCopy = `${base}-copy${extension}`;

  if (!existingNames.has(firstCopy.toLowerCase())) {
    return firstCopy;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const name = `${base}-copy-${index}${extension}`;
    if (!existingNames.has(name.toLowerCase())) {
      return name;
    }
  }

  return `${base}-copy-${Date.now()}${extension}`;
}

function nextCopyFolderName(nodes: WorkspaceNode[], parentPath: string, sourceName: string) {
  const parentFolder = findFolder(nodes, parentPath);
  const siblings = parentFolder?.children ?? nodes;
  const existingNames = new Set(siblings.map((node) => node.name.toLowerCase()));
  const firstCopy = `${sourceName}-copy`;

  if (!existingNames.has(firstCopy.toLowerCase())) {
    return firstCopy;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const name = `${sourceName}-copy-${index}`;
    if (!existingNames.has(name.toLowerCase())) {
      return name;
    }
  }

  return `${sourceName}-copy-${Date.now()}`;
}

function countFiles(folder: WorkspaceFolder): number {
  return folder.children.reduce((count, node) => {
    if (node.type === "file") return count + 1;
    return count + countFiles(node);
  }, 0);
}

function countFolders(folder: WorkspaceFolder): number {
  return folder.children.reduce((count, node) => {
    if (node.type === "file") return count;
    return count + 1 + countFolders(node);
  }, 0);
}

function chooseRequestTemplate() {
  const choice = window.prompt("Template: 1 GET, 2 POST JSON, 3 Form, 4 cURL", "1")?.trim();

  if (choice === "2") {
    return `### New JSON request
POST https://example.com
Content-Type: application/json

{
  "hello": "world"
}
`;
  }

  if (choice === "3") {
    return `### New form request
POST https://example.com
Content-Type: application/x-www-form-urlencoded

key=value
`;
  }

  if (choice === "4") {
    return `### New cURL request
curl https://example.com
`;
  }

  return starterHttp;
}

function toRequestSnapshot(request: RequestSummary | RequestSnapshot): RequestSnapshot {
  return {
    name: request.name,
    method: request.method,
    url: request.url,
    headers: request.headers ?? [],
    body: request.body ?? null
  };
}

function requestToHttpBlock(request: RequestSnapshot) {
  const lines = [`### ${request.name || "Request"}`, `${request.method} ${request.url}`];
  for (const [key, value] of request.headers) {
    lines.push(`${key}: ${value}`);
  }
  if (request.body) {
    lines.push("", request.body);
  }
  return lines.join("\n");
}

function extractUndefinedVariable(message: string) {
  const match = /Undefined variable\(s\):\s*([^,\s]+)/.exec(message);
  return match?.[1] ?? null;
}

function updateFileContent(nodes: WorkspaceNode[], fileId: string, content: string): WorkspaceNode[] {
  return nodes.map((node) => {
    if (node.type === "file") {
      return node.id === fileId ? { ...node, content } : node;
    }

    return { ...node, children: updateFileContent(node.children, fileId, content) };
  });
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
