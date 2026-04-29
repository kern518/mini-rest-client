import { useEffect, useRef } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

type HttpEditorProps = {
  value: string;
  selectedIndex: number;
  knownVariables: string[];
  locateVariable: string | null;
  onChange: (value: string) => void;
  onSelect: (index: number) => void;
  onSend: (index: number) => void;
  onCopyCurl: (index: number) => void;
};

const SEND_REQUEST_ACTION = "miniRestClient.sendSelectedRequest";
const COPY_CURL_ACTION = "miniRestClient.copySelectedRequestAsCurl";
let codeLensCommandId = "";
let copyCurlCommandId = "";

export default function HttpEditor({
  value,
  selectedIndex,
  knownVariables,
  locateVariable,
  onChange,
  onSelect,
  onSend,
  onCopyCurl
}: HttpEditorProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const selectedIndexRef = useRef(selectedIndex);
  const onSelectRef = useRef(onSelect);
  const onSendRef = useRef(onSend);
  const onCopyCurlRef = useRef(onCopyCurl);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
    onSelectRef.current = onSelect;
    onSendRef.current = onSend;
    onCopyCurlRef.current = onCopyCurl;
  }, [selectedIndex, onSelect, onSend, onCopyCurl]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !locateVariable) return;
    const model = editor.getModel();
    if (!model) return;
    const variableName = locateVariable.split(":")[0];
    const match = model.findMatches(`{{${variableName}}}`, false, false, false, null, true)[0];
    if (!match) return;
    editor.revealRangeInCenter(match.range);
    editor.setSelection(match.range);
    editor.focus();
  }, [locateVariable]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!monaco || !model) return;
    updateDiagnostics(monaco, model, knownVariables);
  }, [value, knownVariables]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    registerHttpLanguage(monaco);
    monaco.editor.setTheme("mini-rest-readable");
    registerRequestHeaderFolding(monaco);
    updateDiagnostics(monaco, editor.getModel(), knownVariables);

    const sendRequest = (requestIndex?: unknown) => {
      const index = typeof requestIndex === "number" ? requestIndex : selectedIndexRef.current;
      onSelectRef.current(index);
      onSendRef.current(index);
    };

    const commandId = editor.addCommand(0, (_accessor, requestIndex?: unknown) => {
      sendRequest(requestIndex);
    });
    codeLensCommandId = commandId ?? SEND_REQUEST_ACTION;

    const copyCommandId = editor.addCommand(0, (_accessor, requestIndex?: unknown) => {
      const index = typeof requestIndex === "number" ? requestIndex : selectedIndexRef.current;
      onSelectRef.current(index);
      onCopyCurlRef.current(index);
    });
    copyCurlCommandId = copyCommandId ?? COPY_CURL_ACTION;

    editor.addAction({
      id: SEND_REQUEST_ACTION,
      label: "Send Request",
      run: () => {
        sendRequest();
      }
    });

    editor.addAction({
      id: COPY_CURL_ACTION,
      label: "Copy cURL",
      run: () => {
        onCopyCurlRef.current(selectedIndexRef.current);
      }
    });

    registerSendRequestCodeLens(monaco);

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onSendRef.current(selectedIndexRef.current);
    });

    window.setTimeout(() => {
      foldRequestHeaders(editor);
    }, 0);
  };

  return (
    <div className="editorShell">
      <Editor
        height="100%"
        defaultLanguage="http"
        theme="mini-rest-readable"
        value={value}
        onChange={(nextValue) => onChange(nextValue ?? "")}
        onMount={handleMount}
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          wordWrap: "on",
          lineNumbersMinChars: 3,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          codeLens: true,
          padding: { top: 14, bottom: 14 },
          renderLineHighlight: "all"
        }}
      />
    </div>
  );
}

