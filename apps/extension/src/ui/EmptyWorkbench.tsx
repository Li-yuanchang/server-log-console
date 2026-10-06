import React from "react";
import { ChevronDown } from "lucide-react";

/* ============================================================
   EmptyWorkbench — 大屏空态统一组件（方案 A「引导式工作台」定稿）
   原型：docs/prototypes/empty-states-a-v2.html（01-07 屏）
   方案：docs/ui-redesign-2026-09/空状态与状态条实施方案-2026-10-04.md §2

   结构：eyebrow → 标题 → 副文案 →（连接中 live 行）→ 步骤时间线 → 键位行
         右栏 = 情境面板 + 提示卡（无数据源的场景不渲染，见方案偏差③）
   窄档（容器查询 slc-sp ≤799.9px，样式见 styles-empty-workbench.css）：
   右栏/键位隐藏，panel.rows 降级为 chips 行，主按钮可全宽（footerNarrow）。
   ============================================================ */

export type EmptyWbStepAction = {
  label: string;
  kind?: "pri" | "ghost";
  onClick?: () => void;
  disabled?: boolean;
};

export type EmptyWbStep = {
  title: string;
  desc: string;
  state?: "cur" | "wait" | "done";
  actions?: EmptyWbStepAction[];
};

export type EmptyWbRow = {
  dot?: "ok" | "idle" | "red" | "warn";
  title: string;
  meta?: string;
  action?: string;
  onAction?: () => void;
  onClick?: () => void;
};

export type EmptyWbPanel = {
  title: string;
  link?: string;
  onLink?: () => void;
  rows: EmptyWbRow[];
};

export type EmptyWorkbenchProps = {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  sub: string;
  steps: EmptyWbStep[];
  /** 连接中 / 等待类的 mono 实时状态行（自动带打点动画） */
  live?: string;
  /** 键位行（触屏窄档由 CSS 隐藏） */
  keys?: Array<{ kbd: string; label: string }>;
  /** 右栏情境面板 */
  panel?: EmptyWbPanel;
  /** 右栏提示卡内容 */
  tip?: React.ReactNode;
  tipIcon?: React.ReactNode;
  /** 窄档专用主行动（宽档隐藏；如 SP 档「选择服务器」全宽按钮） */
  footerNarrow?: React.ReactNode;
  /** 附加根类名（宿主定位用，如终端容器内的绝对定位） */
  className?: string;
};

function StepActions({ actions }: { actions?: EmptyWbStepAction[] }) {
  if (!actions?.length) return <span className="empty-wb-arr">→</span>;
  return (
    <span className="empty-wb-step-acts">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={`ghost-button${action.kind === "pri" ? " confirm-btn-primary" : ""}`}
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </button>
      ))}
    </span>
  );
}

export function EmptyWorkbench(props: EmptyWorkbenchProps) {
  const { icon, eyebrow, title, sub, steps, live, keys, panel, tip, tipIcon, footerNarrow, className } = props;
  const chipRows = panel?.rows.slice(0, 3) ?? [];

  return (
    <div className={`empty-wb${className ? ` ${className}` : ""}`}>
      <div className={`empty-wb-grid${panel ? "" : " no-side"}`}>
        <div>
          <span className="empty-wb-eyebrow rv d1">
            {icon}
            {eyebrow}
          </span>
          <div className="empty-wb-title rv d2">{title}</div>
          <p className="empty-wb-sub rv d3">{sub}</p>
          {live ? (
            <div className="empty-wb-live rv d3">
              <span className="live-dot" aria-hidden="true" />
              <span className="live-text">{live}</span>
              <span className="live-ellipsis" aria-hidden="true" />
            </div>
          ) : null}
          <div className="empty-wb-steps rv d4">
            {steps.map((step, index) => (
              <div
                key={`${index}-${step.title}`}
                className={`empty-wb-step${step.state === "cur" ? " is-cur" : ""}${step.state === "wait" ? " is-wait" : ""}`}
              >
                {step.state === "done" ? (
                  <span className="empty-wb-num is-done" aria-hidden="true">✓</span>
                ) : step.state === "wait" ? (
                  /* 进行中：只渲染 spinner（::before），数字若同格会掉到圈外（用户反馈 2026-10-05） */
                  <span className="empty-wb-num is-wait" aria-hidden="true" />
                ) : (
                  <span className="empty-wb-num" aria-hidden="true">{index + 1}</span>
                )}
                <div className="empty-wb-step-tx">
                  <b>{step.title}</b>
                  <span>{step.desc}</span>
                </div>
                <StepActions actions={step.actions} />
              </div>
            ))}
          </div>
          {footerNarrow ? <div className="empty-wb-footer-narrow rv d5">{footerNarrow}</div> : null}
          {chipRows.length ? (
            <div className="empty-wb-chips rv d5">
              {chipRows.map((row, index) => (
                <button
                  key={`${index}-${row.title}`}
                  type="button"
                  className="chip"
                  onClick={row.onClick ?? row.onAction}
                  title={row.meta}
                >
                  {row.dot && row.dot !== "idle" ? <span className="chip-dot" aria-hidden="true" /> : row.dot === "idle" ? <span className="chip-dot idle" aria-hidden="true" /> : null}
                  <span className="chip-text">{row.title}</span>
                </button>
              ))}
            </div>
          ) : null}
          {keys?.length ? (
            <div className="empty-wb-keys rv d5">
              {keys.map((key) => (
                <span key={key.kbd}>
                  <kbd>{key.kbd}</kbd>
                  {key.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {panel || tip ? (
          <aside className="empty-wb-side rv d6">
            {panel ? (
              <div className="empty-wb-panel">
                <div className="empty-wb-panel-hd">
                  <span>{panel.title}</span>
                  {panel.link ? (
                    <button type="button" className="empty-wb-panel-link" onClick={panel.onLink}>
                      {panel.link}
                    </button>
                  ) : null}
                </div>
                {panel.rows.map((row, index) => (
                  <div
                    key={`${index}-${row.title}`}
                    className="empty-wb-row"
                    onClick={row.onClick}
                    role={row.onClick ? "button" : undefined}
                  >
                    {row.dot ? <span className={`row-dot${row.dot === "ok" ? "" : ` ${row.dot}`}`} aria-hidden="true" /> : null}
                    <div className="row-main">
                      <span className="row-title">
                        <span className="row-title-text">{row.title}</span>
                      </span>
                      {row.meta ? <span className="row-meta">{row.meta}</span> : null}
                    </div>
                    {row.action ? (
                      <span
                        className="row-act"
                        onClick={(event) => {
                          if (!row.onAction) return;
                          event.stopPropagation();
                          row.onAction();
                        }}
                      >
                        {row.action}
                      </span>
                    ) : row.onClick || row.onAction ? (
                      <ChevronDown className="row-act" size={11} strokeWidth={1.8} aria-hidden="true" />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {tip ? (
              <div className="empty-wb-tip">
                <span className="tip-ic" aria-hidden="true">
                  {tipIcon}
                </span>
                <div>{tip}</div>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
