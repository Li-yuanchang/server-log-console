/**
 * 语义色 token —— 终端与日志预览的唯一取色来源
 *
 * 为什么需要这个文件：
 * 同一个日志文件在「终端 tail -f」和「日志预览」里是两个视图，但用户看的是
 * 同一份内容。此前两边的配色各写各的：
 *   - 终端 terminal-decorations.ts 里硬编码 #e06c75 / #e5c07b
 *   - 日志 theme-modern.css 里硬编码 #fecaca / #fbbf24
 * 结果同一个 ERROR 在两个视图里色相都不一致，切换视图时眼睛要重新建立
 * 「哪个颜色代表什么」。这里把两端收口到同一套语义映射。
 *
 * 关键设计：**不是同一个色值，而是同一套语义**
 * - 终端（深底）用高明度着色（亮红）
 * - 日志（浅底）用低明度着色（深红）
 * - 但**色相相同**（都是红），语义一致
 *
 * 加新语义色时：只在这里加，两端自动同步。
 */

export type SemanticKind = "fatal" | "exception" | "error" | "warning" | "prompt" | "promptPath";

export interface SemanticColorPair {
  /** 终端（深色底）用的颜色：高明度，保证在深底上可读 */
  terminal: string;
  /** 日志预览（浅色底）用的颜色：低明度，保证在浅底上可读 */
  log: string;
}

/**
 * 语义色映射。终端与日志从这里取色，不再各自硬编码。
 *
 * 取色原则（不抢内容主角）：
 * - 背景永远低饱和，语义色是唯一高声量的元素
 * - 语义色只用于**关键字本身**，不整行染色（整行染色最抢戏）
 * - 与正文的亮度差 ≥ 25%，保证「跳出来」但不刺眼
 */
export const SEMANTIC_COLORS: Record<SemanticKind, SemanticColorPair> = {
  /** 致命：最高级别，用紫色与 ERROR 区分（红系内难再分层） */
  fatal: { terminal: "#b39ddb", log: "#6d28d9" },
  /** 异常栈：琥珀色，区别于普通 error */
  exception: { terminal: "#ffb74d", log: "#b45309" },
  /** 错误 */
  error: { terminal: "#ff7b8a", log: "#a5483d" },
  /** 警告 */
  warning: { terminal: "#ffc86b", log: "#b77935" },
  /** 提示符 user@host 段 */
  prompt: { terminal: "#7fcf91", log: "#477a45" },
  /** 提示符路径段 */
  promptPath: { terminal: "#7ec8e3", log: "#2f5f8f" }
};

/** 语义色在日志侧的行底色（浅色底上用极低透明度，避免整行被染色抢戏） */
export const SEMANTIC_LOG_TINTS: Record<SemanticKind, string> = {
  fatal: "rgba(109, 40, 217, 0.09)",
  exception: "rgba(180, 83, 9, 0.10)",
  error: "rgba(165, 72, 61, 0.07)",
  warning: "rgba(183, 121, 53, 0.10)",
  prompt: "transparent",
  promptPath: "transparent"
};

/** 取终端侧颜色 */
export function terminalColor(kind: SemanticKind): string {
  return SEMANTIC_COLORS[kind].terminal;
}

/** 取日志侧颜色 */
export function logColor(kind: SemanticKind): string {
  return SEMANTIC_COLORS[kind].log;
}

/**
 * 背景纹理类型。
 * 纹理是背景层的最低优先级：默认强度压在「几乎无感」档，
 * 只提供空间感，不与内容争注意力。
 */
export type TerminalTexture = "none" | "grid" | "dots" | "double";

export const TERMINAL_TEXTURES: Array<{ id: TerminalTexture; name: string; desc: string }> = [
  { id: "none", name: "无", desc: "纯色背景，最不干扰" },
  { id: "grid", name: "方格", desc: "16px 细线 · 标准技术感" },
  { id: "dots", name: "点阵", desc: "14px 圆点 · 比线更柔和" },
  { id: "double", name: "双层", desc: "16px + 80px 主次刻度 · 工程感" }
];

/** 生成纹理的 CSS 背景（强度 0~100，映射到透明度） */
export function buildTextureBackground(
  texture: TerminalTexture,
  intensity: number
): { image: string; size: string } {
  const k = Math.max(0, Math.min(100, intensity)) / 100;
  switch (texture) {
    case "grid":
      return {
        image:
          `linear-gradient(rgba(90,160,200,${(0.055 * k).toFixed(4)}) 1px,transparent 1px),` +
          `linear-gradient(90deg,rgba(90,160,200,${(0.055 * k).toFixed(4)}) 1px,transparent 1px)`,
        size: "16px 16px"
      };
    case "dots":
      return {
        image: `radial-gradient(circle at 1px 1px, rgba(110,190,230,${(0.13 * k).toFixed(4)}) 1px, transparent 0)`,
        size: "14px 14px"
      };
    case "double":
      return {
        image:
          `linear-gradient(rgba(90,160,200,${(0.045 * k).toFixed(4)}) 1px,transparent 1px),` +
          `linear-gradient(90deg,rgba(90,160,200,${(0.045 * k).toFixed(4)}) 1px,transparent 1px),` +
          `linear-gradient(rgba(90,160,200,${(0.09 * k).toFixed(4)}) 1px,transparent 1px),` +
          `linear-gradient(90deg,rgba(90,160,200,${(0.09 * k).toFixed(4)}) 1px,transparent 1px)`,
        size: "16px 16px,16px 16px,80px 80px,80px 80px"
      };
    default:
      return { image: "none", size: "auto" };
  }
}
