import { useState } from "react";
import type { ServerSummary, ServerConnectionTestResponse } from "@server-log-console/shared";
import type { SettingsWorkspaceView } from "./ConnectionSettingsWorkspace.js";
import { Command as CommandIcon } from "lucide-react";
import { ToolIcon } from "./ToolIcon.js";

export type SidebarPanelProps = {
  uiTheme?: "classic" | "modern";
  isElectron: boolean;
  showConnectionSettings: boolean;
  actionStatus: string;
  serverFilter: string;
  onServerFilterChange: (value: string) => void;
  servers: ServerSummary[];
  serverId: string;
  selectServerById: (id: string) => void;
  connectionTestStatus: ServerConnectionTestResponse | null;
  showServiceOfflineState: boolean;
  filteredGroupedServers: readonly (readonly [string, ServerSummary[]])[];
  localServiceStatusText: string;
  connectionStateText: string;
  selectedServer: ServerSummary | null;
  directoryPath: string;
  activityPanelHeight: number;
  activityPanelVisible: boolean;
  sidebarActivityLines: string[];
  onDeleteServer: (server: ServerSummary) => void;
  onOpenSettingsWorkspace: (view?: SettingsWorkspaceView) => void;
  onOpenPalette: () => void;
  onCloseSettingsWorkspace: () => void;
  onActivityPanelResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
};

