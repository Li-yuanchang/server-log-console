import { useEffect, useRef } from "react";
import { clampBrowserTreeWidth, clampActivityPanelHeight } from "./storage.js";

export type PanelResizeAPI = {
  treeResizeRef: React.MutableRefObject<{ startX: number; startWidth: number; maxWidth: number } | null>;
  activityPanelResizeRef: React.MutableRefObject<{ startY: number; startHeight: number } | null>;
};

export function usePanelResize(setBrowserTreeWidth: (v: number) => void, setActivityPanelHeight: (v: number) => void): PanelResizeAPI {
  const treeResizeRef = useRef<{ startX: number; startWidth: number; maxWidth: number } | null>(null);
  const activityPanelResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const resizeState = treeResizeRef.current;
      if (!resizeState) {
        return;
      }

      const delta = event.clientX - resizeState.startX;
      /* maxWidth 在拖拽起点由 App 按容器实测宽算出（保证右侧文件列有保底宽度），
         窄宿主（Chrome 侧栏 ~200px）下不会把树列拖到压没文件列。 */
      setBrowserTreeWidth(clampBrowserTreeWidth(resizeState.startWidth + delta, resizeState.maxWidth));
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
