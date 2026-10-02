import { useState } from "react";
import { createPortal } from "react-dom";
import { ToolIcon } from "./ToolIcon.js";
import { useEffect, useRef } from "react";

type Props = {
  uiTheme: "classic" | "modern";
  hasServer: boolean;
  isBusy: boolean;
  filterValue: string;
  showPathHistory: boolean;
  showTransferHistory: boolean;
  onFilterChange: (value: string) => void;
  onBrowseParent: () => void;
  onTogglePathHistory: () => void;
  onToggleTransferHistory: () => void;
  onMkdir: () => void;
  onUploadFiles: () => void;
  onUploadDirectory: () => void;
  onRefresh: () => void;
};

/** S6 原型 632-635：工具行 = 常驻 150×24「过滤当前目录…」输入框 + 上传 / 刷新 / 更多（3 个图标）。
 *  「返回上级」属导航（目录树/面包屑已可完成），下沉到 ⋯ 菜单保留能力，不再占图标位。 */
export function FileBrowserActions(props: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  /* 菜单 Portal 到 body + fixed 定位（用户反馈 2026-09-30：菜单在某些窗口状态下
     被祖先容器盖住不显示）——脱离命令行的 overflow/堆叠上下文，物理上不可能再被盖 */
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);

  const syncMenuPos = () => {
    const wrap = moreRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    setMenuPos({
      top: Math.min(rect.bottom + 6, window.innerHeight - 240),
      right: Math.max(8, window.innerWidth - rect.right),
    });
  };

  useEffect(() => {
    if (!moreOpen) return;
    syncMenuPos();
    /* 滚动/resize 时菜单跟随按钮重算位置，避免悬空错位 */
    window.addEventListener("scroll", syncMenuPos, true);
    window.addEventListener("resize", syncMenuPos);
    return () => {
      window.removeEventListener("scroll", syncMenuPos, true);
      window.removeEventListener("resize", syncMenuPos);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (moreRef.current?.contains(target)) return;
      /* Portal 后菜单挂在 body 下，也要算作"菜单内部" */
      if (target?.closest(".fb-more-menu")) return;
      setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [moreOpen]);

  return (
    <>
      {/* S6 原型 632：过滤入口常驻（150×24），不再是图标开合 */}
      <input
        className="fb-filter-input"
        value={props.filterValue}
        onChange={(event) => props.onFilterChange(event.target.value)}
        placeholder="过滤当前目录…"
        disabled={!props.hasServer}
        aria-label="过滤当前目录"
      />
      <button className="ghost-button icon-button" title="上传文件" onClick={props.onUploadFiles} disabled={props.isBusy || !props.hasServer}>
        <ToolIcon theme={props.uiTheme} kind="upload" />
      </button>
      {/* D1: 刷新目录是只读查看操作，忙碌期间保持可用；写类（新建/上传）仍锁忙碌 */}
      <button className="ghost-button icon-button" title="刷新目录" onClick={props.onRefresh} disabled={!props.hasServer}>
        <ToolIcon theme={props.uiTheme} kind="refresh" />
      </button>
      <div className="fb-more-wrap" ref={moreRef}>
        <button
          className={moreOpen ? "ghost-button icon-button tab-active" : "ghost-button icon-button"}
          title="返回上级 / 新建目录 / 上传目录 / 历史与传输记录"
          onClick={() => setMoreOpen((current) => !current)}
          disabled={!props.hasServer}
        >
          <ToolIcon theme={props.uiTheme} kind="more" />
        </button>
        {moreOpen && menuPos ? createPortal(
          /* 套一层 display:contents 的主题壳：Portal 到 body 会脱离 .theme-modern 作用域，
             `.theme-modern .fb-more-menu` 等规则（背景/边框/圆角/投影/列布局）会全部失配。
             壳不生成盒模型、不影响布局，仅恢复后代选择器命中（fixed 定位仍相对视口）。 */
          <div className={props.uiTheme === "modern" ? "theme-modern" : undefined} style={{ display: "contents" }}>
            <div
              className="fb-more-menu"
              role="menu"
              style={{ position: "fixed", top: menuPos.top, right: menuPos.right, zIndex: 11060 }}
            >
              <button type="button" className="fb-more-item" role="menuitem" onClick={() => { setMoreOpen(false); props.onBrowseParent(); }} disabled={!props.hasServer}>
                <ToolIcon theme={props.uiTheme} kind="open" />
                返回上级
              </button>
              <div className="fb-more-sep" />
              <button type="button" className="fb-more-item" role="menuitem" onClick={() => { setMoreOpen(false); props.onMkdir(); }} disabled={props.isBusy}>
                <ToolIcon theme={props.uiTheme} kind="folder-plus" />
                新建目录
              </button>
              <button type="button" className="fb-more-item" role="menuitem" onClick={() => { setMoreOpen(false); props.onUploadDirectory(); }} disabled={props.isBusy}>
                <ToolIcon theme={props.uiTheme} kind="folder-up" />
                上传目录
              </button>
              <div className="fb-more-sep" />
              <button type="button" className="fb-more-item" role="menuitem" onClick={() => { setMoreOpen(false); props.onTogglePathHistory(); }}>
                <ToolIcon theme={props.uiTheme} kind="history" />
                最近访问的目录
              </button>
              <button type="button" className="fb-more-item" role="menuitem" onClick={() => { setMoreOpen(false); props.onToggleTransferHistory(); }}>
                <ToolIcon theme={props.uiTheme} kind="transfer" />
                传输记录
              </button>
            </div>
          </div>,
          document.body,
        ) : null}
      </div>
    </>
  );
}
