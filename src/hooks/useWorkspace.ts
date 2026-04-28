import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SaveState, WorkspaceData, WorkspaceFile, WorkspaceNode } from "../types";

const starterHttp = `### New request
GET https://example.com
`;

const rootPathStorageKey = "mini-rest-client.root-path";
const activeFileStorageKey = "mini-rest-client.active-file";
const expandedFoldersStorageKey = "mini-rest-client.expanded-folders";

export function useWorkspace(onWorkspaceError: (message: string) => void) {
  const [rootPath, setRootPath] = useState(() => window.localStorage.getItem(rootPathStorageKey) ?? "");
  const [workspaceNodes, setWorkspaceNodes] = useState<WorkspaceNode[]>([]);
  const [activeFileId, setActiveFileId] = useState(() => window.localStorage.getItem(activeFileStorageKey) ?? "");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(loadExpandedFolders);
  const [dirtyFileIds, setDirtyFileIds] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<SaveState>("saved");

  const activeFile = useMemo(() => findFile(workspaceNodes, activeFileId), [workspaceNodes, activeFileId]);
  const selectedItem = useMemo(() => {
    if (selectedFolderId && selectedFolderId !== rootPath) return findNode(workspaceNodes, selectedFolderId);
    return activeFile;
  }, [activeFile, rootPath, selectedFolderId, workspaceNodes]);
  const source = activeFile?.content ?? "";

  useEffect(() => {
    if (!rootPath) return;
    invoke<WorkspaceData>("read_workspace_folder", { rootPath })
      .then((workspace) => applyWorkspace(workspace))
      .catch((err) => onWorkspaceError(String(err)));
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
    if (!rootPath || dirtyFileIds.size === 0) {
      if (dirtyFileIds.size === 0) setSaveState("saved");
      return;
    }

    setSaveState("saving");
    const dirtyIds = [...dirtyFileIds];
    const dirtyFiles = dirtyIds
      .map((fileId) => findFile(workspaceNodes, fileId))
      .filter((file): file is WorkspaceFile => Boolean(file));

    const timer = window.setTimeout(() => {
      Promise.all(
        dirtyFiles.map((file) =>
          invoke<void>("write_workspace_file", {
            rootPath,
            filePath: file.path,
            content: file.content
          })
        )
      )
        .then(() => {
          setDirtyFileIds((current) => {
            const next = new Set(current);
            dirtyIds.forEach((fileId) => next.delete(fileId));
            setSaveState(next.size ? "saving" : "saved");
            return next;
          });
        })
        .catch((err) => {
          setSaveState("error");
          onWorkspaceError(String(err));
        });
    }, 450);

    return () => window.clearTimeout(timer);
  }, [dirtyFileIds, onWorkspaceError, rootPath, workspaceNodes]);

  async function openFolder() {
    await flushDirtyFiles();
    const workspace = await invoke<WorkspaceData | null>("open_workspace_folder");
    if (!workspace) return;

    window.localStorage.setItem(rootPathStorageKey, workspace.root_path);
    applyWorkspace(workspace, true);
  }

  async function refreshWorkspace() {
    if (!rootPath) return;
    await flushDirtyFiles();
    const workspace = await invoke<WorkspaceData>("read_workspace_folder", { rootPath });
    applyWorkspace(workspace);
  }

  async function addFolder() {
    if (!rootPath) return;
    const name = window.prompt("Folder name", "New Folder")?.trim();
    if (!name) return;

    await flushDirtyFiles();
    const parentPath = selectedFolderId ?? rootPath;
    const workspace = await invoke<WorkspaceData>("create_workspace_folder", {
      rootPath,
      parentPath,
      name
    });
    expandFolder(parentPath);
    applyWorkspace(workspace);
  }

  async function addFile() {
    if (!rootPath) return;
    const name = window.prompt("File name", "request.http")?.trim();
    if (!name) return;

    const parentPath = selectedFolderId ?? rootPath;
    const fileName = /\.(http|rest)$/i.test(name) ? name : `${name}.http`;
    await flushDirtyFiles();
    const workspace = await invoke<WorkspaceData>("create_workspace_file", {
      rootPath,
      parentPath,
      name: fileName,
      content: starterHttp
    });
    const createdPath = joinPath(parentPath, fileName);
    expandFolder(parentPath);
    applyWorkspace(workspace);
    setActiveFileId(createdPath);
  }

  async function renameItem(item: WorkspaceNode) {
    if (!rootPath) return;
    const nextName = window.prompt("Rename", item.name)?.trim();
    if (!nextName || nextName === item.name) return;

    await flushDirtyFiles();
    const workspace = await invoke<WorkspaceData>("rename_workspace_item", {
      rootPath,
      itemPath: item.path,
      newName: nextName
    });

    const renamedPath = joinPath(parentPathOf(item.path), nextName);
    applyWorkspace(workspace);
    if (item.type === "file") setActiveFileId(renamedPath);
    if (item.type === "folder") {
      setSelectedFolderId(renamedPath);
      expandFolder(renamedPath);
    }
  }

  async function renameSelectedItem() {
    if (!selectedItem) return;
    await renameItem(selectedItem);
  }

  function updateActiveSource(nextSource: string) {
    if (!activeFile) return;
    setWorkspaceNodes((nodes) => updateFileContent(nodes, activeFile.id, nextSource));
    setDirtyFileIds((fileIds) => new Set([...fileIds, activeFile.id]));
  }

  function selectFile(fileId: string) {
    setActiveFileId(fileId);
    setSelectedFolderId(null);
  }

  function selectFolder(folderId: string) {
    setSelectedFolderId(folderId);
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

  function applyWorkspace(workspace: WorkspaceData, forceFirstFile = false) {
    setRootPath(workspace.root_path);
    setWorkspaceNodes(workspace.nodes);
    setSelectedFolderId(workspace.root_path);
    expandFolder(workspace.root_path);
    setDirtyFileIds(new Set());
    setSaveState("saved");

    const existingActiveFile = findFile(workspace.nodes, activeFileId);
    const firstFileId = findFirstFileId(workspace.nodes);
    if (forceFirstFile || !existingActiveFile) {
      setActiveFileId(firstFileId ?? "");
    }
  }

  function expandFolder(folderId: string) {
    setExpandedFolders((folders) => new Set([...folders, folderId]));
  }

  async function flushDirtyFiles() {
    if (!rootPath || dirtyFileIds.size === 0) return;

    const dirtyIds = [...dirtyFileIds];
    const dirtyFiles = dirtyIds
      .map((fileId) => findFile(workspaceNodes, fileId))
      .filter((file): file is WorkspaceFile => Boolean(file));

    await Promise.all(
      dirtyFiles.map((file) =>
        invoke<void>("write_workspace_file", {
          rootPath,
          filePath: file.path,
          content: file.content
        })
      )
    );

    setDirtyFileIds((fileIds) => {
      const next = new Set(fileIds);
      dirtyIds.forEach((fileId) => next.delete(fileId));
      return next;
    });
    setSaveState("saved");
  }

  return {
    rootPath,
    workspaceNodes,
    activeFile,
    activeFileId,
    selectedFolderId,
    selectedItem,
    expandedFolders,
    source,
    saveState,
    openFolder,
    refreshWorkspace,
    addFolder,
    addFile,
    renameSelectedItem,
    updateActiveSource,
    selectFile,
    selectFolder,
    toggleFolder
  };
}

function loadExpandedFolders() {
  try {
    const saved = window.localStorage.getItem(expandedFoldersStorageKey);
    return new Set<string>(saved ? JSON.parse(saved) : []);
  } catch {
    return new Set<string>();
  }
}

function joinPath(parent: string, name: string) {
  const separator = parent.includes("/") ? "/" : "\\";
  return `${parent.replace(/[\\/]$/, "")}${separator}${name}`;
}

function parentPathOf(path: string) {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join(path.includes("/") ? "/" : "\\");
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

function findNode(nodes: WorkspaceNode[], nodeId: string): WorkspaceNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    if (node.type === "folder") {
      const child = findNode(node.children, nodeId);
      if (child) return child;
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
