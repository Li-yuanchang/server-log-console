/**
 * useAnchoredMenuPosition — 右键菜单的真实尺寸定位。
 *
 * 背景（用户反馈：文件区右键菜单贴底时被遮盖）：
 * 各菜单此前要么直接用鼠标坐标，要么用「硬编码估算高度」预先夹紧
 * （如 useLogViewer 里的 260/190，而文件菜单实际 11 项、真实高度约 340~400px）。
 * 估算值一旦小于真实尺寸，算出来的「安全位置」就不安全 —— 贴底右键必然越界。
 *
 * 本 hook 的做法：
 *  1. 先按鼠标坐标离屏渲染（visibility:hidden，避免闪跳）
 *  2. 用 offsetWidth/offsetHeight 量测真实尺寸
 *  3. 下方放不下且上方更宽裕 → 向上翻转；右侧同理向左翻转
 *  4. 翻转后仍越界（极端窄/矮窗口）→ 收敛到视口内并留 gap
 *  5. 若菜单比视口还高 → 限制 maxHeight 并允许内部滚动，保证永远不裁
 *
 * 三处菜单（文件行、文件空白处、工作区页签）共用这一份逻辑，避免各自维护估算值。
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

export type AnchoredMenuOptions = {
  /** false 时不做定位（菜单未挂载），并清掉缓存的位置 */
  enabled?: boolean;
  /**
   * 菜单内容指纹：条目数量/类型变化时重新量测。
   * 同一坐标但不同条目（文件 vs 目录、是否压缩包）高度不同，必须重新算。
   */
  contentKey?: string;
  /** 父级用于「点击外部关闭」的 ref；会与内部量测 ref 合并到同一元素 */
  externalRef?: RefObject<HTMLDivElement | null>;
  /** 距视口边缘的最小呼吸间距 */
  gap?: number;
};

/**
 * @param x 鼠标视口坐标 x（不要预先夹紧，交给本 hook）
 * @param y 鼠标视口坐标 y
 * @returns [合并后的 callback ref, 计算好的定位样式]
 */
export function useAnchoredMenuPosition(
  x: number,
  y: number,
  options: AnchoredMenuOptions = {}
): readonly [(node: HTMLDivElement | null) => void, CSSProperties] {
  const { enabled = true, contentKey = "", externalRef, gap = 8 } = options;

  const elRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  // 合并 ref：内部量测 + 父级外部关闭检测都要拿到同一个 DOM 节点
  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      elRef.current = node;
      if (externalRef) {
        externalRef.current = node;
      }
    },
    [externalRef]
  );

  useLayoutEffect(() => {
    if (!enabled) {
      setStyle(null);
      return;
    }
    const el = elRef.current;
    if (!el) return;

    const menuWidth = el.offsetWidth;
    const menuHeight = el.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // 纵向：默认向下展开；下方放不下且上方更宽裕时翻到鼠标上方
    const spaceBelow = viewportHeight - y;
    const spaceAbove = y;
    const flipUp = menuHeight > spaceBelow - gap && spaceAbove > spaceBelow;

    // 横向：默认向右展开；右侧放不下且左侧更宽裕时翻到鼠标左侧
    const spaceRight = viewportWidth - x;
    const spaceLeft = x;
    const flipLeft = menuWidth > spaceRight - gap && spaceLeft > spaceRight;

    const targetLeft = flipLeft ? x - menuWidth : x;
    const targetTop = flipUp ? y - menuHeight : y;

    // 最终收敛：翻转后仍越界（极端窄/矮窗口）就贴边
    const maxLeft = Math.max(gap, viewportWidth - menuWidth - gap);
    const maxTop = Math.max(gap, viewportHeight - menuHeight - gap);
    const left = Math.min(Math.max(targetLeft, gap), maxLeft);
    const top = Math.min(Math.max(targetTop, gap), maxTop);

    const next: CSSProperties = { left, top };

    // 菜单比视口还高：限制高度并内部滚动，否则无论怎么翻转都会被裁
    const availableHeight = viewportHeight - gap * 2;
    if (menuHeight > availableHeight) {
      next.maxHeight = availableHeight;
      next.overflowY = "auto";
      next.top = gap;
    }

    setStyle(next);
  }, [x, y, enabled, contentKey, gap]);

  // 量测完成前先离屏渲染，避免用户看到菜单从错误位置跳一下
  const resolved: CSSProperties = style ?? { left: x, top: y, visibility: "hidden" };

  return [setRef, resolved] as const;
}
