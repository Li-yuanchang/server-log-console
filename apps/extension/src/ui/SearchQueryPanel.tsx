import { useRef, useState, type RefObject } from "react";
import { Download, Search } from "lucide-react";
import { Drawer } from "./Drawer.js";
import type { SearchSettingsState } from "./utils.js";
import { readSearchHistory } from "./storage.js";
import { ThemedSelect } from "./ThemedSelect.js";

type SearchQueryPreset = {
  label: string;
  apply: () => void;
};

type Props = {
  showKeywordBar: boolean;
  showQueryAdvanced: boolean;
  hasServer: boolean;
  keywordInputRef: RefObject<HTMLInputElement | null>;
  onKeywordInputChange: (value: string) => void;
  onRunSearch: () => void;
  showSummary: boolean;
  toolbarSummaryLabel: string;
  toolbarMetaLabel: string;
  settings: SearchSettingsState;
  onKeywordModeChange: (value: SearchSettingsState["keywordMode"]) => void;
  onExcludeInputChange: (value: string) => void;
  onContextLinesChange: (value: number) => void;
  onToggleRegex: () => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onStartTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  searchPresets: SearchQueryPreset[];
  onResetAdvanced: () => void;
  onToggleQueryAdvanced: () => void;
  multiFileMode: boolean;
  onToggleMultiFileMode: () => void;
  filePattern: string;
  onFilePatternChange: (value: string) => void;
  searching: boolean;
  /** 检索进行中显示在按钮上的进度标签（原型 S13：进度内联在按钮上，如 `340MB/1.2GB`）。
      为空时回落为「检索中」。 */
  searchProgressLabel?: string;
  highlightSummary: string;
  onHighlightPrev: () => void;
  onHighlightNext: () => void;
  resultContextMode: boolean;
  canToggleResultContext: boolean;
  onToggleResultContext: () => void;
  canDownloadResults: boolean;
  onDownloadResults: () => void;
};

