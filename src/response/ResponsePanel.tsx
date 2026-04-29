import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

type ResponseData = {
  status: number;
  status_text: string;
  elapsed_ms: number;
  headers: [string, string][];
  body: string;
};

type HistoryEntry = {
  id: string;
  timestamp: number;
  environment: string;
  name: string;
  method: string;
  url: string;
  request?: {
    name: string;
    method: string;
    url: string;
    headers: [string, string][];
    body?: string | null;
  };
  response?: ResponseData;
  status?: number;
  status_text?: string;
  elapsed_ms?: number;
  error?: string;
};

type RequestSnapshot = {
  name: string;
  method: string;
  url: string;
  headers: [string, string][];
  body?: string | null;
};

type ResponsePanelProps = {
  response: ResponseData | null;
  request: RequestSnapshot | null;
  error: string | null;
  loading: boolean;
  history: HistoryEntry[];
  onClear: () => void;
  onClearHistory: () => void;
  onSelectHistory: (entry: HistoryEntry) => void;
  onResendHistory: (entry: HistoryEntry) => void;
  onCreateRequestFromHistory: (entry: HistoryEntry) => void;
  historyQuery: string;
  onHistoryQueryChange: (query: string) => void;
  historyStatusFilter: "all" | "success" | "error";
  onHistoryStatusFilterChange: (filter: "all" | "success" | "error") => void;
  onLocateError: () => void;
};

