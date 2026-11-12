import { PlugZap, MousePointerClick } from "lucide-react";
import type { SettingsWorkspaceView } from "./ConnectionSettingsWorkspace.js";
import { localServiceBase } from "./api.js";
import { LogEmptyState, StageMarkRack } from "./LogEmptyState.js";

export type WorkspaceStartupCardsProps = {
  showServiceCheckingState: boolean;
  showServiceOfflineState: boolean;
  showNoServerState: boolean;
  isElectron: boolean;
  onCheckService: () => void;
  onOpenSettings: (view: SettingsWorkspaceView) => void;
  onImportFinalShell: () => void;
  onRefreshServers: () => void;
};

/* 启动期空态（服务就绪中 / 服务离线 / 无服务器）→ LogEmptyState 统一 halo 骨架
   （v4.1 06 页 + L1.1：EmptyWorkbench 退役，服务诊断面板收进 chip，时间线收成步骤行） */
export function WorkspaceStartupCards(props: WorkspaceStartupCardsProps) {
  const {
    showServiceCheckingState,
    showServiceOfflineState,
    showNoServerState,
    isElectron,
    onCheckService,
    onOpenSettings,
    onImportFinalShell,
  } = props;

  if (showServiceCheckingState) {
    /* L1.1（2026-11-02）：splash 超时放行后的兜底态 —— checking 期间主区不再抢跑教学位 */
    return (
      <LogEmptyState
        icon={<PlugZap />}
        live
        align="ed"
        watermark={<StageMarkRack />}
        liveBar
        title="正在连接本地服务"
        sub="启动页结束后服务仍在就绪中；就绪后自动刷新服务器与目录状态，无需手动操作。"
        steps={[{ t: "探测服务", cur: true }, { t: "加载服务器" }]}
        chip={<>自动重试<i className="lp3-ellip" aria-hidden="true" /></>}
      />
    );
  }

  if (showServiceOfflineState) {
    return (
      <LogEmptyState
        icon={<PlugZap />}
        live
        align="ed"
        watermark={<StageMarkRack />}
        title="连接服务离线"
        sub={isElectron
          ? "内置连接服务未响应，恢复后会自动刷新服务器与目录状态，无需手动重试。"
          : `连接服务未在 ${localServiceBase} 运行；启动后导入 FinalShell 或手动添加服务器。远程部署可在设置中心 → 连接服务 修改地址。`}
        acts={[
          { label: "连接服务设置", onClick: () => onOpenSettings("gateway") },
          { label: "检查服务", kind: "pri", onClick: onCheckService },
        ]}
        chip={<>{localServiceBase}<span className="lp3-sep">·</span>未响应 · 自动重试中<i className="lp3-ellip" aria-hidden="true" /></>}
      />
    );
  }

  if (showNoServerState) {
    return (
      <LogEmptyState
        icon={<MousePointerClick />}
        align="ed"
        watermark={<StageMarkRack />}
        title="还没有服务器"
        sub="从 FinalShell 一键导入连接，或手动新增；导入后左侧自动生成分组列表。"
        acts={[
          { label: "手动新增", onClick: () => onOpenSettings("connections") },
          { label: "导入 FinalShell", kind: "pri", onClick: onImportFinalShell },
        ]}
        steps={[{ t: "导入连接", cur: true }, { t: "浏览目录" }, { t: "查看日志" }]}
        chip={<>导入只读配置<span className="lp3-sep">·</span>不改动原始数据</>}
      />
    );
  }

  return null;
}
