import { Activity, CircleDot, Command as CommandIcon, Ellipsis, Pin, PinOff, Radio } from "lucide-react";
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
  liveFollowEnabled: boolean;
  canToggleLive: boolean;
  onToggleLive: () => void;
  onOpenPalette: () => void;
};

export function SearchToolbarActions(props: Props) {
  const terminalLabel = props.terminalDetached ? "收回终端" : props.terminalPanelOpen ? "收起终端" : "终端";

  return (
    <div className="toolbar-inline toolbar-search-actions">
      <button
        className={`ghost-button toolbar-action-button toolbar-live-button${props.liveFollowEnabled ? " toolbar-live-on" : ""}`}
        onClick={props.onToggleLive}
        disabled={!props.canToggleLive}
        title={props.liveFollowEnabled ? "断开实时追踪" : "开启实时追踪 (tail -F)"}
      >
        <Radio size={14} strokeWidth={1.8} className={props.liveFollowEnabled ? "live-pulse" : undefined} />
        <span>LIVE</span>
      </button>
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
        <CircleDot size={14} strokeWidth={1.8} />
        <span>{props.isRecording ? "结束录制" : "录制"}</span>
      </button>
      <button
        className={`ghost-button icon-button toolbar-action-button${props.showQueryAdvanced ? " tab-active" : ""}`}
        onClick={props.onToggleQueryAdvanced}
        disabled={!props.hasServer}
        title={props.showQueryAdvanced ? "收起条件" : "更多条件"}
        aria-label={props.showQueryAdvanced ? "收起条件" : "更多条件"}
      >
        <Ellipsis size={14} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="ghost-button toolbar-action-button toolbar-palette-button"
        onClick={props.onOpenPalette}
        title="命令面板 (Cmd+K)"
        aria-label="命令面板"
      >
        <CommandIcon size={14} strokeWidth={1.8} />
        <span className="kbd">⌘K</span>
      </button>
    </div>
  );
}
