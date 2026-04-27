import { useEffect, useRef } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

type HttpEditorProps = {
  value: string;
  selectedIndex: number;
  onChange: (value: string) => void;
  onSelect: (index: number) => void;
  onSend: (index: number) => void;
};

const SEND_REQUEST_ACTION = "miniRestClient.sendSelectedRequest";
let codeLensCommandId = "";

export default function HttpEditor({
  value,
  selectedIndex,
  onChange,
  onSelect,
  onSend
}: HttpEditorProps) {
  const selectedIndexRef = useRef(selectedIndex);
  const onSelectRef = useRef(onSelect);
  const onSendRef = useRef(onSend);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
    onSelectRef.current = onSelect;
    onSendRef.current = onSend;
  }, [selectedIndex, onSelect, onSend]);

  const handleMount: OnMount = (editor, monaco) => {
    registerHttpLanguage(monaco);
    registerRequestHeaderFolding(monaco);

    const sendRequest = (requestIndex?: unknown) => {
      const index = typeof requestIndex === "number" ? requestIndex : selectedIndexRef.current;
      onSelectRef.current(index);
      onSendRef.current(index);
    };

    const commandId = editor.addCommand(0, (_accessor, requestIndex?: unknown) => {
      sendRequest(requestIndex);
    });
    codeLensCommandId = commandId ?? SEND_REQUEST_ACTION;

    editor.addAction({
      id: SEND_REQUEST_ACTION,
      label: "Send Request",
      run: () => {
        sendRequest();
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

        if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i.test(line)) {
          if (pendingHeaderLine !== null) {
            lenses.push({
              range: {
                startLineNumber: pendingHeaderLine,
                startColumn: 1,
                endLineNumber: pendingHeaderLine,
                endColumn: 1
              },
              command: {
                id: codeLensCommandId,
                title: "Send Request",
                arguments: [requestIndex]
              }
            });
          }

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

    if (!/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i.test(line)) {
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
