import { PlugZap, MousePointerClick } from "lucide-react";
import type { SettingsWorkspaceView } from "./ConnectionSettingsWorkspace.js";

export type WorkspaceStartupCardsProps = {
  showServiceOfflineState: boolean;
  showNoServerState: boolean;
  isElectron: boolean;
  onCheckService: () => void;
  onOpenSettings: (view: SettingsWorkspaceView) => void;
  onImportFinalShell: () => void;
  onRefreshServers: () => void;
};

export function WorkspaceStartupCards(props: WorkspaceStartupCardsProps) {
  const {
    showServiceOfflineState,
    showNoServerState,
    isElectron,
    onCheckService,
    onOpenSettings,
    onImportFinalShell,
    onRefreshServers,
  } = props;

  if (showServiceOfflineState) {
    return (
      <div className="workspace-startup-card">
        <div className="workspace-startup-icon" aria-hidden="true"><PlugZap size={20} strokeWidth={1.6} /></div>
        <strong>{isElectron ? "正在等待内置连接服务启动" : "本地连接服务未启动"}</strong>
        <span>{isElectron ? "安装版会自动拉起内置连接服务；恢复后页面会自动刷新服务器与目录状态。" : "网关未在 127.0.0.1:4040 运行；启动后导入 FinalShell 或手动添加服务器。"}</span>
        <div className="toolbar-inline workspace-startup-actions">
          <button className="ghost-button" type="button" onClick={() => void onCheckService()}>
            检查服务
          </button>
          <button className="ghost-button" type="button" onClick={() => onOpenSettings("connections")}>
            导入连接
          </button>
        </div>
      </div>
    );
  }

  if (showNoServerState) {
    return (
      <div className="workspace-startup-card">
        <div className="workspace-startup-icon" aria-hidden="true"><MousePointerClick size={20} strokeWidth={1.6} /></div>
        <strong>还没有服务器</strong>
        <span>导入 FinalShell 连接后，左侧会自动出现服务器列表。</span>
        <div className="toolbar-inline workspace-startup-actions">
          <button className="ghost-button" type="button" onClick={() => onOpenSettings("connections")}>
            导入连接
          </button>
          <button className="ghost-button" type="button" onClick={onImportFinalShell}>
            立即导入
          </button>
          <button className="ghost-button" type="button" onClick={() => void onRefreshServers()}>
            刷新列表
          </button>
        </div>
      </div>
    );
  }

  return null;
}
