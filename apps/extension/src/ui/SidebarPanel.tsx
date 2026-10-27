import type { ServerSummary, ServerConnectionTestResponse } from "@server-log-console/shared";
import type { SettingsWorkspaceView } from "./ConnectionSettingsWorkspace.js";
import { Command as CommandIcon, ServerOff, FolderSearch } from "lucide-react";
import { ToolIcon } from "./ToolIcon.js";
import { formatKeyHint } from "./key-hints.js";
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
  onDeleteServer: (server: ServerSummary) => void;
  onOpenSettingsWorkspace: (view?: SettingsWorkspaceView) => void;
  onOpenPalette: () => void;
  onCloseSettingsWorkspace: () => void;
  hasPendingUpdate?: boolean;
  isBusy?: boolean;
  onRetryConnect?: () => void;
  onCheckService?: () => void;
};

export function SidebarPanel(props: SidebarPanelProps) {
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
    onDeleteServer,
    onOpenSettingsWorkspace,
    onCloseSettingsWorkspace,
    onOpenPalette,
    hasPendingUpdate,
    isBusy,
    onRetryConnect,
    onCheckService,
  } = props;

  /* 底部状态条五态（原型 empty-states-a-v2 第 10 屏）：
     warn 服务离线 > err 连接失败 > connecting 连接中 > ok 已连接 > idle 未连接
     （idle 文案 2026-10-06 用户确认：待命含义不清 → 未连接，并入「连接」词族） */

  return (
    <aside className="sidebar-panel">
      <div className="sidebar-head">
        <div className="sidebar-head-row">
          <div className="sidebar-head-title">
            <p className="eyebrow">日志控制台</p>
            <h1 className="topbar-title">
              {/* 标题文案按宿主区分（2026-10-23 用户反馈「Windows 标题栏已自带标题，
                  内部还要保留吗」）：
                  - Electron：窗口标题栏 / macOS 系统菜单栏 已经显示「日志控制台」，
                    侧栏再写一遍是纯冗余、还白占一行高度 → 改为「服务器」，
                    右侧原有的台数计数升为主体信息，既消除重复又有实际信息量。
                  - 浏览器（扩展侧栏 / 普通标签页）：应用内标题是唯一身份标识，保留原名。 */}
              {isElectron ? "服务器" : "日志控制台"}
              {servers.length > 0 ? <span className="sidebar-head-count">{servers.length} 台</span> : null}
            </h1>
          </div>
          <div className="sidebar-head-buttons">
            <button
              className="ghost-button icon-button"
              title={`命令面板 (${formatKeyHint("⌘K")})`}
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
        {/* 2026-10-21 用户要求：去掉搜索框上方的「服务器」标签行 ——
            标题已在顶部「日志控制台」承担，此行使搜索框上方多出一段空白与层级噪音。 */}
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

      {/* 左下「连接概览」状态卡已移除（2026-10-25 用户决策）。
          原因：① 内容展示不全 —— .st-kv 是 50px+1fr 网格 + nowrap/ellipsis，
                「本地服务/主机/路径」全被截成「连接服务已…」「root@192.16…」；
          ② 信息重复 —— 「已连接 + 服务器名」在底部状态栏、服务器列表高亮行、
                终端工具行已经各出现一次，这里第三次重复，还白占 6 行高度；
          ③ 27 台服务器的列表本来就需要滚动，竖向空间应优先给列表。
          连接状态与操作入口（重新连接 / 连接设置）统一由底部状态栏承担。 */}

      {/* 左下「操作记录」面板已彻底移除（2026-10-25 用户决策）。
          原因：① 占高 ~40%（默认 132px+ 可拖拽），把 27 台服务器列表挤到只剩几行；
                ② 内容与日志预览的调试面板（App.tsx recentActivityLines）完全重复 ——
                   同一份 activityLines 在两处展示；
                ③ 视觉噪音大：一组带边框/底色/圆角的列表，每条文字自动换行后
                   挤在一起，像堆了一排小卡片，与侧栏其它区域风格割裂；
                ④ 其中大部分是「系统已启动 / 已读取本地连接列表」这类开发期诊断信息，
                   对日常使用没有价值。
          操作反馈改由 toast（底部居中气泡）承担，那是既有的、非侵入的通道。 */}
    </aside>
  );
}
