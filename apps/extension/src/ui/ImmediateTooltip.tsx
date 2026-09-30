import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { arrow, flip, offset, shift, useFloating } from "@floating-ui/react-dom";

export function ImmediateTooltip({ ownerDocument }: { ownerDocument?: Document }) {
  const [tip, setTip] = useState<{ t: string; ref: HTMLElement } | null>(null);
  const arrowRef = useRef<HTMLDivElement | null>(null);
  const { refs, floatingStyles, placement, middlewareData, update } = useFloating({
    placement: "top",
    middleware: [offset(5), flip({ padding: 8 }), shift({ padding: 8 }), arrow({ element: arrowRef, padding: 6 })],
  });
  const below = placement.startsWith("bottom");

  useLayoutEffect(() => {
    if (tip) {
      refs.setReference(tip.ref);
      update();
    }
  }, [tip, refs, update]);

  useEffect(() => {
    const d = ownerDocument ?? document;
    let active: HTMLElement | null = null;
    const putBack = (el: HTMLElement | null) => {
      if (!el) return;
      const v = el.dataset.instantTip;
      if (v !== undefined) {
        el.title = v;
        delete el.dataset.instantTip;
      }
    };
    const clear = () => {
      putBack(active);
      active = null;
      setTip(null);
    };
    const find = (n: EventTarget | null) => n instanceof Element ? n.closest("[title], [data-instant-tip]") as HTMLElement | null : null;
    const show = (el: HTMLElement) => {
      const t = (el.title || el.dataset.instantTip || "").trim();
      if (!t) return clear();
      if (active !== el) {
        putBack(active);
        active = el;
        el.dataset.instantTip = t;
        el.removeAttribute("title");
      }
      setTip({ t, ref: el });
    };
    const over = (e: MouseEvent) => {
      const el = find(e.target);
      if (el) show(el);
      else clear();
    };
    const out = (e: MouseEvent) => {
      if (!active) return;
      const n = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      if (n && active.contains(n)) return;
      clear();
    };
    const focus = (e: FocusEvent) => {
      const el = find(e.target);
      if (el) show(el);
      else clear();
    };
    d.addEventListener("mouseover", over, true);
    d.addEventListener("mouseout", out, true);
    d.addEventListener("focusin", focus, true);
    d.addEventListener("focusout", clear, true);
    d.addEventListener("scroll", clear, true);
    d.addEventListener("pointerdown", clear, true);
    return () => {
      d.removeEventListener("mouseover", over, true);
      d.removeEventListener("mouseout", out, true);
      d.removeEventListener("focusin", focus, true);
      d.removeEventListener("focusout", clear, true);
      d.removeEventListener("scroll", clear, true);
      d.removeEventListener("pointerdown", clear, true);
      clear();
    };
  }, [ownerDocument]);

  const d = ownerDocument ?? document;
  // 主题变量定义在 .app-shell（.theme-modern）上，portal 到 body 拿不到，需挂进主题容器
  const portalTarget = (d.querySelector(".app-shell") as HTMLElement | null) ?? d.body;
  if (!tip || !portalTarget) return null;
  const arrowX = middlewareData.arrow?.x;
  const arrowY = middlewareData.arrow?.y;
  return createPortal(
    <div
      ref={refs.setFloating}
      className={`instant-tooltip${below ? " instant-tooltip-below" : ""}`}
      style={floatingStyles}
    >
      {tip.t}
      <div
        ref={arrowRef}
        className="instant-tooltip-arrow"
        style={{
          ...(arrowX != null ? { left: `${arrowX}px` } : {}),
          ...(arrowY != null ? { top: `${arrowY}px` } : {}),
        }}
      />
    </div>,
    portalTarget,
  );
}
