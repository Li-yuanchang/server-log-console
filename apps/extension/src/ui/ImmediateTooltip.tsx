import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function ImmediateTooltip({ ownerDocument }: { ownerDocument?: Document }) {
  const [tip, setTip] = useState<{ t: string; x: number; y: number; b: boolean } | null>(null);

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
      const t = el.title.trim();
      if (!t) return clear();
      if (active !== el) putBack(active);
      active = el;
      el.dataset.instantTip = t;
      el.removeAttribute("title");
      const r = el.getBoundingClientRect();
      const b = r.top < 44;
      setTip({ t, x: r.left + r.width / 2, y: b ? r.bottom + 8 : r.top - 8, b });
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
  if (!tip || !d.body) return null;
  return createPortal(<div className={`instant-tooltip${tip.b ? " instant-tooltip-below" : ""}`} style={{ left: tip.x, top: tip.y }}>{tip.t}</div>, d.body);
}
