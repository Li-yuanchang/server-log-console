import { X } from "lucide-react";
import type { WorkspaceSession } from "./types.js";
import type { WorkspaceTabDragState, WorkspaceTabDragAPI } from "./useWorkspaceTabDrag.js";
import type { WorkspaceTabMenuState } from "./WorkspaceTabContextMenu.js";

export type WorkspaceSessionTabsProps = {
  workspaceSessions: WorkspaceSession[];
  activeWorkspaceSessionId: string | null;
  isWorkspaceSwitchLocked: boolean;
  workspaceTabDragState: WorkspaceTabDragState;
  workspaceTabDragJustMovedRef: React.MutableRefObject<boolean>;
  onActivateSession: (session: WorkspaceSession) => void;
  onCloseSession: (sessionId: string) => void;
  onOpenPalette: () => void;
  onContextMenu: (state: WorkspaceTabMenuState) => void;
  dragAPI: Pick<WorkspaceTabDragAPI, "handleWorkspaceTabDragStart" | "handleWorkspaceTabDragOver" | "handleWorkspaceTabDrop" | "handleWorkspaceTabDragEnd">;
};

export function WorkspaceSessionTabs(props: WorkspaceSessionTabsProps) {
  const {
    workspaceSessions,
    activeWorkspaceSessionId,
    isWorkspaceSwitchLocked,
    workspaceTabDragState,
    workspaceTabDragJustMovedRef,
    onActivateSession,
    onCloseSession,
    onOpenPalette,
    onContextMenu,
    dragAPI,
  } = props;

  if (!workspaceSessions.length) return null;

  return (
    <div className="workspace-session-strip">
      <div className="workspace-session-tabs-shell">
        <div className="workspace-session-strip-head">
          <span className="workspace-session-strip-label">工作区</span>
          <span className="workspace-session-strip-count">共 {workspaceSessions.length} 个</span>
        </div>
        <div className="workspace-session-tabs">
          {workspaceSessions.map((session) => {
            const isActiveSession = session.id === activeWorkspaceSessionId;
            const isDraggingSession = workspaceTabDragState.draggedSessionId === session.id;
            const dropPosition = workspaceTabDragState.targetSessionId === session.id ? workspaceTabDragState.position : null;
            return (
              <div
                key={session.id}
                className={`workspace-session-tab ${isActiveSession ? "workspace-session-tab-active" : ""}${!isWorkspaceSwitchLocked ? " workspace-session-tab-draggable" : ""}${isDraggingSession ? " workspace-session-tab-dragging" : ""}${dropPosition ? ` workspace-session-tab-drop-${dropPosition}` : ""}`}
                draggable={!isWorkspaceSwitchLocked}
                onDragStart={(event) => dragAPI.handleWorkspaceTabDragStart(event, session.id)}
                onDragOver={(event) => dragAPI.handleWorkspaceTabDragOver(event, session.id)}
                onDrop={(event) => dragAPI.handleWorkspaceTabDrop(event, session.id)}
                onDragEnd={dragAPI.handleWorkspaceTabDragEnd}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const menuWidth = 160;
                  const menuHeight = 140;
                  const nextX = Math.min(Math.max(8, event.clientX), Math.max(8, window.innerWidth - menuWidth - 8));
                  const nextY = Math.min(Math.max(8, event.clientY), Math.max(8, window.innerHeight - menuHeight - 8));
                  onContextMenu({ x: nextX, y: nextY, session });
                }}
              >
                <button
                  className="workspace-session-tab-trigger"
                  type="button"
                  title={session.serverHost ? `${session.serverName} · ${session.serverHost}` : session.serverName}
                  disabled={isWorkspaceSwitchLocked && !isActiveSession}
                  draggable={false}
                  onClick={() => {
                    if (workspaceTabDragJustMovedRef.current) {
                      workspaceTabDragJustMovedRef.current = false;
                      return;
                    }
                    onActivateSession(session);
                  }}
                >
                  <span className="workspace-session-tab-label">{session.serverName}</span>
                  {session.serverGroup ? <span className="chip workspace-session-tab-group">{session.serverGroup}</span> : null}
                </button>
                <button
                  className="ghost-button icon-button workspace-session-tab-close"
                  type="button"
                  aria-label={`关闭 ${session.serverName}`}
                  disabled={isWorkspaceSwitchLocked}
                  draggable={false}
                  onClick={() => onCloseSession(session.id)}
                >
                  <X size={12} strokeWidth={1.5} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="workspace-session-add"
          title="打开服务器（⌘K）"
          aria-label="新建会话"
          onClick={onOpenPalette}
        >
          ＋
        </button>
        <span className="workspace-session-hint"><span className="kbd">⌘1-9</span> 切换会话</span>
      </div>
    </div>
  );
}
