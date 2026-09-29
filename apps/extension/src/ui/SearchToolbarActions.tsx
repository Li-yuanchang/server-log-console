import { Command as CommandIcon, Ellipsis, Pin, PinOff } from "lucide-react";
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
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={props.liveFollowEnabled ? "live-pulse" : undefined} aria-hidden="true">
          <circle cx="12" cy="12" r="2" />
          <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
          <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
          <circle cx="12" cy="12" r="10" />
          <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
          <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
        </svg>
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
      <button className={`ghost-button toolbar-action-button${props.isRecording ? " btn-recording-active" : ""}`} onClick={props.onToggleRecording} disabled={!props.canToggleRecording}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        </svg>
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
