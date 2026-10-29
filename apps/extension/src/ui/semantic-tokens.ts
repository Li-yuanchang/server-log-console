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
  { id: "grid", name: "方格", desc: "32px 细线 · 疏朗不眼晕" },
  { id: "dots", name: "点阵", desc: "22px 圆点 · 比线更柔和" },
  { id: "double", name: "双层", desc: "32px + 160px 主次刻度 · 工程感" }
];

/**
 * 背景图预设（2026-10-27，2026-10-28 扩图）。
 *
 * 两类来源：
 * ① CSS 生成（aurora/nebula/mesh/carbon/wave）—— 无外部依赖，离线可用；
 * ② 真实图片（hero-four / hero-beam / cosmic-violet / aurora-band / deep-space / graphite-glow）
 *    放在 public/bg/ 下，运行时相对路径引用，不占打包体积。
 *    来源与授权：
 *    · hero-four / hero-beam —— 仿 Windows 10 经典 Hero 风格（蓝青渐变 + 发光四格窗口
 *      + 中心光晕），本项目用 PIL 程序生成，无第三方版权；
 *    · cosmic-violet —— CC0 1.0 可商用
 *      （github.com/Lampe332/flowing-light-backgrounds，"Free for anything, commercial too"）；
 *    · aurora-band / deep-space / graphite-glow —— 程序生成。
 * 目的：解决「清一色黑太单调」，同时不牺牲文字可读性 ——
 * 每个预设都是深色低饱和，叠加在主题底色之上仅作氛围。
 */
export type TerminalBackdrop =
  | "none"
  | "aurora" | "nebula" | "mesh" | "carbon" | "wave"
  | "hexgrid" | "neon-ring" | "orbit" | "ridge" | "ring-glow" | "poly" | "prism"
  | "cosmic-violet" | "aurora-band" | "graphite-glow";

export const TERMINAL_BACKDROPS: Array<{ id: TerminalBackdrop; name: string; desc: string }> = [
  { id: "none", name: "无", desc: "只显示主题底色" },
  { id: "hexgrid", name: "六边形网格", desc: "深蓝紫几何网格，规整克制" },
  { id: "neon-ring", name: "霓虹光环", desc: "发光圆环 + 抽象几何，科技感最强" },
  { id: "orbit", name: "轨道几何", desc: "圆环与几何体，冷调" },
  { id: "ridge", name: "山脊", desc: "紫色天际线与山形剪影" },
  { id: "ring-glow", name: "圆环光晕", desc: "中心光晕，层次柔和" },
  { id: "poly", name: "多面体", desc: "低多边形结构，硬朗" },
  { id: "prism", name: "棱镜", desc: "几何折射色块" },
  { id: "cosmic-violet", name: "宇宙紫光", desc: "深紫蓝流光丝带（CC0 实拍素材）" },
  { id: "aurora-band", name: "极光光带", desc: "顶部青绿到紫的光带" },
  { id: "graphite-glow", name: "石墨微光", desc: "纯光影无图案，最安静" },
  { id: "aurora", name: "极光", desc: "顶部青绿光晕，像夜间极光" },
  { id: "nebula", name: "星云", desc: "紫蓝渐层，深空感" },
  { id: "mesh", name: "网格光", desc: "斜向光束，科技感" },
  { id: "carbon", name: "碳纤维", desc: "斜纹编织质感，低调" },
  { id: "wave", name: "波纹", desc: "底部柔和涟漪" }
];

