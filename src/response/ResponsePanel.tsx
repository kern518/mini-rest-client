import { useMemo, useState } from "react";

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

type ResponsePanelProps = {
  response: ResponseData | null;
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
  const [bodyMode, setBodyMode] = useState<"pretty" | "raw" | "tree">("pretty");
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
            <button onClick={() => writeClipboardText(response.body)}>Copy Body</button>
            <button onClick={() => writeClipboardText(formatHeaders(response.headers))}>Copy Headers</button>
            <button onClick={() => saveTextFile("response.txt", bodyText)}>Save</button>
            <div className="segmentedControl" aria-label="Body display mode">
              <button className={bodyMode === "pretty" ? "active" : ""} onClick={() => setBodyMode("pretty")}>
                Pretty
              </button>
              <button className={bodyMode === "raw" ? "active" : ""} onClick={() => setBodyMode("raw")}>
                Raw
              </button>
              <button className={bodyMode === "tree" ? "active" : ""} onClick={() => setBodyMode("tree")} disabled={responseType !== "json"}>
                Tree
              </button>
            </div>
          </div>

          <details className="responseSection collapsedSection">
            <summary>
              <span>Headers</span>
              <span className="muted">{response.headers.length}</span>
            </summary>
            <div className="headersList">
              {response.headers.map(([key, value]) => (
                <div className="headerLine" key={key}>
                  <span>{key}</span>
                  <code>{value}</code>
                </div>
              ))}
            </div>
          </details>

          <section className="responseSection bodySection">
            <div className="sectionHeader">
              <h2>Body</h2>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                aria-label="Search response body"
              />
            </div>
            {bodyMode === "tree" && responseType === "json" ? (
              <JsonTree value={JSON.parse(response.body)} />
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

function JsonTree({ value, label }: { value: unknown; label?: string }) {
  if (value === null || typeof value !== "object") {
    return (
      <div className="jsonNode">
        {label && <span className="jsonKey">{label}: </span>}
        <code>{JSON.stringify(value)}</code>
      </div>
    );
  }

  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);

  return (
    <details className="jsonNode" open={!label}>
      <summary>
        {label && <span className="jsonKey">{label}: </span>}
        <span>{Array.isArray(value) ? `Array(${entries.length})` : `Object(${entries.length})`}</span>
      </summary>
      <div className="jsonChildren">
        {entries.map(([key, item]) => (
          <JsonTree value={item} label={key} key={key} />
        ))}
      </div>
    </details>
  );
}
