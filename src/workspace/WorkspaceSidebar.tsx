import type { WorkspaceNode } from "../types";

type WorkspaceSidebarProps = {
  rootPath: string;
  nodes: WorkspaceNode[];
  activeFileId: string;
  selectedFolderId: string | null;
  selectedItem: WorkspaceNode | null;
  expandedFolders: Set<string>;
  onOpenFolder: () => void;
  onRefresh: () => void;
  onAddFolder: () => void;
  onAddFile: () => void;
  onRenameSelected: () => void;
  onSelectFile: (fileId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onToggleFolder: (folderId: string) => void;
};

export default function WorkspaceSidebar({
  rootPath,
  nodes,
  activeFileId,
  selectedFolderId,
  selectedItem,
  expandedFolders,
  onOpenFolder,
  onRefresh,
  onAddFolder,
  onAddFile,
  onRenameSelected,
  onSelectFile,
  onSelectFolder,
  onToggleFolder
}: WorkspaceSidebarProps) {
  return (
    <aside className="workspaceSidebar">
      <div className="sidebarHeader">
        <span>Files</span>
        <div className="sidebarActions">
          <button onClick={onOpenFolder}>Open</button>
          <button onClick={onRefresh} disabled={!rootPath} title="Refresh workspace">
            Refresh
          </button>
        </div>
      </div>
      <div className="sidebarActions secondaryActions">
        <button onClick={onAddFolder} disabled={!rootPath} title="New folder">
          Folder
        </button>
        <button onClick={onAddFile} disabled={!rootPath} title="New HTTP file">
          File
        </button>
        <button onClick={onRenameSelected} disabled={!selectedItem} title="Rename selected item">
          Rename
        </button>
      </div>
      <div className="rootPath" title={rootPath}>
        {rootPath || "Open a folder to start"}
      </div>
      <div className="fileTree">
        {nodes.map((node) => (
          <WorkspaceTreeNode
            key={node.id}
            node={node}
            level={0}
            activeFileId={activeFileId}
            selectedFolderId={selectedFolderId}
            expandedFolders={expandedFolders}
            onSelectFile={onSelectFile}
            onToggleFolder={onToggleFolder}
            onSelectFolder={onSelectFolder}
          />
        ))}
      </div>
    </aside>
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
