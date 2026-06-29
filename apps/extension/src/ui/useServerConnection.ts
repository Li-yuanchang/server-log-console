import { useCallback } from "react";
import type { ServerSummary, ServerCredentialStatus, ServerRouteConfig, ServerConnectionTestResponse, JumpServerAssetOption } from "@server-log-console/shared";
import {
  apiGetCredentialStatus,
  apiSaveCredential,
  apiGetServerRoute,
  apiSaveServerRoute,
  apiSearchJumpServerAssets,
  apiTestConnection,
} from "./api.js";
import { looksLikeJumpServer } from "./terminal-utils.js";

export type ServerConnectionAPI = {
  fetchCredentialStatus: (targetServerId: string) => Promise<void>;
  fetchServerRoute: (targetServerId: string) => Promise<void>;
  saveCredentialForServer: () => Promise<void>;
  saveServerRouteForServer: () => Promise<void>;
  searchJumpServerAssets: () => Promise<void>;
  testServerConnection: (targetDirectoryPath?: string, options?: { auto?: boolean }) => Promise<void>;
};

export function useServerConnection(deps: {
  serverId: string;
  serverIdRef: React.MutableRefObject<string>;
  credentialUsername: string;
  credentialPassword: string;
  credentialPrivateKey: string;
  preferredBastionId: string;
  jumpMode: string;
  jumpSearchKeyword: string;
  jumpAssetId: string;
  directoryPath: string;
  selectedServer: ServerSummary | null;
  availableBastions: ServerSummary[];
  isBusy: boolean;
  setIsBusy: (v: boolean) => void;
  setActionStatus: (s: string) => void;
  pushActivity: (a: string) => void;
  showToast: (type: "success" | "error" | "loading", message: string) => string | number;
  setCredentialStatus: (v: ServerCredentialStatus | null) => void;
  setCredentialPassword: (v: string) => void;
  setCredentialPrivateKey: (v: string) => void;
  setCredentialUsername: (v: string) => void;
  setServerRouteConfig: (v: ServerRouteConfig | null) => void;
  setPreferredBastionId: (v: string) => void;
  setJumpMode: (v: "auto" | "jumpserver-search") => void;
  setJumpSearchKeyword: (v: string) => void;
  setJumpAssetId: (v: string) => void;
  setJumpAssetOptions: (v: JumpServerAssetOption[]) => void;
  setConnectionTestStatus: (v: ServerConnectionTestResponse | null) => void;
  setDirectoryPath: (v: string) => void;
  setDirectoryInput: (v: string) => void;
  setFileEntries: (v: any[]) => void;
  jumpAssetAutoSearchKeyRef: React.MutableRefObject<string>;
  withBusy: <T>(message: string, task: () => Promise<T>, successMessage?: string) => Promise<T | null>;
  fetchServers: () => Promise<ServerSummary[]>;
  fetchDirectoryListing: (path: string) => Promise<any>;
  rememberDirectoryIfUseful: (serverId: string, path: string, count: number) => void;
  openSettingsWorkspace: (view?: "overview" | "server" | "inventory") => void;
}): ServerConnectionAPI {
  const {
    serverId,
    credentialUsername,
    credentialPassword,
    credentialPrivateKey,
    preferredBastionId,
    jumpMode,
    jumpSearchKeyword,
    jumpAssetId,
    directoryPath,
    selectedServer,
    availableBastions,
    setIsBusy,
    setActionStatus,
    pushActivity,
    setCredentialStatus,
    setCredentialPassword,
    setCredentialPrivateKey,
    setCredentialUsername,
    setServerRouteConfig,
    setPreferredBastionId: setBastionId,
    setJumpMode,
    setJumpSearchKeyword,
    setJumpAssetId,
    setJumpAssetOptions,
    setConnectionTestStatus,
    setDirectoryPath,
    setDirectoryInput,
    setFileEntries,
    jumpAssetAutoSearchKeyRef,
    withBusy,
    fetchServers,
    fetchDirectoryListing,
    rememberDirectoryIfUseful,
    openSettingsWorkspace,
  } = deps;

  const serverIdRef = deps.serverIdRef;

  const fetchCredentialStatus = useCallback(async (targetServerId: string) => {
    try {
      const payload = await apiGetCredentialStatus(targetServerId);
      if (serverIdRef.current !== targetServerId) {
        return;
      }
      setCredentialStatus(payload);
      setCredentialUsername(payload.username || "");
      setCredentialPassword("");
      setCredentialPrivateKey("");
    } catch (error) {
      if (serverIdRef.current !== targetServerId) {
        return;
      }
      const detail = error instanceof Error ? error.message : "未知错误";
      setCredentialStatus(null);
      pushActivity(`读取连接凭证状态失败：${detail}`);
    }
  }, [setCredentialStatus, setCredentialUsername, setCredentialPassword, setCredentialPrivateKey, pushActivity]);

  const fetchServerRoute = useCallback(async (targetServerId: string) => {
    try {
      const payload = await apiGetServerRoute(targetServerId);
      if (serverIdRef.current !== targetServerId) {
        return;
      }
      setServerRouteConfig(payload);
      setBastionId(payload.preferredBastionId || "");
      setJumpMode(payload.jumpMode || "auto");
      setJumpSearchKeyword(payload.jumpSearchKeyword || "");
      setJumpAssetId(payload.jumpAssetId || "");
      setJumpAssetOptions([]);
      jumpAssetAutoSearchKeyRef.current = "";
    } catch (error) {
      if (serverIdRef.current !== targetServerId) {
        return;
      }
      setServerRouteConfig(null);
      setBastionId("");
      setJumpMode("auto");
      setJumpSearchKeyword("");
      setJumpAssetId("");
      setJumpAssetOptions([]);
      jumpAssetAutoSearchKeyRef.current = "";
      pushActivity(`读取二跳配置失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }, [setServerRouteConfig, setBastionId, setJumpMode, setJumpSearchKeyword, setJumpAssetId, setJumpAssetOptions, jumpAssetAutoSearchKeyRef, pushActivity]);

  const saveCredentialForServer = useCallback(async () => {
    if (!serverId) {
      return;
    }

    await withBusy("正在保存连接凭证...", async () => {
      const payload = await apiSaveCredential(serverId, {
        username: credentialUsername.trim() || undefined,
        password: credentialPassword || undefined,
        privateKey: credentialPrivateKey || undefined
      });
      setCredentialStatus(payload);
      setCredentialPassword("");
      setCredentialPrivateKey("");
      setActionStatus(`连接凭证已保存：${payload.serverName}`);
      pushActivity(`已保存连接凭证：${payload.serverName}，后续刷新页面仍会保留。`);
      await fetchServers();
    });
  }, [serverId, credentialUsername, credentialPassword, credentialPrivateKey, withBusy, setCredentialStatus, setCredentialPassword, setCredentialPrivateKey, setActionStatus, pushActivity, fetchServers]);

  const saveServerRouteForServer = useCallback(async () => {
    if (!serverId) {
      return;
    }

    await withBusy("正在保存二跳设置...", async () => {
      const payload = await apiSaveServerRoute(serverId, {
        preferredBastionId: preferredBastionId || undefined,
        jumpMode,
        jumpSearchKeyword: jumpSearchKeyword.trim() || undefined,
        jumpAssetId: jumpAssetId.trim() || undefined
      });
      setServerRouteConfig(payload);
      setBastionId(payload.preferredBastionId || "");
      setJumpMode(payload.jumpMode || "auto");
      setJumpSearchKeyword(payload.jumpSearchKeyword || "");
      setJumpAssetId(payload.jumpAssetId || "");
      setJumpAssetOptions([]);
      jumpAssetAutoSearchKeyRef.current = "";
      await fetchServers();
      setActionStatus("二跳设置已保存。");
      pushActivity(`已保存二跳设置：${selectedServer?.name || serverId}`);
      await testServerConnectionLocal(directoryPath.trim() || selectedServer?.basePath?.trim() || "/");
    });
  }, [serverId, preferredBastionId, jumpMode, jumpSearchKeyword, jumpAssetId, withBusy, setServerRouteConfig, setBastionId, setJumpMode, setJumpSearchKeyword, setJumpAssetId, setJumpAssetOptions, jumpAssetAutoSearchKeyRef, fetchServers, setActionStatus, pushActivity, selectedServer, directoryPath]);

  const searchJumpServerAssets = useCallback(async () => {
    if (!serverId) {
      return;
    }

    const keyword =
      jumpSearchKeyword.trim() ||
      (selectedServer?.connectionKind === "bastion" ? "" : selectedServer?.host || "");

    if (!keyword) {
      setActionStatus("先输入 JumpServer 搜索关键字，再读取资产列表。");
      return;
    }

    await withBusy("正在读取 JumpServer 资产列表...", async () => {
      const payload = await apiSearchJumpServerAssets(
        serverId,
        preferredBastionId || (selectedServer?.connectionKind === "bastion" ? selectedServer.id : undefined),
        keyword
      );
      setJumpAssetOptions(payload.assets || []);
      if (payload.assets.length === 1) {
        setJumpAssetId(payload.assets[0].id);
        setActionStatus(`已唯一命中 JumpServer 资产：${payload.assets[0].name}`);
        pushActivity(`JumpServer 资产唯一命中：${payload.assets[0].id} / ${payload.assets[0].name}`);
        return;
      }
      setActionStatus(payload.assets.length ? `已读取 ${payload.assets.length} 条 JumpServer 资产。` : "没有检索到可用资产。");
      pushActivity(
        payload.assets.length
          ? `JumpServer 资产已读取：${payload.assets.length} 条，关键字 ${payload.keyword}`
          : `JumpServer 资产为空：${payload.keyword}`
      );
    });
  }, [serverId, jumpSearchKeyword, selectedServer, preferredBastionId, withBusy, setJumpAssetOptions, setJumpAssetId, setActionStatus, pushActivity]);

  const testServerConnectionLocal = useCallback(async (targetDirectoryPath?: string, options?: { auto?: boolean }) => {
    if (!serverId) {
      return;
    }

    const requestServerId = serverId;
    const autoMode = Boolean(options?.auto);
    setIsBusy(true);
    setActionStatus(autoMode ? "正在自动连接服务器..." : "正在测试服务器连接...");

    try {
      const payload = await apiTestConnection(requestServerId, targetDirectoryPath || directoryPath.trim() || "/");
      if (serverIdRef.current !== requestServerId) {
        return;
      }
      setConnectionTestStatus(payload);
      const connectionMessage =
        !payload.connected && ((availableBastions.length && selectedServer?.connectionKind !== "bastion") || looksLikeJumpServer(selectedServer))
          ? `${payload.message} 可在连接设置里切换跳转入口后重试。`
          : payload.message;
      setActionStatus(connectionMessage);

      if (!autoMode || payload.connected) {
        pushActivity(
          payload.connected
            ? `${payload.message}${payload.sampleEntries.length ? `，示例：${payload.sampleEntries.join(", ")}` : ""}`
            : `连接测试失败：${connectionMessage}`
        );
      }

      if (!payload.connected && ((availableBastions.length && selectedServer?.connectionKind !== "bastion") || looksLikeJumpServer(selectedServer))) {
        openSettingsWorkspace("server");
      }

      if (payload.connected && selectedServer?.connectionKind === "bastion" && looksLikeJumpServer(selectedServer)) {
        try {
          pushActivity("已连接 JumpServer 入口，可在终端中继续检索资产并进入目标机。");
          const preferredDirectory = targetDirectoryPath?.trim() || directoryPath.trim() || "/";
          let directoryPayload;
          try {
            directoryPayload = await fetchDirectoryListing(preferredDirectory);
          } catch (directoryError) {
            if (preferredDirectory === "/") {
              throw directoryError;
            }
            pushActivity(`堡垒机目录 ${preferredDirectory} 读取失败，已回退到根目录。`);
            directoryPayload = await fetchDirectoryListing("/");
          }
          if (serverIdRef.current !== requestServerId) {
            return;
          }
          setDirectoryPath(directoryPayload.directoryPath);
          setDirectoryInput(directoryPayload.directoryPath);
          setFileEntries(directoryPayload.entries);
          rememberDirectoryIfUseful(requestServerId, directoryPayload.directoryPath, directoryPayload.entries.length);
          pushActivity(`已通过 SFTP 读取堡垒机目录，共 ${directoryPayload.entries.length} 项。`);
        } catch (sftpError) {
          const sftpDetail = sftpError instanceof Error ? sftpError.message : "未知错误";
          setActionStatus(`堡垒机 SFTP 目录读取失败：${sftpDetail}`);
          pushActivity(`堡垒机 SFTP 目录读取失败：${sftpDetail}`);
        }
      } else if (payload.connected && payload.directoryReadable) {
        const directoryPayload = await fetchDirectoryListing(payload.directoryPath);
        if (serverIdRef.current !== requestServerId) {
          return;
        }
        setDirectoryPath(directoryPayload.directoryPath);
        setFileEntries(directoryPayload.entries);
        rememberDirectoryIfUseful(requestServerId, directoryPayload.directoryPath, directoryPayload.entries.length);
        pushActivity(`连接测试后已读取目录：${directoryPayload.directoryPath}，共 ${directoryPayload.entries.length} 项。`);
      }
    } catch (error) {
      if (serverIdRef.current !== requestServerId) {
        return;
      }
      const detail = error instanceof Error ? error.message : "未知错误";

      setConnectionTestStatus({
        serverId: requestServerId,
        serverName: selectedServer?.name || requestServerId,
        host: selectedServer?.host || "",
        username: selectedServer?.username || "",
        connected: false,
        directoryPath: targetDirectoryPath || directoryPath.trim() || "/",
        directoryReadable: false,
        sampleEntries: [],
        message: detail
      });
      setActionStatus(autoMode ? `自动连接未完成：${detail}` : `连接失败：${detail}`);

      if (!autoMode) {
        pushActivity(`连接失败：${detail}`);
      }

      if ((availableBastions.length && selectedServer?.connectionKind !== "bastion") || looksLikeJumpServer(selectedServer)) {
        openSettingsWorkspace("server");
      }
    } finally {
      setIsBusy(false);
    }
  }, [serverId, directoryPath, selectedServer, availableBastions, setIsBusy, setActionStatus, pushActivity, setConnectionTestStatus, setDirectoryPath, setDirectoryInput, setFileEntries, fetchDirectoryListing, rememberDirectoryIfUseful, openSettingsWorkspace]);

  return {
    fetchCredentialStatus,
    fetchServerRoute,
    saveCredentialForServer,
    saveServerRouteForServer,
    searchJumpServerAssets,
    testServerConnection: testServerConnectionLocal,
  };
}
