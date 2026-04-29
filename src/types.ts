export type RequestSummary = {
  index: number;
  name: string;
  method: string;
  url: string;
};

export type ResponseData = {
  status: number;
  status_text: string;
  elapsed_ms: number;
  headers: [string, string][];
  body: string;
};

export type WorkspaceFile = {
  id: string;
  type: "file";
  name: string;
  path: string;
  content: string;
};

export type WorkspaceFolder = {
  id: string;
  type: "folder";
  name: string;
  path: string;
  children: WorkspaceNode[];
};

export type WorkspaceNode = WorkspaceFile | WorkspaceFolder;

export type WorkspaceData = {
  root_path: string;
  nodes: WorkspaceNode[];
};

export type SaveState = "saved" | "saving" | "error";
