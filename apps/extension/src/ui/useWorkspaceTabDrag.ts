import { useState, useRef, useCallback } from "react";
import type { WorkspaceSession } from "./types.js";

export type WorkspaceTabDragState = {
  draggedSessionId: string | null;
  targetSessionId: string | null;
  position: "before" | "after" | null;
};

export type WorkspaceTabDragAPI = {
  workspaceTabDragState: WorkspaceTabDragState;
  workspaceTabDragJustMovedRef: React.MutableRefObject<boolean>;
  clearWorkspaceTabDragState: () => void;
  reorderWorkspaceSessions: (draggedSessionId: string, targetSessionId: string, position: "before" | "after") => void;
  getWorkspaceTabDropPosition: (event: React.DragEvent<HTMLDivElement>) => "before" | "after";
  handleWorkspaceTabDragStart: (event: React.DragEvent<HTMLDivElement>, sessionId: string) => void;
  handleWorkspaceTabDragOver: (event: React.DragEvent<HTMLDivElement>, sessionId: string) => void;
  handleWorkspaceTabDrop: (event: React.DragEvent<HTMLDivElement>, sessionId: string) => void;
  handleWorkspaceTabDragEnd: () => void;
};

export function useWorkspaceTabDrag(
  isWorkspaceSwitchLocked: boolean,
  setWorkspaceSessions: React.Dispatch<React.SetStateAction<WorkspaceSession[]>>
): WorkspaceTabDragAPI {
  const [workspaceTabDragState, setWorkspaceTabDragState] = useState<WorkspaceTabDragState>({
    draggedSessionId: null,
    targetSessionId: null,
    position: null
  });
  const workspaceTabDragJustMovedRef = useRef(false);

  const clearWorkspaceTabDragState = useCallback(() => {
    setWorkspaceTabDragState({
      draggedSessionId: null,
      targetSessionId: null,
      position: null
    });
  }, []);

  const reorderWorkspaceSessions = useCallback(
    (draggedSessionId: string, targetSessionId: string, position: "before" | "after") => {
      if (draggedSessionId === targetSessionId) { return; }
      setWorkspaceSessions((current) => {
        const draggedIndex = current.findIndex((s) => s.id === draggedSessionId);
        const targetIndex = current.findIndex((s) => s.id === targetSessionId);
        if (draggedIndex === -1 || targetIndex === -1) { return current; }
        const next = [...current];
        const [draggedSession] = next.splice(draggedIndex, 1);
        const normalizedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
        const insertIndex = position === "after" ? normalizedTargetIndex + 1 : normalizedTargetIndex;
        next.splice(insertIndex, 0, draggedSession);
        return next;
      });
    },
    [setWorkspaceSessions]
  );

  const getWorkspaceTabDropPosition = useCallback(
    (event: React.DragEvent<HTMLDivElement>): "before" | "after" => {
      const bounds = event.currentTarget.getBoundingClientRect();
      return event.clientX - bounds.left < bounds.width / 2 ? "before" : "after";
    },
    []
  );

  const handleWorkspaceTabDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>, sessionId: string) => {
      if (isWorkspaceSwitchLocked) { event.preventDefault(); return; }
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(".workspace-session-tab-close")) { event.preventDefault(); return; }
      workspaceTabDragJustMovedRef.current = false;
      setWorkspaceTabDragState({ draggedSessionId: sessionId, targetSessionId: null, position: null });
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", sessionId);
    },
    [isWorkspaceSwitchLocked]
  );

  const handleWorkspaceTabDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>, sessionId: string) => {
      const draggedSessionId = workspaceTabDragState.draggedSessionId;
      if (!draggedSessionId || isWorkspaceSwitchLocked) { return; }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (draggedSessionId === sessionId) {
        if (workspaceTabDragState.targetSessionId || workspaceTabDragState.position) {
          setWorkspaceTabDragState((c) => ({ ...c, targetSessionId: null, position: null }));
        }
        return;
      }
      const position = getWorkspaceTabDropPosition(event);
      if (workspaceTabDragState.targetSessionId === sessionId && workspaceTabDragState.position === position) { return; }
      setWorkspaceTabDragState((c) => ({ ...c, targetSessionId: sessionId, position }));
    },
    [isWorkspaceSwitchLocked, workspaceTabDragState, getWorkspaceTabDropPosition]
  );

  const handleWorkspaceTabDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>, sessionId: string) => {
      const draggedSessionId = workspaceTabDragState.draggedSessionId || event.dataTransfer.getData("text/plain");
      if (!draggedSessionId || isWorkspaceSwitchLocked) { clearWorkspaceTabDragState(); return; }
      event.preventDefault();
      if (draggedSessionId === sessionId) { clearWorkspaceTabDragState(); return; }
      const position = getWorkspaceTabDropPosition(event);
      reorderWorkspaceSessions(draggedSessionId, sessionId, position);
      workspaceTabDragJustMovedRef.current = true;
      clearWorkspaceTabDragState();
    },
    [isWorkspaceSwitchLocked, workspaceTabDragState.draggedSessionId, clearWorkspaceTabDragState, getWorkspaceTabDropPosition, reorderWorkspaceSessions]
  );

  const handleWorkspaceTabDragEnd = useCallback(() => {
    clearWorkspaceTabDragState();
    window.setTimeout(() => { workspaceTabDragJustMovedRef.current = false; }, 120);
  }, [clearWorkspaceTabDragState]);

  return {
    workspaceTabDragState,
    workspaceTabDragJustMovedRef,
    clearWorkspaceTabDragState,
    reorderWorkspaceSessions,
    getWorkspaceTabDropPosition,
    handleWorkspaceTabDragStart,
    handleWorkspaceTabDragOver,
    handleWorkspaceTabDrop,
    handleWorkspaceTabDragEnd
  };
}
