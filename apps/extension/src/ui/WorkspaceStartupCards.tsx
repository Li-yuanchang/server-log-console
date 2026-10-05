import { PlugZap, MousePointerClick, Lightbulb, ShieldCheck } from "lucide-react";
import type { SettingsWorkspaceView } from "./ConnectionSettingsWorkspace.js";
import { localServiceBase } from "./api.js";
import { EmptyWorkbench } from "./EmptyWorkbench.js";

export type WorkspaceStartupCardsProps = {
  showServiceOfflineState: boolean;
  showNoServerState: boolean;
  isElectron: boolean;
  onCheckService: () => void;
  onOpenSettings: (view: SettingsWorkspaceView) => void;
  onImportFinalShell: () => void;
  onRefreshServers: () => void;
};

/* 启动期空态（服务离线 / 无服务器）→ 方案 A 引导式工作台
   （原型 empty-states-a-v2 06/07 屏；实施方案 2026-10-04 批②）。 */
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
      <EmptyWorkbench
        icon={<PlugZap size={13} strokeWidth={1.8} />}
        tipIcon={<Lightbulb size={12} strokeWidth={1.8} />}
        eyebrow="连接服务 · 离线"
        title={isElectron ? "正在等待内置连接服务启动" : "连接服务不可达"}
        sub={
          isElectron
            ? "安装版会自动拉起内置连接服务；恢复后页面会自动刷新服务器与目录状态。"
            : `连接服务未在 ${localServiceBase} 运行；启动后导入 FinalShell 或手动添加服务器。远程部署可在设置中心 → 连接服务 修改地址。`
        }
        steps={[
          { title: "等待服务就绪", desc: "自动重试，无需手动刷新", state: "wait" },
          {
            title: "检查服务",
            desc: "立即探测一次服务状态",
            actions: [{ label: "检查服务", kind: "pri", onClick: onCheckService }],
          },
          {
            title: "打开服务设置",
            desc: "修改服务地址或端口",
            actions: [{ label: "连接服务设置", kind: "ghost", onClick: () => onOpenSettings("gateway") }],
          },
        ]}
        panel={{
          title: "服务诊断",
          rows: [
            { title: "服务地址", meta: localServiceBase },
            { dot: "red", title: "状态", meta: "未响应 · 自动重试中" },
          ],
        }}
        tip={
          isElectron
            ? "长时间未恢复？检查安装目录是否完整，或是否有防火墙拦截本地端口。"
            : "可在终端执行 npm run dev:gateway 启动本地连接服务，然后点击「检查服务」。"
        }
      />
    );
  }

  if (showNoServerState) {
    return (
      <EmptyWorkbench
        icon={<MousePointerClick size={13} strokeWidth={1.8} />}
        tipIcon={<ShieldCheck size={12} strokeWidth={1.8} />}
        eyebrow="首次配置"
        title="还没有服务器"
        sub="从 FinalShell 一键导入连接，或手动新增；导入后左侧自动生成分组列表。"
        steps={[
          {
            title: "导入连接",
            desc: "识别 FinalShell 配置并生成分组",
            state: "cur",
            actions: [
              { label: "刷新列表", kind: "ghost", onClick: onRefreshServers },
              { label: "立即导入", kind: "pri", onClick: onImportFinalShell },
            ],
          },
          {
            title: "手动新增",
            desc: "逐台填写主机与凭证",
            actions: [{ label: "连接设置", kind: "ghost", onClick: () => onOpenSettings("connections") }],
          },
          { title: "选择服务器开始使用", desc: "连接后即可浏览目录与查看日志" },
        ]}
        panel={{
          title: "支持的导入来源",
          rows: [
            { dot: "ok", title: "FinalShell", meta: "自动识别连接与分组", action: "导入", onAction: onImportFinalShell },
            { dot: "idle", title: "手动新增", meta: "逐台填写主机与凭证", action: "新增", onAction: () => onOpenSettings("connections") },
          ],
        }}
        tip="导入只读取配置文件，不会改动或上传原始数据。"
      />
    );
  }

  return null;
}
