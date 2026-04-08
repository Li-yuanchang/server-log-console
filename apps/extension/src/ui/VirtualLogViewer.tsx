import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { escapeHtml, escapeRegExp } from "./utils.js";

const VirtuosoScroller = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function VirtuosoScroller(props, ref) {
    return <div {...props} ref={ref} className={`virtuoso-scroller ${props.className ?? ""}`} />;
  },
);

export interface VirtualLogViewerHandle {
  scrollToTop(): void;
  scrollToBottom(): void;
  scrollToHighlight(index: number): void;
  getScrollState(): { scrollTop: number; scrollHeight: number; clientHeight: number } | null;
  getScrollerElement(): HTMLElement | null;
}

interface Props {
  content: string;
  keywordTerms: string[];
  useRegex: boolean;
  activeHighlightIndex: number;
  onHighlightCountChange?: (count: number) => void;
  onWheel?: (event: React.WheelEvent<HTMLDivElement>) => void;
  onNearBottomChange?: (nearBottom: boolean) => void;
  followOutput?: boolean;
  className?: string;
}

export const VirtualLogViewer = forwardRef<VirtualLogViewerHandle, Props>(
  function VirtualLogViewer(props, ref) {
    const {
      content,
      keywordTerms,
      useRegex,
      activeHighlightIndex,
      onHighlightCountChange,
      onWheel,
      onNearBottomChange,
      followOutput,
      className,
    } = props;

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);

    const lines = useMemo(() => {
      if (!content) return [];
      return content.split("\n");
    }, [content]);

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

    const renderLine = useCallback(
      (index: number) => {
        const line = lines[index];
        const escaped = escapeHtml(line ?? "");

        if (!highlightRegex || !escaped) {
          return <div className="log-line" dangerouslySetInnerHTML={{ __html: escaped || "\u00A0" }} />;
        }

        const startMatchIdx = cumulativeOffsets[index] ?? 0;
        let matchIdx = startMatchIdx;
        const highlighted = escaped.replace(highlightRegex, (_match, capture: string) => {
          const cls =
            matchIdx === activeHighlightIndex ? "log-highlight log-highlight-active" : "log-highlight";
          matchIdx++;
          return `<mark class="${cls}">${capture}</mark>`;
        });

        return <div className="log-line" dangerouslySetInnerHTML={{ __html: highlighted }} />;
      },
      [lines, highlightRegex, cumulativeOffsets, activeHighlightIndex],
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
          scrollerRef={(el) => {
            scrollerRef.current = el as HTMLElement | null;
          }}
          components={{ Scroller: VirtuosoScroller }}
          totalCount={lines.length}
          itemContent={renderLine}
          defaultItemHeight={17}
          followOutput={followOutput ? "smooth" : false}
          atBottomStateChange={(atBottom) => onNearBottomChange?.(atBottom)}
          overscan={300}
          style={{ height: "100%", width: "100%" }}
        />
      </div>
    );
  },
);
