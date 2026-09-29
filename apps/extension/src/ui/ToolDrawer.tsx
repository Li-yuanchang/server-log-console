import type { ReactNode } from "react";
import { AppWindow, Cpu, GitCompare, Plug, Zap } from "lucide-react";
import { Drawer } from "./Drawer.js";

export type UtilityPanelType = "compare" | "tunnels" | "batch" | "status";

const PANEL_ORDER: UtilityPanelType[] = ["tunnels", "batch", "status", "compare"];

const PANEL_META: Record<UtilityPanelType, { label: string; icon: typeof Plug; unavailableHint: string }> = {
  tunnels: {
    label: "隧道",
    icon: Plug,
    unavailableHint: "选择服务器后可用",
  },
  batch: {
    label: "批量",
    icon: Zap,
    unavailableHint: "无可用服务器",
  },
  status: {
    label: "监控",
    icon: Cpu,
    unavailableHint: "选择服务器后可用",
  },
  compare: {
    label: "对比",
    icon: GitCompare,
    unavailableHint: "打开检索结果后可用",
  },
};

interface ToolDrawerProps {
  open: boolean;
  activePanel: UtilityPanelType;
  /** 当前可用的面板集合；不在集合内的分段按钮禁用 */
  panels: UtilityPanelType[];
  onSelectPanel: (panel: UtilityPanelType) => void;
  onClose: () => void;
  onPopout?: () => void;
  children: ReactNode;
}

// 右侧工具抽屉：承载 SSH 隧道 / 批量执行 / 服务器监控 / 本地对比四个面板（非模态，无遮罩）
export function ToolDrawer({ open, activePanel, panels, onSelectPanel, onClose, onPopout, children }: ToolDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      title="工具"
      headExtra={
        <>
          <div className="tool-drawer-seg" role="tablist" aria-label="工具面板切换">
            {PANEL_ORDER.map((panel) => {
              const meta = PANEL_META[panel];
              const Icon = meta.icon;
              const available = panels.includes(panel);
              const active = panel === activePanel;
              return (
                <button
                  key={panel}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={active ? "on" : undefined}
                  disabled={!available}
                  title={available ? meta.label : meta.unavailableHint}
                  onClick={() => onSelectPanel(panel)}
                >
                  <Icon size={12} strokeWidth={1.9} />
                  <span>{meta.label}</span>
                </button>
              );
            })}
          </div>
          {onPopout ? (
            <button
              type="button"
              className="ghost-button icon-button tool-drawer-popout"
              title="弹出为独立窗口"
              aria-label="弹出为独立窗口"
              onClick={onPopout}
            >
              <AppWindow size={14} strokeWidth={1.8} />
            </button>
          ) : null}
        </>
      }
    >
      <div className="tool-drawer-body">{children}</div>
    </Drawer>
  );
}
