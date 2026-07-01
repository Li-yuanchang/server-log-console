import { useEffect, type RefObject } from "react";

export type KeyboardShortcutsParams = {
  activeLogView: "search" | "files";
  activeViewerTabId: string;
  filePath: string;
  keywordInput: string;
  keywordInputRef: RefObject<HTMLInputElement | null>;
  setShowKeywordBar: (show: boolean) => void;
  setShowQueryAdvanced: (show: boolean) => void;
  setKeywordInput: (input: string) => void;
  setActiveLogView: (view: "search" | "files") => void;
  setActiveViewerTabId: (tab: string) => void;
  enterPathbarEditMode: (options?: { selectAll?: boolean }) => void;
  loadHeadSlice: () => Promise<void>;
  loadTailSlice: (options?: { forceRefresh?: boolean }) => Promise<void>;
  navigateSlice: (direction: "prev" | "next", source: "button" | "wheel" | "keyboard") => Promise<void>;
  focusHighlight: (direction: "prev" | "next") => void;
  normalizeSearchInput: (input: string) => string;
};

export function useKeyboardShortcuts(params: KeyboardShortcutsParams) {
  const {
    activeLogView,
    activeViewerTabId,
    filePath,
    keywordInput,
    keywordInputRef,
    setShowKeywordBar,
    setShowQueryAdvanced,
    setKeywordInput,
    setActiveLogView,
    setActiveViewerTabId,
    enterPathbarEditMode,
    loadHeadSlice,
    loadTailSlice,
    navigateSlice,
    focusHighlight,
    normalizeSearchInput,
  } = params;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const lowered = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && lowered === "f") {
        event.preventDefault();
        setShowKeywordBar(true);
        window.setTimeout(() => keywordInputRef.current?.focus(), 0);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && lowered === "l") {
        event.preventDefault();
        enterPathbarEditMode({ selectAll: true });
        return;
      }

      if (event.key === "Escape") {
        setShowQueryAdvanced(false);
        setShowKeywordBar(true);
        return;
      }

      if (!isTypingTarget && event.key === "/" && activeLogView === "search") {
        event.preventDefault();
        setShowKeywordBar(true);
        window.setTimeout(() => {
          if (keywordInput.trim()) {
            keywordInputRef.current?.focus();
            keywordInputRef.current?.select();
            return;
          }

          setKeywordInput("/");
          keywordInputRef.current?.focus();
          window.setTimeout(() => {
            keywordInputRef.current?.setSelectionRange(1, 1);
          }, 0);
        }, 0);
        return;
      }

      if (isTypingTarget || !filePath.trim()) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Home") {
        event.preventDefault();
        void loadHeadSlice();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "End") {
        event.preventDefault();
        void loadTailSlice({ forceRefresh: true });
        return;
      }

      if (event.key === "PageUp") {
        event.preventDefault();
        if (activeViewerTabId !== "file") {
          setActiveLogView("search");
          setActiveViewerTabId("file");
        }
        void navigateSlice("prev", "keyboard");
        return;
      }

      if (event.key === "PageDown") {
        event.preventDefault();
        if (activeViewerTabId !== "file") {
          setActiveLogView("search");
          setActiveViewerTabId("file");
        }
        void navigateSlice("next", "keyboard");
        return;
      }

      if (activeLogView === "search" && lowered === "n" && normalizeSearchInput(keywordInput)) {
        event.preventDefault();
        focusHighlight(event.shiftKey ? "prev" : "next");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeLogView, activeViewerTabId, filePath, keywordInput, setShowKeywordBar, setShowQueryAdvanced, setKeywordInput, setActiveLogView, setActiveViewerTabId, enterPathbarEditMode, loadHeadSlice, loadTailSlice, navigateSlice, focusHighlight, normalizeSearchInput, keywordInputRef]);
}
