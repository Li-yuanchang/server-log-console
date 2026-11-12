import type { ReactNode } from "react";

/* ============================================================
   LogEmptyState — 日志预览空态 / 静默占位（定稿 v4.1）
   原型：docs/prototypes/log-preview-empty-v4-2026-11.html
   形态：A3 无卡光晕 —— 徽章(62) → 标题 → 副文案 → 动作 ≤2(胶囊) → chip(mono)
   · 幽灵行(bars) 仅「未选文件 · 未检索」装饰位；live = 呼吸 + 波纹（进行中语义）
   · chip / 相位 / 统计一律由调用方传真实字段，不写死示范值
   · loading 与空占位互斥：加载期不渲染本组件（见 file-loading 分支）
   样式：styles-empty-state.css（lp3- / lg- 独立前缀，token 全 var(--*)）
   ============================================================ */

export type LogEmptyStateAct = {
  label: string;
  kind?: "pri" | "ghost";
  onClick?: () => void;
  disabled?: boolean;
};

/** 流程性空态的内联步骤行（≤3 步，编号胶囊；EmptyWorkbench 时间线的退役形态） */
export type LogEmptyStateStep = { t: string; cur?: boolean };

export type LogEmptyStateProps = {
  icon: ReactNode;
  title: ReactNode;
  sub: ReactNode;
  acts?: LogEmptyStateAct[];
  /** mono 状态 chip：语法提示 / 命中统计 / tail 命令 / 相位等真实字段 */
  chip?: ReactNode;
  /** 进行中语义：徽章呼吸 + 波纹双环（live chip 文本由调用方拼接，结尾加 <i className="lp3-ellip" />） */
  live?: boolean;
  /** 幽灵行装饰（仅「未选文件 · 未检索」） */
  bars?: boolean;
  /** 流程性空态：内联步骤行 */
  steps?: LogEmptyStateStep[];
  /** 流程性空态：情境扩展区（如快速连接结构化行列表） */
  extra?: ReactNode;
  /** 宿主定位附加类（如终端容器内绝对定位 in-terminal） */
  className?: string;
  /** editorial 变体（2026-11-12 实装）：左对齐内容列 + 极光舞台底；缺省 = 居中（PiP/小窗） */
  align?: "ed";
  /** 功能区水印线稿（editorial 变体右下角装饰，由调用方按情境选择） */
  watermark?: ReactNode;
  /** livebar 细进度线：进行中空态的 loading 语言（退役 spinner） */
  liveBar?: boolean;
  /** 快捷键键帽：紧贴主按钮右侧（就近提示，如 ⌘K / Ctrl K） */
  kbdHint?: string;
};

