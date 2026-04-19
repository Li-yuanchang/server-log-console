import type { ReactNode } from "react";

type Props = {
  title: string;
  summary?: ReactNode;
};

export function FileBrowserContentHeader(props: Props) {
  return (
    <div className="browser-column-head">
      <strong>{props.title}</strong>
      {props.summary}
    </div>
  );
}
