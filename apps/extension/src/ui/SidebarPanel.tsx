import { useState } from "react";
import type { ServerSummary, ServerConnectionTestResponse } from "@server-log-console/shared";
import type { SettingsWorkspaceView } from "./ConnectionSettingsWorkspace.js";
import { Command as CommandIcon, ServerOff, FolderSearch } from "lucide-react";
import { ToolIcon } from "./ToolIcon.js";
import { ServerGroupsList } from "./SidepanelMobile.js";

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
  hasPendingUpdate?: boolean;
  isBusy?: boolean;
  onRetryConnect?: () => void;
  onCheckService?: () => void;
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
    hasPendingUpdate,
    isBusy,
    onRetryConnect,
    onCheckService,
  } = props;

  /* 底部状态条五态（原型 empty-states-a-v2 第 10 屏）：
     warn 服务离线 > err 连接失败 > connecting 连接中 > ok 已连接 > idle 待命 */
  const statusState: "idle" | "connecting" | "ok" | "err" | "warn" = showServiceOfflineState
    ? "warn"
    : selectedServer && connectionTestStatus && !connectionTestStatus.connected && !isBusy
      ? "err"
      : selectedServer && !connectionTestStatus?.connected
        ? "connecting"
        : selectedServer && connectionTestStatus?.connected
          ? "ok"
          : "idle";
  const statusWord = { idle: "待命", connecting: "连接中", ok: "已连接", err: "连接失败", warn: "服务离线" }[statusState];
  const statusObj = statusState === "ok" || statusState === "connecting" ? selectedServer?.name ?? "" : "";
  const statusL2 =
    statusState === "idle" ? (
      "选择服务器后自动连接"
    ) : statusState === "connecting" ? (
      <>
        <span className="st-mini-spin" aria-hidden="true" />
        <span className="mono">{actionStatus || `SSH 握手中 · ${selectedServer?.name ?? ""}`}</span>
      </>
    ) : statusState === "ok" ? (
      <span className="mono">{`${selectedServer?.username ?? ""}@${selectedServer?.host ?? ""}:${selectedServer?.port ?? ""} · ${directoryPath || "/"}`}</span>
    ) : statusState === "err" ? (
      <>
        <span className="mono">{selectedServer ? `${selectedServer.host}:${selectedServer.port}` : ""}</span>
        <span>{connectionTestStatus?.message || "连接失败"}</span>
        {onRetryConnect ? (
          <button
            type="button"
            className="st-inline-act"
            onClick={(event) => {
              event.stopPropagation();
              onRetryConnect();
            }}
          >
            重试
          </button>
        ) : null}
      </>
    ) : (
      <>
        <span>自动重试中</span>
        {onCheckService ? (
          <button
            type="button"
            className="st-inline-act"
            onClick={(event) => {
              event.stopPropagation();
              onCheckService();
            }}
          >
            检查
          </button>
        ) : null}
      </>
    );

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
              className="ghost-button icon-button settings-gear-button"
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
              {hasPendingUpdate ? <span className="settings-gear-badge" aria-label="有新版本可更新" /> : null}
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
            {/* S12 原型空态模板：44×44 描边图标 + 一句话 + 主按钮 */}
            <span className="empty-box-icon" aria-hidden="true">
              <ServerOff size={18} strokeWidth={1.8} />
            </span>
            <strong>{isElectron ? "正在等待内置连接服务启动" : "本地服务未启动"}</strong>
            <span>{isElectron ? "应用会自动重试连接本地服务；如果长时间没有恢复，我会继续排查安装版启动链路。" : "请在终端执行 npm run dev:gateway 启动本地连接服务，然后点击下方\"检查服务\"。"}</span>
          </div>
        ) : (
          /* 服务器分组列表抽取为共享组件（SidepanelMobile.tsx），选服层复用同一渲染 */
          <ServerGroupsList
            filteredGroupedServers={filteredGroupedServers}
            serverId={serverId}
            connectionTestStatus={connectionTestStatus}
            onSelectServer={selectServerById}
            onDeleteServer={onDeleteServer}
            onOpenSettingsWorkspace={onOpenSettingsWorkspace}
            emptyState={
              <div className="empty-box sidebar-empty-box">
                <span className="empty-box-icon" aria-hidden="true">
                  <FolderSearch size={18} strokeWidth={1.8} />
                </span>
                <strong>还没有服务器</strong>
                <span>检查 FinalShell 目录后导入，或手动补录连接信息。</span>
              </div>
            }
          />
        )}
      </div>

      <div
        className={`status-card status-grid pane-section compact-connection-card sidebar-status st-${statusState}${statusExpanded ? " sidebar-status-open" : ""}`}
        onClick={() => setStatusExpanded((v) => !v)}
        title={statusExpanded ? "收起连接概览" : "展开连接概览"}
      >
        <span className="st-progress" aria-hidden="true" />
        {statusExpanded ? (
          <div className="st-open">
            <div className="st-open-hd">
              <span>连接概览</span>
              <span
                className="st-collapse"
                onClick={(event) => {
                  event.stopPropagation();
                  setStatusExpanded(false);
                }}
              >
                收起
              </span>
            </div>
            <div className="st-kv">
              <span>本地服务</span>
              <b className="sans">{localServiceStatusText}</b>
              <span>服务器</span>
              <b className="sans">{selectedServer ? `${selectedServer.name} · ${connectionStateText || "--"}` : "--"}</b>
              <span>主机</span>
              <b>{selectedServer ? `${selectedServer.username}@${selectedServer.host}:${selectedServer.port}` : "--"}</b>
              <span>路径</span>
              <b>{directoryPath || "/"}</b>
            </div>
            <div className="st-acts">
              {statusState === "err" && onRetryConnect ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRetryConnect();
                  }}
                >
                  重试
                </button>
              ) : null}
              {statusState === "ok" && onRetryConnect ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRetryConnect();
                  }}
                >
                  重新连接
                </button>
              ) : null}
              {statusState === "warn" && onCheckService ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCheckService();
                  }}
                >
                  检查服务
                </button>
              ) : null}
              <button
                type="button"
                className="ghost-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenSettingsWorkspace("connections");
                }}
              >
                连接设置
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="st-l1">
              <span className="st-dot" aria-hidden="true" />
              <span className="st-word">{statusWord}</span>
              {statusObj ? <span className="st-obj">{statusObj}</span> : null}
              <span className="st-chev" aria-hidden="true">▾</span>
            </div>
            <div className="st-l2">{statusL2}</div>
          </>
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
