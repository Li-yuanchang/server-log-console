import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastState } from "./FeedbackOverlays.js";

export function useToasts() {
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const toastIdRef = useRef(0);
  const dismissTimersRef = useRef(new Map<string, number>());
  const removeTimersRef = useRef(new Map<string, number>());

  const clearDismissTimer = useCallback((id: string) => {
    const timer = dismissTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      dismissTimersRef.current.delete(id);
    }
  }, []);

  const clearRemoveTimer = useCallback((id: string) => {
    const timer = removeTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      removeTimersRef.current.delete(id);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    clearDismissTimer(id);
    clearRemoveTimer(id);
    setToasts((prev) => prev.map((toast) => toast.id === id ? { ...toast, exiting: true } : toast));
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      removeTimersRef.current.delete(id);
    }, 250);
    removeTimersRef.current.set(id, timer);
  }, [clearDismissTimer, clearRemoveTimer]);

  const scheduleAutoDismiss = useCallback((id: string, type: ToastState["type"]) => {
    clearDismissTimer(id);
    if (type !== "success" && type !== "error") {
      return;
    }
    const delay = type === "success" ? 2500 : 4000;
    const timer = window.setTimeout(() => {
      dismissToast(id);
    }, delay);
    dismissTimersRef.current.set(id, timer);
  }, [clearDismissTimer, dismissToast]);

  const showToast = useCallback((type: ToastState["type"], message: string) => {
    const id = `toast-${++toastIdRef.current}`;
    setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
    scheduleAutoDismiss(id, type);
    return id;
  }, [scheduleAutoDismiss]);

  const updateToast = useCallback((id: string, type: ToastState["type"], message: string) => {
    clearRemoveTimer(id);
    setToasts((prev) => prev.map((toast) => toast.id === id ? { ...toast, type, message, exiting: false } : toast));
    scheduleAutoDismiss(id, type);
  }, [clearRemoveTimer, scheduleAutoDismiss]);

  useEffect(() => {
    return () => {
      for (const timer of dismissTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      dismissTimersRef.current.clear();
      for (const timer of removeTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      removeTimersRef.current.clear();
    };
  }, []);

  return {
    toasts,
    showToast,
    updateToast,
    dismissToast,
  };
}
