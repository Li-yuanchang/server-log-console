import type { DragEventHandler, MouseEventHandler, ReactNode } from "react";
import { FileBrowserContentHeader } from "./FileBrowserContentHeader.js";
import { FileBrowserFileColumn } from "./FileBrowserFileColumn.js";
import { FileBrowserTable } from "./FileBrowserTable.js";
import { FileBrowserTableHead } from "./FileBrowserTableHead.js";

type Props = {
  isDragOver: boolean;
  /** 拖拽中的顶层项目数与是否含文件夹（dragover 阶段浏览器不允许遍历目录内容，
      所以这里只能是"顶层 N 项"，文件夹内部数量要等放下后才知道） */
  dragSummary?: { itemCount: number; hasDirectory: boolean; targetLabel?: string } | null;
  summary: ReactNode;
  tableHead: ReactNode;
  children: ReactNode;
  onDragOver: DragEventHandler<HTMLElement>;
  onDragLeave: DragEventHandler<HTMLElement>;
  onDrop: DragEventHandler<HTMLElement>;
  /* 空白处右键菜单（用户反馈 2026-09-30） */
  onBlankContextMenu?: MouseEventHandler<HTMLElement>;
};

export function FileBrowserContentColumn(props: Props) {
  return (
    <FileBrowserFileColumn
      isDragOver={props.isDragOver}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onContextMenu={props.onBlankContextMenu}
      head={<FileBrowserContentHeader title="目录内容" summary={props.summary} />}
      overlay={props.isDragOver ? (
        <div className="drop-zone-overlay">
          <div className="drop-zone-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13V4M6.4 7.6L10 4l3.6 3.6" />
              <path d="M3.4 13.4v2.2a1.4 1.4 0 001.4 1.4h10.4a1.4 1.4 0 001.4-1.4v-2.2" />
            </svg>
          </div>
          <div className="drop-zone-label">
            松开上传到 {props.dragSummary?.targetLabel || "当前目录"}
          </div>
          {props.dragSummary ? (
            <div className="drop-zone-sub">
              {props.dragSummary.itemCount} 项
              {props.dragSummary.hasDirectory ? " · 含文件夹（内部的文件会在放下后统计）" : ""}
            </div>
          ) : null}
        </div>
      ) : null}
    >
      <FileBrowserTable head={<FileBrowserTableHead>{props.tableHead}</FileBrowserTableHead>}>
        {props.children}
      </FileBrowserTable>
    </FileBrowserFileColumn>
  );
}
