import { ToolIcon } from "./ToolIcon.js";

type Props = {
  uiTheme: "classic" | "modern";
  hasServer: boolean;
  isBusy: boolean;
  showPathHistory: boolean;
  showTransferHistory: boolean;
  showDirectoryFilter: boolean;
  onBrowseParent: () => void;
  onTogglePathHistory: () => void;
  onToggleTransferHistory: () => void;
  onToggleDirectoryFilter: () => void;
  onMkdir: () => void;
  onUploadFiles: () => void;
  onUploadDirectory: () => void;
  onRefresh: () => void;
};

export function FileBrowserActions(props: Props) {
  return (
    <>
      <button className="ghost-button icon-button" title="返回上一级" onClick={props.onBrowseParent} disabled={props.isBusy || !props.hasServer}>
        <ToolIcon theme={props.uiTheme} kind="open" />
      </button>
      <button
        className={props.showPathHistory ? "ghost-button icon-button tab-active" : "ghost-button icon-button"}
        title="最近访问的目录"
        onClick={props.onTogglePathHistory}
        disabled={!props.hasServer}
      >
        <ToolIcon theme={props.uiTheme} kind="history" />
      </button>
      <button
        className={props.showTransferHistory ? "ghost-button icon-button tab-active" : "ghost-button icon-button"}
        title="传输记录"
        onClick={props.onToggleTransferHistory}
        disabled={!props.hasServer}
      >
        <ToolIcon theme={props.uiTheme} kind="transfer" />
      </button>
      <button className={props.showDirectoryFilter ? "ghost-button icon-button tab-active" : "ghost-button icon-button"} title="过滤当前目录" onClick={props.onToggleDirectoryFilter} disabled={!props.hasServer}>
        <ToolIcon theme={props.uiTheme} kind="filter" />
      </button>
      <button className="ghost-button icon-button" title="新建目录" onClick={props.onMkdir} disabled={props.isBusy || !props.hasServer}>
        <ToolIcon theme={props.uiTheme} kind="folder-plus" />
      </button>
      <button className="ghost-button icon-button" title="上传文件" onClick={props.onUploadFiles} disabled={props.isBusy || !props.hasServer}>
        <ToolIcon theme={props.uiTheme} kind="upload" />
      </button>
      <button className="ghost-button icon-button" title="上传目录" onClick={props.onUploadDirectory} disabled={props.isBusy || !props.hasServer}>
        <ToolIcon theme={props.uiTheme} kind="folder" />
      </button>
      <button className="ghost-button icon-button" title="刷新目录" onClick={props.onRefresh} disabled={props.isBusy || !props.hasServer}>
        <ToolIcon theme={props.uiTheme} kind="refresh" />
      </button>
    </>
  );
}