export default function ResponsePanel({
  response,
  request,
  error,
  loading,
  history,
  onClear,
  onClearHistory,
  onSelectHistory,
  onResendHistory,
  onCreateRequestFromHistory,
  historyQuery,
  onHistoryQueryChange,
  historyStatusFilter,
  onHistoryStatusFilterChange,
  onLocateError
}: ResponsePanelProps) {
  const [bodyMode, setBodyMode] = useState<"pretty" | "raw">("pretty");
  const [collapsedJsonPaths, setCollapsedJsonPaths] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const hasResult = Boolean(response || error);
  const bodyText = response ? (bodyMode === "pretty" ? formatBody(response.body) : response.body) : "";
  const filteredBody = useMemo(() => filterText(bodyText, query), [bodyText, query]);
  const filteredHistory = useMemo(
    () => filterHistory(history, historyQuery, historyStatusFilter),
    [history, historyQuery, historyStatusFilter]
  );
  const responseType = response ? detectResponseType(response) : "";
  const responseSize = response ? formatBytes(new Blob([response.body]).size) : "";
  const parsedJson = useMemo(
    () => (response && responseType === "json" ? parseJson(response.body) : null),
    [response, responseType]
  );

  useEffect(() => {
    setBodyMode("pretty");
    setCollapsedJsonPaths(new Set());
    setQuery("");
  }, [response]);

  function toggleJsonPath(path: string) {
    setCollapsedJsonPaths((paths) => {
      const next = new Set(paths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <aside className="responsePanel">
      <div className="panelHeader">
        <span>Response</span>
        <div className="panelHeaderActions">
          {loading && <span className="muted">Sending...</span>}
          <button onClick={onClear} disabled={!hasResult && !loading}>
            Clear
          </button>
        </div>
      </div>

      {error && (
        <div className="errorBox">
          <button onClick={onLocateError}>Locate</button>
          <pre>{error}</pre>
        </div>
      )}

      {!error && !response && !loading && (
        <div className="emptyState">Send a request to see the response.</div>
      )}

      {response && !error && (
        <div className="responseContent">
          <div className="statusRow">
            <span className={response.status >= 400 ? "status bad" : "status good"}>
              {response.status} {response.status_text}
            </span>
            <span className="muted">{response.elapsed_ms} ms · {responseSize} · {responseType}</span>
          </div>

          <div className="responseActions">
            <button onClick={() => saveTextFile("response.txt", response.body)}>Save</button>
            <div className="segmentedControl" aria-label="Body display mode">
              <button className={bodyMode === "pretty" ? "active" : ""} onClick={() => setBodyMode("pretty")}>
                Pretty
              </button>
              <button className={bodyMode === "raw" ? "active" : ""} onClick={() => setBodyMode("raw")}>
                Raw
              </button>
            </div>
          </div>

          <div className="headersGrid">
            <details className="responseSection collapsedSection">
              <summary>
                <span>Request Headers</span>
                <span className="muted">{request?.headers.length ?? 0}</span>
              </summary>
              {request ? (
                <div className="headersViewer">
                  <div className="headerStartLine">
                    <span>Request</span>
                    <code>{request.method} {request.url}</code>
                  </div>
                  <div className="headersToolbar">
                    <span>{request.headers.length ? "Configured headers" : "No request headers"}</span>
                    <button onClick={() => writeClipboardText(formatHeaders(request.headers))} disabled={!request.headers.length}>
                      Copy
                    </button>
                  </div>
                  {request.headers.length ? (
                    <pre className="headersRaw">{formatHeaders(request.headers)}</pre>
                  ) : (
                    <div className="emptyHeaders">No request headers.</div>
                  )}
                </div>
              ) : (
                <div className="emptyHeaders">No request metadata recorded.</div>
              )}
            </details>

            <details className="responseSection collapsedSection">
              <summary>
                <span>Response Headers</span>
                <span className="muted">{response.headers.length}</span>
              </summary>
              <div className="headersViewer">
                <div className="headerStartLine">
                  <span>Response</span>
                  <code>HTTP {response.status} {response.status_text}</code>
                </div>
                <div className="headersToolbar">
                  <span>{response.headers.length ? "Received headers" : "No response headers"}</span>
                  <button onClick={() => writeClipboardText(formatHeaders(response.headers))} disabled={!response.headers.length}>
                    Copy
                  </button>
                </div>
                {response.headers.length ? (
                  <pre className="headersRaw">{formatHeaders(response.headers)}</pre>
                ) : (
                  <div className="emptyHeaders">No response headers.</div>
                )}
              </div>
            </details>
          </div>

          <section className="responseSection bodySection">
            <div className="sectionHeader">
              <h2>Body</h2>
              <div className="bodyTools">
                <button onClick={() => writeClipboardText(response.body)}>Copy</button>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                  aria-label="Search response body"
                />
              </div>
            </div>
            {bodyMode === "pretty" && responseType === "json" && !query && parsedJson?.ok ? (
              <JsonCode value={parsedJson.value} collapsedPaths={collapsedJsonPaths} onToggle={toggleJsonPath} />
            ) : (
              <pre>{limitedText(filteredBody || (query ? "No matches." : bodyText))}</pre>
            )}
          </section>
        </div>
      )}

      <details className="historyPanel">
        <summary>
          <span>History</span>
          <span className="muted">{history.length}</span>
        </summary>
        <div className="historyBody">
          <div className="historyActions">
            <input
              value={historyQuery}
              onChange={(event) => onHistoryQueryChange(event.target.value)}
              placeholder="Search history"
            />
            <select
              value={historyStatusFilter}
              onChange={(event) => onHistoryStatusFilterChange(event.target.value as "all" | "success" | "error")}
            >
              <option value="all">All</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>
            <button onClick={onClearHistory} disabled={!history.length}>
              Clear History
            </button>
          </div>
          <div className="historyList">
            {filteredHistory.map((item) => (
              <details className="historyItem" key={item.id} title={item.url}>
                <summary onClick={() => onSelectHistory(item)}>
                  <div>
                    <span className="historyMethod">{item.method}</span>
                    <span>{item.name || item.url}</span>
                  </div>
                  <div className="historyMeta">
                    <span className={item.error || (item.status ?? 0) >= 400 ? "badText" : "goodText"}>
                      {item.error ? "ERR" : item.status}
                    </span>
                    {item.elapsed_ms !== undefined && <span>{item.elapsed_ms} ms</span>}
                    {item.environment && <span>{item.environment}</span>}
                    <span>{new Date(item.timestamp).toLocaleTimeString()}</span>
                  </div>
                </summary>
                <div className="historyDetail">
                  <code>{item.url}</code>
                  {item.request?.headers.length ? <pre>{formatHeaders(item.request.headers)}</pre> : null}
                  {item.request?.body ? <pre>{item.request.body}</pre> : null}
                  <div className="historyDetailActions">
                    <button onClick={() => onResendHistory(item)} disabled={!item.request}>Resend</button>
                    <button onClick={() => onCreateRequestFromHistory(item)} disabled={!item.request}>Create Request</button>
                  </div>
                </div>
              </details>
            ))}
            {!filteredHistory.length && <div className="emptyHistory">No requests yet.</div>}
          </div>
        </div>
      </details>
    </aside>
  );
}

function formatBody(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function formatHeaders(headers: [string, string][]) {
  return headers.map(([key, value]) => `${key}: ${value}`).join("\n");
}

function filterText(text: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;

  return text
    .split("\n")
    .filter((line) => line.toLowerCase().includes(needle))
    .join("\n");
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

async function openExternalUrl(url: string) {
  try {
    await invoke("open_external_url", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function saveTextFile(fileName: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filterHistory(history: HistoryEntry[], query: string, status: "all" | "success" | "error") {
  const needle = query.trim().toLowerCase();
  return history.filter((item) => {
    const failed = Boolean(item.error || (item.status ?? 0) >= 400);
    if (status === "success" && failed) return false;
    if (status === "error" && !failed) return false;
    if (!needle) return true;
    return [item.name, item.method, item.url, item.environment, item.error ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

function detectResponseType(response: ResponseData) {
  const contentType = response.headers.find(([key]) => key.toLowerCase() === "content-type")?.[1]?.toLowerCase() ?? "";
  if (contentType.includes("application/json") || isJson(response.body)) return "json";
  if (contentType.startsWith("image/")) return "image";
  if (contentType.includes("text/html")) return "html";
  if (contentType.startsWith("text/")) return "text";
  return "text";
}

function isJson(value: string) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function limitedText(text: string) {
  const limit = 500_000;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[Body truncated at ${formatBytes(limit)} for display]`;
}

type JsonCodeLine = {
  content: ReactNode;
  key: string;
  level: number;
};

function JsonCode({
  value,
  collapsedPaths,
  onToggle
}: {
  value: unknown;
  collapsedPaths: Set<string>;
  onToggle: (path: string) => void;
}) {
  const lines = buildJsonCodeLines(value, {
    collapsedPaths,
    isLast: true,
    level: 0,
    onToggle,
    path: "$"
  });

  return (
    <pre className="jsonCode">
      {lines.map((line, index) => (
        <span className="jsonCodeLine" key={line.key}>
          <span className="jsonLineNumber">{index + 1}</span>
          <span className="jsonLineContent" style={{ paddingLeft: line.level * 18 }}>
            {line.content}
          </span>
        </span>
      ))}
    </pre>
  );
}

function buildJsonCodeLines(
  value: unknown,
  options: {
    collapsedPaths: Set<string>;
    isLast: boolean;
    label?: string;
    level: number;
    onToggle: (path: string) => void;
    path: string;
  }
): JsonCodeLine[] {
  if (value === null || typeof value !== "object") {
    return [
      {
        content: (
          <>
            {options.label && <JsonPropertyLabel label={options.label} />}
            <JsonPrimitiveToken value={value} />
            {!options.isLast && <span className="jsonCodePunctuation">,</span>}
          </>
        ),
        key: options.path,
        level: options.level
      }
    ];
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);
  const opening = isArray ? "[" : "{";
  const closing = isArray ? "]" : "}";
  const collapsed = options.collapsedPaths.has(options.path);

  if (!entries.length) {
    return [
      {
        content: (
          <>
            {options.label && <JsonPropertyLabel label={options.label} />}
            <span className="jsonCodePunctuation">{opening}{closing}</span>
            {!options.isLast && <span className="jsonCodePunctuation">,</span>}
          </>
        ),
        key: options.path,
        level: options.level
      }
    ];
  }

  const toggleButton = (
    <button className="jsonFoldButton" onClick={() => options.onToggle(options.path)} type="button">
      {collapsed ? ">" : "v"}
    </button>
  );

  if (collapsed) {
    return [
      {
        content: (
          <>
            {toggleButton}
            {options.label && <JsonPropertyLabel label={options.label} />}
            <span className="jsonCodePunctuation">{opening}</span>
            <span className="jsonCodeMeta"> ... {entries.length} {isArray ? "items" : "keys"} </span>
            <span className="jsonCodePunctuation">{closing}</span>
            {!options.isLast && <span className="jsonCodePunctuation">,</span>}
          </>
        ),
        key: options.path,
        level: options.level
      }
    ];
  }

  const lines: JsonCodeLine[] = [
    {
      content: (
        <>
          {toggleButton}
          {options.label && <JsonPropertyLabel label={options.label} />}
          <span className="jsonCodePunctuation">{opening}</span>
        </>
      ),
      key: `${options.path}:open`,
      level: options.level
    }
  ];

  entries.forEach(([key, item], index) => {
    lines.push(
      ...buildJsonCodeLines(item, {
        collapsedPaths: options.collapsedPaths,
        isLast: index === entries.length - 1,
        label: isArray ? undefined : key,
        level: options.level + 1,
        onToggle: options.onToggle,
        path: `${options.path}/${encodeURIComponent(key)}`
      })
    );
  });

  lines.push({
    content: (
      <>
        <span className="jsonFoldSpacer" />
        <span className="jsonCodePunctuation">{closing}</span>
        {!options.isLast && <span className="jsonCodePunctuation">,</span>}
      </>
    ),
    key: `${options.path}:close`,
    level: options.level
  });

  return lines;
}

function JsonPropertyLabel({ label }: { label: string }) {
  return (
    <>
      <span className="jsonCodeKey">{JSON.stringify(label)}</span>
      <span className="jsonCodePunctuation">: </span>
    </>
  );
}

function JsonPrimitiveToken({ value }: { value: unknown }) {
  if (value === null) return <span className="jsonCodeNull">null</span>;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) {
      return (
        <span className="jsonCodeString">
          &quot;
          <a
            className="jsonCodeLink"
            href={value}
            onClick={(event) => {
              event.preventDefault();
              void openExternalUrl(value);
            }}
            rel="noreferrer"
            target="_blank"
          >
            {value}
          </a>
          &quot;
        </span>
      );
    }

    return <span className="jsonCodeString">{JSON.stringify(value)}</span>;
  }
  if (typeof value === "number") return <span className="jsonCodeNumber">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="jsonCodeBoolean">{String(value)}</span>;
  return <span>{JSON.stringify(value)}</span>;
}
