import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/* 终端 fit 自适应 hook：收敛原先散落三处的 setTimeout 连发 fit
   （TerminalWorkspace.tsx / TerminalPane.tsx 的 [0, 48, 140, 320, 640] 连发模式）。
   改为 ResizeObserver 监听容器真实尺寸变化，触发后 requestAnimationFrame + 32ms
   去抖调用 fit——拖分屏、折叠侧栏、窗口缩放都只走这一条路径。 */

/** ResizeObserver 触发后的去抖窗口（ms）：等布局稳定再 fit，避免连续拖拽时反复重排 */
const FIT_DEBOUNCE_MS = 32;

/**
 * 监听终端容器尺寸变化并自动调用 fit。
 * - fit 经 ref 持有：调用方每次渲染传入新函数不会导致观察器重订阅；
 * - containerRef.current 变化（换挂载点 / 分屏重排）时自动重挂观察器；
 * - 卸载时 disconnect 并清理 pending 的 rAF / timer。
 */
export function useTerminalFit(containerRef: RefObject<HTMLElement | null>, fit: () => void): void {
  const fitRef = useRef(fit);

  // 每次渲染同步最新 fit，避免定时器回调闭包捕获旧函数
  useEffect(() => {
    fitRef.current = fit;
  });

  // 把 containerRef.current 镜像到 state：ref 换节点时才触发下方 effect 重挂观察器
  const [container, setContainer] = useState<HTMLElement | null>(() => containerRef.current);
  useEffect(() => {
    setContainer(containerRef.current);
  });

  useEffect(() => {
    if (!container) {
      return;
    }
    let frame: number | null = null;
    let timer: number | null = null;
    const scheduleFit = () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        if (timer !== null) {
          window.clearTimeout(timer);
        }
        timer = window.setTimeout(() => {
          timer = null;
          fitRef.current();
        }, FIT_DEBOUNCE_MS);
      });
    };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [container]);
}