export function SearchQueryPanel(props: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<string[]>([]);
  const historyShellRef = useRef<HTMLDivElement | null>(null);

  /* 2026-10-25 用户决策：「先不显示搜索记录了」—— 聚焦不再自动弹出历史浮层。
     背景：原实现 onFocus 无条件 setHistoryOpen(true)，即聚焦就弹；即使没有历史
     记录，浮层也会先挂载成一个只有边框底色的空白框（用户截图里搜索框下方那块
     白块），一聚焦就出现、很恼人。用户明确要求默认不显示。

     现在的行为：
       · 聚焦输入框 → 不弹任何浮层；
       · 历史记录**仍在照常写入**（pushSearchHistory 不变），只是默认不展示 ——
         将来若需要，可改用显式入口（如输入框右侧的历史按钮）唤出。
       · openHistory 保留但从 onFocus 解绑，改为由 ⌥↓ 这类显式操作触发，
         不作为默认行为打扰输入。 */
  function openHistory() {
    const items = readSearchHistory();
    if (!items.length) {
      setHistoryItems([]);
      setHistoryOpen(false);
      return;
    }
    setHistoryItems(items);
    setHistoryOpen(true);
  }

  return (
    <>
      {props.showKeywordBar ? (
        <div className="toolbar-search-row" ref={historyShellRef}>
          <div className="keyword-shell" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHistoryOpen(false);
          }}>
            <span className="keyword-input-icon" aria-hidden="true"><Search size={13} strokeWidth={1.8} /></span>
            <input
              ref={props.keywordInputRef}
              type="search"
              autoComplete="off"
              enterKeyHint="search"
              className="command-input command-input-keyword"
              value={props.settings.keywordInput}
              onChange={(event) => props.onKeywordInputChange(event.target.value)}
              /* 2026-10-25：移除 onFocus={openHistory}。
                 聚焦不再自动弹历史 —— 用户反馈「有时候根本不需要，一直出现让人恼火」。
                 历史浮层改为显式触发（见下方 onKeyDown 的 ⌥↓），默认不打扰输入。
                 同时收起已有的浮层，避免残留。 */
              onFocus={() => setHistoryOpen(false)}
              onKeyDown={(event) => {
                // ⌥↓ 显式唤出历史（有记录时才有效）；其余按键照旧
                if (event.altKey && event.key === "ArrowDown") {
                  event.preventDefault();
                  openHistory();
                  return;
                }
                // 回车检索；输入法组合中（中文拼音待选）不触发，避免误检索
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  props.onRunSearch();
                } else if (event.key === "Escape") {
                  setHistoryOpen(false);
                }
              }}
              placeholder="输入关键字，或直接用 /关键字 后回车"
              disabled={!props.hasServer}
            />
            {/* 右端附属控件：仅在有内容时显示「清空 ✕」（固定贴右端）。
                空态不再放「/」历史提示按钮 —— 它与占位文字抢位、把 placeholder 压住（用户反馈，
                DevTools 确认被遮挡元素即 button.keyword-input-kbd）。检索历史仍可在聚焦时自动展开（onFocus）。 */}
            {props.settings.keywordInput ? (
              <button
                type="button"
                className="keyword-input-clear"
                title="清空"
                aria-label="清空"
                tabIndex={-1}
                disabled={!props.hasServer}
                onClick={() => props.onKeywordInputChange("")}
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            ) : null}
            {historyOpen && historyItems.length ? (
              <div className="search-history-panel" role="listbox">
                <div className="search-history-cap">最近检索</div>
                {historyItems.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="search-history-item"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      props.onKeywordInputChange(item);
                      setHistoryOpen(false);
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={`ghost-button slim-button search-run-button${props.searching ? " search-run-busy" : ""}`}
            onClick={props.onRunSearch}
            disabled={!props.hasServer || props.searching}
          >
            {props.searching ? <span className="btn-spinner" aria-hidden="true" /> : null}
            {/* 原型 S13 第 02 段：进度内联在按钮上（如 `340MB/1.2GB`），不锁界面 */}
            {props.searching ? (
              props.searchProgressLabel ? (
                <span className="search-run-progress">{props.searchProgressLabel}</span>
              ) : (
                "检索中"
              )
            ) : (
              "检索"
            )}
          </button>
        </div>
      ) : null}

      {props.showSummary ? (
        <div className="toolbar-inline toolbar-hint toolbar-summary">
          <span>{props.toolbarSummaryLabel}</span>
          <span>{props.toolbarMetaLabel}</span>
          <span style={{ flex: 1 }} />
          {props.highlightSummary ? (
            <span className="summary-nav">
              {/* 原型 S1/S3 rtools 命中导航 = ◀ 3 / 128 ▶（prototype.html 第 417 行：
                  左 `m12 19-7-7 7-7`+`M19 12H5`、右 `m9 18 6-6-6-6`，均 12px、sw1.6）。
                  原实现误用纵向三角 ▲▼，方向与原型不符。 */}
              <button type="button" className="ghost-button icon-button" title="上一处命中" aria-label="上一处命中" onClick={props.onHighlightPrev}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m12 19-7-7 7-7" />
                  <path d="M19 12H5" />
                </svg>
              </button>
              <span className="mono summary-nav-count">{props.highlightSummary}</span>
              <button type="button" className="ghost-button icon-button" title="下一处命中" aria-label="下一处命中" onClick={props.onHighlightNext}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </span>
          ) : null}
          {props.canToggleResultContext ? (
            <span className="summary-seg">
              <button type="button" className={!props.resultContextMode ? "on" : ""} onClick={props.onToggleResultContext}>仅命中</button>
              <button type="button" className={props.resultContextMode ? "on" : ""} onClick={props.onToggleResultContext}>含上下文</button>
            </span>
          ) : null}
          <button
            type="button"
            className="ghost-button slim-button"
            onClick={props.onDownloadResults}
            disabled={!props.canDownloadResults}
            title="下载结果"
          >
            <Download size={12} strokeWidth={1.8} /> 下载
          </button>
        </div>
      ) : null}

      <Drawer
        open={props.showQueryAdvanced}
        onClose={props.onToggleQueryAdvanced}
        title="高级检索条件"
        width={420}
        footer={(
          <>
            <button
              type="button"
              className="ghost-button slim-button"
              onClick={props.onResetAdvanced}
              disabled={!props.hasServer}
            >
              重置
            </button>
            <button
              type="button"
              className="ghost-button slim-button primary-action advanced-apply-button"
              onClick={() => {
                props.onRunSearch();
                props.onToggleQueryAdvanced();
              }}
              disabled={!props.hasServer}
            >
              应用条件并检索
            </button>
          </>
        )}
      >
        <div className="advanced-strip advanced-strip-drawer">
          <div className="advanced-row advanced-row-main">
            <label>
              匹配
              <ThemedSelect value={props.settings.keywordMode} onChange={(value) => props.onKeywordModeChange(value as SearchSettingsState["keywordMode"])} disabled={!props.hasServer} ariaLabel="匹配方式"
                options={[
                  { value: "phrase", label: "精确包含" },
                  { value: "any", label: "任意一个" },
                  { value: "all", label: "同时包含" }
                ]}
              />
            </label>
            <label>
              上下文
              <input type="number" min={0} max={20} value={props.settings.contextLines} onChange={(event) => props.onContextLinesChange(Number(event.target.value))} disabled={!props.hasServer} />
            </label>
            <button
              type="button"
              className={`ghost-button regex-pill${props.settings.useRegex ? " regex-pill-active" : ""}`}
              onClick={props.onToggleRegex}
            >
              正则
            </button>
          </div>
          <div className="advanced-row advanced-row-multi-file">
            <button
              type="button"
              className={`ghost-button regex-pill${props.multiFileMode ? " regex-pill-active" : ""}`}
              onClick={props.onToggleMultiFileMode}
            >
              多文件
            </button>
            {props.multiFileMode ? (
              <label>
                文件匹配
                <input
                  type="text"
                  placeholder="*.log"
                  value={props.filePattern}
                  onChange={(event) => props.onFilePatternChange(event.target.value)}
                  disabled={!props.hasServer}
                />
              </label>
            ) : null}
          </div>
          <div className="advanced-row advanced-row-exclude">
            <label>
              排除
              <input
                type="text"
                placeholder="排除包含这些词的行，空格分隔"
                value={props.settings.excludeInput}
                onChange={(event) => props.onExcludeInputChange(event.target.value)}
                disabled={!props.hasServer}
              />
            </label>
          </div>
          <div className="advanced-row advanced-row-time">
            <label>
              起始
              <div className="time-pair">
                <input type="text" placeholder="年-月-日" value={props.settings.startDate} onChange={(event) => props.onStartDateChange(event.target.value)} disabled={!props.hasServer} />
                <input type="text" placeholder="时:分:秒" value={props.settings.startTime} onChange={(event) => props.onStartTimeChange(event.target.value)} disabled={!props.hasServer} />
              </div>
            </label>
            <label>
              截止
              <div className="time-pair">
                <input type="text" placeholder="年-月-日" value={props.settings.endDate} onChange={(event) => props.onEndDateChange(event.target.value)} disabled={!props.hasServer} />
                <input type="text" placeholder="时:分:秒" value={props.settings.endTime} onChange={(event) => props.onEndTimeChange(event.target.value)} disabled={!props.hasServer} />
              </div>
            </label>
          </div>
          <div className="preset-strip preset-strip-advanced">
            {props.searchPresets.map((preset) => (
              <button
                key={preset.label}
                className={preset.label === props.settings.selectedPreset ? "fchip fchip-on" : "fchip"}
                onClick={preset.apply}
                type="button"
                disabled={!props.hasServer}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </Drawer>
    </>
  );
}
