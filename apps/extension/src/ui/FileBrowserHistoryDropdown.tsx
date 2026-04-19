type Props = {
  historyPaths: string[];
  onBrowsePath: (path: string) => void;
};

export function FileBrowserHistoryDropdown(props: Props) {
  if (!props.historyPaths.length) {
    return (
      <div className="path-history-dropdown">
        <span className="path-history-empty">暂无历史记录</span>
      </div>
    );
  }
  return (
    <div className="path-history-dropdown">
      {props.historyPaths.map((historyPath) => (
        <div
          key={historyPath}
          role="button"
          className="path-history-item"
          onClick={() => props.onBrowsePath(historyPath)}
        >
          {historyPath}
        </div>
      ))}
    </div>
  );
}
