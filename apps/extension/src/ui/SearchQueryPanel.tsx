import type { RefObject } from "react";
import type { SearchSettingsState } from "./utils.js";

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
};

export function SearchQueryPanel(props: Props) {
  return (
    <>
      {props.showKeywordBar ? (
        <div className="toolbar-search-row">
          <input
            ref={props.keywordInputRef}
            className="command-input command-input-keyword"
            value={props.settings.keywordInput}
            onChange={(event) => props.onKeywordInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                props.onRunSearch();
              }
            }}
            placeholder="输入关键字，或直接用 /关键字 后回车"
            disabled={!props.hasServer}
          />
          <button className="ghost-button slim-button" onClick={props.onClearKeyword} disabled={!props.hasServer}>
            清空
          </button>
        </div>
      ) : null}

      {props.showSummary ? (
        <div className="toolbar-inline toolbar-hint toolbar-summary">
          <span>{props.toolbarSummaryLabel}</span>
          <span>{props.toolbarMetaLabel}</span>
        </div>
      ) : null}

      {props.showQueryAdvanced ? (
        <div className="advanced-strip">
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
                className={preset.label === props.settings.selectedPreset ? "ghost-button preset-active" : "ghost-button"}
                onClick={preset.apply}
                type="button"
                disabled={!props.hasServer}
              >
                {preset.label}
              </button>
            ))}
            <button className="ghost-button" onClick={props.onResetAdvanced} disabled={!props.hasServer}>清空</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
