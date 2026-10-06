import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { escapeHtml, escapeRegExp } from "./utils.js";
import { detectLogHighlightKind, type LogHighlightKind } from "./logHighlighting.js";

const VirtuosoScroller = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function VirtuosoScroller(props, ref) {
    return <div {...props} ref={ref} className={`virtuoso-scroller ${props.className ?? ""}`} />;
  },
);

function findClosestLineIndex(node: Node | null): number | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const lineElement = element?.closest<HTMLElement>("[data-line-index]");
  if (!lineElement) return null;
  const rawIndex = Number(lineElement.dataset.lineIndex);
  return Number.isFinite(rawIndex) ? rawIndex : null;
}

type ViewerSelectionPoint = {
  lineIndex: number;
  charOffset: number;
};

function getLineElementFromPoint(clientX: number, clientY: number): HTMLElement | null {
  const elements = document.elementsFromPoint(clientX, clientY);
  for (const element of elements) {
    const lineElement = element.closest?.<HTMLElement>("[data-line-index]");
    if (lineElement) {
      return lineElement;
    }
  }
  return null;
}

function getSelectionPointFromEvent(event: MouseEvent | React.MouseEvent, lines: string[], variant: "log" | "results"): ViewerSelectionPoint | null {
  const lineElement = getLineElementFromPoint(event.clientX, event.clientY);
  if (!lineElement) {
    return null;
  }
  const lineIndex = Number(lineElement.dataset.lineIndex);
  if (!Number.isFinite(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
    return null;
  }
  const lineText = lines[lineIndex] ?? "";
  const metaPrefixLength = getLineMetaPrefixLength(lineText, variant);
  const range = document.createRange();
  range.selectNodeContents(lineElement);
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  range.detach();

  // meta 列行（时间列/行号列）：rects[0] 为 meta 列文本框，其余为内容列文本框，按列分别映射字符偏移，保持选择文本完整
  if (metaPrefixLength > 0 && rects.length >= 2) {
    const metaRect = rects[0];
    const bodyRects = rects.slice(1);
    const bodyTargetRect = bodyRects.find((rect) => event.clientY >= rect.top && event.clientY <= rect.bottom) || bodyRects[bodyRects.length - 1] || lineElement.getBoundingClientRect();
    if (event.clientY >= metaRect.top && event.clientY <= metaRect.bottom && event.clientX < bodyTargetRect.left) {
      const relativeX = Math.max(0, Math.min(metaRect.width, event.clientX - metaRect.left));
      const ratio = metaRect.width > 0 ? relativeX / metaRect.width : 0;
      const charOffset = Math.max(0, Math.min(metaPrefixLength, Math.round(metaPrefixLength * ratio)));
      return { lineIndex, charOffset };
    }
    const bodyTextLength = Math.max(0, lineText.length - metaPrefixLength);
    const relativeX = Math.max(0, Math.min(bodyTargetRect.width, event.clientX - bodyTargetRect.left));
    const ratio = bodyTargetRect.width > 0 ? relativeX / bodyTargetRect.width : 0;
    const charOffset = Math.max(0, Math.min(lineText.length, metaPrefixLength + Math.round(bodyTextLength * ratio)));
    return { lineIndex, charOffset };
  }

  const lineRect = lineElement.getBoundingClientRect();
  const targetRect = rects.find((rect) => event.clientY >= rect.top && event.clientY <= rect.bottom) || rects[rects.length - 1] || lineRect;
  const relativeX = Math.max(0, Math.min(targetRect.width, event.clientX - targetRect.left));
  const ratio = targetRect.width > 0 ? relativeX / targetRect.width : 0;
  const charOffset = Math.max(0, Math.min(lineText.length, Math.round(lineText.length * ratio)));
  return { lineIndex, charOffset };
}

function buildSelectionTextFromPoints(lines: string[], first: ViewerSelectionPoint, second: ViewerSelectionPoint): string {
  const [start, end] = first.lineIndex < second.lineIndex || (first.lineIndex === second.lineIndex && first.charOffset <= second.charOffset)
    ? [first, second]
    : [second, first];
  if (start.lineIndex === end.lineIndex) {
    return (lines[start.lineIndex] ?? "").slice(start.charOffset, end.charOffset);
  }
  const selected: string[] = [];
  selected.push((lines[start.lineIndex] ?? "").slice(start.charOffset));
  for (let index = start.lineIndex + 1; index < end.lineIndex; index += 1) {
    selected.push(lines[index] ?? "");
  }
  selected.push((lines[end.lineIndex] ?? "").slice(0, end.charOffset));
  return selected.join("\n");
}

/**
 * 日志行时间戳前缀（行首单次匹配，O(行长)）：
 * - 完整日期时间：YYYY-MM-DD（或 YYYY/MM/DD）+ 空格/T + HH:MM:SS，兼容 .mmm/.mmm 毫秒与可选时区（Z / ±HH:MM / ±HHMM）
 * - nginx/Apache CLF：[30/Sep/2026:16:33:58 +0800]（方括号计入时间列，时区可省）
 * - syslog：Sep 30 16:33:58（英文月缩写 + 日 + 时间，兼容双空格补位）
 * - 仅时间：HH:MM:SS，兼容毫秒
 * 匹配后必须紧跟空白或行尾；其后空白一并归入时间列，保证内容列起点恒为固定列宽。
 * 注意：非 global，exec 不改变 lastIndex，可安全地在渲染与鼠标事件中复用。
 */
const LOG_MONTH_RE_SRC = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const LOG_LINE_TIME_RE = new RegExp(
  "^(\\d{4}[-/]\\d{2}[-/]\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}(?:[.,]\\d{1,3})?(?:\\s*(?:Z|[+-]\\d{2}:?\\d{2}))?"
  + `|\\[\\d{1,2}/${LOG_MONTH_RE_SRC}/\\d{4}:\\d{2}:\\d{2}:\\d{2}(?:\\s+[+-]\\d{4})?\\]`
  + `|${LOG_MONTH_RE_SRC}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2}`
  + "|\\d{1,2}:\\d{2}:\\d{2}(?:[.,]\\d{1,3})?)(?:\\s+|$)",
);

function getLogLineTimePrefixLength(line: string): number {
  const match = LOG_LINE_TIME_RE.exec(line);
  return match ? match[0].length : 0;
}

/**
 * 检索结果行前缀：`${lineNumber} | `（formatSearchViewerContent 的输出格式）。
 * results 视图用它渲染独立的行号列；前缀整体（含分隔符）计入 meta 列宽，
 * 使鼠标选区到原始文本的字符偏移映射保持一致。非 global，可安全复用。
 */
const RESULT_LINE_NUM_RE = /^(\d+)(\s*\|\s?)/;

function getResultLinePrefixLength(line: string): number {
  const match = RESULT_LINE_NUM_RE.exec(line);
  return match ? match[0].length : 0;
}

function getLineMetaPrefixLength(line: string, variant: "log" | "results"): number {
  return variant === "results" ? getResultLinePrefixLength(line) : getLogLineTimePrefixLength(line);
}

function isBlockTimestampLine(line: string): boolean {
  // 与渲染的时间列共用同一正则：新格式（CLF/syslog 等）的行也能作为日志块起点
  return LOG_LINE_TIME_RE.test(line.trim());
}

function isHardBlockBoundary(line: string): boolean {
  const text = line.trim();
  return text === "--" || text === "---";
}

function trimEmptyRangeEdges(lines: string[], start: number, end: number) {
  let nextStart = start;
  let nextEnd = end;
  while (nextStart <= nextEnd && !(lines[nextStart] ?? "").trim()) nextStart += 1;
  while (nextEnd >= nextStart && !(lines[nextEnd] ?? "").trim()) nextEnd -= 1;
  return { start: nextStart, end: nextEnd };
}

function getLogBlockRange(lines: string[], lineIndex: number) {
  if (!lines.length) return null;
  const target = Math.max(0, Math.min(lines.length - 1, lineIndex));
  let start = target;
  let foundTimestamp = false;

  for (let index = target; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (isHardBlockBoundary(line)) {
      start = index + 1;
      break;
    }
    if (isBlockTimestampLine(line)) {
      start = index;
      foundTimestamp = true;
      break;
    }
  }

  if (!foundTimestamp && start === target) {
    while (start > 0 && (lines[start - 1] ?? "").trim() && !isHardBlockBoundary(lines[start - 1] ?? "")) {
      start -= 1;
    }
  }

  let end = target;
  for (let index = target + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (isHardBlockBoundary(line) || isBlockTimestampLine(line)) {
      end = index - 1;
      break;
    }
    end = index;
  }

  const trimmed = trimEmptyRangeEdges(lines, start, end);
  return trimmed.start <= trimmed.end ? trimmed : { start: target, end: target };
}

export interface VirtualLogViewerHandle {
  scrollToTop(): void;
  scrollToBottom(): void;
  scrollToLine(index: number, behavior?: "auto" | "smooth"): void;
  scrollToHighlight(index: number): void;
  getLineRangeText(startLine: number, endLine: number): string;
  getLogBlockText(lineIndex: number): { text: string; start: number; end: number } | null;
  getSelectionText(selection: Selection): string;
  getScrollState(): { scrollTop: number; scrollHeight: number; clientHeight: number } | null;
  getScrollerElement(): HTMLElement | null;
}

export interface VirtualLogViewerScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  totalLines: number;
}

