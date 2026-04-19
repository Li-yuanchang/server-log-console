import type { ReactNode } from "react";

type Props = {
  pathbar: ReactNode;
  actions: ReactNode;
  filterBar?: ReactNode;
  historyDropdown?: ReactNode;
  transferDropdown?: ReactNode;
};

export function FileBrowserStrip(props: Props) {
  return (
    <>
      <div className="workspace-strip">
        <div className="workspace-pathbar">{props.pathbar}</div>
        <div className="toolbar-inline workspace-actions compact-actions">{props.actions}</div>
      </div>
      {props.filterBar}
      {props.historyDropdown}
      {props.transferDropdown}
    </>
  );
}
