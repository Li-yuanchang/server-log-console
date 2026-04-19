import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { escapeHtml, escapeRegExp } from "./utils.js";
import { detectLogHighlightKind, type LogHighlightKind } from "./logHighlighting.js";

const VirtuosoScroller = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function VirtuosoScroller(props, ref) {
    return <div {...props} ref={ref} className={`virtuoso-scroller ${props.className ?? ""}`} />;
  },
);

export interface VirtualLogViewerHandle {
  scrollToTop(): void;
  scrollToBottom(): void;
  scrollToLine(index: number, behavior?: "auto" | "smooth"): void;
  scrollToHighlight(index: number): void;
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
  onLineClick?: (lineIndex: number, event: React.MouseEvent<HTMLDivElement>) => void;
  onHighlightCountChange?: (count: number) => void;
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
      onLineClick,
      onHighlightCountChange,
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

    const highlightRegex = useMemo(() => {
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
      if (!highlightRegex || !lines.length) {
        return { lineMatchCounts: [] as number[], cumulativeOffsets: [] as number[], totalMatches: 0 };
      }
      const counts: number[] = [];
      const offsets: number[] = [];
      let cumulative = 0;
      for (const line of lines) {
        offsets.push(cumulative);
        const escaped = escapeHtml(line);
        const matches = escaped.match(highlightRegex);
        const count = matches?.length ?? 0;
        counts.push(count);
        cumulative += count;
      }
      return { lineMatchCounts: counts, cumulativeOffsets: offsets, totalMatches: cumulative };
    }, [lines, highlightRegex]);

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
      if (activeHighlightIndex < 0 || activeHighlightIndex >= totalMatches) return;
      const targetLine = findLineForMatch(activeHighlightIndex);
      virtuosoRef.current?.scrollToIndex({ index: targetLine, align: "center", behavior: "smooth" });
    }, [activeHighlightIndex, totalMatches, findLineForMatch]);

    useEffect(() => {
      if (focusLineIndex == null || focusLineIndex < 0 || focusLineIndex >= lines.length) return;
      virtuosoRef.current?.scrollToIndex({ index: focusLineIndex, align: "center", behavior: "smooth" });
    }, [focusLineIndex, lines.length]);

    const renderLine = useCallback(
      (index: number, item: VirtualLogViewerLineItem) => {
        const escaped = escapeHtml(item.text);

        const isFocused = index === focusLineIndex;
        const clickable = Boolean(onLineClick);
        const errorKind = item.errorKind;
        const baseClass = `log-line${isFocused ? " log-line-focus" : ""}${clickable ? " log-line-clickable" : ""}${errorKind ? ` log-line-level-${errorKind}` : ""}`;
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
        const title = clickable ? "按住 Ctrl 或 Cmd 点击可跳转到原日志" : undefined;

        if (!highlightRegex || !escaped) {
          return <div className={baseClass} onClick={handleClick} title={title} dangerouslySetInnerHTML={{ __html: escaped || "\u00A0" }} />;
        }

        const startMatchIdx = cumulativeOffsets[index] ?? 0;
        let matchIdx = startMatchIdx;
        const highlighted = escaped.replace(highlightRegex, (_match, capture: string) => {
          const cls =
            matchIdx === activeHighlightIndex ? "log-highlight log-highlight-active" : "log-highlight";
          matchIdx++;
          return `<mark class="${cls}">${capture}</mark>`;
        });

        return <div className={baseClass} onClick={handleClick} title={title} dangerouslySetInnerHTML={{ __html: highlighted }} />;
      },
      [highlightRegex, cumulativeOffsets, activeHighlightIndex, focusLineIndex, onLineClick],
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToTop() {
          virtuosoRef.current?.scrollToIndex({ index: 0, behavior: "auto" });
        },
        scrollToBottom() {
          virtuosoRef.current?.scrollToIndex({ index: lines.length - 1, align: "end", behavior: "auto" });
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
      [lines.length, totalMatches, findLineForMatch],
    );

    if (!content) {
      return <div className={className} />;
    }

    return (
      <div className={className} onWheel={onWheel}>
        <Virtuoso
          ref={virtuosoRef}
          data={lineItems}
          scrollerRef={(el) => {
            scrollerRef.current = el as HTMLElement | null;
          }}
          components={{ Scroller: VirtuosoScroller }}
          itemContent={renderLine}
          defaultItemHeight={17}
          followOutput={followOutput ? "smooth" : false}
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
