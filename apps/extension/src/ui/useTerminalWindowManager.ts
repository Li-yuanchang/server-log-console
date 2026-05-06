import { useEffect, useRef } from "react";
import type { ServerSummary } from "@server-log-console/shared";
import type { WorkspaceSession, WorkspaceSessionState } from "./types.js";
import { createTerminalSessionId } from "./app-utils.js";
import type { useTerminalSession } from "./useTerminalSession.js";
import type { usePictureInPicture } from "./usePictureInPicture.js";

export type TerminalWindowManagerAPI = {
  ensureTerminalSessionId: () => string;
  openTerminalView: (options?: { auto?: boolean }) => void;
  closeTerminalOverlay: () => void;
  toggleTerminalOverlay: (nextOverlay: "shortcuts" | "ai") => void;
  restoreEmbeddedTerminalWindow: (targetSessionId?: string) => Promise<void>;
  reconcileDetachedTerminalOwnership: (nextSessionId: string) => Promise<void>;
  toggleTerminalPanel: () => void;
  openDetachedTerminalWindow: () => Promise<void>;
  closeDetachedTerminalWindow: (targetSessionId?: string) => Promise<void>;
  terminalDetachedRef: React.MutableRefObject<boolean>;
  terminalSessionIdRef: React.MutableRefObject<string>;
};

export type TerminalWindowManagerParams = {
  // Terminal state
  terminalSessionId: string;
  setTerminalSessionId: (id: string) => void;
  terminalDetached: boolean;
  setTerminalDetached: (detached: boolean) => void;
  terminalPanelOpen: boolean;
  setTerminalPanelOpen: (open: boolean) => void;
  terminalOverlay: "none" | "shortcuts" | "ai";
  setTerminalOverlay: (overlay: "none" | "shortcuts" | "ai") => void;
  preserveTerminalOnInactive: boolean;
  setPreserveTerminalOnInactive: (preserve: boolean) => void;

  // Server context
  serverId: string;
  serverIdRef: React.MutableRefObject<string>;
  isElectron: boolean;
  isStandaloneTerminalWindow: boolean;
  selectedServer: ServerSummary | null;
  preferredBastionId: string;
  terminalWorkingDirectory: string | undefined;

  // Workspace session state access
  workspaceSessions: WorkspaceSession[];
  activeWorkspaceSessionId: string | null;
  workspaceSessionStatesRef: React.MutableRefObject<Record<string, WorkspaceSessionState>>;
  readWorkspaceSessionState: (session: WorkspaceSession) => WorkspaceSessionState;
  storeWorkspaceSessionState: (sessionId: string, nextState: WorkspaceSessionState) => void;

  // External hooks
  terminalSession: ReturnType<typeof useTerminalSession>;
  pip: ReturnType<typeof usePictureInPicture>;
};

