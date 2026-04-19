import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function FileBrowserTableHead(props: Props) {
  return <div className="file-table-head">{props.children}</div>;
}
