import { useEffect, useRef } from "react";
import { clampBrowserTreeWidth, clampActivityPanelHeight } from "./storage.js";

export type PanelResizeAPI = {
  treeResizeRef: React.MutableRefObject<{ startX: number; startWidth: number } | null>;
  activityPanelResizeRef: React.MutableRefObject<{ startY: number; startHeight: number } | null>;
};

export function usePanelResize(setBrowserTreeWidth: (v: number) => void, setActivityPanelHeight: (v: number) => void): PanelResizeAPI {
  const treeResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const activityPanelResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const resizeState = treeResizeRef.current;
      if (!resizeState) {
        return;
      }

      const delta = event.clientX - resizeState.startX;
      setBrowserTreeWidth(clampBrowserTreeWidth(resizeState.startWidth + delta));
    }

    function stopResize() {
      treeResizeRef.current = null;
      document.body.classList.remove("is-resizing-tree");
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [setBrowserTreeWidth]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const resizeState = activityPanelResizeRef.current;
      if (!resizeState) {
        return;
      }

      const delta = resizeState.startY - event.clientY;
      setActivityPanelHeight(clampActivityPanelHeight(resizeState.startHeight + delta));
    }

    function stopResize() {
      activityPanelResizeRef.current = null;
      document.body.classList.remove("is-resizing-activity-panel");
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, [setActivityPanelHeight]);

  return { treeResizeRef, activityPanelResizeRef };
}
