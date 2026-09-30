import type { RefObject } from "react";

type BreadcrumbItem = { label: string; path: string };

type Props = {
  mode: "browse" | "edit";
  directoryInput: string;
  currentDirectory: string;
  breadcrumbItems: BreadcrumbItem[];
  inputRef: RefObject<HTMLInputElement | null>;
  hasServer: boolean;
  onSetDirectoryInput: (value: string) => void;
  onEnterEditMode: () => void;
  onExitEditMode: () => void;
  onOpenFromInput: () => void;
  onCommitDirectoryPath: (path: string) => void;
};

export function FileBrowserPathbar(props: Props) {
  if (props.mode === "edit") {
    return (
      <input
        ref={props.inputRef}
        className="directory-input"
        value={props.directoryInput}
        onChange={(event) => props.onSetDirectoryInput(event.target.value)}
        onBlur={props.onExitEditMode}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            props.onOpenFromInput();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            props.onExitEditMode();
          }
        }}
        placeholder="/home/app/logs"
        disabled={!props.hasServer}
      />
    );
  }

  return (
    <div
      className={props.hasServer ? "pathbar-breadcrumbs" : "pathbar-breadcrumbs is-disabled"}
      onClick={() => props.onEnterEditMode()}
    >
      {props.breadcrumbItems.map((item, index) => {
        const isLast = index === props.breadcrumbItems.length - 1;
        return (
          <div className="pathbar-breadcrumb-node" key={item.path}>
            {/* S6 原型：面包屑段间用 › 分隔（首段之后每段都有） */}
            {index > 0 ? <span className="pathbar-breadcrumb-separator">›</span> : null}
            {/* D1: 面包屑跳转是只读导航，忙碌期间保持可用 */}
            <button
              type="button"
              className={isLast ? "pathbar-breadcrumb-item is-current" : "pathbar-breadcrumb-item"}
              onClick={(event) => {
                event.stopPropagation();
                if (isLast) {
                  props.onEnterEditMode();
                  return;
                }
                props.onCommitDirectoryPath(item.path);
              }}
              disabled={!props.hasServer}
            >
              {item.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function buildBreadcrumbItems(value: string): BreadcrumbItem[] {
  const normalized = (value || "/").trim();
  if (!normalized || normalized === "/") {
    return [{ label: "/", path: "/" }];
  }

  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  const absolutePath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const segments = absolutePath.split("/").filter(Boolean);

  // S6 原型（628-630）：面包屑为 `/data › logs › eos`，首段整体带前导斜杠，
  // 不额外拆出一个独立的根段「/」。
  let currentPath = "";
  return segments.map((segment, index) => {
    currentPath += `/${segment}`;
    return { label: index === 0 ? currentPath : segment, path: currentPath };
  });
}
