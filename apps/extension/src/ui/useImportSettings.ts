import { useCallback } from "react";
import {
  apiGetFinalShellSettings,
  apiSaveFinalShellPath,
  apiImportFromTool,
} from "./api.js";

export type ImportSettingsAPI = {
  fetchFinalShellSettings: () => Promise<void>;
  saveFinalShellPath: () => Promise<void>;
  previewImport: (toolId?: string) => Promise<void>;
  importFromTool: (toolId?: string) => Promise<void>;
  importFromFinalShell: () => Promise<void>;
};

export function useImportSettings(deps: {
  selectedImportTool: string;
  finalShellPath: string;
  setFinalShellPath: (v: string) => void;
  setFinalShellDetectedPaths: (v: string[]) => void;
  setFinalShellLastImportedAt: (v: string) => void;
  setXshellLastImportedAt: (v: string) => void;
  setImportPath: (v: string) => void;
  setImportStatus: (v: string) => void;
  setServers: (v: any[]) => void;
  setFilePath: (v: string) => void;
  setActionStatus: (v: string) => void;
  pushActivity: (a: string) => void;
  selectServerById: (id: string) => void;
  withBusy: <T>(message: string, task: () => Promise<T>, successMessage?: string) => Promise<T | null>;
  checkLocalServiceHealth: (opts?: { silentFailure?: boolean }) => Promise<boolean>;
}): ImportSettingsAPI {
  const {
    selectedImportTool,
    finalShellPath,
    setFinalShellPath,
    setFinalShellDetectedPaths,
    setFinalShellLastImportedAt,
    setXshellLastImportedAt,
    setImportPath,
    setImportStatus,
    setServers,
    setFilePath,
    setActionStatus,
    pushActivity,
    selectServerById,
    withBusy,
    checkLocalServiceHealth,
  } = deps;

  const fetchFinalShellSettings = useCallback(async () => {
    try {
      const payload = await apiGetFinalShellSettings();
      setFinalShellPath(payload.configuredPath || "");
      setFinalShellDetectedPaths(payload.searchedPaths || []);
      setFinalShellLastImportedAt(payload.lastImportedAt || "");
      setImportPath(
        payload.resolvedPath
          ? `当前识别目录：${payload.resolvedPath}`
          : `尚未识别到 FinalShell 目录，已检测：${payload.searchedPaths.join(" | ")}`
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      await checkLocalServiceHealth({ silentFailure: true });
      pushActivity(`读取 FinalShell 配置失败：${detail}`);
    }
  }, [setFinalShellPath, setFinalShellDetectedPaths, setFinalShellLastImportedAt, setImportPath, pushActivity, checkLocalServiceHealth]);

  const saveFinalShellPath = useCallback(async () => {
    await withBusy("正在保存 FinalShell 目录...", async () => {
      const payload = await apiSaveFinalShellPath(finalShellPath.trim());
      setFinalShellPath(payload.configuredPath || "");
      setFinalShellDetectedPaths(payload.searchedPaths || []);
      setFinalShellLastImportedAt(payload.lastImportedAt || "");
      setImportPath(
        payload.resolvedPath
          ? `当前识别目录：${payload.resolvedPath}`
          : `尚未识别到 FinalShell 目录，已检测：${payload.searchedPaths.join(" | ")}`
      );
      setActionStatus("FinalShell 目录已保存。");
      pushActivity(`FinalShell 目录已保存：${payload.configuredPath || "已清空，将回退自动检测"}`);
    });
  }, [finalShellPath, withBusy, setFinalShellPath, setFinalShellDetectedPaths, setFinalShellLastImportedAt, setImportPath, setActionStatus, pushActivity]);

  /** 打开变更预览（不写库）。真正的落库由弹层确认后调用 apply。 */
  const previewImport = useCallback(async (toolId: string = selectedImportTool) => {
    const toolLabel = toolId === "finalshell" ? "FinalShell" : toolId === "xshell" ? "Xshell" : toolId;
    if (!(await checkLocalServiceHealth({ silentFailure: false }))) {
      setImportStatus("连接服务不可用，无法读取导入变更。");
      return;
    }
    setImportStatus(`正在比对 ${toolLabel} 配置变更…`);
  }, [selectedImportTool, checkLocalServiceHealth, setImportStatus]);

  const importFromTool = useCallback(async (toolId: string = selectedImportTool) => {
    const toolLabel = toolId === "finalshell" ? "FinalShell" : toolId === "xshell" ? "Xshell" : toolId;
    await withBusy(`正在导入 ${toolLabel} 连接...`, async () => {
      const payload = await apiImportFromTool(toolId);

      /* 「找不到目录」或「目录存在但 0 条连接」都不算成功（2026-10-23 用户反馈
         「没装 FinalShell 也提示导入成功」）。
         注意必须 throw 而非 return：withBusy 的 successMessage 在任务**正常返回**时
         会无条件弹「已导入 FinalShell 连接」——提前 return 仍会显示成功提示。
         throw 让 withBusy 走 catch 分支，统一弹出错误 toast 并给出原因；
         同时不写空列表，避免把用户已有服务器覆盖成空。 */
      if (!payload.resolvedPath || payload.servers.length === 0) {
        const detail = !payload.resolvedPath
          ? `未找到 ${toolLabel} 配置目录。已检查：${payload.searchedPaths.join(" | ")}`
          : `已找到配置目录 ${payload.resolvedPath}，但其中没有可导入的连接`;
        setImportStatus(`未导入任何服务器：${detail}`);
        setImportPath(detail);
        throw new Error(`${detail}。可在设置中心指定配置目录，或手动新增连接。`);
      }

      setServers(payload.servers);

      /* 私钥认证但没读到私钥：显式提示，不要等到连接时才表现为「认证失败」。
         以前这里是静默降级（只剩用户名），排查成本极高。 */
      const missingKeys = payload.missingPrivateKeyServers ?? [];
      if (missingKeys.length > 0) {
        const names = missingKeys.slice(0, 3).join("、");
        const more = missingKeys.length > 3 ? ` 等 ${missingKeys.length} 台` : "";
        setImportStatus(
          `已导入，但 ${names}${more} 的私钥未读到，凭证不完整。请在导入设置里检查私钥目录后重新导入。`
        );
        pushActivity(
          `${toolLabel} 导入：${missingKeys.length} 台服务器的私钥未能读取（${names}${more}），这些连接会认证失败。`
        );
      }
      selectServerById(payload.servers[0]?.id ?? "");
      setFilePath("");
      setImportStatus(`已导入 ${payload.servers.length} 台服务器，时间 ${payload.importedAt}`);
      if (toolId === "finalshell") setFinalShellLastImportedAt(payload.importedAt);
      if (toolId === "xshell") setXshellLastImportedAt(payload.importedAt);
      setImportPath(
        payload.resolvedPath
          ? `配置目录：${payload.resolvedPath}`
          : `未发现 ${toolLabel} 配置目录，已检查：${payload.searchedPaths.join(" | ")}`
      );
      setActionStatus(`${toolLabel} 连接导入完成。`);
      pushActivity(`${toolLabel} 配置已导入，共 ${payload.servers.length} 台，选择服务器后会自动连接。`);
    }, `已导入 ${toolLabel} ${toolId === "finalshell" || toolId === "xshell" ? "连接" : ""}`);
  }, [selectedImportTool, withBusy, setServers, selectServerById, setFilePath, setImportStatus, setFinalShellLastImportedAt, setXshellLastImportedAt, setImportPath, setActionStatus, pushActivity]);

  const importFromFinalShell = useCallback(async () => {
    return importFromTool("finalshell");
  }, [importFromTool]);

  return {
    fetchFinalShellSettings,
    saveFinalShellPath,
    previewImport,
    importFromTool,
    importFromFinalShell,
  };
}
