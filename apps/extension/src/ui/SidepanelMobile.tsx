import { useState } from "react";
import type { ReactNode } from "react";
import type { ServerSummary, ServerConnectionTestResponse } from "@server-log-console/shared";
import type { SettingsWorkspaceView } from "./ConnectionSettingsWorkspace.js";
import { Command as CommandIcon, Copy, Ellipsis, Pencil, Trash2, ChevronDown, X, FileText, FolderOpen, TerminalSquare } from "lucide-react";
import { ToolIcon } from "./ToolIcon.js";

/* 侧栏（Chrome side panel）移动档共享组件。
   仅结构 + 契约 class 名（sp-appbar / srv-chip / sp-tabbar / sp-picker / sp-dir-sheet / sp-startup-cta），
   显隐与档位由 styles-sidepanel.css 的容器查询决定；组件本身不做任何宽度判断。
   契约见 docs/sidepanel-responsive-plan.md §3.2。 */

export type ServerGroupsListProps = {
  filteredGroupedServers: readonly (readonly [string, ServerSummary[]])[];
  serverId: string;
  connectionTestStatus: ServerConnectionTestResponse | null;
  onSelectServer: (id: string) => void;
  onDeleteServer: (server: ServerSummary) => void;
  onOpenSettingsWorkspace: (view?: SettingsWorkspaceView) => void;
  /* 列表为空时的空态（服务离线 / 无服务器），文案由调用方传入 */
  emptyState?: ReactNode;
};

/* SidebarPanel 服务器分组列表的原样抽取（server-item 悬浮快捷组 + server-item-menu 一并搬来），
   SidebarPanel 与 ServerPickerOverlay 共用，保证桌面侧栏视觉零变化。 */
