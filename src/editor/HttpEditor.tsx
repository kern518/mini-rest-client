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
        theme="vs-dark"
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

  monaco.languages.setMonarchTokensProvider("http", {
    tokenizer: {
      root: [
        [/^###.*$/, "keyword"],
        [/^@(\w+)\s*=.*/, "variable"],
        [/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/, "type.identifier"],
        [/^curl(\.exe)?\b/i, "type.identifier"],
        [/^[A-Za-z0-9-]+(?=:)/, "attribute.name"],
        [/\{\{[^}]+\}\}/, "variable.predefined"],
        [/\/\/.*$/, "comment"],
        [/#.*$/, "comment"]
      ]
    }
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
  const markers: Monaco.editor.IMarkerData[] = [];
  const known = new Set(knownVariables);
  let currentContentType = "";
  let bodyStartLine = 0;

  for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
    const text = model.getLineContent(lineNumber);
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

    if (isRequestStart(trimmed) && !trimmed.toLowerCase().startsWith("curl")) {
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
      currentContentType = "";
      bodyStartLine = 0;
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

  if (bodyStartLine > 0) {
    const body = model.getValueInRange({
      startLineNumber: bodyStartLine,
      startColumn: 1,
      endLineNumber: model.getLineCount(),
      endColumn: model.getLineMaxColumn(model.getLineCount())
    }).trim();
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
          endColumn: model.getLineMaxColumn(bodyStartLine)
        });
      }
    }
  }

  monaco.editor.setModelMarkers(model, "mini-rest-client", markers);
}

function isRequestStart(line: string) {
  return /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i.test(line) || /^curl(\.exe)?\b/i.test(line);
}
