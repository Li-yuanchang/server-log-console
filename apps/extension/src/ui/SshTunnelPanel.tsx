import { useCallback, useEffect, useState } from "react";
import { Plug, X, RefreshCw, Plus } from "lucide-react";
import type { SshTunnelInfo, SshTunnelRequest } from "@server-log-console/shared";
import { apiCreateSshTunnel, apiCloseSshTunnel, apiListSshTunnels } from "./api.js";

type Props = {
  visible: boolean;
  serverId: string;
  onClose: () => void;
  onStatus: (msg: string) => void;
};

export function SshTunnelPanel({ visible, serverId, onClose, onStatus }: Props) {
  const [tunnels, setTunnels] = useState<SshTunnelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<"local" | "remote">("local");
  const [formLocalHost, setFormLocalHost] = useState("127.0.0.1");
  const [formLocalPort, setFormLocalPort] = useState("");
  const [formRemoteHost, setFormRemoteHost] = useState("127.0.0.1");
  const [formRemotePort, setFormRemotePort] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiListSshTunnels();
      setTunnels(res.tunnels);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  if (!visible) return null;

  const handleCreate = async () => {
    const localPort = Number(formLocalPort);
    const remotePort = Number(formRemotePort);
    if (!localPort || !remotePort) {
      onStatus("请输入有效的端口号");
      return;
    }
    const req: SshTunnelRequest = {
      serverId,
      tunnelType: formType,
      localHost: formLocalHost,
      localPort,
      remoteHost: formRemoteHost,
      remotePort,
    };
    const res = await apiCreateSshTunnel(req);
    if (res.ok) {
      onStatus(`隧道已创建: ${formType} ${formType === "local" ? `${formLocalHost}:${localPort} → ${formRemoteHost}:${remotePort}` : `${formRemoteHost}:${remotePort} → ${formLocalHost}:${localPort}`}`);
      setShowForm(false);
      setFormLocalPort("");
      setFormRemotePort("");
      refresh();
    } else {
      onStatus(res.message || "创建隧道失败");
    }
  };

  const handleClose = async (tunnelId: string) => {
    const res = await apiCloseSshTunnel(tunnelId);
    if (res.ok) {
      onStatus("隧道已关闭");
      refresh();
    } else {
      onStatus(res.message || "关闭隧道失败");
    }
  };

  return (
    <div className="ssh-tunnel-panel">
      <div className="ssh-tunnel-header">
        <span>SSH 隧道</span>
        <div className="ssh-tunnel-actions">
          <button className="ghost-button icon-button" onClick={refresh} title="刷新"><RefreshCw size={12} /></button>
          <button className="ghost-button icon-button" onClick={() => setShowForm(!showForm)} title="新建隧道"><Plus size={12} /></button>
          <button className="ghost-button slim-button" onClick={onClose}>关闭</button>
        </div>
      </div>

      {showForm ? (
        <div className="ssh-tunnel-form">
          <div className="ssh-tunnel-form-row">
            <label>类型</label>
            <select value={formType} onChange={(e) => setFormType(e.target.value as "local" | "remote")}>
              <option value="local">本地转发 (-L)</option>
              <option value="remote">远程转发 (-R)</option>
            </select>
          </div>
          <div className="ssh-tunnel-form-row">
            <label>本地地址</label>
            <input value={formLocalHost} onChange={(e) => setFormLocalHost(e.target.value)} placeholder="127.0.0.1" />
            <input value={formLocalPort} onChange={(e) => setFormLocalPort(e.target.value)} placeholder="端口" type="number" />
          </div>
          <div className="ssh-tunnel-form-row">
            <label>远程地址</label>
            <input value={formRemoteHost} onChange={(e) => setFormRemoteHost(e.target.value)} placeholder="127.0.0.1" />
            <input value={formRemotePort} onChange={(e) => setFormRemotePort(e.target.value)} placeholder="端口" type="number" />
          </div>
          <button className="primary-button slim-button" onClick={handleCreate}>创建</button>
          <button className="ghost-button slim-button" onClick={() => setShowForm(false)}>取消</button>
        </div>
      ) : null}

      <div className="ssh-tunnel-list">
        {loading ? <div className="ssh-tunnel-loading">加载中...</div> : null}
        {!loading && tunnels.length === 0 ? <div className="ssh-tunnel-empty">暂无活跃隧道</div> : null}
        {!loading && tunnels.map((t) => (
          <div key={t.tunnelId} className={`ssh-tunnel-entry ssh-tunnel-${t.status}`}>
            <Plug size={12} />
            <div className="ssh-tunnel-entry-info">
              <span className="ssh-tunnel-type">{t.tunnelType === "local" ? "-L" : "-R"}</span>
              <span>{t.tunnelType === "local" ? `${t.localHost}:${t.localPort} → ${t.remoteHost}:${t.remotePort}` : `${t.remoteHost}:${t.remotePort} → ${t.localHost}:${t.localPort}`}</span>
            </div>
            <span className={`ssh-tunnel-status ssh-tunnel-status-${t.status}`}>{t.status === "active" ? "活跃" : t.status === "error" ? "错误" : "已关闭"}</span>
            <button className="ghost-button icon-button" onClick={() => handleClose(t.tunnelId)} title="关闭隧道"><X size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
