import type { ReactNode } from "react";

type Props = {
  head: ReactNode;
  children: ReactNode;
};

export function FileBrowserTable(props: Props) {
  return (
    <div className="file-table">
      {props.head}
      {props.children}
    </div>
  );
}