interface Props {
  /** 行渲染形态：log = 文件预览（时间戳列 + 续行缩进），results = 检索结果（行号列，无时间列留白） */
  variant?: "log" | "results";
  content: string;
  keywordTerms: string[];
  useRegex: boolean;
  activeHighlightIndex: number;
  focusLineIndex?: number;
  selectedLineRange?: { start: number; end: number } | null;
  bookmarks?: Record<number, string>;
  onLineClick?: (lineIndex: number, event: React.MouseEvent<HTMLDivElement>) => void;
  lineActionTitle?: string;
  onBookmarkToggle?: (lineIndex: number) => void;
  onHighlightCountChange?: (count: number) => void;
  onFocusLineHighlightIndex?: (index: number) => void;
  onMatchLineIndicesChange?: (lineIndices: number[], totalLines: number) => void;
  onWheel?: (event: React.WheelEvent<HTMLDivElement>) => void;
  onNearBottomChange?: (nearBottom: boolean) => void;
  onScrollStateChange?: (state: VirtualLogViewerScrollState) => void;
  onSelectedLineRangeChange?: (range: { start: number; end: number }) => void;
  onCopyLineRange?: () => void;
  errorHighlightEnabled?: boolean;
  followOutput?: boolean;
  className?: string;
}

interface VirtualLogViewerLineItem {
  text: string;
  errorKind: LogHighlightKind | null;
}