function registerHttpLanguage(monaco: typeof Monaco) {
  if (!monaco.languages.getLanguages().some((language) => language.id === "http")) {
    monaco.languages.register({ id: "http" });
  }

  registerReadableHttpTheme(monaco);

  monaco.languages.setMonarchTokensProvider("http", {
    defaultToken: "body",
    tokenizer: {
      root: [
        [/^\s*###.*$/, "request.separator"],
        [/^\s*#.*$/, "comment"],
        [/^(\s*@)([A-Za-z_][\w.-]*)(\s*=\s*)(.*)$/, ["variable.prefix", "variable.name", "delimiter", "variable.value"]],
        [/^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/, { token: "request.method", next: "@requestUrl" }],
        [/^\s*curl(?:\.exe)?\b/, { token: "curl.command", next: "@curl" }],
        [/\{\{[^}]+\}\}/, "variable.reference"],
        [/\/\/.*$/, "comment"],
        [/.*$/, "body"]
      ],
      requestUrl: [
        [/\s+/, "white"],
        [/\{\{[^}]+\}\}/, "variable.reference"],
        [/.*$/, { token: "request.url", next: "@headers" }]
      ],
      headers: [
        [/^\s*###.*$/, { token: "request.separator", next: "@root" }],
        [/^\s*#.*$/, "comment"],
        [/^\s*$/, { token: "body.separator", next: "@body" }],
        [/\s+/, "white"],
        [/"(?:\\.|[^"\\])*"(?=\s*:)/, "json.key"],
        [/"(?:\\.|[^"\\])*"/, "json.string"],
        [/\b(?:true|false)\b/, "json.boolean"],
        [/\bnull\b/, "json.null"],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "json.number"],
        [/[{}[\],]/, "json.punctuation"],
        [/^\s*[A-Za-z0-9-]+(?=\s*:)/, { token: "header.name", next: "@headerSeparator" }],
        [/\{\{[^}]+\}\}/, "variable.reference"],
        [/\/\/.*$/, "comment"],
        [/.*$/, "body"]
      ],
      headerSeparator: [
        [/\s+/, "white"],
        [/\s*:\s*/, { token: "delimiter", next: "@headerValue" }]
      ],
      headerValue: [
        [/\s+/, "white"],
        [/\{\{[^}]+\}\}/, "variable.reference"],
        [/.*$/, { token: "header.value", next: "@headers" }]
      ],
      body: [
        [/^\s*###.*$/, { token: "request.separator", next: "@root" }],
        [/\s+/, "white"],
        [/\{\{[^}]+\}\}/, "variable.reference"],
        [/"(?:\\.|[^"\\])*"(?=\s*:)/, "json.key"],
        [/"(?:\\.|[^"\\])*"/, "json.string"],
        [/\b(?:true|false)\b/, "json.boolean"],
        [/\bnull\b/, "json.null"],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "json.number"],
        [/[{}[\],:]/, "json.punctuation"],
        [/\/\/.*$/, "comment"],
        [/.*$/, "body"]
      ],
      curl: [
        [/^\s*###.*$/, { token: "request.separator", next: "@root" }],
        [/\s+/, "white"],
        [/\{\{[^}]+\}\}/, "variable.reference"],
        [/(-H|--header)(\s+)(["'])([^"':]+)(:\s*)([^"']*)(["'])/, ["curl.flag", "white", "curl.quote", "curl.header.name", "delimiter", "curl.header.value", "curl.quote"]],
        [/(-X|--request)(\s+)([A-Za-z]+)/, ["curl.flag", "white", "request.method"]],
        [/(-d|--data|--data-raw|--data-binary|--data-urlencode)(\s+)(["'])(.*)(["'])/, ["curl.flag", "white", "curl.quote", "curl.data", "curl.quote"]],
        [/--?[A-Za-z0-9-]+(?:=[^\s]+)?/, "curl.flag"],
        [/https?:\/\/[^\s'"\\]+/, "request.url"],
        [/"(?:\\.|[^"\\])*"(?=\s*:)/, "json.key"],
        [/"(?:\\.|[^"\\])*"/, "json.string"],
        [/\b(?:true|false)\b/, "json.boolean"],
        [/\bnull\b/, "json.null"],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "json.number"],
        [/[{}[\],:]/, "json.punctuation"],
        [/"(?:\\.|[^"\\])*"/, "curl.string"],
        [/'[^']*'/, "curl.string"],
        [/'/, "curl.quote"],
        [/\\$|`$|\^$/, "curl.continuation"],
        [/^\s*$/, { token: "", next: "@root" }],
        [/.*$/, "curl.text"]
      ]
    }
  });
}

function registerReadableHttpTheme(monaco: typeof Monaco) {
  const registryKey = "__miniRestClientReadableThemeRegistered";
  const globalMonaco = monaco as typeof Monaco & Record<string, boolean>;

  if (globalMonaco[registryKey]) {
    return;
  }

  globalMonaco[registryKey] = true;

  monaco.editor.defineTheme("mini-rest-readable", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "request.separator", foreground: "8b949e", fontStyle: "italic" },
      { token: "request.method", foreground: "58a6ff", fontStyle: "bold" },
      { token: "request.url", foreground: "d2a8ff" },
      { token: "header.name", foreground: "79c0ff" },
      { token: "header.value", foreground: "7ee787" },
      { token: "body.separator", foreground: "8b949e" },
      { token: "body", foreground: "d4d4d4" },
      { token: "variable.prefix", foreground: "ff7b72" },
      { token: "variable.name", foreground: "ffa657" },
      { token: "variable.value", foreground: "a5d6ff" },
      { token: "variable.reference", foreground: "ffa657", fontStyle: "bold" },
      { token: "curl.command", foreground: "58a6ff", fontStyle: "bold" },
      { token: "curl.flag", foreground: "79c0ff" },
      { token: "curl.quote", foreground: "8b949e" },
      { token: "curl.header.name", foreground: "79c0ff" },
      { token: "curl.header.value", foreground: "7ee787" },
      { token: "curl.data", foreground: "a5d6ff" },
      { token: "curl.string", foreground: "a5d6ff" },
      { token: "curl.continuation", foreground: "8b949e" },
      { token: "curl.text", foreground: "d4d4d4" },
      { token: "json.key", foreground: "ffab70" },
      { token: "json.string", foreground: "a5d6ff" },
      { token: "json.number", foreground: "79c0ff" },
      { token: "json.boolean", foreground: "ff7b72" },
      { token: "json.null", foreground: "8b949e", fontStyle: "italic" },
      { token: "json.punctuation", foreground: "d4d4d4" },
      { token: "delimiter", foreground: "8b949e" },
      { token: "comment", foreground: "8b949e", fontStyle: "italic" }
    ],
    colors: {}
  });
}

function registerRequestHeaderFolding(monaco: typeof Monaco) {
  const registryKey = "__miniRestClientHeaderFoldingRegistered";
  const globalMonaco = monaco as typeof Monaco & Record<string, boolean>;

  if (globalMonaco[registryKey]) {
    return;
  }

  globalMonaco[registryKey] = true;

  monaco.languages.registerFoldingRangeProvider("http", {
    provideFoldingRanges(model) {
      return findRequestHeaderRanges(model).map((range) => ({
        start: range.startLineNumber,
        end: range.endLineNumber,
        kind: monaco.languages.FoldingRangeKind.Region
      }));
    }
  });
}

function registerSendRequestCodeLens(monaco: typeof Monaco) {
  const registryKey = "__miniRestClientCodeLensRegistered";
  const globalMonaco = monaco as typeof Monaco & Record<string, boolean>;

  if (globalMonaco[registryKey]) {
    return;
  }

  globalMonaco[registryKey] = true;

  monaco.languages.registerCodeLensProvider("http", {
    provideCodeLenses(model) {
      const lenses: Monaco.languages.CodeLens[] = [];
      let requestIndex = 0;
      let pendingHeaderLine: number | null = null;

      for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
        const line = model.getLineContent(lineNumber).trim();

        if (line.startsWith("###")) {
          pendingHeaderLine = lineNumber;
          continue;
        }

        if (isRequestStart(line)) {
          const lensLine = pendingHeaderLine ?? lineNumber;
          lenses.push(
            {
              range: {
                startLineNumber: lensLine,
                startColumn: 1,
                endLineNumber: lensLine,
                endColumn: 1
              },
              command: {
                id: codeLensCommandId,
                title: "Send Request",
                arguments: [requestIndex]
              }
            },
            {
              range: {
                startLineNumber: lensLine,
                startColumn: 1,
                endLineNumber: lensLine,
                endColumn: 1
              },
              command: {
                id: copyCurlCommandId,
                title: "Copy cURL",
                arguments: [requestIndex]
              }
            }
          );

          requestIndex += 1;
          pendingHeaderLine = null;
        }
      }

      return {
        lenses,
        dispose: () => undefined
      };
    },
    resolveCodeLens(_model, codeLens) {
      return codeLens;
    }
  });
}

function foldRequestHeaders(editor: Monaco.editor.IStandaloneCodeEditor) {
  const model = editor.getModel();
  if (!model) {
    return;
  }

  const headerStartLines = findRequestHeaderRanges(model).map((range) => range.startLineNumber);
  if (!headerStartLines.length) {
    return;
  }

  editor.trigger("mini-rest-client", "editor.fold", {
    selectionLines: headerStartLines
  });
}

function findRequestHeaderRanges(model: Monaco.editor.ITextModel) {
  const ranges: Array<{ startLineNumber: number; endLineNumber: number }> = [];

  for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
    const line = model.getLineContent(lineNumber).trim();

    if (!isRequestStart(line)) {
      continue;
    }

    let lastHeaderLine = lineNumber;
    for (let nextLine = lineNumber + 1; nextLine <= model.getLineCount(); nextLine += 1) {
      const next = model.getLineContent(nextLine).trim();

      if (!next || next.startsWith("###")) {
        break;
      }

      if (/^[A-Za-z0-9-]+:\s*/.test(next)) {
        lastHeaderLine = nextLine;
        continue;
      }

      break;
    }

    if (lastHeaderLine > lineNumber) {
      ranges.push({
        startLineNumber: lineNumber,
        endLineNumber: lastHeaderLine
      });
    }
  }

  return ranges;
}

function updateDiagnostics(monaco: typeof Monaco, model: Monaco.editor.ITextModel | null, knownVariables: string[]) {
  if (!model) return;
  const textModel = model;
  const markers: Monaco.editor.IMarkerData[] = [];
  const known = new Set(knownVariables);
  let currentContentType = "";
  let bodyStartLine = 0;

  function validateJsonBody(endLineNumber: number) {
    if (bodyStartLine <= 0) {
      return;
    }

    if (endLineNumber < bodyStartLine) {
      bodyStartLine = 0;
      return;
    }

    const bodyEndLine = endLineNumber;
    const body = textModel
      .getValueInRange({
        startLineNumber: bodyStartLine,
        startColumn: 1,
        endLineNumber: bodyEndLine,
        endColumn: textModel.getLineMaxColumn(bodyEndLine)
      })
      .trim();

    if (body) {
      try {
        JSON.parse(body);
      } catch (err) {
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: `Invalid JSON body: ${String(err)}`,
          startLineNumber: bodyStartLine,
          startColumn: 1,
          endLineNumber: bodyStartLine,
          endColumn: textModel.getLineMaxColumn(bodyStartLine)
        });
      }
    }

    bodyStartLine = 0;
  }

  for (let lineNumber = 1; lineNumber <= textModel.getLineCount(); lineNumber += 1) {
    const text = textModel.getLineContent(lineNumber);
    const trimmed = text.trim();

    for (const match of text.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)) {
      const name = match[1];
      if (!known.has(name)) {
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: `Undefined variable: ${name}`,
          startLineNumber: lineNumber,
          startColumn: (match.index ?? 0) + 1,
          endLineNumber: lineNumber,
          endColumn: (match.index ?? 0) + match[0].length + 1
        });
      }
    }

    if (trimmed.startsWith("###")) {
      validateJsonBody(lineNumber - 1);
      currentContentType = "";
      bodyStartLine = 0;
      continue;
    }

    if (isRequestStart(trimmed)) {
      validateJsonBody(lineNumber - 1);
      currentContentType = "";
      bodyStartLine = 0;

      if (!trimmed.toLowerCase().startsWith("curl")) {
        const url = trimmed.split(/\s+/)[1] ?? "";
        if (url && !url.startsWith("{{") && !/^https?:\/\//i.test(url)) {
          markers.push({
            severity: monaco.MarkerSeverity.Warning,
            message: "URL should start with http:// or https://",
            startLineNumber: lineNumber,
            startColumn: Math.max(text.indexOf(url) + 1, 1),
            endLineNumber: lineNumber,
            endColumn: text.length + 1
          });
        }
      }
      continue;
    }

    if (bodyStartLine > 0) {
      continue;
    }

    if (/^[A-Za-z0-9-]+:/.test(trimmed)) {
      const [key, value = ""] = trimmed.split(/:(.*)/);
      if (!key || !value.trim()) {
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          message: "Header value is empty",
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: text.length + 1
        });
      }
      if (key.toLowerCase() === "content-type") currentContentType = value.trim().toLowerCase();
      continue;
    }

    if (!trimmed && currentContentType.includes("application/json") && bodyStartLine === 0) {
      bodyStartLine = lineNumber + 1;
      continue;
    }
  }

  validateJsonBody(textModel.getLineCount());

  monaco.editor.setModelMarkers(textModel, "mini-rest-client", markers);
}

function isRequestStart(line: string) {
  return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i.test(line) || /^curl(\.exe)?\b/i.test(line);
}
