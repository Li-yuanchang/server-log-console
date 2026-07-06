import { useCallback } from "react";
import type { ServerSummary } from "@server-log-console/shared";
import type { ManualServerDraft, SettingsWorkspaceView } from "./ConnectionSettingsWorkspace.js";
import type { WorkspaceSession, WorkspaceSessionState } from "./types.js";
import type { ConfirmDialogState } from "./ModalDialogs.js";
import { apiGetServers, apiDeleteServer, apiUpsertManualServer } from "./api.js";
import { createManualServerDraft, parseManualServerTags, buildWorkspaceSession } from "./app-utils.js";

export type ServerManagementAPI = {
  fetchServers: () => Promise<ServerSummary[]>;
  selectServerById: (nextServerId: string) => boolean;
  activateWorkspaceSession: (session: WorkspaceSession) => void;
  closeWorkspaceSession: (sessionId: string) => void;
  startCreateManualServer: () => void;
  startEditManualServer: (server: ServerSummary) => void;
  saveManualServer: () => Promise<void>;
  deleteServerRecord: (targetServer: ServerSummary) => Promise<void>;
  requestDeleteServer: (targetServer: ServerSummary) => void;
};

export function useServerManagement(deps: {
  serverId: string;
  servers: ServerSummary[];
  workspaceSessions: WorkspaceSession[];
  activeWorkspaceSessionId: string | null;
  isWorkspaceSwitchLocked: boolean;
  manualServerDraft: ManualServerDraft;
  workspaceSessionStatesRef: React.MutableRefObject<Record<string, WorkspaceSessionState>>;
  setServers: (v: ServerSummary[]) => void;
  setServerId: (v: string) => void;
  setActionStatus: (s: string) => void;
  pushActivity: (a: string) => void;
  showToast: (type: "success" | "error" | "loading", message: string) => string | number;
  setConfirmDialog: (v: ConfirmDialogState | null) => void;
  setWorkspaceSessions: (v: WorkspaceSession[] | ((prev: WorkspaceSession[]) => WorkspaceSession[])) => void;
  setActiveWorkspaceSessionId: (v: string | null) => void;
  setManualServerDraft: (v: ManualServerDraft | ((prev: ManualServerDraft) => ManualServerDraft)) => void;
  setSettingsWorkspaceView: (v: SettingsWorkspaceView) => void;
  setPendingLiveFollowRestore: (v: WorkspaceSessionState | null) => void;
  setPreserveTerminalOnInactive: (v: boolean) => void;
  withBusy: <T>(message: string, task: () => Promise<T>, successMessage?: string) => Promise<T | null>;
  checkLocalServiceHealth: (opts?: { silentFailure?: boolean; background?: boolean }) => Promise<boolean>;
  startWorkspaceActivation: (session: WorkspaceSession, options?: { skipSaveCurrent?: boolean }) => void;
  openSettingsWorkspace: (view?: SettingsWorkspaceView) => void;
}): ServerManagementAPI {
  const {
    serverId,
    servers,
    workspaceSessions,
    activeWorkspaceSessionId,
    isWorkspaceSwitchLocked,
    manualServerDraft,
    workspaceSessionStatesRef,
    setServers,
    setServerId,
    setActionStatus,
    pushActivity,
    showToast,
    setConfirmDialog,
    setWorkspaceSessions,
    setActiveWorkspaceSessionId,
    setManualServerDraft,
    setSettingsWorkspaceView,
    setPendingLiveFollowRestore,
    setPreserveTerminalOnInactive,
    withBusy,
    checkLocalServiceHealth,
    startWorkspaceActivation,
    openSettingsWorkspace,
  } = deps;

  const fetchServers = useCallback(async (): Promise<ServerSummary[]> => {
    try {
      const data = await apiGetServers();
      await checkLocalServiceHealth({ silentFailure: true, background: true });
      setServers(data);
      setActionStatus(data.length ? `已载入 ${data.length} 台服务器，请在左侧选择一台。` : "当前还没有服务器，请导入 FinalShell 或手动新增。");
      pushActivity(data.length ? `已读取本地连接清单，共 ${data.length} 台。` : "当前没有服务器，请先导入 FinalShell 或手动新增连接。");
      return data;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      await checkLocalServiceHealth({ silentFailure: true });
      setActionStatus(`本地连接服务不可用：${detail}`);
      pushActivity(`读取本地服务器清单失败：${detail}`);
      return [];
    }
  }, [setServers, setActionStatus, pushActivity, checkLocalServiceHealth]);

  const selectServerById = useCallback((nextServerId: string): boolean => {
    if (nextServerId && nextServerId !== serverId && isWorkspaceSwitchLocked) {
      setActionStatus("当前检索或连接操作尚未完成，请稍后再切换工作区。");
      return false;
    }

    if (!nextServerId) {
      setActiveWorkspaceSessionId(null);
      setServerId("");
      return true;
    }

    const existingSession = workspaceSessions.find((session) => session.serverId === nextServerId);
    const targetServer = servers.find((server) => server.id === nextServerId);
    const nextSession = existingSession ?? (targetServer ? buildWorkspaceSession(targetServer) : null);

    if (!nextSession) {
      setServerId(nextServerId);
      return true;
    }

    if (!existingSession) {
      setWorkspaceSessions((current) => current.some((session) => session.id === nextSession.id) ? current : [...current, nextSession]);
    }

    startWorkspaceActivation(nextSession);
    return true;
  }, [serverId, isWorkspaceSwitchLocked, workspaceSessions, servers, setActionStatus, setActiveWorkspaceSessionId, setServerId, setWorkspaceSessions, startWorkspaceActivation]);

  const activateWorkspaceSession = useCallback((session: WorkspaceSession) => {
    startWorkspaceActivation(session);
  }, [startWorkspaceActivation]);

  const closeWorkspaceSession = useCallback((sessionId: string) => {
    if (isWorkspaceSwitchLocked) {
      setActionStatus("当前检索或连接操作尚未完成，请稍后再关闭工作区。");
      return;
    }

    const currentIndex = workspaceSessions.findIndex((session) => session.id === sessionId);
    if (currentIndex === -1) {
      return;
    }

    const nextSessions = workspaceSessions.filter((session) => session.id !== sessionId);
    setWorkspaceSessions(nextSessions);
    delete workspaceSessionStatesRef.current[sessionId];

    if (activeWorkspaceSessionId !== sessionId) {
      return;
    }

    const fallbackSession = nextSessions[Math.min(currentIndex, nextSessions.length - 1)] ?? null;
    if (!fallbackSession) {
      setPendingLiveFollowRestore(null);
      setPreserveTerminalOnInactive(false);
      setActiveWorkspaceSessionId(null);
      setServerId("");
      return;
    }

    startWorkspaceActivation(fallbackSession, { skipSaveCurrent: true });
  }, [isWorkspaceSwitchLocked, workspaceSessions, activeWorkspaceSessionId, workspaceSessionStatesRef, setWorkspaceSessions, setActionStatus, setPendingLiveFollowRestore, setPreserveTerminalOnInactive, setActiveWorkspaceSessionId, setServerId, startWorkspaceActivation]);

  const startCreateManualServer = useCallback(() => {
    setManualServerDraft(createManualServerDraft());
    openSettingsWorkspace("inventory");
  }, [setManualServerDraft, openSettingsWorkspace]);

  const startEditManualServer = useCallback((server: ServerSummary) => {
    setManualServerDraft(createManualServerDraft(server));
    selectServerById(server.id);
    openSettingsWorkspace("inventory");
  }, [setManualServerDraft, selectServerById, openSettingsWorkspace]);

  const saveManualServer = useCallback(async () => {
    const name = manualServerDraft.name.trim();
    const host = manualServerDraft.host.trim();
    const portValue = manualServerDraft.port.trim();
    const port = Number(portValue || "22");

    if (!name || !host) {
      setActionStatus("请先填写服务器名称和主机地址。");
      openSettingsWorkspace("inventory");
      return;
    }

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setActionStatus("端口必须是 1-65535 之间的整数。");
      openSettingsWorkspace("inventory");
      return;
    }

    await withBusy("正在保存手动服务器...", async () => {
      const payload = await apiUpsertManualServer({
        id: manualServerDraft.id || undefined,
        name,
        host,
        port,
        username: manualServerDraft.username.trim() || undefined,
        basePath: manualServerDraft.basePath.trim() || "/",
        profile: manualServerDraft.profile,
        connectionKind: manualServerDraft.connectionKind,
        tags: parseManualServerTags(manualServerDraft.tagsText),
        credential: manualServerDraft.password || manualServerDraft.privateKey
          ? {
              username: manualServerDraft.username.trim() || undefined,
              password: manualServerDraft.password || undefined,
              privateKey: manualServerDraft.privateKey || undefined
            }
          : undefined
      });
      const refreshedServers = await fetchServers();
      const savedServer = refreshedServers.find((server) => server.id === payload.server.id) || payload.server;
      selectServerById(savedServer.id);
      setManualServerDraft(createManualServerDraft(savedServer));
      setSettingsWorkspaceView(savedServer.connectionKind === "bastion-target" ? "server" : "inventory");
      setActionStatus(`已保存连接：${savedServer.name}`);
      pushActivity(`已保存手动服务器：${savedServer.name}（${savedServer.host}:${savedServer.port}）`);
      showToast("success", `已保存 ${savedServer.name}`);
    });
  }, [manualServerDraft, withBusy, fetchServers, selectServerById, setManualServerDraft, setSettingsWorkspaceView, setActionStatus, pushActivity, showToast, openSettingsWorkspace]);

  const deleteServerRecord = useCallback(async (targetServer: ServerSummary) => {
    await withBusy(`正在删除服务器 ${targetServer.name}...`, async () => {
      await apiDeleteServer(targetServer.id);
      const refreshedServers = await fetchServers();
      if (serverId === targetServer.id) {
        const fallbackServerId = refreshedServers[0]?.id || "";
        selectServerById(fallbackServerId);
      }
      setManualServerDraft((current) => current.id === targetServer.id ? createManualServerDraft() : current);
      setSettingsWorkspaceView(refreshedServers.length ? "inventory" : "overview");
      setActionStatus(`已删除服务器：${targetServer.name}`);
      pushActivity(`已删除服务器：${targetServer.name}（${targetServer.host}:${targetServer.port}）`);
      showToast("success", `已删除 ${targetServer.name}`);
    });
  }, [serverId, withBusy, fetchServers, selectServerById, setManualServerDraft, setSettingsWorkspaceView, setActionStatus, pushActivity, showToast]);

  const requestDeleteServer = useCallback((targetServer: ServerSummary) => {
    setConfirmDialog({
      title: "删除服务器",
      message: `确定删除服务器"${targetServer.name}"？\n${targetServer.username}@${targetServer.host}:${targetServer.port}`,
      danger: true,
      onConfirm: () => {
        void deleteServerRecord(targetServer);
      }
    });
  }, [setConfirmDialog, deleteServerRecord]);

  return {
    fetchServers,
    selectServerById,
    activateWorkspaceSession,
    closeWorkspaceSession,
    startCreateManualServer,
    startEditManualServer,
    saveManualServer,
    deleteServerRecord,
    requestDeleteServer,
  };
}
