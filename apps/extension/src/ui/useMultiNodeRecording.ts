import { useCallback, useRef, useState } from "react";
import { apiStartLogRecording, apiStopLogRecording } from "./api.js";

export type MultiRecordTargetStatus = "recording" | "stopping" | "done" | "failed";

export type MultiRecordTarget = {
  sessionId: string;
  serverId: string;
  serverName: string;
  filePath: string;
  directoryPath: string;
  recSessionId: string | null;
  status: MultiRecordTargetStatus;
  outPath: string;
  sizeBytes: number;
  failMsg: string;
  retried: boolean;
};

export type MultiRecordItem = {
  sessionId: string;
  serverId: string;
  serverName: string;
  filePath: string;
  directoryPath?: string;
};

type Deps = {
  onStatus: (message: string) => void;
  pushActivity: (message: string) => void;
  showToast: (type: "loading" | "success" | "error", message: string) => string;
  updateToast: (id: string, type: "loading" | "success" | "error", message: string) => void;
  onStopped: () => void;
};

function failMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useMultiNodeRecording(deps: Deps) {
  const [targets, setTargets] = useState<MultiRecordTarget[]>([]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  const patch = useCallback((sessionId: string, partial: Partial<MultiRecordTarget>) => {
    setTargets((prev) => prev.map((t) => (t.sessionId === sessionId ? { ...t, ...partial } : t)));
  }, []);

  const startBatch = useCallback(async (
    items: MultiRecordItem[],
    failures: { sessionId: string; serverId: string; serverName: string; failMsg: string }[] = []
  ) => {
    if (!items.length && !failures.length) return;
    const seeded: MultiRecordTarget[] = [
      ...items.map((item) => ({
        sessionId: item.sessionId,
        serverId: item.serverId,
        serverName: item.serverName,
        filePath: item.filePath,
        directoryPath: item.directoryPath || "",
        recSessionId: null,
        status: "recording" as const,
        outPath: "",
        sizeBytes: 0,
        failMsg: "",
        retried: false,
      })),
      ...failures.map((f) => ({
        sessionId: f.sessionId,
        serverId: f.serverId,
        serverName: f.serverName,
        filePath: "",
        directoryPath: "",
        recSessionId: null,
        status: "failed" as const,
        outPath: "",
        sizeBytes: 0,
        failMsg: f.failMsg,
        retried: false,
      })),
    ];
    setTargets((prev) => [...prev.filter((t) => !seeded.some((s) => s.sessionId === t.sessionId)), ...seeded]);

    const tid = String(deps.showToast("loading", `正在开始 ${items.length} 台录制…`));
    let ok = 0;
    await Promise.all(
      items.map(async (item) => {
        try {
          const payload = await apiStartLogRecording(item.serverId, item.filePath, item.directoryPath || undefined);
          patch(item.sessionId, { recSessionId: payload.sessionId, outPath: payload.outputPath, status: "recording" });
          deps.pushActivity(`批量录制已开始：${item.serverName} · ${item.filePath} → ${payload.outputPath}`);
          ok += 1;
        } catch (error) {
          patch(item.sessionId, { status: "failed", failMsg: failMessage(error) });
        }
      })
    );
    const failed = items.length + failures.length - ok;
    deps.updateToast(
      tid,
      failed > 0 ? "error" : "success",
      failed > 0 ? `已开始录制：${ok} 成功 · ${failed} 失败` : `已开始录制 ${ok} 台`
    );
    deps.onStatus(
      failed > 0
        ? `批量录制：${ok} 成功 · ${failed} 失败（点录制按钮停止全部）`
        : `批量录制中：${ok} 台（点录制按钮停止全部）`
    );
  }, [deps, patch]);

  const stopAll = useCallback(async () => {
    const actives = targetsRef.current.filter((t) => t.status === "recording");
    if (!actives.length) return;
    actives.forEach((t) => patch(t.sessionId, { status: "stopping" }));
    const tid = String(deps.showToast("loading", `正在停止 ${actives.length} 台录制…`));
    let done = 0;
    let failed = 0;
    await Promise.all(
      actives.map(async (t) => {
        try {
          if (!t.recSessionId) throw new Error("录制会话缺失");
          const res = await apiStopLogRecording(t.recSessionId);
          patch(t.sessionId, { status: "done", sizeBytes: res.sizeBytes });
          deps.pushActivity(`批量录制已停止：${t.serverName} · ${t.outPath}（${res.sizeBytes} 字节）`);
          done += 1;
        } catch (error) {
          patch(t.sessionId, { status: "failed", failMsg: `${failMessage(error)}（已录制文件保留在节点上，可重试或直接下载）` });
          failed += 1;
        }
      })
    );
    deps.updateToast(tid, failed > 0 ? "error" : "success", `已停止：${done} 成功${failed ? ` · ${failed} 失败` : ""}`);
    deps.onStatus(`已停止：${done} 成功${failed ? ` · ${failed} 失败` : ""}`);
    deps.onStopped();
  }, [deps, patch]);

  const retry = useCallback(async (sessionId: string) => {
    const target = targetsRef.current.find((t) => t.sessionId === sessionId);
    if (!target) return;
    patch(sessionId, { status: "recording", failMsg: "", retried: true });
    const tid = String(deps.showToast("loading", `${target.serverName} 重新开始录制…`));
    try {
      const payload = await apiStartLogRecording(target.serverId, target.filePath, target.directoryPath || undefined);
      patch(sessionId, { recSessionId: payload.sessionId, outPath: payload.outputPath, status: "recording" });
      deps.updateToast(tid, "success", `${target.serverName} 已重新开始录制`);
      deps.pushActivity(`批量录制重试：${target.serverName} → ${payload.outputPath}`);
    } catch (error) {
      patch(sessionId, { status: "failed", failMsg: failMessage(error) });
      deps.updateToast(tid, "error", `${target.serverName} 重试失败`);
    }
  }, [deps, patch]);

  return { targets, startBatch, stopAll, retry };
}
