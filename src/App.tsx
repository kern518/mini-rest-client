import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import HttpEditor from "./editor/HttpEditor";
import { useResizableLayout } from "./hooks/useResizableLayout";
import { useWorkspace } from "./hooks/useWorkspace";
import ResponsePanel from "./response/ResponsePanel";
import type { RequestSummary, ResponseData } from "./types";
import WorkspaceSidebar from "./workspace/WorkspaceSidebar";

export default function App() {
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const onWorkspaceError = useCallback((message: string) => setError(message), []);
  const workspace = useWorkspace(onWorkspaceError);
  const layout = useResizableLayout();

  useEffect(() => {
    setSelectedIndex(0);
    setResponse(null);
    setError(null);
  }, [workspace.activeFileId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!workspace.source.trim()) {
        setRequests([]);
        setError(null);
        return;
      }

      invoke<RequestSummary[]>("parse_requests", { source: workspace.source })
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
  }, [selectedIndex, workspace.source]);

  async function sendRequest(index: number) {
    if (!requests.length) return;
    setLoading(true);
    setError(null);

    try {
      const data = await invoke<ResponseData>("send_request", {
        source: workspace.source,
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

  async function openFolder() {
    await workspace.openFolder();
    setResponse(null);
    setError(null);
  }

  async function refreshWorkspace() {
    await workspace.refreshWorkspace();
    setResponse(null);
    setError(null);
  }

  const title = workspace.activeFile?.name ?? "No file";
  const saveLabel =
    workspace.saveState === "saving" ? "Saving..." : workspace.saveState === "error" ? "Save failed" : "Saved";

  return (
    <main className="appRoot">
      <header className="toolbar">
        <div className="titleGroup">
          <strong>Mini REST Client</strong>
          <span>{title}</span>
          <span className="muted">{saveLabel}</span>
        </div>
        <div className="toolbarActions">
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
          gridTemplateColumns: `${layout.sidebarWidth}px 6px minmax(420px, 1fr) 6px ${layout.responseWidth}px`
        }}
      >
        <WorkspaceSidebar
          rootPath={workspace.rootPath}
          nodes={workspace.workspaceNodes}
          activeFileId={workspace.activeFileId}
          selectedFolderId={workspace.selectedFolderId}
          selectedItem={workspace.selectedItem}
          expandedFolders={workspace.expandedFolders}
          onOpenFolder={openFolder}
          onRefresh={refreshWorkspace}
          onAddFolder={workspace.addFolder}
          onAddFile={workspace.addFile}
          onRenameSelected={workspace.renameSelectedItem}
          onSelectFile={workspace.selectFile}
          onSelectFolder={workspace.selectFolder}
          onToggleFolder={workspace.toggleFolder}
        />

        <div
          className="paneResizer"
          role="separator"
          aria-label="Resize files panel"
          onMouseDown={layout.startDraggingSidebar}
        />

        <HttpEditor
          value={workspace.source}
          selectedIndex={selectedIndex}
          onChange={workspace.updateActiveSource}
          onSelect={setSelectedIndex}
          onSend={sendRequest}
        />

        <div
          className="paneResizer"
          role="separator"
          aria-label="Resize response panel"
          onMouseDown={layout.startDraggingResponse}
        />

        <ResponsePanel response={response} error={error} loading={loading} />
      </section>
    </main>
  );
}
