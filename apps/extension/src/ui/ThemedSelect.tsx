import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type ThemedSelectOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

type Props<T extends string | number> = {
  value: T;
  options: Array<ThemedSelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  title?: string;
  /** 菜单宽度跟随触发器（默认）；传固定值可覆盖 */
  menuWidth?: number | "trigger";
};

// 主题化下拉（原型 .input 形态 + 自绘菜单）：替代原生 <select>，
// 菜单 portal 到 body 并 fixed 定位，避免被 overflow 容器裁剪；
// 菜单壳复制 .app-shell 类名以继承皮肤令牌（与 Drawer 同理）。
export function ThemedSelect<T extends string | number>(props: Props<T>) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number; w: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const selected = props.options.find((option) => option.value === props.value);

  function updateCoords() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ x: rect.left, y: rect.bottom, w: rect.width });
  }

  function openMenu() {
    if (props.disabled) return;
    updateCoords();
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open) return;
    // 打开后校正：若菜单下方放不下且上方更宽裕，则向上翻
    const menu = menuRef.current;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (menu && rect) {
      const menuH = menu.offsetHeight;
      const below = window.innerHeight - rect.bottom;
      if (below < menuH + 8 && rect.top > menuH + 8) {
        setCoords((current) => (current ? { ...current, y: rect.top - menuH } : current));
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const onReposition = () => setOpen(false);
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onReposition);
    };
  }, [open]);

  const shellClassName = typeof document !== "undefined"
    ? document.querySelector(".app-shell")?.className ?? "theme-modern"
    : "theme-modern";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`themed-select-trigger${props.className ? ` ${props.className}` : ""}${open ? " themed-select-open" : ""}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.ariaLabel}
        title={props.title}
      >
        <span className="themed-select-value">{selected ? selected.label : "\u00a0"}</span>
        <ChevronDown size={13} strokeWidth={1.8} className="themed-select-chevron" aria-hidden="true" />
      </button>
      {open && coords ? createPortal(
        <div className={shellClassName} style={{ display: "contents" }}>
          <div
            ref={menuRef}
            className="themed-select-menu"
            role="listbox"
            style={{
              left: `${coords.x}px`,
              top: `${coords.y}px`,
              width: props.menuWidth === undefined || props.menuWidth === "trigger" ? `${coords.w}px` : `${props.menuWidth}px`,
              zIndex: 9800,
            }}
          >
            {props.options.map((option) => {
              const isSelected = option.value === props.value;
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  className={`themed-select-item${isSelected ? " themed-select-item-selected" : ""}`}
                  onClick={() => {
                    props.onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="themed-select-item-label">{option.label}</span>
                  {isSelected ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
