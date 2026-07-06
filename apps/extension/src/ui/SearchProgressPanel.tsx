type Props = {
  phaseLabel: string;
  elapsedLabel: string;
  strategyLabel: string;
  overallProgressLabel: string;
  phaseProgressLabel: string;
  matchCountLabel: string;
  progressPercent: number | null;
};

export function SearchProgressPanel(props: Props) {
  return (
    <details className="search-progress-panel search-progress-panel-compact">
      <summary className="search-progress-summary">
        <span className="search-progress-dot" aria-hidden="true" />
        <strong>{props.phaseLabel}</strong>
        <span>{props.matchCountLabel}</span>
        <span>{props.elapsedLabel ? `已用 ${props.elapsedLabel}` : ""}</span>
        <span className="search-progress-summary-hint">展开</span>
      </summary>
      <div className="search-progress-track">
        <span
          className="search-progress-indicator"
          style={props.progressPercent === null ? undefined : { left: "0%", width: `${Math.max(6, props.progressPercent)}%`, animation: "none" }}
        />
      </div>
      <div className="search-progress-meta">
        <span>{props.strategyLabel}</span>
        <span className="search-progress-meta-primary">{props.overallProgressLabel}</span>
        <span className="search-progress-meta-secondary">{props.phaseProgressLabel}</span>
      </div>
    </details>
  );
}
