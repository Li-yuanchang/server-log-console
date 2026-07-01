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

function getSelectionPointFromEvent(event: MouseEvent | React.MouseEvent, lines: string[]): ViewerSelectionPoint | null {
  const lineElement = getLineElementFromPoint(event.clientX, event.clientY);
  if (!lineElement) {
    return null;
  }
  const lineIndex = Number(lineElement.dataset.lineIndex);
  if (!Number.isFinite(lineIndex) || lineIndex < 0 || lineIndex >= lines.length) {
    return null;
  }
  const lineText = lines[lineIndex] ?? "";
  const range = document.createRange();
  range.selectNodeContents(lineElement);
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
  range.detach();

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

export interface VirtualLogViewerHandle {
  scrollToTop(): void;
  scrollToBottom(): void;
  scrollToLine(index: number, behavior?: "auto" | "smooth"): void;
  scrollToHighlight(index: number): void;
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
  content: string;
  keywordTerms: string[];
  useRegex: boolean;
  activeHighlightIndex: number;
  focusLineIndex?: number;
  bookmarks?: Record<number, string>;
  onLineClick?: (lineIndex: number, event: React.MouseEvent<HTMLDivElement>) => void;
  onBookmarkToggle?: (lineIndex: number) => void;
  onHighlightCountChange?: (count: number) => void;
  onFocusLineHighlightIndex?: (index: number) => void;
  onMatchLineIndicesChange?: (lineIndices: number[], totalLines: number) => void;
  onWheel?: (event: React.WheelEvent<HTMLDivElement>) => void;
  onNearBottomChange?: (nearBottom: boolean) => void;
  onScrollStateChange?: (state: VirtualLogViewerScrollState) => void;
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
      content,
      keywordTerms,
      useRegex,
      activeHighlightIndex,
      focusLineIndex,
      bookmarks,
      onLineClick,
      onBookmarkToggle,
      onHighlightCountChange,
      onFocusLineHighlightIndex,
      onMatchLineIndicesChange,
      onWheel,
      onNearBottomChange,
      onScrollStateChange,
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
      virtuosoRef.current?.scrollToIndex({ index: focusLineIndex, align: "center", behavior: "smooth" });
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
        const escaped = escapeHtml(item.text);

        const isFocused = index === focusLineIndex;
        const showBookmarkControls = Boolean(bookmarks && onBookmarkToggle);
        const isBookmarked = showBookmarkControls ? index in bookmarks! : false;
        const clickable = Boolean(onLineClick);
        const errorKind = item.errorKind;
        const baseClass = `log-line${isFocused ? " log-line-focus" : ""}${clickable ? " log-line-clickable" : ""}${errorKind ? ` log-line-level-${errorKind}` : ""}${isBookmarked ? " log-line-bookmarked" : ""}`;
        const handleClick = clickable ? (event: React.MouseEvent<HTMLDivElement>) => {
          if (!(event.metaKey || event.ctrlKey)) {
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
        const title = clickable ? "按住 Ctrl 或 Cmd 点击可跳转到原日志" : undefined;

        const bookmarkIcon = showBookmarkControls
          ? (isBookmarked
            ? `<span class="log-bookmark-icon" title="${bookmarks![index] || "书签"}">★</span>`
            : `<span class="log-bookmark-icon log-bookmark-icon-empty">☆</span>`)
          : "";
        const focusBadge = isFocused
          ? `<span class="log-focus-badge" title="当前跳转定位">定位</span>`
          : "";

        if (!displayHighlightRegex || !escaped) {
          return <div className={baseClass} data-line-index={index} onClick={handleClick} onDoubleClick={handleDoubleClick} title={title} dangerouslySetInnerHTML={{ __html: bookmarkIcon + focusBadge + (escaped || "\u00A0") }} />;
        }

        const startMatchIdx = cumulativeOffsets[index] ?? 0;
        let matchIdx = startMatchIdx;
        const highlighted = escaped.replace(displayHighlightRegex, (_match, capture: string) => {
          const cls =
            matchIdx === activeHighlightIndex ? "log-highlight log-highlight-active" : "log-highlight";
          matchIdx++;
          return `<mark class="${cls}">${capture}</mark>`;
        });

        return <div className={baseClass} data-line-index={index} onClick={handleClick} onDoubleClick={handleDoubleClick} title={title} dangerouslySetInnerHTML={{ __html: bookmarkIcon + focusBadge + highlighted }} />;
      },
      [displayHighlightRegex, cumulativeOffsets, activeHighlightIndex, focusLineIndex, bookmarks, onLineClick, onBookmarkToggle],
    );

    const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const point = getSelectionPointFromEvent(event, lines);
      selectionStartRef.current = point;
      selectionEndRef.current = point;
    }, [lines]);

    const handleMouseUp = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
      const point = getSelectionPointFromEvent(event, lines);
      if (point) {
        selectionEndRef.current = point;
      }
    }, [lines]);

    const forceScrollToBottom = useCallback(() => {
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    }, []);

    const scrollToBottomStable = useCallback(() => {
      if (!lines.length) return;
      const lastIndex = lines.length - 1;
      virtuosoRef.current?.scrollToIndex({ index: lastIndex, align: "end", behavior: "auto" });
      forceScrollToBottom();
      window.requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: lastIndex, align: "end", behavior: "auto" });
        forceScrollToBottom();
        window.requestAnimationFrame(forceScrollToBottom);
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
      <div className={className} onWheel={onWheel} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp}>
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