export function useTerminalWindowManager(params: TerminalWindowManagerParams): TerminalWindowManagerAPI {
  const {
    terminalSessionId,
    setTerminalSessionId,
    terminalDetached,
    setTerminalDetached,
    terminalPanelOpen,
    setTerminalPanelOpen,
    terminalOverlay,
    setTerminalOverlay,
    serverId,
    serverIdRef,
    isElectron,
    isStandaloneTerminalWindow,
    selectedServer,
    preferredBastionId,
    terminalWorkingDirectory,
    workspaceSessions,
    activeWorkspaceSessionId,
    workspaceSessionStatesRef,
    readWorkspaceSessionState,
    storeWorkspaceSessionState,
    terminalSession,
    pip,
  } = params;

  const terminalDetachedRef = useRef(terminalDetached);
  const terminalSessionIdRef = useRef(terminalSessionId);

  useEffect(() => {
    terminalDetachedRef.current = terminalDetached;
  }, [terminalDetached]);

  useEffect(() => {
    terminalSessionIdRef.current = terminalSessionId;
  }, [terminalSessionId]);

  // Electron PiP closed callback for terminal windows
  useEffect(() => {
    if (!isElectron) {
      return;
    }

    const api = (window as any).electronAPI;
    if (!api?.onPipClosed) {
      return;
    }
    api.onPipClosed((payload?: { mode?: "viewer" | "terminal"; terminalSessionId?: string }) => {
      const closedTerminalSessionId = String(payload?.terminalSessionId || "").trim();
      if (payload?.mode !== "terminal" || !closedTerminalSessionId) {
        return;
      }

      Object.keys(workspaceSessionStatesRef.current).forEach((workspaceSessionId) => {
        const sessionState = workspaceSessionStatesRef.current[workspaceSessionId];
        if (!sessionState || sessionState.terminalSessionId.trim() !== closedTerminalSessionId) {
          return;
        }
        workspaceSessionStatesRef.current[workspaceSessionId] = {
          ...sessionState,
          terminalDetached: false,
          terminalPanelOpen: Boolean(sessionState.serverId),
        };
      });

      if (terminalSessionIdRef.current !== closedTerminalSessionId) {
        return;
      }

      setTerminalDetached(false);
      setTerminalPanelOpen(Boolean(serverIdRef.current));
    });
  }, [isElectron, workspaceSessionStatesRef, setTerminalDetached, setTerminalPanelOpen, serverIdRef]);

  // Auto-open terminal panel in standalone terminal window mode
  useEffect(() => {
    if (!isStandaloneTerminalWindow || !serverId) {
      return;
    }

    setTerminalPanelOpen(true);
  }, [serverId, isStandaloneTerminalWindow, setTerminalPanelOpen]);

  function ensureTerminalSessionId() {
    const existing = terminalSessionId.trim();
    if (existing) {
      return existing;
    }

    const next = createTerminalSessionId(serverId || "server");
    setTerminalSessionId(next);
    return next;
  }

  function openTerminalView(options?: { auto?: boolean }) {
    const nextSessionId = ensureTerminalSessionId();
    setTerminalDetached(false);
    setTerminalPanelOpen(true);
    terminalSession.startTerminal({ ...options, sessionId: nextSessionId });
  }

  function closeTerminalOverlay() {
    setTerminalOverlay("none");
  }

  function toggleTerminalOverlay(nextOverlay: "shortcuts" | "ai") {
    setTerminalOverlay(terminalOverlay === nextOverlay ? "none" : nextOverlay);
  }

  async function restoreEmbeddedTerminalWindow(targetSessionId: string = terminalSessionId) {
    await closeDetachedTerminalWindow(targetSessionId);
    setTerminalDetached(false);
    setTerminalPanelOpen(Boolean(serverId));
  }

  async function reconcileDetachedTerminalOwnership(nextSessionId: string) {
    const normalizedNextSessionId = nextSessionId.trim();
    if (!isElectron || !normalizedNextSessionId) {
      return;
    }

    const detachedSessionIdsToClose = new Set<string>();
    for (const session of workspaceSessions) {
      if (session.id === activeWorkspaceSessionId) {
        continue;
      }

      const sessionState = readWorkspaceSessionState(session);
      const detachedSessionId = sessionState.terminalSessionId.trim();
      if (!sessionState.terminalDetached || !detachedSessionId || detachedSessionId === normalizedNextSessionId) {
        continue;
      }

      storeWorkspaceSessionState(session.id, {
        ...sessionState,
        terminalDetached: false,
        terminalPanelOpen: Boolean(sessionState.serverId),
      });
      detachedSessionIdsToClose.add(detachedSessionId);
    }

    for (const detachedSessionId of detachedSessionIdsToClose) {
      await closeDetachedTerminalWindow(detachedSessionId);
    }
  }

  function toggleTerminalPanel() {
    if (terminalDetached) {
      void restoreEmbeddedTerminalWindow();
      return;
    }

    if (terminalPanelOpen) {
      closeTerminalOverlay();
      setTerminalPanelOpen(false);
      terminalSession.stopTerminal();
      return;
    }

    openTerminalView();
  }

  async function openDetachedTerminalWindow() {
    if (!isElectron || !serverId) {
      return;
    }

    const nextSessionId = ensureTerminalSessionId();
    await reconcileDetachedTerminalOwnership(nextSessionId);

    if (pip.isPip) {
      await pip.togglePip();
    }

    const terminalBastionId = selectedServer?.connectionKind === "bastion"
      ? selectedServer.id
      : selectedServer?.connectionKind === "bastion-target"
        ? (preferredBastionId || undefined)
        : !selectedServer?.connectionKind
          ? (preferredBastionId || undefined)
          : undefined;

    await (window as any).electronAPI.openPipWindow({
      mode: "terminal",
      width: 980,
      height: 680,
      title: selectedServer?.name || selectedServer?.host || "终端",
      serverId,
      terminalSessionId: nextSessionId,
      directoryPath: terminalWorkingDirectory || selectedServer?.basePath?.trim() || "/",
      bastionId: terminalBastionId,
    });

    closeTerminalOverlay();
    setTerminalPanelOpen(false);
    setTerminalDetached(true);
  }

  async function closeDetachedTerminalWindow(targetSessionId: string = terminalSessionId) {
    if (!isElectron) {
      return;
    }

    const nextSessionId = targetSessionId.trim();
    if (!nextSessionId) {
      return;
    }

    await (window as any).electronAPI.closePipWindow({
      mode: "terminal",
      terminalSessionId: nextSessionId,
    });
  }

  return {
    ensureTerminalSessionId,
    openTerminalView,
    closeTerminalOverlay,
    toggleTerminalOverlay,
    restoreEmbeddedTerminalWindow,
    reconcileDetachedTerminalOwnership,
    toggleTerminalPanel,
    openDetachedTerminalWindow,
    closeDetachedTerminalWindow,
    terminalDetachedRef,
    terminalSessionIdRef,
  };
}
