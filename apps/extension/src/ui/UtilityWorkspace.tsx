import type { ReactNode } from "react";
import { AppWindow, GitCompare, Plug, TerminalSquare, X } from "lucide-react";
import { useEscapeToClose } from "./useEscapeToClose.js";

export type UtilityPanelType = "compare" | "tunnels" | "batch";

interface UtilityWorkspaceProps {
  activePanel: UtilityPanelType;
  panels: UtilityPanelType[];
  onSelectPanel: (panel: UtilityPanelType) => void;
  onClose: () => void;
  onPopout?: () => void;
  standalone?: boolean;
  children: ReactNode;
}

const PANEL_META: Record<UtilityPanelType, { eyebrow: string; label: string; subtitle: string; icon: typeof GitCompare }> = {
  compare: {
    eyebrow: "COMPARE",
    label: "本地对比",
    subtitle: "选择本地文件与远程内容对比差异",
    icon: GitCompare,
  },
  tunnels: {
    eyebrow: "TUNNELS",
    label: "SSH 隧道",
    subtitle: "在当前服务器旁路管理本地端口映射",
    icon: Plug,
  },
  batch: {
    eyebrow: "BATCH",
    label: "批量执行",
    subtitle: "对多台服务器并行下发命令并汇总结果",
    icon: TerminalSquare,
  },
};

export function UtilityWorkspace({ activePanel, panels, onSelectPanel, onClose, onPopout, standalone = false, children }: UtilityWorkspaceProps) {
  const activeMeta = PANEL_META[activePanel];
  useEscapeToClose(true, onClose);

  return (
    <section className={`utility-workspace${standalone ? " utility-workspace-standalone" : ""}`}>
      <div className="utility-workspace-topbar">
        <div className="utility-workspace-titleblock">
          <span className="utility-workspace-eyebrow">{activeMeta.eyebrow}</span>
          <strong>{activeMeta.label}</strong>
          <span className="utility-workspace-subtitle">{activeMeta.subtitle}</span>
        </div>
        <div className="utility-workspace-actions">
          {onPopout ? (
            <button className="ghost-button icon-button" type="button" onClick={onPopout} title="弹出附属窗口">
              <AppWindow size={14} />
            </button>
          ) : null}
          <button className="ghost-button icon-button" type="button" onClick={onClose} title={standalone ? "关闭窗口" : "关闭工具面板"}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="utility-workspace-tabs" style={{ gridTemplateColumns: `repeat(${Math.max(1, panels.length)}, minmax(0, 1fr))` }}>
        {panels.map((panel) => {
          const meta = PANEL_META[panel];
          const Icon = meta.icon;
          return (
            <button
              key={panel}
              type="button"
              className={panel === activePanel ? "utility-workspace-tab utility-workspace-tab-active" : "utility-workspace-tab"}
              onClick={() => onSelectPanel(panel)}
            >
              <Icon size={13} />
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>

      <div className="utility-workspace-body">
        {children}
      </div>
    </section>
  );
}
