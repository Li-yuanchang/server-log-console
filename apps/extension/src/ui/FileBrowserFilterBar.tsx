type Props = {
  value: string;
  hasServer: boolean;
  onChange: (value: string) => void;
};

export function FileBrowserFilterBar(props: Props) {
  return (
    <div className="directory-filter-bar">
      <input
        className="directory-filter-input"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder="输入关键词过滤当前目录..."
        autoFocus
        disabled={!props.hasServer}
      />
    </div>
  );
}