const VirtualLogViewerImpl = forwardRef<VirtualLogViewerHandle, Props>(
  function VirtualLogViewer(props, ref) {
    const {
      variant = "log",
      content,
      keywordTerms,
      useRegex,
      activeHighlightIndex,
      focusLineIndex,
      selectedLineRange,
      bookmarks,
      onLineClick,
      lineActionTitle,
      onBookmarkToggle,
      onHighlightCountChange,
      onFocusLineHighlightIndex,
      onMatchLineIndicesChange,
      onWheel,
      onNearBottomChange,
      onScrollStateChange,
      onSelectedLineRangeChange,
      onCopyLineRange,
      errorHighlightEnabled,
      followOutput,
      className,
    } = props;

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    const lastScrollStateEmitRef = useRef(0);
    const selectionStartRef = useRef<ViewerSelectionPoint | null>(null);
    const selectionEndRef = useRef<ViewerSelectionPoint | null>(null);

    const lines = useMemo(() => {
      if (!content) return [];
      return content.split("\n");
    }, [content]);

    const errorLineKinds = useMemo(
      () => (errorHighlightEnabled ? lines.map((line) => detectLogHighlightKind(line)) : []),
      [errorHighlightEnabled, lines],
    );

    const lineItems = useMemo<VirtualLogViewerLineItem[]>(
      () => lines.map((line, index) => ({
        text: line,
        errorKind: errorLineKinds[index] ?? null,
      })),
      [errorLineKinds, lines],
    );

    // 时间戳内联模式（2026-10-04）：时间列固定宽已废弃（theme-modern-v2 §日志行时间戳），
    // 时间戳就地渲染、堆栈续行顶格 —— 不再按视口测宽注入 --log-time-ch。

    const rawHighlightRegex = useMemo(() => {
      const normalized = [...new Set(keywordTerms.map((t) => t.trim()).filter(Boolean))];
      if (!normalized.length) return null;
      const patterns = normalized
        .map((t) => (useRegex ? t : escapeRegExp(t)))
        .filter(Boolean);
      if (!patterns.length) return null;
      try {
        return new RegExp(`(${patterns.join("|")})`, "gi");
      } catch {
        return null;
      }
    }, [keywordTerms, useRegex]);

    const displayHighlightRegex = useMemo(() => {
      const normalized = [...new Set(keywordTerms.map((t) => t.trim()).filter(Boolean))];
      if (!normalized.length) return null;
      const patterns = normalized
        .map((t) => (useRegex ? t : escapeRegExp(escapeHtml(t))))
        .filter(Boolean);
      if (!patterns.length) return null;
      try {
        return new RegExp(`(${patterns.join("|")})`, "gi");
      } catch {
        return null;
      }
    }, [keywordTerms, useRegex]);

    const { lineMatchCounts, cumulativeOffsets, totalMatches } = useMemo(() => {
      if (!rawHighlightRegex || !lines.length) {
        return { lineMatchCounts: [] as number[], cumulativeOffsets: [] as number[], totalMatches: 0 };
      }
      const counts: number[] = [];
      const offsets: number[] = [];
      let cumulative = 0;
      for (const line of lines) {
        offsets.push(cumulative);
        const matches = line.match(rawHighlightRegex);
        const count = matches?.length ?? 0;
        counts.push(count);
        cumulative += count;
      }
      return { lineMatchCounts: counts, cumulativeOffsets: offsets, totalMatches: cumulative };
    }, [lines, rawHighlightRegex]);

    useEffect(() => {
      onHighlightCountChange?.(totalMatches);
    }, [totalMatches, onHighlightCountChange]);

    const highlightedLineIndices = useMemo(() => {
      const indices: number[] = [];
      for (let index = 0; index < lineMatchCounts.length; index += 1) {
        if ((lineMatchCounts[index] || 0) > 0) {
          indices.push(index);
        }
      }
      return indices;
    }, [lineMatchCounts]);

    useEffect(() => {
      onMatchLineIndicesChange?.(highlightedLineIndices, lines.length);
    }, [highlightedLineIndices, lines.length, onMatchLineIndicesChange]);

    useEffect(() => {
      const el = scrollerRef.current;
      if (!el || !onScrollStateChange) {
        return;
      }

      let frame = 0;
      const emit = () => {
        frame = 0;
        const now = performance.now();
        if (now - lastScrollStateEmitRef.current < 80) {
          return;
        }
        lastScrollStateEmitRef.current = now;
        onScrollStateChange({
          scrollTop: el.scrollTop,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          totalLines: lines.length,
        });
      };
      const scheduleEmit = () => {
        if (frame) {
          return;
        }
        frame = window.requestAnimationFrame(emit);
      };

      scheduleEmit();
      el.addEventListener("scroll", scheduleEmit, { passive: true });
      return () => {
        el.removeEventListener("scroll", scheduleEmit);
        if (frame) {
          window.cancelAnimationFrame(frame);
        }
      };
    }, [content, lines.length, onScrollStateChange]);

    const findLineForMatch = useCallback(
      (matchIndex: number): number => {
        for (let i = 0; i < cumulativeOffsets.length; i++) {
          if (cumulativeOffsets[i] + (lineMatchCounts[i] || 0) > matchIndex) {
            return i;
          }
        }
        return 0;
      },
      [cumulativeOffsets, lineMatchCounts],
    );

    useEffect(() => {
      if (focusLineIndex == null || focusLineIndex < 0 || focusLineIndex >= lines.length) return;
      virtuosoRef.current?.scrollToIndex({ index: focusLineIndex, align: "center", behavior: "auto" });
      window.requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: focusLineIndex, align: "center", behavior: "auto" });
      });
    }, [focusLineIndex, lines.length]);

    useEffect(() => {
      if (!onFocusLineHighlightIndex) return;
      if (focusLineIndex == null || focusLineIndex < 0 || focusLineIndex >= lines.length) return;
      if (totalMatches <= 0) return;
      const startIdx = cumulativeOffsets[focusLineIndex] ?? 0;
      const clamped = Math.max(0, Math.min(totalMatches - 1, startIdx));
      onFocusLineHighlightIndex(clamped);
    }, [focusLineIndex, lines.length, cumulativeOffsets, totalMatches, onFocusLineHighlightIndex]);

    const renderLine = useCallback(
      (index: number, item: VirtualLogViewerLineItem) => {
        const isResults = variant === "results";
        // 行首 meta 前缀解析（单次锚定正则，O(行长)；渲染期间无副作用，非 global 正则）：
        // log 视图 = 时间戳列；results 视图 = 检索结果行号列（"N | "），无时间戳不再保留 170px 时间列留白
        const timeMatch = isResults ? null : LOG_LINE_TIME_RE.exec(item.text);
        const hasTimeColumn = Boolean(timeMatch);
        const timeText = timeMatch ? timeMatch[0] : "";
        const bodyText = timeMatch ? item.text.slice(timeText.length) : item.text;

        const resultNumMatch = isResults && !isHardBlockBoundary(item.text) ? RESULT_LINE_NUM_RE.exec(item.text) : null;
        const hasNumColumn = Boolean(resultNumMatch);
        const resultNumText = resultNumMatch ? resultNumMatch[1] : "";
        const resultBodyText = resultNumMatch ? item.text.slice(resultNumMatch[0].length) : item.text;

        const isFocused = index === focusLineIndex;
        const rangeStart = selectedLineRange ? Math.min(selectedLineRange.start, selectedLineRange.end) : -1;
        const rangeEnd = selectedLineRange ? Math.max(selectedLineRange.start, selectedLineRange.end) : -1;
        const isRangeSelected = rangeStart >= 0 && index >= rangeStart && index <= rangeEnd;
        const showBookmarkControls = Boolean(bookmarks && onBookmarkToggle);
        const isBookmarked = showBookmarkControls ? index in bookmarks! : false;
        const clickable = Boolean(onLineClick);
        const errorKind = item.errorKind;
        const isHitLine = (lineMatchCounts[index] || 0) > 0;
        const layoutClass = isResults
          ? hasNumColumn
            ? " log-line-results"
            : ""
          : hasTimeColumn
            ? " log-line-ts"
            : " log-line-no-time";
        const baseClass = `log-line${layoutClass}${isFocused ? " log-line-focus" : ""}${clickable ? " log-line-clickable" : ""}${isRangeSelected ? " log-line-range-selected" : ""}${isRangeSelected && index === rangeStart ? " log-line-range-start" : ""}${isRangeSelected && index === rangeEnd ? " log-line-range-end" : ""}${errorKind ? ` log-line-level-${errorKind}` : ""}${isHitLine ? " log-line-hit" : ""}${isBookmarked ? " log-line-bookmarked" : ""}`;
        const handleClick = clickable ? (event: React.MouseEvent<HTMLDivElement>) => {
          if (!(event.metaKey || event.ctrlKey || event.shiftKey)) {
            return;
          }
          const selection = globalThis.getSelection?.();
          if (
            selection &&
            !selection.isCollapsed &&
            selection.toString().trim() &&
            ((selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) ||
              (selection.focusNode && event.currentTarget.contains(selection.focusNode)))
          ) {
            return;
          }
          onLineClick!(index, event);
        } : undefined;
        const handleDoubleClick = showBookmarkControls ? () => onBookmarkToggle!(index) : undefined;
        const title = clickable ? (lineActionTitle || "按住 Ctrl 或 Cmd 点击执行行操作") : undefined;

        const bookmarkIcon = showBookmarkControls
          ? (isBookmarked
            ? `<span class="log-bookmark-icon" title="${bookmarks![index] || "书签"}">★</span>`
            : `<span class="log-bookmark-icon log-bookmark-icon-empty">☆</span>`)
          : "";
        const focusBadge = isFocused
          ? `<span class="log-focus-badge" title="当前跳转定位">定位</span>`
          : "";
        const lineProps = {
          className: baseClass,
          "data-line-index": index,
          onClick: handleClick,
          onDoubleClick: handleDoubleClick,
          title,
        };

        const renderNumColumn = (numHtml: string, bodyHtml: string) => (
          <div {...lineProps}>
            <span className="log-line-num" dangerouslySetInnerHTML={{ __html: numHtml }} />
            <span className="log-line-body" dangerouslySetInnerHTML={{ __html: bookmarkIcon + focusBadge + bodyHtml }} />
          </div>
        );

        if (!displayHighlightRegex) {
          if (isResults) {
            if (hasNumColumn) {
              return renderNumColumn(escapeHtml(resultNumText), escapeHtml(resultBodyText) || "\u00A0");
            }
            const escaped = escapeHtml(item.text);
            return <div {...lineProps} dangerouslySetInnerHTML={{ __html: bookmarkIcon + focusBadge + (escaped || "\u00A0") }} />;
          }
          // log 视图统一两列结构：无时间戳行（堆栈/续行）渲染空时间占位，正文与上一条记录的内容列对齐；
          // 内容整体无时间戳时列宽自适应为 0（--log-time-ch: 0），行首不再出现整片留白
          return (
            <div {...lineProps}>
              <span className="log-line-time" dangerouslySetInnerHTML={{ __html: escapeHtml(timeText) }} />
              <span className="log-line-body" dangerouslySetInnerHTML={{ __html: bookmarkIcon + focusBadge + (escapeHtml(bodyText) || "\u00A0") }} />
            </div>
          );
        }

        const startMatchIdx = cumulativeOffsets[index] ?? 0;
        let matchIdx = startMatchIdx;
        const highlightReplace = (capture: string) => {
          const cls =
            matchIdx === activeHighlightIndex ? "log-highlight log-highlight-active" : "log-highlight";
          matchIdx++;
          return `<mark class="${cls}">${capture}</mark>`;
        };

        if (isResults) {
          if (hasNumColumn) {
            // 行号列与内容列各自高亮，matchIdx 顺序累加（同时间列处理）
            const numHtml = escapeHtml(resultNumText).replace(displayHighlightRegex, highlightReplace);
            const bodyHtml = escapeHtml(resultBodyText).replace(displayHighlightRegex, highlightReplace) || "\u00A0";
            return renderNumColumn(numHtml, bodyHtml);
          }

          const escaped = escapeHtml(item.text);
          if (!escaped) {
            return <div {...lineProps} dangerouslySetInnerHTML={{ __html: bookmarkIcon + focusBadge + "\u00A0" }} />;
          }

          const highlighted = escaped.replace(displayHighlightRegex, highlightReplace);

          return <div {...lineProps} dangerouslySetInnerHTML={{ __html: bookmarkIcon + focusBadge + highlighted }} />;
        }

        // 时间列与内容列各自高亮，matchIdx 顺序累加，保持与整行匹配序号一致（命中导航不受拆列影响）
        const timeHtml = escapeHtml(timeText).replace(displayHighlightRegex, highlightReplace);
        const bodyHtml = escapeHtml(bodyText).replace(displayHighlightRegex, highlightReplace) || "\u00A0";
        return (
          <div {...lineProps}>
            <span className="log-line-time" dangerouslySetInnerHTML={{ __html: timeHtml }} />
            <span className="log-line-body" dangerouslySetInnerHTML={{ __html: bookmarkIcon + focusBadge + bodyHtml }} />
          </div>
        );
      },
      [variant, displayHighlightRegex, cumulativeOffsets, activeHighlightIndex, focusLineIndex, selectedLineRange, bookmarks, onLineClick, lineActionTitle, onBookmarkToggle, lineMatchCounts],
    );

    const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.currentTarget.focus({ preventScroll: true });
      const point = getSelectionPointFromEvent(event, lines, variant);
      selectionStartRef.current = point;
      selectionEndRef.current = point;
    }, [lines, variant]);

    const handleMouseUp = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      const point = getSelectionPointFromEvent(event, lines, variant);
      if (point) {
        selectionEndRef.current = point;
      }
    }, [lines, variant]);

    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!selectedLineRange || !lines.length) {
        return;
      }

      const copyRequested = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c";
      if (copyRequested) {
        event.preventDefault();
        onCopyLineRange?.();
        return;
      }

      if (!event.shiftKey || !onSelectedLineRangeChange) {
        return;
      }

      const currentStart = Math.max(0, Math.min(selectedLineRange.start, selectedLineRange.end));
      const currentEnd = Math.min(lines.length - 1, Math.max(selectedLineRange.start, selectedLineRange.end));
      let nextRange: { start: number; end: number } | null = null;

      if (event.key === "ArrowDown") {
        nextRange = { start: currentStart, end: Math.min(lines.length - 1, currentEnd + 1) };
      } else if (event.key === "ArrowUp") {
        nextRange = { start: Math.max(0, currentStart - 1), end: currentEnd };
      } else if (event.key === "End") {
        nextRange = { start: currentStart, end: lines.length - 1 };
      } else if (event.key === "Home") {
        nextRange = { start: 0, end: currentEnd };
      }

      if (!nextRange) {
        return;
      }
      event.preventDefault();
      onSelectedLineRangeChange(nextRange);
    }, [lines.length, onCopyLineRange, onSelectedLineRangeChange, selectedLineRange]);

    const forceScrollToBottom = useCallback(() => {
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, []);

    const scrollToBottomStable = useCallback(() => {
      if (!lines.length) return;
      const lastIndex = lines.length - 1;
      virtuosoRef.current?.scrollToIndex({ index: lastIndex, align: "end", behavior: "auto" });
      // 仅在一帧后校正一次：立即叠加 scrollTop 直写会与 Virtuoso 的滚动补偿互相拉扯，造成抖动
      window.requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: lastIndex, align: "end", behavior: "auto" });
        forceScrollToBottom();
      });
    }, [forceScrollToBottom, lines.length]);

    useImperativeHandle(
      ref,
      () => ({
        scrollToTop() {
          virtuosoRef.current?.scrollToIndex({ index: 0, behavior: "auto" });
        },
        scrollToBottom() {
          scrollToBottomStable();
        },
        scrollToLine(index: number, behavior: "auto" | "smooth" = "smooth") {
          if (!lines.length) return;
          const targetLine = Math.max(0, Math.min(lines.length - 1, index));
          virtuosoRef.current?.scrollToIndex({ index: targetLine, align: "center", behavior });
        },
        scrollToHighlight(index: number) {
          if (index < 0 || index >= totalMatches) return;
          const targetLine = findLineForMatch(index);
          virtuosoRef.current?.scrollToIndex({ index: targetLine, align: "center", behavior: "smooth" });
        },
        getLineRangeText(startLine: number, endLine: number) {
          if (!lines.length) return "";
          const start = Math.max(0, Math.min(startLine, endLine));
          const end = Math.min(lines.length - 1, Math.max(startLine, endLine));
          return lines.slice(start, end + 1).join("\n");
        },
        getLogBlockText(lineIndex: number) {
          const range = getLogBlockRange(lines, lineIndex);
          if (!range) return null;
          return {
            ...range,
            text: lines.slice(range.start, range.end + 1).join("\n"),
          };
        },
        getSelectionText(selection: Selection) {
          const anchorLine = findClosestLineIndex(selection.anchorNode);
          const focusLine = findClosestLineIndex(selection.focusNode);
          const domText = selection.toString();
          const pointText = selectionStartRef.current && selectionEndRef.current
            ? buildSelectionTextFromPoints(lines, selectionStartRef.current, selectionEndRef.current)
            : "";
          if (pointText.trim() && pointText.length >= domText.length) {
            return pointText;
          }
          if (anchorLine == null || focusLine == null) {
            return domText;
          }
          const startLine = Math.max(0, Math.min(anchorLine, focusLine));
          const endLine = Math.min(lines.length - 1, Math.max(anchorLine, focusLine));
          if (startLine === endLine) {
            return domText;
          }
          const selectedLineText = lines.slice(startLine, endLine + 1).join("\n");
          return selectedLineText || domText;
        },
        getScrollState() {
          const el = scrollerRef.current;
          if (!el) return null;
          return {
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          };
        },
        getScrollerElement() {
          return scrollerRef.current;
        },
      }),
      [lines, scrollToBottomStable, totalMatches, findLineForMatch],
    );

    if (!content) {
      return <div className={className} />;
    }

    return (
      <div
        className={className}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onWheel={onWheel}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        <Virtuoso
          ref={virtuosoRef}
          data={lineItems}
          scrollerRef={(el) => {
            scrollerRef.current = el as HTMLElement | null;
          }}
          components={{ Scroller: VirtuosoScroller }}
          itemContent={renderLine}
          defaultItemHeight={17}
          followOutput={followOutput ? "auto" : false}
          atBottomThreshold={200}
          atBottomStateChange={(atBottom) => onNearBottomChange?.(atBottom)}
          overscan={300}
          style={{ height: "100%", width: "100%" }}
        />
      </div>
    );
  },
);

export const VirtualLogViewer = React.memo(VirtualLogViewerImpl);
