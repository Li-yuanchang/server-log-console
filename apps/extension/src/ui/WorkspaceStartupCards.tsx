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
        <div className="workspace-startup-head">
          <strong>{isElectron ? "正在等待内置连接服务启动" : "本地连接服务未启动"}</strong>
          <span>{isElectron ? "安装版会自动拉起内置连接服务；恢复后页面会自动刷新服务器与目录状态。" : "步骤：1. 在项目根目录执行 npm run dev:gateway 2. 点击右侧\"检查服务\" 3. 服务就绪后导入 FinalShell 或手动添加服务器"}</span>
        </div>
        <div className="toolbar-inline">
          <button className="ghost-button" type="button" onClick={() => void onCheckService()}>
            检查服务
          </button>
          <button className="ghost-button" type="button" onClick={() => onOpenSettings("overview")}>
            连接设置
          </button>
        </div>
      </div>
    );
  }

  if (showNoServerState) {
    return (
      <div className="workspace-startup-card">
        <div className="workspace-startup-head">
          <strong>本地服务已启动，但还没有服务器</strong>
          <span>导入 FinalShell 连接后，左侧会自动出现服务器列表。</span>
        </div>
        <div className="toolbar-inline">
          <button className="ghost-button" type="button" onClick={() => onOpenSettings("overview")}>
            连接设置
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
