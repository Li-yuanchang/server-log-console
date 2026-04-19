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
    <div className="search-progress-panel">
      <div className="search-progress-head">
        <strong>{props.phaseLabel}</strong>
        <span>已用 {props.elapsedLabel}</span>
      </div>
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
        <span>{props.matchCountLabel}</span>
      </div>
    </div>
  );
}