/** 真实图片背景 → public/bg 下的**根绝对**路径。
 *  2026-10-28 修复「背景图永远 404、终端只有纯色」（用户长期反馈）：
 *  原先写的是相对路径 `bg/xxx.jpg`。它虽然注入在内联 style 的 CSS 变量里，
 *  但真正消费该变量的是 **CSS 文件**里的 `background-image: var(--terminal-texture-image)`——
 *  按 CSS 规范，CSS 文件中的 url() 相对**样式表所在目录**解析，于是：
 *      期望  /bg/deep-space.jpg
 *      实际  /assets/bg/deep-space.jpg   ← 404，图片从未显示
 *  实测（浏览器内 Image() 探测）：
 *      /assets/bg/deep-space.jpg → FAIL
 *      /bg/deep-space.jpg        → OK 1600x900
 *  改为以 `/` 开头的根绝对路径。两种宿主都成立：
 *      · Electron file://：解析为 file:///.../dist/bg/xxx.jpg（dist 为根）
 *      · Gateway http:// ：解析为 http://host:4040/bg/xxx.jpg（static 根为 dist）
 */
export const BACKDROP_IMAGES: Partial<Record<TerminalBackdrop, string>> = {
  /* 2026-10-29 按「深空星点」方向重做（用户反馈 Hero 太糊、要大颗粒星点）：
     全部程序化生成，参数对齐现有 deep-space（暗部 rgb(4,7,19)、星点占 0.1%、
     亮度 p50≈8 / p99≈20-45）。已叠加终端文字实测，均可读、不抢内容。 */
  "hexgrid": "bg/hexgrid.jpg",       /* 六边形网格 */
  "neon-ring": "bg/neon-ring.jpg",   /* 霓虹光环 */
  "orbit": "bg/orbit.jpg",           /* 轨道几何 */
  "ridge": "bg/ridge.jpg",           /* 山脊 */
  "ring-glow": "bg/ring-glow.jpg",   /* 圆环光晕 */
  "poly": "bg/poly.jpg",             /* 多面体 */
  "prism": "bg/prism.jpg",           /* 棱镜 */
  "cosmic-violet": "bg/cosmic-violet.jpg",
  "aurora-band": "bg/aurora-band.jpg",
  "graphite-glow": "bg/graphite-glow.jpg"
};

/** 把背景图的相对路径解析成**绝对 URL**（2026-10-28 修复「图片 404、终端只有纯色」）。
 *
 *  根因：`url("bg/xxx.jpg")` 虽然写在 JS 侧，但最终是被 **CSS 文件**里的
 *  `background-image: var(--terminal-texture-image)` 消费的。按 CSS 规范，
 *  CSS 文件中的相对 URL 相对**样式表目录**解析，于是变成
 *      /assets/bg/xxx.jpg   ← 404（图片实际在 /bg/ 下）
 *  实测：/assets/bg/deep-space.jpg → FAIL，bg/deep-space.jpg → OK 1600x900。
 *
 *  为什么不用写死 `/bg/xxx.jpg`：file:// 下 `/bg/` 会解析到磁盘根（file:///bg/），
 *  实测 FAIL；而 http 下 `bg/` 又会相对 /assets/ 出错。两个宿主基准不同。
 *  因此运行时用 document.baseURI 拼绝对 URL，一次对齐两种宿主：
 *    · Electron file://.../dist/index.html → file://.../dist/bg/xxx.jpg ✓
 *    · Gateway  http://host:4040/          → http://host:4040/bg/xxx.jpg ✓
 */