export function LogEmptyState(props: LogEmptyStateProps) {
  const { icon, title, sub, acts, chip, live = false, bars = false, steps, extra, className, align, watermark, liveBar, kbdHint } = props;
  return (
    <div className={`lp3${align === "ed" ? " ed" : ""}${className ? ` ${className}` : ""}`} role="status">
      {watermark}
      <div className="lp3-inner">
        <span className="lp3-icwrap" aria-hidden="true">
          <span className={`lp3-ic${live ? " lp3-ic-live" : ""}`}>{icon}</span>
          {live ? <span className="lp3-ring" /> : null}
        </span>
        <div className="lp3-title">{title}</div>
        <p className="lp3-sub">{sub}</p>
        {acts && acts.length ? (
          <div className="lp3-acts">
            {acts.map((act) => (
              <button
                key={act.label}
                type="button"
                className={`btn2${act.kind === "pri" ? " btn2-pri" : ""}`}
                onClick={act.onClick}
                disabled={act.disabled}
              >
                {act.label}
              </button>
            ))}
            {kbdHint ? <span className="lp3-kbd" aria-label={kbdHint}>{kbdHint}</span> : null}
          </div>
        ) : null}
        {steps && steps.length ? (
          <div className="lp3-steps">
            {steps.map((step, index) => (
              <span key={`${index}-${step.t}`} className={`lp3-step${step.cur ? " lp3-step-cur" : ""}`}>
                <i aria-hidden="true">{index + 1}</i>
                {step.t}
              </span>
            ))}
          </div>
        ) : null}
        {liveBar ? <span className="lp3-livebar" aria-hidden="true"><i /></span> : null}
        {extra}
        {bars ? (
          <div className="lp3-fade" aria-hidden="true">
            <i style={{ width: "72%", opacity: 0.9 }} />
            <i style={{ width: "46%", opacity: 0.5 }} />
            <i style={{ width: "58%", opacity: 0.7 }} />
          </div>
        ) : null}
        {chip ? (
          <span className="lp3-chip">
            <span className="lp3-chip-t">{chip}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* LogoLoader —— 统一 logo 加载语言（L1.0 启动页 / L3.0 文件加载 / L4.2 重启遮罩共用）：
   徽标 = icon.svg 的「severity 点 + 消息条」三行日志行，波纹双环 2.6s；
   全程亮底、无 spinner（各屏唯一动效源 = 徽标呼吸 + 波纹） */
export function LogoLoader({ small = false }: { small?: boolean }) {
  return (
    <span className="lg-rip" aria-hidden="true">
      <span className={`lg-mark${small ? " lg-mark-sm" : ""}`}>
        <span className="lg-row"><i className="lg-dot lg-dot-g" /><i className="lg-bar" style={{ width: "64%" }} /></span>
        <span className="lg-row"><i className="lg-dot lg-dot-a" /><i className="lg-bar" style={{ width: "46%" }} /></span>
        <span className="lg-row"><i className="lg-dot lg-dot-r" /><i className="lg-bar" style={{ width: "55%" }} /></span>
      </span>
      <i className="lg-ring" />
      <i className="lg-ring lg-ring-2" />
    </span>
  );
}

/* ============================================================
   功能区水印线稿（editorial 变体右下角装饰，原型 empty-states-full-8 的 stagemark）
   · 语义随情境：日志窗 / 目录树 / 服务器机架 / 终端提示符；色 = var(--accent) 由 CSS 控制
   · 2026-11-12 统一刻度：圆角收敛（rx 9/6，Boss：大圆角不好看）、
     内部构图统一占满 220×170 视窗（此前机架/目录树偏小，四稿有大有小）
   · 纯装饰 aria-hidden，定位与尺寸由 .lp3-mark 承担
   ============================================================ */
export function StageMarkLog() {
  return (
    <svg className="lp3-mark" viewBox="0 0 220 170" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="212" height="162" rx="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="4" fill="currentColor" opacity=".5" />
      <circle cx="38" cy="24" r="4" fill="currentColor" opacity=".32" />
      <circle cx="52" cy="24" r="4" fill="currentColor" opacity=".18" />
      <line x1="4" y1="38" x2="216" y2="38" stroke="currentColor" strokeWidth="1.5" opacity=".8" />
      <circle cx="26" cy="62" r="3.5" fill="currentColor" opacity=".45" />
      <rect x="38" y="58" width="112" height="8" rx="4" fill="currentColor" opacity=".26" />
      <circle cx="26" cy="86" r="3.5" fill="currentColor" opacity=".36" />
      <rect x="38" y="82" width="74" height="8" rx="4" fill="currentColor" opacity=".18" />
      <circle cx="26" cy="110" r="3.5" fill="currentColor" opacity=".42" />
      <rect x="38" y="106" width="94" height="8" rx="4" fill="currentColor" opacity=".22" />
      <rect x="38" y="130" width="9" height="14" rx="2.5" fill="currentColor" opacity=".5" />
      <rect x="51" y="133" width="62" height="8" rx="4" fill="currentColor" opacity=".14" />
    </svg>
  );
}

export function StageMarkFolder() {
  return (
    <svg className="lp3-mark" viewBox="0 0 220 170" fill="none" aria-hidden="true">
      {/* 等比放大 1.22（描边不缩放，vector-effect 锁 1.5px），与日志窗/机架同视觉量级 */}
      <g transform="translate(110,85) scale(1.22) translate(-110,-85)">
        <path d="M18 138V52a10 10 0 0 1 10-10h40l14 14h84a10 10 0 0 1 10 10v72a10 10 0 0 1-10 10H28a10 10 0 0 1-10-10Z" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <circle cx="40" cy="86" r="3.5" fill="currentColor" opacity=".5" />
        <rect x="50" y="82" width="96" height="8" rx="4" fill="currentColor" opacity=".26" />
        <circle cx="40" cy="106" r="3.5" fill="currentColor" opacity=".36" />
        <rect x="50" y="102" width="70" height="8" rx="4" fill="currentColor" opacity=".18" />
        <rect x="150" y="34" width="52" height="64" rx="6" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" opacity=".7" />
        <rect x="158" y="46" width="36" height="6" rx="3" fill="currentColor" opacity=".22" />
        <rect x="158" y="58" width="28" height="6" rx="3" fill="currentColor" opacity=".16" />
        <rect x="158" y="70" width="32" height="6" rx="3" fill="currentColor" opacity=".2" />
        <rect x="120" y="146" width="72" height="10" rx="5" fill="currentColor" opacity=".12" />
        <rect x="30" y="146" width="72" height="10" rx="5" fill="currentColor" opacity=".1" />
      </g>
    </svg>
  );
}

export function StageMarkRack() {
  return (
    <svg className="lp3-mark" viewBox="0 0 220 170" fill="none" aria-hidden="true">
      {/* 2026-11-12 重绘：外框 196×158 铺满视窗（原 172×154 偏小），圆角收敛 rx 9/6 */}
      <rect x="12" y="6" width="196" height="158" rx="9" stroke="currentColor" strokeWidth="1.5" />
      <rect x="28" y="22" width="164" height="34" rx="6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="44" cy="39" r="4.5" fill="currentColor" opacity=".5" />
      <rect x="58" y="35" width="86" height="7" rx="3" fill="currentColor" opacity=".24" />
      <rect x="58" y="46" width="50" height="5" rx="2.5" fill="currentColor" opacity=".14" />
      <rect x="28" y="68" width="164" height="34" rx="6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="44" cy="85" r="4.5" fill="currentColor" opacity=".34" />
      <rect x="58" y="81" width="98" height="7" rx="3" fill="currentColor" opacity=".2" />
      <rect x="58" y="92" width="56" height="5" rx="2.5" fill="currentColor" opacity=".12" />
      <rect x="28" y="114" width="164" height="34" rx="6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="44" cy="131" r="4.5" fill="currentColor" opacity=".42" />
      <rect x="58" y="127" width="72" height="7" rx="3" fill="currentColor" opacity=".22" />
      <rect x="58" y="138" width="44" height="5" rx="2.5" fill="currentColor" opacity=".13" />
    </svg>
  );
}

export function StageMarkTerminal() {
  return (
    <svg className="lp3-mark" viewBox="0 0 220 170" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="212" height="162" rx="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M24 58l14 12-14 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
      <rect x="48" y="62" width="11" height="15" rx="3" fill="currentColor" opacity=".5" />
      <rect x="26" y="92" width="118" height="8" rx="4" fill="currentColor" opacity=".2" />
      <rect x="26" y="112" width="82" height="8" rx="4" fill="currentColor" opacity=".14" />
      <rect x="26" y="132" width="96" height="8" rx="4" fill="currentColor" opacity=".17" />
    </svg>
  );
}
