import type { ReactNode } from "react";

type Props = {
  head: ReactNode;
  children: ReactNode;
};

/* 表头与数据行分层：表头必须在滚动容器【外】，否则竖向滚动条会从表头那一行
   就开始画（App 里 .file-table 之前是唯一滚动容器，表头 sticky 挂在它内部，
   滚动条轨道覆盖整表含表头）。这里把数据行（含空态/加载态）包进 .file-table-body
   独立滚动容器，.file-table 自身改为不滚动的 flex 列容器；表头与 body 各自
   scrollbar-gutter: stable 保证两侧内容宽度一致、列仍然对齐（见 styles-file-reader.css）。 */
export function FileBrowserTable(props: Props) {
  return (
    <div className="file-table">
      {props.head}
      <div className="file-table-body">{props.children}</div>
    </div>
  );
}
