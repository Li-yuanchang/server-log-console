import { useCallback, useEffect, useMemo, useState } from "react";
import type { ImportPreviewResponse, ImportServerChange, ServerSummary } from "@server-log-console/shared";
import { apiApplyImport, apiPreviewImport } from "./api.js";
import { useEscapeToClose } from "./useEscapeToClose.js";

/**
 * 重新导入 · 变更预览
 *
 * 背景：此前重新导入是全量静默覆盖 —— 用户在 FinalShell 里删掉一台机器，
 * 本工具里的日志路径/搜索条件/堡垒机路由会一起消失，界面却只显示「导入成功」。
 *
 * 交互约定：
 * - 打开即拉预览，不写库
 * - 「删除」默认不勾选（保留），必须用户主动勾选才删
 * - 「修改」默认不勾选（保留本地值），勾选才用导入值覆盖
 * - 「新增」不需要确认，直接展示
 * - 有本地配置的删除项额外标红提示
 */

interface ImportPreviewDialogProps {
  visible: boolean;
  toolId: "finalshell" | "xshell";
  toolLabel: string;
  onClose: () => void;
  onApplied: (result: { servers: ServerSummary[]; summary: string }) => void;
  onStatus: (message: string) => void;
}

export function ImportPreviewDialog(props: ImportPreviewDialogProps) {
  const { visible, toolId, toolLabel, onClose, onApplied, onStatus } = props;
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [removeIds, setRemoveIds] = useState<Set<string>>(new Set());
  const [updateIds, setUpdateIds] = useState<Set<string>>(new Set());

  useEscapeToClose(visible, onClose);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiPreviewImport(toolId);
      setPreview(result);
      // 删除默认全不勾（保留）；修改默认全不勾（保留本地值）
      setRemoveIds(new Set());
      setUpdateIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, [toolId]);

  useEffect(() => {
    if (visible) {
      void load();
    } else {
      setPreview(null);
      setError(null);
      setRemoveIds(new Set());
      setUpdateIds(new Set());
    }
  }, [visible, load]);

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  };

  const totalChanges = useMemo(() => {
    if (!preview) return 0;
    return preview.added.length + preview.removed.length + preview.updated.length;
  }, [preview]);

  const apply = useCallback(async () => {
    if (!preview) return;
    setApplying(true);
    try {
      const result = await apiApplyImport({
        toolId,
        removeServerIds: Array.from(removeIds),
        updateServerIds: Array.from(updateIds)
      });
      const parts: string[] = [];
      if (result.addedCount > 0) parts.push(`新增 ${result.addedCount}`);
      if (result.removedCount > 0) parts.push(`删除 ${result.removedCount}`);
      if (result.updatedCount > 0) parts.push(`更新 ${result.updatedCount}`);
      if (result.keptCount > 0) parts.push(`保留 ${result.keptCount}`);
      const summary = parts.length > 0 ? parts.join(" · ") : "没有变化";

      const missing = result.missingPrivateKeyServers ?? [];
      if (missing.length > 0) {
        const names = missing.slice(0, 3).join("、");
        const more = missing.length > 3 ? ` 等 ${missing.length} 台` : "";
        onStatus(`${summary}；但 ${names}${more} 的私钥未读到，凭证不完整`);
      } else {
        onStatus(`${toolLabel} 导入完成：${summary}`);
      }

      onApplied({ servers: result.servers, summary });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setApplying(false);
    }
  }, [preview, toolId, removeIds, updateIds, toolLabel, onStatus, onApplied, onClose]);

  if (!visible) return null;

  return (
    <div className="ipd-scrim" role="dialog" aria-modal="true" aria-label="导入变更预览">
      <div className="ipd-panel">
        <header className="ipd-head">
          <div>
            <strong>重新导入 {toolLabel} · 变更预览</strong>
            <span>
              {loading ? "正在比对…" : preview ? `${totalChanges} 处变化 · 未匹配 ${preview.unchangedCount} 台` : ""}
            </span>
          </div>
          <button type="button" className="ghost-button" onClick={onClose} disabled={applying}>
            取消
          </button>
        </header>

        <div className="ipd-body">
          {loading ? <div className="ipd-hint">正在读取配置并比对…</div> : null}

          {error ? (
            <div className="ipd-error">
              <strong>无法读取变更</strong>
              <span>{error}</span>
              <button type="button" className="ghost-button" onClick={() => void load()}>重试</button>
            </div>
          ) : null}

          {!loading && !error && preview ? (
            <>
              {totalChanges === 0 ? (
                <div className="ipd-hint">
                  与当前记录完全一致，没有需要应用的变更。
                </div>
              ) : null}

              {preview.added.length > 0 ? (
                <section className="ipd-section">
                  <div className="ipd-section-head">
                    <span className="ipd-kicker">新增</span>
                    <span className="ipd-count ipd-count-add">{preview.added.length}</span>
                  </div>
                  {preview.added.map((change) => (
                    <div key={change.serverId} className="ipd-row">
                      <span className="ipd-dot ipd-dot-add" aria-hidden="true" />
                      <div className="ipd-main">
                        <strong>{change.name}</strong>
                        <span className="mono">{change.username}@{change.host}:{change.port}</span>
                      </div>
                      <span className="ipd-tag ipd-tag-add">加入</span>
                    </div>
                  ))}
                </section>
              ) : null}

              {preview.removed.length > 0 ? (
                <section className="ipd-section">
                  <div className="ipd-section-head">
                    <span className="ipd-kicker">已从 {toolLabel} 移除 · 需要你决定</span>
                    <span className="ipd-count ipd-count-warn">{preview.removed.length}</span>
                  </div>
                  {preview.removed.map((change) => (
                    <label key={change.serverId} className={`ipd-row ipd-row-check${removeIds.has(change.serverId) ? " ipd-row-on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={removeIds.has(change.serverId)}
                        onChange={() => setRemoveIds((prev) => toggle(prev, change.serverId))}
                      />
                      <div className="ipd-main">
                        <strong>{change.name}</strong>
                        <span className="mono">{change.username}@{change.host}:{change.port}</span>
                        {change.hasLocalData ? (
                          <span className="ipd-warn">本工具里还有该连接的配置（日志路径 / 路由 / 已保存凭证）</span>
                        ) : null}
                      </div>
                      <span className={`ipd-tag ${removeIds.has(change.serverId) ? "ipd-tag-warn" : "ipd-tag-keep"}`}>
                        {removeIds.has(change.serverId) ? "删除" : "保留"}
                      </span>
                    </label>
                  ))}
                  <div className="ipd-note">默认全部保留 —— 在 {toolLabel} 里清理机器，不应该顺手清掉本工具的配置。</div>
                </section>
              ) : null}

              {preview.updated.length > 0 ? (
                <section className="ipd-section">
                  <div className="ipd-section-head">
                    <span className="ipd-kicker">参数有变化 · 需要你决定</span>
                    <span className="ipd-count ipd-count-info">{preview.updated.length}</span>
                  </div>
                  {preview.updated.map((change) => (
                    <UpdatedRow
                      key={change.serverId}
                      change={change}
                      checked={updateIds.has(change.serverId)}
                      onToggle={() => setUpdateIds((prev) => toggle(prev, change.serverId))}
                      toolLabel={toolLabel}
                    />
                  ))}
                  <div className="ipd-note">默认保留本工具里的值 —— 你在这里改过的参数通常是更新的意图。</div>
                </section>
              ) : null}

              {preview.missingPrivateKeyServers && preview.missingPrivateKeyServers.length > 0 ? (
                <div className="ipd-error">
                  <strong>{preview.missingPrivateKeyServers.length} 台私钥未读到</strong>
                  <span>
                    {preview.missingPrivateKeyServers.slice(0, 5).join("、")}
                    {preview.missingPrivateKeyServers.length > 5 ? " 等" : ""}
                    ：这些服务器声明用私钥认证，但私钥文件没读到，导入后凭证不完整，连接会认证失败。
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <footer className="ipd-foot">
          <span className="ipd-foot-hint">
            {preview
              ? `删除 ${removeIds.size} · 覆盖 ${updateIds.size} · 新增 ${preview.added.length}`
              : ""}
          </span>
          <button type="button" className="ghost-button" onClick={onClose} disabled={applying}>取消</button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void apply()}
            disabled={applying || loading || !preview}
          >
            {applying ? "正在应用…" : "应用变更"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function UpdatedRow(props: {
  change: ImportServerChange;
  checked: boolean;
  onToggle: () => void;
  toolLabel: string;
}) {
  const { change, checked, onToggle, toolLabel } = props;
  return (
    <label className={`ipd-row ipd-row-check ipd-row-stack${checked ? " ipd-row-on" : ""}`}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <div className="ipd-main">
        <strong>{change.name}</strong>
        {change.changes?.map((fieldChange) => (
          <span key={fieldChange.field} className="ipd-field">
            <span className="ipd-field-label">{fieldChange.label}</span>
            <span className="mono ipd-field-old">{fieldChange.before}</span>
            <span className="ipd-field-arrow">→</span>
            <span className="mono ipd-field-new">{fieldChange.after}</span>
          </span>
        ))}
      </div>
      <span className={`ipd-tag ${checked ? "ipd-tag-info" : "ipd-tag-keep"}`}>
        {checked ? `用 ${toolLabel} 的` : "保留本地"}
      </span>
    </label>
  );
}
