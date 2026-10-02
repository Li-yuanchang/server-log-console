import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";

/**
 * 终端文字客户端着色（纯客户端方案）。
 *
 * 原理：只读 terminal.buffer.active 的行文本，用 xterm 的 registerMarker + registerDecoration
 * 在渲染层给匹配文本上色。绝不向 PTY 写入任何字节（JumpServer 红线：不能发不可见字符），
 * 对跳板机会话同样安全。
 *
 * 颜色对应 docs/ui-redesign-2026-09/终端重设计原型-2026-10-01.html 的 .term token：
 *   .u   = #98c379（提示符 user@host 段，绿）
 *   .pth = #7ec8e3（提示符路径段，青）
 *   .err = #e06c75（ERROR，红）
 *   .wrn = #e5c07b（WARN/WARNING，橙）
 * 装饰是行内样式，直接写字面 hex，不走 CSS 变量。
 */

export interface TerminalColorizer {
  /** 扫描最近 N 行并上色（已上色的段按 key 跳过）。 */
  scan(): void;
  /** 清空全部装饰（resize/清屏/会话停止时调用；之后 scan 即可恢复）。 */
  disposeAll(): void;
}

/** 每次扫描最近 400 行（buffer.active，从最后一行往上）。 */
const SCAN_WINDOW_LINES = 400;
/** 装饰总数上限，超限 dispose 最旧的。 */
const MAX_DECORATIONS = 800;

/* 原型 .term 配色 token（字面 hex，注释标注对应原型 class） */
const PROMPT_USER_HOST_COLOR = "#98c379"; // .u
const PROMPT_PATH_COLOR = "#7ec8e3"; // .pth
const LOG_ERROR_COLOR = "#e06c75"; // .err
const LOG_WARN_COLOR = "#e5c07b"; // .wrn

/**
 * 素色提示符行：[user@host path]# 或 [user@host path]$。
 * 服务器提示符无 ANSI 码，buffer 里的文本即原样；路径段允许为空、可含空格。
 */
const PROMPT_LINE_PATTERN = /\[(?<uh>[^\s\]]+@[^\s\]]+) (?<path>[^\]]*)\](?=[#$])/;
const ERROR_WORD_PATTERN = /\bERROR\b/g;
const WARN_WORD_PATTERN = /\bWARN(?:ING)?\b/g;

type DecorationKind = "prompt-user-host" | "prompt-path" | "log-error" | "log-warn";

interface DecorationEntry {
  key: string;
  decoration: IDecoration;
  marker: IMarker;
}

/**
 * 宽字符（CJK/全角）在终端占 2 个单元格，而装饰的 x/width 以单元格计；
 * 纯 ASCII 行退化为「字符串下标 == 单元格列」。这里按主流宽字符区段近似，
 * 覆盖中日韩路径/文本场景；提示符与级别词本身均为 ASCII，不受影响。
 */
function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f)
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || codePoint >= 0x20000
  );
}

function segmentCellWidth(text: string, fromIndex: number, toIndex: number): number {
  let width = 0;
  let index = fromIndex;
  while (index < toIndex) {
    const codePoint = text.codePointAt(index) ?? 0;
    index += codePoint > 0xffff ? 2 : 1;
    width += isWideCodePoint(codePoint) ? 2 : 1;
  }
  return width;
}

function visualColumn(text: string, charIndex: number): number {
  return segmentCellWidth(text, 0, charIndex);
}

