import { useRef, useState, type RefObject } from "react";
import { Download, Search } from "lucide-react";
import { Drawer } from "./Drawer.js";
import type { SearchSettingsState } from "./utils.js";
import { readSearchHistory } from "./storage.js";

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
  onClearKeyword: () => void;
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

  function openHistory() {
    setHistoryItems(readSearchHistory());
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
              className="command-input command-input-keyword"
              value={props.settings.keywordInput}
              onChange={(event) => props.onKeywordInputChange(event.target.value)}
              onFocus={openHistory}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  props.onRunSearch();
                } else if (event.key === "Escape") {
                  setHistoryOpen(false);
                }
              }}
              placeholder="输入关键字，或直接用 /关键字 后回车"
              disabled={!props.hasServer}
            />
            <button
              type="button"
              className="keyword-input-kbd"
              title="检索历史"
              aria-label="检索历史"
              tabIndex={-1}
              disabled={!props.hasServer}
              onClick={() => (historyOpen ? setHistoryOpen(false) : openHistory())}
            >
              /
            </button>
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
          <button className="ghost-button slim-button" onClick={props.onClearKeyword} disabled={!props.hasServer}>
            清空
          </button>
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
              <select value={props.settings.keywordMode} onChange={(event) => props.onKeywordModeChange(event.target.value as SearchSettingsState["keywordMode"])} disabled={!props.hasServer}>
                <option value="phrase">精确包含</option>
                <option value="any">任意一个</option>
                <option value="all">同时包含</option>
              </select>
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
