import { useEffect, useRef } from "react";

const escapeCloseStack: symbol[] = [];

function removeToken(token: symbol) {
  const index = escapeCloseStack.lastIndexOf(token);
  if (index >= 0) {
    escapeCloseStack.splice(index, 1);
  }
}

function shouldHandleEscape(event: KeyboardEvent) {
  return event.key === "Escape" && !event.defaultPrevented && !event.isComposing;
}

export function useEscapeToClose(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      return;
    }

    const token = Symbol("escape-close-dialog");
    escapeCloseStack.push(token);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandleEscape(event)) {
        return;
      }
      if (escapeCloseStack[escapeCloseStack.length - 1] !== token) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      removeToken(token);
    };
  }, [open]);
}