export function ServerGroupsList(props: ServerGroupsListProps) {
  const [serverMenuId, setServerMenuId] = useState("");
  const {
    filteredGroupedServers,
    serverId,
    connectionTestStatus,
    onSelectServer,
    onDeleteServer,
    onOpenSettingsWorkspace,
    emptyState,
  } = props;

  if (!filteredGroupedServers.length) {
    return emptyState ? <>{emptyState}</> : null;
  }

  return (
    <>
      {filteredGroupedServers.map(([groupName, groupServers]) => (
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
                      onSelectServer(server.id);
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
                    {/* 重排（用户反馈 2026-10-06：hover/选中时三按钮 ≈100px 把名称/IP 挤成
                        "2.2..."/"192..." 半截信息）：只保留一个「更多 ⋯」按钮（≈28px），
                        名称与 host 基本完整可读。连接 = 点击行本身（原 ▶ 与行点击重复）；
                        编辑移入 ⋯ 菜单。 */}
                    <button
                      type="button"
                      className={`server-item-mini-action${serverMenuId === server.id ? " is-open" : ""}`}
                      title="更多操作"
                      aria-label={`${server.name} 更多操作`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setServerMenuId((current) => current === server.id ? "" : server.id);
                      }}
                    >
                      <Ellipsis size={12} strokeWidth={1.6} />
                    </button>
                    {serverMenuId === server.id ? (
                      <div className="server-item-menu" onClick={(event) => event.stopPropagation()}>
                        <button
                          type="button"
                          className="server-item-menu-item"
                          onClick={() => {
                            void navigator.clipboard?.writeText(`${server.username}@${server.host}:${server.port}`).catch(() => {});
                            setServerMenuId("");
                          }}
                        >
                          <Copy size={12} strokeWidth={1.8} /> 复制连接信息
                        </button>
                        <button
                          type="button"
                          className="server-item-menu-item"
                          onClick={() => {
                            setServerMenuId("");
                            onOpenSettingsWorkspace("connections");
                          }}
                        >
                          <Pencil size={12} strokeWidth={1.8} /> 编辑（设置中心）
                        </button>
                        {server.source ? (
                          <button
                            type="button"
                            className="server-item-menu-item server-item-menu-danger"
                            onClick={() => {
                              setServerMenuId("");
                              onDeleteServer(server);
                            }}
                          >
                            <Trash2 size={12} strokeWidth={1.8} /> 删除
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
          </div>
        </section>
      ))}
    </>
  );
}

export type ServerPickerOverlayProps = {
  open: boolean;
  onClose: () => void;
  serverFilter: string;
  onServerFilterChange: (value: string) => void;
  filteredGroupedServers: readonly (readonly [string, ServerSummary[]])[];
  serverId: string;
  connectionTestStatus: ServerConnectionTestResponse | null;
  onSelectServer: (id: string) => void;
  onDeleteServer: (server: ServerSummary) => void;
  onOpenSettingsWorkspace: (view?: SettingsWorkspaceView) => void;
  emptyState?: ReactNode;
  /** 连接概览（kv 行）：原底部 sp-statusbar 移除后并入选服层顶部（2026-10-04） */
  overview?: Array<[string, string]>;
};

/* 移动档整屏选服层（scrim + aside），宽档由 CSS display:none 隐藏，DOM 常驻。 */
export function ServerPickerOverlay(props: ServerPickerOverlayProps) {
  const {
    open,
    onClose,
    serverFilter,
    onServerFilterChange,
    filteredGroupedServers,
    serverId,
    connectionTestStatus,
    onSelectServer,
    onDeleteServer,
    onOpenSettingsWorkspace,
    emptyState,
    overview,
  } = props;

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="sp-picker-scrim" onClick={onClose} />
      <aside className="sp-picker" role="dialog" aria-modal="true" aria-label="选择服务器">
        <div className="sp-picker-head">
          <span className="sp-picker-title">选择服务器</span>
          <button
            type="button"
            className="ghost-button icon-button"
            title="关闭"
            aria-label="关闭服务器列表"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
        {overview?.length ? (
          <div className="sp-picker-overview">
            <div className="sp-picker-overview-hd">连接概览</div>
            <div className="sp-picker-overview-grid">
              {overview.map(([key, value]) => (
                <div key={key} className="sp-status-kv"><span>{key}</span><b>{value}</b></div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="sp-picker-filter">
          <input
            value={serverFilter}
            onChange={(event) => onServerFilterChange(event.target.value)}
            placeholder="输入名称、分组或地址"
          />
        </div>
        <div className="sp-picker-groups">
          <ServerGroupsList
            filteredGroupedServers={filteredGroupedServers}
            serverId={serverId}
            connectionTestStatus={connectionTestStatus}
            onSelectServer={onSelectServer}
            onDeleteServer={onDeleteServer}
            onOpenSettingsWorkspace={onOpenSettingsWorkspace}
            emptyState={emptyState}
          />
        </div>
      </aside>
    </>
  );
}

export type SidepanelMobileTopProps = {
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  showSettingsActive?: boolean;
  selectedServer: ServerSummary | null;
  connectionTestStatus: ServerConnectionTestResponse | null;
  onOpenServerPicker: () => void;
  /* 与 SidebarPanel sidebar-head-buttons 的 ToolIcon 主题保持一致 */
  uiTheme?: "classic" | "modern";
};

/* 顶栏 app bar（全档位）：chip = 服务器上下文 + 选服入口（v3 并入顶栏，砍掉独立 chip 行），
   命令面板/设置靠右。视图名不在此重复（移动档由底部 tab 承担、宽档由视图切换承担）。 */
export function SidepanelMobileTop(props: SidepanelMobileTopProps) {
  const {
    onOpenPalette,
    onOpenSettings,
    showSettingsActive,
    selectedServer,
    connectionTestStatus,
    onOpenServerPicker,
    uiTheme,
  } = props;

  return (
    <div className="sp-appbar">
      <button
        type="button"
        className="srv-chip"
        onClick={onOpenServerPicker}
        title="切换服务器"
        aria-label={selectedServer ? `当前服务器 ${selectedServer.name}，点击切换` : "选择服务器"}
      >
        <span className={`srv-chip-dot${selectedServer && connectionTestStatus?.connected ? " is-ok" : ""}`} />
        <span className="srv-chip-text">
          <span className="srv-chip-name">{selectedServer ? selectedServer.name : "选择服务器"}</span>
          {selectedServer ? (
            <span className="srv-chip-host">{selectedServer.username}@{selectedServer.host}</span>
          ) : null}
        </span>
        <ChevronDown className="srv-chip-caret" size={12} strokeWidth={1.8} aria-hidden="true" />
      </button>
      <span className="sp-top-sp" />
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
        title={showSettingsActive ? "关闭设置中心" : "打开设置中心"}
        onClick={onOpenSettings}
      >
        <ToolIcon theme={uiTheme} kind="settings" />
      </button>
    </div>
  );
}

export type SidepanelMobileTabBarProps = {
  activeView: "log" | "files" | "term";
  canOpenTerminal: boolean;
  hasServer: boolean;
  onLog: () => void;
  onFiles: () => void;
  onTerm: () => void;
};

/* 移动档底部 tab 导航：日志 / 文件 / 终端（终端仅 canOpenTerminal 时渲染）。 */
export function SidepanelMobileTabBar(props: SidepanelMobileTabBarProps) {
  const { activeView, canOpenTerminal, hasServer, onLog, onFiles, onTerm } = props;

  return (
    <nav className="sp-tabbar" aria-label="内容视图切换">
      <button
        type="button"
        className={`sp-tabbar-btn${activeView === "log" ? " is-active" : ""}`}
        aria-pressed={activeView === "log"}
        onClick={onLog}
        disabled={!hasServer}
      >
        <FileText size={16} strokeWidth={1.7} aria-hidden="true" />
        <span>日志</span>
      </button>
      <button
        type="button"
        className={`sp-tabbar-btn${activeView === "files" ? " is-active" : ""}`}
        aria-pressed={activeView === "files"}
        onClick={onFiles}
        disabled={!hasServer}
      >
        <FolderOpen size={16} strokeWidth={1.7} aria-hidden="true" />
        <span>文件</span>
      </button>
      {canOpenTerminal ? (
        <button
          type="button"
          className={`sp-tabbar-btn${activeView === "term" ? " is-active" : ""}`}
          aria-pressed={activeView === "term"}
          onClick={onTerm}
          disabled={!hasServer}
        >
          <TerminalSquare size={16} strokeWidth={1.7} aria-hidden="true" />
          <span>终端</span>
        </button>
      ) : null}
    </nav>
  );
}

export type DirectorySheetProps = {
  open: boolean;
  onClose: () => void;
  directoryPath: string;
  /* 已配好 props 的 <FileBrowserTreeColumn /> 元素，由调用方传入 */
  tree: ReactNode;
};

/* 移动档底部 sheet：目录树（FileBrowserTreeColumn 原样复用）。 */
export function DirectorySheet(props: DirectorySheetProps) {
  const { open, onClose, directoryPath, tree } = props;

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="sp-dir-scrim" onClick={onClose} />
      <aside className="sp-dir-sheet" role="dialog" aria-modal="true" aria-label="目录树">
        <span className="sp-dir-handle" aria-hidden="true" />
        <div className="sp-dir-head">
          <span className="sp-dir-path">{directoryPath || "/"}</span>
          <button
            type="button"
            className="ghost-button icon-button"
            title="关闭"
            aria-label="关闭目录树"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
        <div className="sp-dir-body">{tree}</div>
      </aside>
    </>
  );
}
