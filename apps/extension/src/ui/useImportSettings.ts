import { useCallback } from "react";
import {
  apiGetFinalShellSettings,
  apiSaveFinalShellPath,
  apiImportFromTool,
} from "./api.js";

export type ImportSettingsAPI = {
  fetchFinalShellSettings: () => Promise<void>;
  saveFinalShellPath: () => Promise<void>;
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

  const importFromTool = useCallback(async (toolId: string = selectedImportTool) => {
    const toolLabel = toolId === "finalshell" ? "FinalShell" : toolId === "xshell" ? "Xshell" : toolId;
    await withBusy(`正在导入 ${toolLabel} 连接...`, async () => {
      const payload = await apiImportFromTool(toolId);
      setServers(payload.servers);
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
    importFromTool,
    importFromFinalShell,
  };
}