export function SidebarPanel(props: SidebarPanelProps) {
  const [statusExpanded, setStatusExpanded] = useState(false);
  const {
    uiTheme,
    isElectron,
    showConnectionSettings,
    actionStatus,
    serverFilter,
    onServerFilterChange,
    servers,
    serverId,
    selectServerById,
    connectionTestStatus,
    showServiceOfflineState,
    filteredGroupedServers,
    localServiceStatusText,
    connectionStateText,
    selectedServer,
    directoryPath,
    activityPanelHeight,
    activityPanelVisible,
    sidebarActivityLines,
    onDeleteServer,
    onOpenSettingsWorkspace,
    onCloseSettingsWorkspace,
    onOpenPalette,
    onActivityPanelResizeStart,
  } = props;

  return (
    <aside className="sidebar-panel">
      <div className="sidebar-head">
        <div className="sidebar-head-row">
          <div className="sidebar-head-title">
            <p className="eyebrow">日志控制台</p>
            <h1 className="topbar-title">日志控制台</h1>
          </div>
          <div className="sidebar-head-buttons">
            <button
              className="ghost-button icon-button"
              title="命令面板 (Cmd+K)"
              aria-label="命令面板"
              onClick={onOpenPalette}
            >
              <CommandIcon size={14} strokeWidth={1.8} />
            </button>
            <button
              className="ghost-button icon-button"
              title={showConnectionSettings ? "关闭设置中心" : "打开设置中心"}
              onClick={() => {
                if (showConnectionSettings) {
                  onCloseSettingsWorkspace();
                  return;
                }
                onOpenSettingsWorkspace();
              }}
            >
              <ToolIcon theme={uiTheme} kind="settings" />
            </button>
          </div>
        </div>
        <p className="status-inline">{actionStatus}</p>
      </div>

      <section className="pane-section">
        <div className="pane-title-row"><strong className="pane-title">服务器</strong>{servers.length > 0 && <span>{servers.length} 台</span>}</div>
        <input
          value={serverFilter}
          onChange={(event) => onServerFilterChange(event.target.value)}
          placeholder="输入名称、分组或地址"
        />
      </section>

      <div className="server-groups pane-section">
        {showServiceOfflineState ? (
          <div className="empty-box sidebar-empty-box">
            <strong>{isElectron ? "正在等待内置连接服务启动" : "本地服务未启动"}</strong>
            <span>{isElectron ? "应用会自动重试连接本地服务；如果长时间没有恢复，我会继续排查安装版启动链路。" : "请在终端执行 npm run dev:gateway 启动本地连接服务，然后点击下方\"检查服务\"。"}</span>
          </div>
        ) : filteredGroupedServers.length ? (
          filteredGroupedServers.map(([groupName, groupServers]) => (
            <section key={groupName} className="server-group">
              <div className="server-group-title">{groupName}</div>
              <div className="server-list">
                {groupServers
                  .map((server) => (
                    <div key={server.id} className={`server-item-wrap ${server.id === serverId ? "server-item-wrap-active" : ""}`}>
                      <button
                        type="button"
                        className={`server-item ${server.id === serverId ? "server-item-active" : ""}`}
                        onClick={() => {
                          selectServerById(server.id);
                        }}
                      >
                        <span className={`server-status-dot ${server.id === serverId ? (connectionTestStatus?.connected ? "dot-connected" : "dot-pending") : "dot-idle"}`} />
                        <span className="server-item-main">
                          <strong>{server.name}</strong>
                          <span>{server.host}</span>
                        </span>
                        <span className="server-item-meta">{server.port}</span>
                      </button>
                      <div className="server-item-quick-actions" aria-label={`${server.name} 管理操作`}>
                        <button
                          type="button"
                          className="server-item-mini-action"
                          title="管理连接"
                          onClick={() => {
                            selectServerById(server.id);
                            onOpenSettingsWorkspace("connections");
                          }}
                        >
                          管理
                        </button>
                        {server.source ? (
                          <button
                            type="button"
                            className="server-item-mini-action server-item-mini-danger"
                            title="删除连接"
                            onClick={() => onDeleteServer(server)}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          ))
        ) : (
          <div className="empty-box sidebar-empty-box">
            <strong>还没有服务器</strong>
            <span>检查 FinalShell 目录后导入，或手动补录连接信息。</span>
          </div>
        )}
      </div>

      <div
        className={`status-card status-grid pane-section compact-connection-card sidebar-status${statusExpanded ? " sidebar-status-open" : ""}`}
        onClick={() => setStatusExpanded((v) => !v)}
        title={statusExpanded ? "收起连接概览" : "展开连接概览"}
      >
        {statusExpanded ? (
          <>
            <div className="pane-title">
              连接概览
              <span className="sidebar-status-collapse">收起</span>
            </div>
            <div className="status-row"><span>本地服务</span><strong>{localServiceStatusText}</strong></div>
            <div className="status-row"><span>服务器</span><strong>{connectionStateText}</strong></div>
            <div className="status-row"><span>主机</span><strong>{selectedServer ? `${selectedServer.username}@${selectedServer.host}` : "--"}</strong></div>
            <div className="status-row status-row-path"><span>路径</span><strong>{directoryPath || "/"}</strong></div>
          </>
        ) : (
          <div className="sidebar-status-summary">
            <span className={`sidebar-status-dot${selectedServer ? " on" : ""}`} />
            <span className="sidebar-status-sum">
              {selectedServer ? `${selectedServer.name} · ${selectedServer.username} · ${directoryPath || "/"}` : connectionStateText || "未连接"}
            </span>
            <span className="sidebar-status-toggle">详情</span>
          </div>
        )}
      </div>

      {activityPanelVisible ? (
      <section className="activity-panel pane-section compact-activity-panel" style={{ height: activityPanelHeight }}>
          <div
            className="activity-panel-resizer"
            onPointerDown={onActivityPanelResizeStart}
            role="separator"
            aria-orientation="horizontal"
            aria-label="调整操作记录高度"
          />
          <div className="browser-column-head pane-title-row">
            <strong className="pane-title">操作记录</strong>
            <span>{sidebarActivityLines.length} 条</span>
          </div>
          <div className="activity-log-list compact-activity-log-list">
            {sidebarActivityLines.map((line, index) => {
              const text = line.replace(/^\[[^\]]+\]\s*/, "");
              return (
                <div key={index} className="activity-log-line">
                  <span className="activity-log-msg">{text}</span>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
