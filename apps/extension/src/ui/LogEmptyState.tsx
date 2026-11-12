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
  /** 情境侧栏（2026-11-12）：editorial 大面积留白的右侧填充——真实数据面板，由调用方传入 */
  aside?: ReactNode;
};

export function LogEmptyState(props: LogEmptyStateProps) {
  const { icon, title, sub, acts, chip, live = false, bars = false, steps, extra, className, align, watermark, liveBar, kbdHint, aside } = props;
  return (
    <div className={`lp3${align === "ed" ? " ed" : ""}${className ? ` ${className}` : ""}`} role="status">
      {aside}
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
   SLC 字标水印（2026-11-12 Boss 定稿：E 电路板单线 v3）
   原型：docs/prototypes/slc-watermark-deformed.html（E 款）
   · 一笔走线贯穿 S、L、C，skewX(-8) 斜切，纯单线 —— 终端工具的本命语言
   · v3 已删焊盘 / 分支圆点 / 中段横连线（Boss：连接点莫名其妙、横线像横杠）
   · 全部尺寸用 cqw，随容器宽度等比缩放，任何窗口都不裁切
   · 纯装饰 aria-hidden，pointer-events:none
   注意：带数码屏统计面板的空态不加水印（与面板冲突，见 no-server-facade-lcd.html）
   ============================================================ */
export function SlcWatermark() {
  return (
    <div className="slc-wm" aria-hidden="true">
      <svg viewBox="0 0 260 120" fill="none" focusable="false">
        <g
          transform="skewX(-8)"
          stroke="currentColor"
          strokeWidth="9"
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="none"
        >
          {/* S */}
          <path d="M60 8H14V52H58V96H14" />
          {/* L */}
          <path d="M96 8V96H140" />
          {/* C */}
          <path d="M216 8H176V96H216" />
        </g>
      </svg>
      <span className="slc-wm-word">SERVER LOG CONSOLE</span>
    </div>
  );
}
