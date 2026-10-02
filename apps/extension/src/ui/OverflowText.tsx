import { useEffect, useRef, useState, type CSSProperties } from "react";

type Props = {
  text: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * 文本溢出（被省略号截断）时才挂原生 title 提示；内容完整时不显示。
 *
 * 背景（用户反馈 2026-10-01）：静态 title 会在内容未省略时也弹出 tooltip，
 * 与可见文本完全重复、干扰视线。仅当 scrollWidth > clientWidth（真的被截断）
 * 才提示，让 tooltip 只承担「显示被省略内容」的职责。
 */
export function OverflowText({ text, className, style }: Props) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      /* +1 容差：亚像素布局下 scrollWidth/clientWidth 会差 1px 的舍入抖动 */
      setOverflowing(el.scrollWidth > el.clientWidth + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span ref={ref} className={className} style={style} title={overflowing ? text : undefined}>
      {text}
    </span>
  );
}
