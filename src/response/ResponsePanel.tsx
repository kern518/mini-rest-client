type ResponseData = {
  status: number;
  status_text: string;
  elapsed_ms: number;
  headers: [string, string][];
  body: string;
};

type ResponsePanelProps = {
  response: ResponseData | null;
  error: string | null;
  loading: boolean;
};

export default function ResponsePanel({ response, error, loading }: ResponsePanelProps) {
  return (
    <aside className="responsePanel">
      <div className="panelHeader">
        <span>Response</span>
        {loading && <span className="muted">Sending...</span>}
      </div>

      {error && <pre className="errorBox">{error}</pre>}

      {!error && !response && !loading && (
        <div className="emptyState">Send a request to see the response.</div>
      )}

      {response && !error && (
        <div className="responseContent">
          <div className="statusRow">
            <span className={response.status >= 400 ? "status bad" : "status good"}>
              {response.status} {response.status_text}
            </span>
            <span className="muted">{response.elapsed_ms} ms</span>
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
            <h2>Body</h2>
            <pre>{formatBody(response.body)}</pre>
          </section>
        </div>
      )}
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