function resolveBackdropUrl(relative: string): string {
  try {
    const base =
      typeof document !== "undefined" && document.baseURI
        ? document.baseURI
        : typeof location !== "undefined"
          ? location.href
          : "";
    if (!base) return relative;
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

/** 生成背景图 CSS（叠加在底色之上，透明度由 intensity 控制） */
export function buildBackdropBackground(
  backdrop: TerminalBackdrop,
  intensity: number
): string {
  const k = Math.max(0, Math.min(100, intensity)) / 100;
  if (backdrop === "none") return "none";

  /* 2026-10-28：真实图片背景。返回 url(...) 由调用方负责 cover 铺满；
     遮罩强度沿用同一套 intensity（0.30~1.0），避免图片过亮抢文字。 */
  const imgPath = BACKDROP_IMAGES[backdrop];
  if (imgPath) {
    /* 2026-10-28 修复三个叠加问题：
       ① `return` 关键字曾丢失 → 函数返回 undefined，CSS 拿到无效值，
          背景图永远不显示（这是「选了没反应」的真正主因）；
       ② 遮罩方向写反：原来 shade = 0.30 + 0.34*k，强度越大遮罩越厚，
          用户把强度调高反而更看不清图 —— 与「强度」语义相反；
       ③ 遮罩基线过高（0.30 起步），低强度时图片已被压掉三成。
     现在：k=0 → 0.55（很淡，几乎只有底色）；k=1 → 0.18（图清晰但不过亮）。
     反比关系让「强度滑杆」符合直觉：往右拉 = 图更明显。 */
    const shade = (0.55 - 0.37 * k).toFixed(2);
    return `linear-gradient(rgba(6,10,18,${shade}),rgba(6,10,18,${shade})), url("${resolveBackdropUrl(imgPath)}")`;
  }

  /* 2026-10-27 修正「6 个预览长得一样」：
     ① 各预设的浓度过低（0.12~0.30），在小缩略图里被压成纯黑，无法分辨。
        统一提高到 0.35~0.55 区间，保证缩略图就能看出色彩走向。
     ② 光斑位置彼此区分：极光在顶部、星云对角两团、波纹在底部、
        网格光是斜带 —— 让缩略图一眼能辨别。
     ③ intensity=0 时仍保留 30% 基线（缩略图预览用 100% 不受影响），
        避免「选了但什么都看不到」。 */
  /* 2026-10-29 回退（同纹理）：基线 0.55 让所有背景图/渐变整体变亮，
     星云、碳纤维等深色方案被抬成灰白。恢复 0.30 基线。 */
  const base = 0.30 + 0.70 * k;

  switch (backdrop) {
    case "aurora":
      /* 顶部大面积青绿光晕 + 右上补充光斑 */
      return `radial-gradient(ellipse 100% 70% at 50% -15%, rgba(78,205,196,${(0.55 * base).toFixed(3)}), transparent 72%),` +
             `radial-gradient(ellipse 55% 45% at 88% 8%, rgba(110,231,208,${(0.34 * base).toFixed(3)}), transparent 68%)`;
    case "nebula":
      /* 左上紫 + 右下蓝，对角分布 */
      return `radial-gradient(ellipse 75% 80% at 12% 0%, rgba(140,100,235,${(0.50 * base).toFixed(3)}), transparent 70%),` +
             `radial-gradient(ellipse 70% 75% at 95% 100%, rgba(50,110,200,${(0.42 * base).toFixed(3)}), transparent 72%)`;
    case "mesh":
      /* 两条 40° 斜向光带交叉 */
      return `linear-gradient(118deg, transparent 30%, rgba(110,190,230,${(0.34 * base).toFixed(3)}) 48%, transparent 64%),` +
             `linear-gradient(62deg, transparent 36%, rgba(160,130,225,${(0.30 * base).toFixed(3)}) 50%, transparent 66%)`;
    case "carbon":
      /* 45° 斜纹编织，缩略图里最容易被辨认 */
      return `repeating-linear-gradient(45deg, rgba(150,175,200,${(0.10 * base).toFixed(3)}) 0 3px, transparent 3px 7px),` +
             `repeating-linear-gradient(-45deg, rgba(150,175,200,${(0.08 * base).toFixed(3)}) 0 3px, transparent 3px 7px)`;
    case "wave":
      /* 底部圆弧涟漪 */
      return `radial-gradient(ellipse 130% 60% at 50% 125%, rgba(70,150,200,${(0.48 * base).toFixed(3)}), transparent 68%)`;
    default:
      return "none";
  }
}

/**
 * 生成纹理的 CSS 背景（强度 0~100，映射到透明度）。
 *
 * 2026-10-27 提高可见度：原基线 5.5% 在深色底上几乎不可见
 * （用户反馈「格子都不明显」）。现基线提到 12%，并随强度线性增长；
 * 强度 100 时约 22%，肉眼清晰但不抢文字。
 */
export function buildTextureBackground(
  texture: TerminalTexture,
  intensity: number
): { image: string; size: string } {
  const k = Math.max(0, Math.min(100, intensity)) / 100;
  /* 2026-10-27 二次调整：
     ① 间距放疏 —— 16px 在正常字号的终端里约每 1.5 个字符一格，密集到眼晕；
        改成 32px（约 4 字符），视线不会被连续的十字路口拉扯。
     ② 线更细更淡 —— 1px 实线叠在 16px 间距上形成「套格子」观感，
        改成 1px + 更低透明度，只作若隐若现的底纹。
     ③ 强度基线 8%，上限 14%（原来 12~22% 偏亮）。 */
  /* 2026-10-29 回退（用户反馈「碳纤维/星云都不是深色背景了，变成灰白色」）：
     上一版把 alpha 提到 0.20–0.42，叠在 #0a0a0a 上算出 rgb(56,81,98)、
     亮度 76.9（原 0.08 时仅 23.2）—— 等于把深色背景整体糊成了灰蓝。
     纹理是「若隐若现的底纹」，不是背景色本身，必须保持低透明度。
     恢复 0.08–0.14：只提供空间感，不改变背景明暗。 */
  const alpha = (0.08 + 0.06 * k).toFixed(3);
  switch (texture) {
    case "grid":
      return {
        image:
          `linear-gradient(rgba(120,180,220,${alpha}) 1px,transparent 1px),` +
          `linear-gradient(90deg,rgba(120,180,220,${alpha}) 1px,transparent 1px)`,
        size: "32px 32px"
      };
    case "dots":
      return {
        image: `radial-gradient(circle at 1px 1px, rgba(130,200,235,${(parseFloat(alpha) * 1.5).toFixed(3)}) 1px, transparent 0)`,
        size: "22px 22px"
      };
    case "double":
      /* 双层：32px 细线 + 160px 主刻度（5 倍关系，主次分明） */
      return {
        image:
          `linear-gradient(rgba(120,180,220,${(parseFloat(alpha) * 0.5).toFixed(3)}) 1px,transparent 1px),` +
          `linear-gradient(90deg,rgba(120,180,220,${(parseFloat(alpha) * 0.5).toFixed(3)}) 1px,transparent 1px),` +
          `linear-gradient(rgba(120,180,220,${alpha}) 1px,transparent 1px),` +
          `linear-gradient(90deg,rgba(120,180,220,${alpha}) 1px,transparent 1px)`,
        size: "32px 32px,32px 32px,160px 160px,160px 160px"
      };
    default:
      return { image: "none", size: "auto" };
  }
}

/**
 * 缩略图专用背景光效（2026-10-27）
 *
 * 为什么需要单独一套：正常版按终端全屏尺寸设计（光斑在 -15% / 125% 等处），
 * 44px 高的缩略图完全覆盖不到那些区域，看起来一片纯色 ——
 * 用户反馈「6 个预览长得一样」就是这个原因。
 * 这里把光斑位置压到缩略图可见范围内，并提高浓度，保证一眼可辨。
 */
export function buildBackdropPreview(backdrop: TerminalBackdrop): string {
  /* 真实图片：缩略图直接用图片本身（不叠遮罩，保证能看清色彩走向） */
  const imgPath = BACKDROP_IMAGES[backdrop];
  /* 同 buildBackdropBackground：必须用绝对 URL，否则设置页缩略图也会 404 */
  if (imgPath) return `url("${resolveBackdropUrl(imgPath)}")`;

  switch (backdrop) {
    case "aurora":
      return "radial-gradient(ellipse 130% 90% at 50% 0%, rgba(78,205,196,0.75), transparent 72%)," +
             "radial-gradient(ellipse 80% 70% at 85% 20%, rgba(110,231,208,0.45), transparent 70%)";
    case "nebula":
      return "radial-gradient(ellipse 110% 120% at 10% 10%, rgba(140,100,235,0.70), transparent 72%)," +
             "radial-gradient(ellipse 100% 110% at 95% 95%, rgba(50,110,200,0.60), transparent 74%)";
    case "mesh":
      return "linear-gradient(118deg, transparent 22%, rgba(110,190,230,0.55) 46%, transparent 68%)," +
             "linear-gradient(62deg, transparent 28%, rgba(160,130,225,0.50) 50%, transparent 70%)";
    case "carbon":
      return "repeating-linear-gradient(45deg, rgba(150,175,200,0.20) 0 3px, transparent 3px 8px)," +
             "repeating-linear-gradient(-45deg, rgba(150,175,200,0.16) 0 3px, transparent 3px 8px)";
    case "wave":
      return "radial-gradient(ellipse 150% 95% at 50% 110%, rgba(70,150,200,0.70), transparent 70%)";
    default:
      return "none";
  }
}

/**
 * 终端外观组合预设（2026-10-27）
 *
 * 为什么需要：用户反馈「极光+方格」这类自由组合太难看了 ——
 * 背景图和纹理各自调色是一回事，搭配是否协调是另一回事。
 * 这里给出经过挑选的稳定组合，一键套用，避免用户踩到冲突搭配。
 *
 * 设计原则：
 * - 有背景光效时不再叠纹理（两者都是「大面积图案」，叠加会互相干扰）
 * - 纹理只配纯色底（纹理本身就是底纹，加光效等于两层图案）
 * - 每个组合都有明确的场景定位，不是随机拼色
 */
export interface TerminalLookPreset {
  id: string;
  name: string;
  desc: string;
  /** 推荐搭配的终端配色方案 id */
  scheme: string;
  backdrop: TerminalBackdrop;
  backdropIntensity: number;
  texture: TerminalTexture;
  textureIntensity: number;
}

export const TERMINAL_LOOK_PRESETS: TerminalLookPreset[] = [
  {
    id: "plain",
    name: "纯色克制",
    desc: "无背景图无纹理，只靠配色区分。长时间排障首选",
    scheme: "sage",
    backdrop: "none", backdropIntensity: 60,
    texture: "none", textureIntensity: 55
  },
  {
    id: "aurora-clean",
    name: "极光净底",
    desc: "极光光效 + 无纹理。氛围明确且不干扰文字",
    scheme: "aurora",
    backdrop: "aurora", backdropIntensity: 55,
    texture: "none", textureIntensity: 55
  },
  {
    id: "nebula-deep",
    name: "星云深空",
    desc: "星云渐层 + 深空蓝配色。适合夜间长盯",
    scheme: "space",
    backdrop: "nebula", backdropIntensity: 50,
    texture: "none", textureIntensity: 55
  },
  {
    id: "grid-tech",
    name: "方格工程",
    desc: "方格底纹 + 炭黑配色。纯技术感，无光效干扰",
    scheme: "charcoal",
    backdrop: "none", backdropIntensity: 60,
    texture: "grid", textureIntensity: 45
  },
  {
    id: "carbon-dark",
    name: "碳纤暗调",
    desc: "碳纤维斜纹 + 石墨青。低调质感，几乎不抢注意力",
    scheme: "sage",
    backdrop: "carbon", backdropIntensity: 45,
    texture: "none", textureIntensity: 55
  },
  {
    id: "wave-calm",
    name: "波纹静水",
    desc: "底部波纹 + 墨绿护眼。最柔和的一套",
    scheme: "moss",
    backdrop: "wave", backdropIntensity: 45,
    texture: "none", textureIntensity: 55
  }
];
