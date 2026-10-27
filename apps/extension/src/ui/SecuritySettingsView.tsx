import { useCallback, useEffect, useState } from "react";
import type { SecurityStatusResponse } from "@server-log-console/shared";
import { apiGetSecurityStatus } from "./api.js";

/**
 * 设置中心 → 安全
 *
 * 背景：凭证加密与访问令牌是「静默生效」的能力 —— 后端默认开启，但用户完全
 * 不知道它在保护什么、当前是否生效、出问题（换机器导致密钥丢失）时也无从
 * 诊断。这一页把三个状态摆出来，且不提供「关掉加密」的开关（安全默认值不该
 * 交给用户随手关闭），只做可见化与说明。
 */

interface SecuritySettingsViewProps {
  isElectron: boolean;
  onStatus: (message: string) => void;
}

export function SecuritySettingsView(props: SecuritySettingsViewProps) {
  const { isElectron, onStatus } = props;
  const [status, setStatus] = useState<SecurityStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await apiGetSecurityStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const encryptionOn = status?.credentialEncryptionEnabled ?? false;
  const authOn = status?.authEnabled ?? false;
  const exportOn = status?.secretsExportEnabled ?? false;
  /* 风险只算「加密/鉴权未生效」—— 那两项是凭证直接暴露。
     明文导出接口默认开放（本地单用户场景合理），只作为提示项，不拉黄条，
     否则默认配置下永久显示警告，反而让人对提示麻木。 */
  const hasRisk = status !== null && (!encryptionOn || !authOn);

  return (
    <div className="view">
      <div className="view-head">
        <div style={{ flex: 1 }}>
          <h1>安全</h1>
          <div className="desc">
            {loading ? "正在读取…" : status ? (hasRisk ? "存在需要关注的风险项" : "关键防护已生效") : "无法读取状态"}
          </div>
        </div>
        <button type="button" className="ghost-button" onClick={() => { void load(); onStatus("已刷新安全状态"); }} disabled={loading}>
          刷新
        </button>
      </div>

      <div className="view-scroll">
        {error ? (
          <div className="sec-alert sec-alert-bad">
            <strong>无法读取安全状态</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {hasRisk ? (
          <div className="sec-alert sec-alert-warn">
            <strong>有防护未生效</strong>
            <span>下列标黄的项目当前没有保护你的凭证，建议按说明处理。</span>
          </div>
        ) : null}

        {/* 凭证加密 */}
        <div className="sec-kicker">凭证存储</div>
        <section className="sec-card">
          <div className="sec-row">
            <div className="sec-label">
              <strong>凭证加密保存</strong>
              <span>
                SSH 密码与私钥以 AES-256-GCM 加密后写入磁盘。
                {isElectron ? "密钥由系统钥匙串托管，你不需要输入任何密码。" : "浏览器形态下密钥保存在本机密钥文件（权限 600）。"}
              </span>
            </div>
            <span className={`sec-badge ${encryptionOn ? "sec-badge-ok" : "sec-badge-warn"}`}>
              {encryptionOn ? "已开启" : "未开启"}
            </span>
          </div>
          <div className="sec-row">
            <div className="sec-label">
              <strong>能防住</strong>
              <span>笔记本丢失或被盗 · 备份/网盘同步把配置目录带出去 · 别人临时用这台机器翻文件</span>
            </div>
            <span className="sec-badge sec-badge-ok">有效</span>
          </div>
          <div className="sec-row">
            <div className="sec-label">
              <strong>防不住</strong>
              <span>本机恶意软件（能读内存或密钥文件）· 浏览器里其它网页调用本机接口（由下方访问令牌负责）</span>
            </div>
            <span className="sec-badge sec-badge-mute">已知边界</span>
          </div>
        </section>

        {/* 访问令牌 */}
        <div className="sec-kicker">本机接口访问</div>
        <section className="sec-card">
          <div className="sec-row">
            <div className="sec-label">
              <strong>访问令牌校验</strong>
              <span>
                浏览器形态下，本机 4040 端口对任意网页可达。开启后除 /health 外全部接口与
                WebSocket 都要求令牌，别家网页无法调用。
              </span>
            </div>
            <span className={`sec-badge ${authOn ? "sec-badge-ok" : "sec-badge-bad"}`}>
              {authOn ? "已启用" : "未启用"}
            </span>
          </div>
          <div className="sec-row">
            <div className="sec-label">
              <strong>跨源白名单（CORS）</strong>
              <span>
                仅放行本工具自身来源：网关自托管页面、SLC 开发服务器（5273）、Chrome 扩展。
                本机其它端口的服务不被信任，外部站点一律拒绝。
              </span>
            </div>
            <span className="sec-badge sec-badge-ok">已收紧</span>
          </div>
          <div className="sec-row">
            <div className="sec-label">
              <strong>凭证明文导出接口</strong>
              <span>
                {exportOn
                  ? "当前允许通过接口导出明文密码。共享部署或多人共用本机时建议关闭。"
                  : "已通过 GATEWAY_HIDE_SECRETS=1 关闭。"}
              </span>
            </div>
            <span className={`sec-badge ${exportOn ? "sec-badge-warn" : "sec-badge-ok"}`}>
              {exportOn ? "开放" : "已关闭"}
            </span>
          </div>
        </section>

        {/* 说明 */}
        <div className="sec-kicker">关于令牌的位置</div>
        <section className="sec-card">
          <div className="sec-row sec-row-stack">
            <div className="sec-label">
              <strong>令牌保存在本机，不随仓库分发</strong>
              <span>
                令牌写在 <code>~/.server-log-console/gateway-auth.json</code>（权限 600），
                属于用户家目录，不在项目仓库内，也不会被提交。
              </span>
            </div>
          </div>
          <div className="sec-row sec-row-stack">
            <div className="sec-label">
              <strong>桌面端自动注入，无需你操作</strong>
              <span>
                {isElectron
                  ? "主进程启动网关时自动带上令牌，前端通过 IPC 取得，界面上不会要求你填写。"
                  : "当前是浏览器 / 扩展形态，需要在「连接服务」里填一次令牌；桌面版无需填写。"}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
