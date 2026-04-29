import { useEffect, useState } from "react";

const sidebarWidthStorageKey = "mini-rest-client.sidebar-width";
const responseWidthStorageKey = "mini-rest-client.response-width";

export function useResizableLayout() {
  const [sidebarWidth, setSidebarWidth] = useState(() => loadStoredNumber(sidebarWidthStorageKey, 240));
  const [responseWidth, setResponseWidth] = useState(() => loadStoredNumber(responseWidthStorageKey, 520));
  const [draggingPane, setDraggingPane] = useState<"sidebar" | "response" | null>(null);

  useEffect(() => {
    window.localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(responseWidthStorageKey, String(responseWidth));
  }, [responseWidth]);

  useEffect(() => {
    if (!draggingPane) return;

    document.body.classList.add("isResizing");

    function handleMouseMove(event: MouseEvent) {
      const availableWidth = window.innerWidth;
      const minEditorWidth = 420;

      if (draggingPane === "sidebar") {
        const maxSidebarWidth = Math.max(180, availableWidth - responseWidth - minEditorWidth - 12);
        setSidebarWidth(clamp(event.clientX, 180, Math.min(460, maxSidebarWidth)));
        return;
      }

      const maxResponseWidth = Math.max(320, availableWidth - sidebarWidth - minEditorWidth - 12);
      setResponseWidth(clamp(availableWidth - event.clientX, 320, Math.min(840, maxResponseWidth)));
    }

    function handleMouseUp() {
      setDraggingPane(null);
      document.body.classList.remove("isResizing");
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.classList.remove("isResizing");
    };
  }, [draggingPane, responseWidth, sidebarWidth]);

  return {
    sidebarWidth,
    responseWidth,
    startDraggingSidebar: () => setDraggingPane("sidebar"),
    startDraggingResponse: () => setDraggingPane("response")
  };
}

function loadStoredNumber(key: string, fallback: number) {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
