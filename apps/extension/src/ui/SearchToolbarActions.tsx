import { Activity, Circle, Pin, PinOff } from "lucide-react";
import { ToolIcon } from "./ToolIcon.js";

type Props = {
  uiTheme: "classic" | "modern";
  isElectron: boolean;
  isPinned: boolean;
  onTogglePin: () => void | Promise<void>;
  canOpenTerminal: boolean;
  terminalDetached: boolean;
  terminalPanelOpen: boolean;
  onToggleTerminal: () => void;
  hasServer: boolean;
  serverStatusOpen: boolean;
  onOpenServerStatus: () => void;
  isRecording: boolean;
  canToggleRecording: boolean;
  onToggleRecording: () => void;
  showQueryAdvanced: boolean;
  onToggleQueryAdvanced: () => void;
};

export function SearchToolbarActions(props: Props) {
  const terminalLabel = props.terminalDetached ? "收回终端" : props.terminalPanelOpen ? "收起终端" : "终端";

  return (
    <div className="toolbar-inline toolbar-search-actions">
      {props.isElectron ? (
        <button
          className={`ghost-button toolbar-action-button${props.isPinned ? " tab-active" : ""}`}
          title={props.isPinned ? "取消置顶 (Cmd+Shift+T)" : "窗口置顶 (Cmd+Shift+T)"}
          onClick={() => { void props.onTogglePin(); }}
        >
          {props.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
          <span>{props.isPinned ? "已置顶" : "置顶"}</span>
        </button>
      ) : null}
      {props.canOpenTerminal ? (
        <button className={`ghost-button toolbar-action-button${props.terminalDetached ? " tab-active" : ""}`} onClick={props.onToggleTerminal} disabled={!props.hasServer}>
          <ToolIcon theme={props.uiTheme} kind="terminal" />
          <span>{terminalLabel}</span>
        </button>
      ) : null}
      <button
        className={`ghost-button toolbar-action-button${props.serverStatusOpen ? " tab-active" : ""}`}
        onClick={props.onOpenServerStatus}
        disabled={!props.hasServer}
        title="查看服务器状态"
      >
        <Activity size={14} strokeWidth={1.8} />
        <span>状态</span>
      </button>
      <button className={`ghost-button toolbar-action-button${props.isRecording ? " btn-recording-active" : ""}`} onClick={props.onToggleRecording} disabled={!props.canToggleRecording}>
        <Circle size={14} strokeWidth={1.8} fill="currentColor" />
        <span>{props.isRecording ? "结束录制" : "开始录制"}</span>
      </button>
      <button className="ghost-button toolbar-action-button" onClick={props.onToggleQueryAdvanced} disabled={!props.hasServer}>
        <ToolIcon theme={props.uiTheme} kind="more" />
        <span>{props.showQueryAdvanced ? "收起条件" : "更多条件"}</span>
      </button>
    </div>
  );
}
