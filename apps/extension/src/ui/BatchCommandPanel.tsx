import { useCallback, useState } from "react";
import { Play, X, ChevronDown, ChevronRight } from "lucide-react";
import type { BatchCommandResult, ServerSummary } from "@server-log-console/shared";
import { apiBatchExec } from "./api.js";

type Props = {
  visible: boolean;
  servers: ServerSummary[];
  onClose: () => void;
  onStatus: (msg: string) => void;
};

export function BatchCommandPanel({ visible, servers, onClose, onStatus }: Props) {
  const [command, setCommand] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [executing, setExecuting] = useState(false);
  const [results, setResults] = useState<BatchCommandResult[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!visible) return null;

  const toggleServer = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const selectAll = () => {
    if (selectedIds.size === servers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(servers.map((s) => s.id)));
    }
  };

  const handleExec = useCallback(async () => {
    if (!command.trim()) {
      onStatus("请输入要执行的命令");
      return;
    }
    if (selectedIds.size === 0) {
      onStatus("请选择至少一台服务器");
      return;
    }
    setExecuting(true);
    setResults([]);
    try {
      const res = await apiBatchExec({
        serverIds: Array.from(selectedIds),
        command: command.trim(),
      });
      setResults(res.results);
      const failCount = res.results.filter((r) => r.error).length;
      onStatus(res.ok ? `批量执行完成，${res.results.length} 台服务器` : `${failCount}/${res.results.length} 台执行失败`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "批量执行失败");
    } finally {
      setExecuting(false);
    }
  }, [command, selectedIds, onStatus]);

  return (
    <div className="batch-command-panel">
      <div className="batch-command-header">
        <span>批量执行</span>
        <button className="ghost-button slim-button" onClick={onClose}>关闭</button>
      </div>

      <div className="batch-command-servers">
        <div className="batch-command-servers-header">
          <label className="batch-checkbox-label">
            <input type="checkbox" checked={selectedIds.size === servers.length && servers.length > 0} onChange={selectAll} />
            <span>全选 ({selectedIds.size}/{servers.length})</span>
          </label>
        </div>
        <div className="batch-command-servers-list">
          {servers.map((s) => (
            <label key={s.id} className="batch-checkbox-label batch-server-item">
              <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => toggleServer(s.id)} />
              <span>{s.name || s.host}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="batch-command-input">
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="输入要批量执行的命令..."
          rows={3}
          disabled={executing}
        />
        <button className="primary-button slim-button" onClick={handleExec} disabled={executing || !command.trim() || selectedIds.size === 0}>
          <Play size={12} />
          {executing ? "执行中..." : "执行"}
        </button>
      </div>

      {results.length > 0 ? (
        <div className="batch-command-results">
          {results.map((r) => (
            <div key={r.serverId} className={`batch-result-item ${r.error ? "batch-result-error" : "batch-result-ok"}`}>
              <div className="batch-result-header" onClick={() => setExpandedId(expandedId === r.serverId ? null : r.serverId)}>
                {expandedId === r.serverId ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span className="batch-result-name">{r.serverName || r.serverId}</span>
                <span className="batch-result-meta">{r.durationMs}ms {r.error ? "❌" : "✓"}</span>
              </div>
              {expandedId === r.serverId ? (
                <div className="batch-result-detail">
                  {r.stdout ? (
                    <pre className="batch-result-stdout">{r.stdout}</pre>
                  ) : null}
                  {r.stderr ? (
                    <pre className="batch-result-stderr">{r.stderr}</pre>
                  ) : null}
                  {!r.stdout && !r.stderr ? <span className="batch-result-empty">（无输出）</span> : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