export function createTerminalColorizer(terminal: Terminal): TerminalColorizer {
  const entries: DecorationEntry[] = [];
  const registeredKeys = new Set<string>();
  /* 异常后一次性降级：停用着色并只输出一次 debug，绝不影响终端数据流 */
  let disabled = false;
  let debugLogged = false;

  const debugOnce = (message: string, error?: unknown) => {
    if (debugLogged) {
      return;
    }
    debugLogged = true;
    console.debug(`[terminal-decorations] ${message}`, error);
  };

  /* 能力探测：缺 Decoration API（旧版 xterm 等）时静默降级为无操作 */
  if (typeof terminal.registerDecoration !== "function" || typeof terminal.registerMarker !== "function") {
    debugOnce("当前 xterm 缺少 Decoration API，客户端着色降级为无操作。");
    return {
      scan() {},
      disposeAll() {},
    };
  }

  const removeEntry = (entry: DecorationEntry) => {
    const index = entries.indexOf(entry);
    if (index >= 0) {
      entries.splice(index, 1);
    }
    registeredKeys.delete(entry.key);
  };

  const disposeEntry = (entry: DecorationEntry) => {
    try {
      entry.decoration.dispose();
    } catch {
      /* 忽略单个装饰释放失败 */
    }
    /* xterm 的 DecorationService 只做「marker dispose → decoration dispose」联动；
       手动 dispose 装饰会解绑该联动，marker 需自行释放，避免 buffer.markers 泄漏 */
    try {
      if (!entry.marker.isDisposed) {
        entry.marker.dispose();
      }
    } catch {
      /* 忽略 */
    }
  };

  const addDecoration = (key: string, line: number, x: number, width: number, color: string) => {
    if (disabled || width <= 0 || x < 0) {
      return;
    }
    if (registeredKeys.has(key)) {
      return;
    }
    /* 总量治理：超出上限先 dispose 最旧的 */
    while (entries.length >= MAX_DECORATIONS) {
      const oldest = entries[0];
      disposeEntry(oldest);
      removeEntry(oldest);
    }
    let marker: IMarker | undefined;
    try {
      const buffer = terminal.buffer.active;
      /* registerMarker(offset) 的绝对行 = buffer.baseY + buffer.cursorY + offset
         （公共 API 的 baseY/cursorY 即内部 ybase/y）；
         marker 会随滚动裁剪/追加自动跟踪所在行，无需手动维护 */
      marker = terminal.registerMarker(line - (buffer.baseY + buffer.cursorY));
      if (!marker || marker.isDisposed || marker.line < 0) {
        marker?.dispose();
        return;
      }
      const decoration = terminal.registerDecoration({
        marker,
        /* x 相对 anchor（默认 left，即行首）的单元格偏移 */
        x,
        width,
        height: 1,
        foregroundColor: color,
        layer: "bottom", /* 渲染在选区之下，不影响选中高亮 */
      });
      if (!decoration) {
        marker.dispose();
        return;
      }
      const entry: DecorationEntry = { key, decoration, marker };
      entries.push(entry);
      registeredKeys.add(key);
      /* marker 因滚动裁剪/清屏被 xterm 释放时装饰随之释放，这里同步登记表 */
      decoration.onDispose(() => removeEntry(entry));
    } catch (error) {
      try {
        marker?.dispose();
      } catch {
        /* 忽略 */
      }
      disabled = true;
      debugOnce("装饰注册失败，客户端着色已停用。", error);
    }
  };

  /* 提示符行：两个装饰——user@host 段（含前导 "["，对齐原型 span.u）绿色、路径段青色 */
  const colorizePromptLine = (line: number, text: string) => {
    const match = PROMPT_LINE_PATTERN.exec(text);
    if (!match || !match.groups) {
      return;
    }
    const uh = match.groups.uh;
    const path = match.groups.path;
    if (uh.length > 0) {
      const uhStart = match.index;
      const uhWidth = 1 + uh.length; /* 含前导 "[" */
      addDecoration(
        `${line}|prompt-user-host|${text.slice(uhStart, uhStart + uhWidth)}`,
        line,
        visualColumn(text, uhStart),
        uhWidth,
        PROMPT_USER_HOST_COLOR,
      );
    }
    if (path.length > 0) {
      /* 正则保证 "[uh path]" 紧邻：路径起点 = "["(1) + uh + " "(1) */
      const pathStart = match.index + 1 + uh.length + 1;
      addDecoration(
        `${line}|prompt-path|${path}`,
        line,
        visualColumn(text, pathStart),
        segmentCellWidth(text, pathStart, pathStart + path.length),
        PROMPT_PATH_COLOR,
      );
    }
  };

  /* 日志级别词：只给关键词上色（x/width = 词的位置），整行不动 */
  const colorizeWordMatches = (line: number, text: string, pattern: RegExp, color: string, kind: DecorationKind) => {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const word = match[0];
      if (word.length > 0) {
        /* key 附带列号：同一行出现多个相同级别词时逐个上色（仍满足行号+内容+类型的去重语义） */
        addDecoration(
          `${line}|${kind}|${word}@${match.index}`,
          line,
          visualColumn(text, match.index),
          word.length, /* ERROR/WARN/WARNING 均为 ASCII，字符数 == 单元格数 */
          color,
        );
      }
      if (pattern.lastIndex === match.index) {
        pattern.lastIndex += 1; /* 防御零宽匹配造成死循环 */
      }
    }
  };

  const scan = () => {
    if (disabled) {
      return;
    }
    try {
      const buffer = terminal.buffer.active;
      if (!buffer || buffer.length <= 0) {
        return;
      }
      const lastLine = buffer.length - 1;
      const firstLine = Math.max(0, lastLine - SCAN_WINDOW_LINES + 1);
      for (let line = lastLine; line >= firstLine; line -= 1) {
        const bufferLine = buffer.getLine(line);
        if (!bufferLine) {
          continue;
        }
        /* trim 尾部空白；提示符/级别词匹配不受影响 */
        const text = bufferLine.translateToString(true);
        if (!text) {
          continue;
        }
        /* 廉价预筛：三类目标分别需要 "[" / "ERROR" / "WARN" */
        if (!text.includes("[") && !text.includes("ERROR") && !text.includes("WARN")) {
          continue;
        }
        colorizePromptLine(line, text);
        colorizeWordMatches(line, text, ERROR_WORD_PATTERN, LOG_ERROR_COLOR, "log-error");
        colorizeWordMatches(line, text, WARN_WORD_PATTERN, LOG_WARN_COLOR, "log-warn");
      }
    } catch (error) {
      disabled = true;
      debugOnce("缓冲区扫描失败，客户端着色已停用。", error);
    }
  };

  const disposeAll = () => {
    const stale = entries.splice(0, entries.length);
    for (const entry of stale) {
      disposeEntry(entry);
    }
    registeredKeys.clear();
  };

  return { scan, disposeAll };
}
