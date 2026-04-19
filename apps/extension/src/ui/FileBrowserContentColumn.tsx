import type { DragEventHandler, ReactNode } from "react";
import { FileBrowserContentHeader } from "./FileBrowserContentHeader.js";
import { FileBrowserFileColumn } from "./FileBrowserFileColumn.js";
import { FileBrowserTable } from "./FileBrowserTable.js";
import { FileBrowserTableHead } from "./FileBrowserTableHead.js";

type Props = {
  isDragOver: boolean;
  summary: ReactNode;
  batchBar?: ReactNode;
  tableHead: ReactNode;
  children: ReactNode;
  onDragOver: DragEventHandler<HTMLElement>;
  onDragLeave: DragEventHandler<HTMLElement>;
  onDrop: DragEventHandler<HTMLElement>;
};

export function FileBrowserContentColumn(props: Props) {
  return (
    <FileBrowserFileColumn
      isDragOver={props.isDragOver}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      head={<FileBrowserContentHeader title="目录内容" summary={props.batchBar ?? props.summary} />}
      overlay={props.isDragOver ? (
        <div className="drop-zone-overlay">
          <div className="drop-zone-label">松开上传文件到当前目录</div>
        </div>
      ) : null}
    >
      <FileBrowserTable head={<FileBrowserTableHead>{props.tableHead}</FileBrowserTableHead>}>
        {props.children}
      </FileBrowserTable>
    </FileBrowserFileColumn>
  );
}
