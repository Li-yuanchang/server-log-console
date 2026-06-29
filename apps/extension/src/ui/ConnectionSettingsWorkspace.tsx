import { useState, type CSSProperties } from "react";
import type { JumpServerAssetOption, LogProfile, ServerConnectionKind, ServerCredentialStatus, ServerSummary } from "@server-log-console/shared";
import { looksLikeJumpServer } from "./terminal-utils.js";

export type SettingsWorkspaceView = "overview" | "inventory" | "server";

export interface ManualServerDraft {
  id: string;
  name: string;
  host: string;
  port: string;
  username: string;
  basePath: string;
  profile: LogProfile;
  tagsText: string;
  connectionKind: ServerConnectionKind;
  password: string;
  privateKey: string;
}

interface Props {
  activeView: SettingsWorkspaceView;
  onViewChange: (view: SettingsWorkspaceView) => void;
  isBusy: boolean;
  localServiceState: "checking" | "online" | "offline";
  localServiceStatusText: string;
  importSection: {
    selectedTool: "finalshell" | "xshell";
    importStatus: string;
    importPath: string;
    finalShellPath: string;
    finalShellDetectedPaths: string[];
    finalShellLastImportedAt: string;
    xshellDetectedPaths: string[];
    xshellLastImportedAt: string;
    onSelectTool: (tool: "finalshell" | "xshell") => void;
    onChangeFinalShellPath: (value: string) => void;
    onCheckService: () => void;
    onSaveFinalShellPath: () => void;
    onImport: (tool?: "finalshell" | "xshell") => void;
  };
  inventorySection: {
    managedServers: ServerSummary[];
    manualServers: ServerSummary[];
    importedServers: ServerSummary[];
    selectedServerId: string;
    draft: ManualServerDraft;
    canSaveDraft: boolean;
    onSelectServer: (serverId: string) => void;
    onStartCreate: () => void;
    onStartEdit: (server: ServerSummary) => void;
    onChangeDraft: (patch: Partial<ManualServerDraft>) => void;
    onResetDraft: () => void;
    onSaveDraft: () => void;
    onDeleteServer: (server: ServerSummary) => void;
  };
  currentServerSection: {
    selectedServer: ServerSummary | null;
    connectionDirectory: string;
    credentialStatus: ServerCredentialStatus | null;
    credentialUsername: string;
    credentialPassword: string;
    credentialPrivateKey: string;
    onCredentialUsernameChange: (value: string) => void;
    onCredentialPasswordChange: (value: string) => void;
    onCredentialPrivateKeyChange: (value: string) => void;
    onSaveCredential: () => void;
    onTestConnection: () => void;
    onOpenTerminal: () => void;
    availableBastions: ServerSummary[];
    preferredBastionId: string;
    jumpMode: "auto" | "jumpserver-search";
    jumpSearchKeyword: string;
    jumpAssetId: string;
    jumpAssetOptions: JumpServerAssetOption[];
    onPreferredBastionChange: (value: string) => void;
    onJumpModeChange: (value: "auto" | "jumpserver-search") => void;
    onJumpSearchKeywordChange: (value: string) => void;
    onJumpAssetIdChange: (value: string) => void;
    onSearchJumpAssets: () => void;
    onSaveRoute: () => void;
  };
}

function sourceLabel(source?: ServerSummary["source"]) {
  if (source === "manual") return "手动维护";
  if (source === "finalshell") return "FinalShell";
  if (source === "xshell") return "Xshell";
  return "内置";
}

function connectionKindLabel(kind?: ServerConnectionKind) {
  if (kind === "bastion") return "堡垒机入口";
  if (kind === "bastion-target") return "经堡垒机目标机";
  return "普通直连";
}

function connectionKindHint(kind: ServerConnectionKind) {
  if (kind === "bastion") return "作为堡垒机入口账号使用。";
  if (kind === "bastion-target") return "保存后还需要在当前连接里指定入口账号。";
  return "普通 SSH 直连服务器。";
}

function serviceTone(state: Props["localServiceState"]) {
  if (state === "online") return "success";
  if (state === "offline") return "danger";
  return "neutral";
}

export function ConnectionSettingsWorkspace(props: Props) {
  const [showCredentialPassword, setShowCredentialPassword] = useState(false);
  const [showCredentialPrivateKey, setShowCredentialPrivateKey] = useState(false);
  const selectedServer = props.currentServerSection.selectedServer;
  const credentialStatus = props.currentServerSection.credentialStatus;
  const hasCredentialDraft = Boolean(
    props.currentServerSection.credentialPassword
    || props.currentServerSection.credentialPrivateKey
    || props.currentServerSection.credentialUsername !== (credentialStatus?.username || selectedServer?.username || "")
  );
  const selectedBastion = props.currentServerSection.availableBastions.find(
    (server) => server.id === props.currentServerSection.preferredBastionId
  ) ?? null;
  const showJumpFields = Boolean(
    (selectedServer && looksLikeJumpServer(selectedServer))
    || (selectedBastion && looksLikeJumpServer(selectedBastion))
  );
  const canConfigureRoute = Boolean(
    selectedServer
    && (
      selectedServer.connectionKind === "bastion-target"
      || !selectedServer.connectionKind
      || looksLikeJumpServer(selectedServer)
    )
  );
  const canPickEntry = Boolean(
    selectedServer
    && selectedServer.connectionKind !== "bastion"
    && !looksLikeJumpServer(selectedServer)
    && (selectedServer.connectionKind === "bastion-target" || !selectedServer.connectionKind)
  );
  return (
    <section className="settings-workspace">
      <header className="settings-workspace-head">
        <div>
          <p className="settings-workspace-eyebrow">设置工作区</p>
          <h2 className="settings-workspace-title">连接设置</h2>
          <p className="settings-workspace-subtitle">把导入、手动维护和当前连接拆开处理。</p>
        </div>
        <div className="settings-workspace-pills">
          <span className={`settings-pill settings-pill-${serviceTone(props.localServiceState)}`}>{props.localServiceStatusText}</span>
          <span className="settings-pill">{props.inventorySection.managedServers.length} 台已维护</span>
          <span className="settings-pill">{props.inventorySection.manualServers.length} 台手动维护</span>
        </div>
      </header>
      <nav className="settings-workspace-nav">
        <button type="button" className={props.activeView === "overview" ? "settings-nav-btn settings-nav-btn-active" : "settings-nav-btn"} onClick={() => props.onViewChange("overview")}>导入与概览</button>
        <button type="button" className={props.activeView === "inventory" ? "settings-nav-btn settings-nav-btn-active" : "settings-nav-btn"} onClick={() => props.onViewChange("inventory")}>服务器台账</button>
        <button type="button" className={props.activeView === "server" ? "settings-nav-btn settings-nav-btn-active" : "settings-nav-btn"} onClick={() => props.onViewChange("server")}>当前连接</button>
      </nav>

      {props.activeView === "overview" ? (
        <div className="settings-workspace-grid settings-workspace-grid-overview">
          <section className="settings-card settings-card-hero">
            <div className="settings-card-head">
              <div>
                <span className="settings-card-kicker">自动导入</span>
                <strong>FinalShell</strong>
              </div>
              <div className="settings-inline-actions">
                <button className="ghost-button" type="button" onClick={props.importSection.onCheckService} disabled={props.isBusy}>检查服务</button>
                <button className="ghost-button" type="button" onClick={props.importSection.onSaveFinalShellPath} disabled={props.isBusy}>保存目录</button>
                <button className="ghost-button" type="button" onClick={() => props.importSection.onImport("finalshell")} disabled={props.isBusy || props.localServiceState !== "online"}>立即导入</button>
              </div>
            </div>
            <div className="settings-tool-switcher">
              <button type="button" className={props.importSection.selectedTool === "finalshell" ? "settings-tool-chip settings-tool-chip-active" : "settings-tool-chip"} onClick={() => props.importSection.onSelectTool("finalshell")}>FinalShell</button>
              <button type="button" className={props.importSection.selectedTool === "xshell" ? "settings-tool-chip settings-tool-chip-active" : "settings-tool-chip"} onClick={() => props.importSection.onSelectTool("xshell")}>Xshell</button>
            </div>
            <label className="settings-field">
              <span>配置目录</span>
              <input value={props.importSection.finalShellPath} onChange={(event) => props.importSection.onChangeFinalShellPath(event.target.value)} placeholder="~/Library/FinalShell/conn" />
            </label>
            <div className="settings-meta-grid">
              <span>导入状态：{props.importSection.importStatus}</span>
              <span>识别结果：{props.importSection.importPath}</span>
              <span>上次导入：{props.importSection.finalShellLastImportedAt || "--"}</span>
              <span>检测路径：{props.importSection.finalShellDetectedPaths.length}</span>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <div>
                <span className="settings-card-kicker">兼容导入</span>
                <strong>Xshell</strong>
              </div>
              <button className="ghost-button" type="button" onClick={() => props.importSection.onImport("xshell")} disabled={props.isBusy || props.localServiceState !== "online"}>导入 Xshell</button>
            </div>
            <div className="settings-meta-grid">
              <span>导入状态：{props.importSection.importStatus}</span>
              <span>上次导入：{props.importSection.xshellLastImportedAt || "--"}</span>
              <span>检测路径：{props.importSection.xshellDetectedPaths.length}</span>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <div>
                <span className="settings-card-kicker">手动维护</span>
                <strong>服务器台账</strong>
              </div>
              <div className="settings-inline-actions">
                <button className="ghost-button" type="button" onClick={() => props.onViewChange("inventory")}>打开台账</button>
                <button className="ghost-button" type="button" onClick={props.inventorySection.onStartCreate}>新建服务器</button>
              </div>
            </div>
            <div className="settings-meta-grid">
              <span>手动维护：{props.inventorySection.manualServers.length} 台</span>
              <span>自动导入：{props.inventorySection.importedServers.length} 台</span>
              <span>当前选中：{selectedServer?.name || "--"}</span>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <div>
                <span className="settings-card-kicker">当前连接</span>
                <strong>{selectedServer?.name || "尚未选择服务器"}</strong>
              </div>
              <div className="settings-inline-actions">
                <button className="ghost-button" type="button" onClick={() => props.onViewChange("server")} disabled={!selectedServer}>进入连接设置</button>
                <button className="ghost-button" type="button" onClick={props.currentServerSection.onOpenTerminal} disabled={!selectedServer || props.isBusy}>打开终端</button>
              </div>
            </div>
            <div className="settings-meta-grid">
              <span>来源：{selectedServer ? sourceLabel(selectedServer.source) : "--"}</span>
              <span>类型：{selectedServer ? connectionKindLabel(selectedServer.connectionKind) : "--"}</span>
              <span>路径：{props.currentServerSection.connectionDirectory || "/"}</span>
            </div>
          </section>
        </div>
      ) : null}

      {props.activeView === "inventory" ? (
        <div className="settings-workspace-grid settings-workspace-grid-inventory">
          <section className="settings-card settings-card-scroll">
            <div className="settings-card-head">
              <div>
                <span className="settings-card-kicker">服务器台账</span>
                <strong>已维护的服务器</strong>
              </div>
              <button className="ghost-button" type="button" onClick={props.inventorySection.onStartCreate}>新建</button>
            </div>
            <div className="settings-server-list">
              {props.inventorySection.managedServers.length ? props.inventorySection.managedServers.map((server) => (
                <div key={server.id} className={`settings-server-row${props.inventorySection.selectedServerId === server.id ? " settings-server-row-active" : ""}`}>
                  <button type="button" className="settings-server-main" onClick={() => props.inventorySection.onSelectServer(server.id)}>
                    <strong>{server.name}</strong>
                    <span>{server.username}@{server.host}:{server.port}</span>
                  </button>
                  <div className="settings-server-meta">
                    <span className={`settings-source-chip settings-source-chip-${server.source || "builtin"}`}>{sourceLabel(server.source)}</span>
                    <span className="settings-kind-chip">{connectionKindLabel(server.connectionKind)}</span>
                  </div>
                  <div className="settings-server-actions">
                    {server.source === "manual" ? <button className="ghost-button" type="button" onClick={() => props.inventorySection.onStartEdit(server)}>编辑</button> : null}
                    {server.source ? <button className="ghost-button danger-button" type="button" onClick={() => props.inventorySection.onDeleteServer(server)}>删除</button> : null}
                  </div>
                </div>
              )) : <div className="settings-workspace-empty"><strong>还没有可维护的服务器</strong><span>先导入一批，或者直接手动新增。</span></div>}
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <div>
                <span className="settings-card-kicker">手动维护</span>
                <strong>{props.inventorySection.draft.id ? "编辑手动服务器" : "新建手动服务器"}</strong>
              </div>
              <div className="settings-inline-actions">
                <button className="ghost-button" type="button" onClick={props.inventorySection.onResetDraft}>清空</button>
                <button className="ghost-button" type="button" onClick={props.inventorySection.onSaveDraft} disabled={!props.inventorySection.canSaveDraft || props.isBusy}>保存服务器</button>
              </div>
            </div>
            <div className="settings-form-grid settings-form-grid-two">
              <label className="settings-field">
                <span>名称</span>
                <input value={props.inventorySection.draft.name} onChange={(event) => props.inventorySection.onChangeDraft({ name: event.target.value })} />
              </label>
              <label className="settings-field">
                <span>主机</span>
                <input value={props.inventorySection.draft.host} onChange={(event) => props.inventorySection.onChangeDraft({ host: event.target.value })} />
              </label>
              <label className="settings-field">
                <span>端口</span>
                <input value={props.inventorySection.draft.port} onChange={(event) => props.inventorySection.onChangeDraft({ port: event.target.value })} placeholder="22" />
              </label>
              <label className="settings-field">
                <span>用户名</span>
                <input value={props.inventorySection.draft.username} onChange={(event) => props.inventorySection.onChangeDraft({ username: event.target.value })} />
              </label>
              <label className="settings-field">
                <span>日志目录</span>
                <input value={props.inventorySection.draft.basePath} onChange={(event) => props.inventorySection.onChangeDraft({ basePath: event.target.value })} placeholder="/var/log" />
              </label>
              <label className="settings-field">
                <span>日志模式</span>
                <select value={props.inventorySection.draft.profile} onChange={(event) => props.inventorySection.onChangeDraft({ profile: event.target.value as LogProfile })}>
                  <option value="custom">自定义</option>
                  <option value="nginx">Nginx</option>
                  <option value="system">系统日志</option>
                </select>
              </label>
              <label className="settings-field">
                <span>连接方式</span>
                <select value={props.inventorySection.draft.connectionKind} onChange={(event) => props.inventorySection.onChangeDraft({ connectionKind: event.target.value as ServerConnectionKind })}>
                  <option value="direct">普通直连</option>
                  <option value="bastion">堡垒机入口</option>
                  <option value="bastion-target">经堡垒机目标机</option>
                </select>
              </label>
              <label className="settings-field">
                <span>标签</span>
                <input value={props.inventorySection.draft.tagsText} onChange={(event) => props.inventorySection.onChangeDraft({ tagsText: event.target.value })} placeholder="prod, web, jump" />
              </label>
              <label className="settings-field settings-field-span-2">
                <span>密码</span>
                <input type="password" value={props.inventorySection.draft.password} onChange={(event) => props.inventorySection.onChangeDraft({ password: event.target.value })} placeholder="留空则不更新密码" />
              </label>
              <label className="settings-field settings-field-span-2">
                <span>私钥</span>
                <textarea value={props.inventorySection.draft.privateKey} onChange={(event) => props.inventorySection.onChangeDraft({ privateKey: event.target.value })} placeholder="可直接粘贴私钥内容" />
              </label>
            </div>
            <div className="settings-note-box">
              <strong>{connectionKindLabel(props.inventorySection.draft.connectionKind)}</strong>
              <span>{connectionKindHint(props.inventorySection.draft.connectionKind)}</span>
            </div>
          </section>
        </div>
      ) : null}

      {props.activeView === "server" ? (
        selectedServer ? (
          <div className="settings-workspace-grid settings-workspace-grid-server">
            <section className="settings-card settings-card-banner">
              <div className="settings-card-head">
                <div>
                  <span className="settings-card-kicker">当前连接</span>
                  <strong>{selectedServer.name}</strong>
                </div>
                <div className="settings-inline-actions">
                  <button className="ghost-button" type="button" onClick={props.currentServerSection.onTestConnection} disabled={props.isBusy}>重连测试</button>
                  <button className="ghost-button" type="button" onClick={props.currentServerSection.onOpenTerminal} disabled={props.isBusy}>打开终端</button>
                </div>
              </div>
              <div className="settings-meta-grid">
                <span>来源：{sourceLabel(selectedServer.source)}</span>
                <span>类型：{connectionKindLabel(selectedServer.connectionKind)}</span>
                <span>目录：{props.currentServerSection.connectionDirectory || "/"}</span>
                <span>说明：{selectedServer.connectionHint || "--"}</span>
              </div>
            </section>

            <section className="settings-card">
              <div className="settings-card-head">
                <div>
                  <span className="settings-card-kicker">连接凭证</span>
                  <strong>按服务器维度保存</strong>
                  <p className="settings-card-note">
                    已保存的密码/私钥不会回显；留空表示继续沿用现有凭证，填写后保存会覆盖。
                  </p>
                </div>
                <div className="settings-inline-actions">
                  <button className="ghost-button" type="button" onClick={props.currentServerSection.onTestConnection} disabled={props.isBusy}>重连</button>
                  <button className="ghost-button settings-primary-action" type="button" onClick={props.currentServerSection.onSaveCredential} disabled={props.isBusy}>
                    {props.isBusy ? "保存中..." : hasCredentialDraft ? "保存并覆盖" : "保存凭证"}
                  </button>
                </div>
              </div>
              <div className="credential-status-panel">
                <div className="credential-status-main">
                  <span className={`credential-status-dot ${credentialStatus?.hasUsableCredential ? "credential-status-dot-ok" : "credential-status-dot-warn"}`} />
                  <div>
                    <strong>{credentialStatus?.hasUsableCredential ? "已有可用凭证" : "尚未配置可用凭证"}</strong>
                    <span>{credentialStatus?.message || "读取凭证状态后会显示保存来源和可用性。"}</span>
                  </div>
                </div>
                <div className="credential-status-tags">
                  <span>来源：{credentialStatus?.source || "--"}</span>
                  <span>用户名：{credentialStatus?.username || selectedServer.username || "--"}</span>
                  <span className={credentialStatus?.hasPassword ? "credential-tag-ok" : ""}>密码：{credentialStatus?.hasPassword ? "已保存" : "未配置"}</span>
                  <span className={credentialStatus?.hasPrivateKey ? "credential-tag-ok" : ""}>私钥：{credentialStatus?.hasPrivateKey ? "已保存" : "未配置"}</span>
                </div>
              </div>
              <div className="settings-form-grid settings-form-grid-single">
                <label className="settings-field">
                  <span>用户名</span>
                  <input value={props.currentServerSection.credentialUsername} onChange={(event) => props.currentServerSection.onCredentialUsernameChange(event.target.value)} />
                </label>
                <label className="settings-field">
                  <span>密码</span>
                  <div className="settings-secret-field">
                    <input
                      type={showCredentialPassword ? "text" : "password"}
                      value={props.currentServerSection.credentialPassword}
                      onChange={(event) => props.currentServerSection.onCredentialPasswordChange(event.target.value)}
                      placeholder={credentialStatus?.hasPassword ? "已保存，留空不覆盖" : "输入密码后保存"}
                    />
                    <button type="button" className="ghost-button slim-button" onClick={() => setShowCredentialPassword((current) => !current)}>
                      {showCredentialPassword ? "隐藏" : "显示"}
                    </button>
                  </div>
                </label>
                <label className="settings-field">
                  <span>私钥</span>
                  <div className="settings-secret-field settings-secret-field-textarea">
                    <textarea
                      value={props.currentServerSection.credentialPrivateKey}
                      onChange={(event) => props.currentServerSection.onCredentialPrivateKeyChange(event.target.value)}
                      placeholder={credentialStatus?.hasPrivateKey ? "已保存，留空不覆盖；需要替换时粘贴新私钥" : "可直接粘贴私钥内容"}
                      spellCheck={false}
                      style={showCredentialPrivateKey ? undefined : { WebkitTextSecurity: "disc" } as CSSProperties}
                    />
                    <button type="button" className="ghost-button slim-button" onClick={() => setShowCredentialPrivateKey((current) => !current)}>
                      {showCredentialPrivateKey ? "隐藏" : "显示"}
                    </button>
                  </div>
                </label>
              </div>
            </section>

            <section className="settings-card">
              <div className="settings-card-head">
                <div>
                  <span className="settings-card-kicker">连接入口</span>
                  <strong>{canConfigureRoute ? "入口账号与 JumpServer 规则" : "当前无需额外入口设置"}</strong>
                </div>
                {canConfigureRoute ? <button className="ghost-button" type="button" onClick={props.currentServerSection.onSaveRoute} disabled={props.isBusy}>保存入口设置</button> : null}
              </div>
              {canConfigureRoute ? (
                <>
                  {canPickEntry ? (
                    <label className="settings-field">
                      <span>入口账号</span>
                      <select value={props.currentServerSection.preferredBastionId} onChange={(event) => props.currentServerSection.onPreferredBastionChange(event.target.value)}>
                        <option value="">自动尝试</option>
                        {props.currentServerSection.availableBastions.map((server) => (
                          <option key={server.id} value={server.id}>{server.name} · {server.username}@{server.host}:{server.port}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  {showJumpFields ? (
                    <div className="settings-form-grid settings-form-grid-single">
                      <label className="settings-field">
                        <span>JumpServer 模式</span>
                        <select value={props.currentServerSection.jumpMode} onChange={(event) => props.currentServerSection.onJumpModeChange(event.target.value as "auto" | "jumpserver-search")}>
                          <option value="auto">自动推断</option>
                          <option value="jumpserver-search">按关键字搜索资产</option>
                        </select>
                      </label>
                      <label className="settings-field">
                        <span>搜索关键字</span>
                        <div className="settings-inline-actions settings-inline-actions-stretch">
                          <input value={props.currentServerSection.jumpSearchKeyword} onChange={(event) => props.currentServerSection.onJumpSearchKeywordChange(event.target.value)} placeholder="默认可填主机名、业务名或资产别名" />
                          <button className="ghost-button" type="button" onClick={props.currentServerSection.onSearchJumpAssets} disabled={props.isBusy}>搜索资产</button>
                        </div>
                      </label>
                      <label className="settings-field">
                        <span>资产 ID</span>
                        <input value={props.currentServerSection.jumpAssetId} onChange={(event) => props.currentServerSection.onJumpAssetIdChange(event.target.value)} placeholder="也可直接粘贴已有资产 ID" />
                      </label>
                      {props.currentServerSection.jumpAssetOptions.length ? (
                        <div className="settings-asset-list">
                          {props.currentServerSection.jumpAssetOptions.map((asset) => (
                            <button key={asset.id} type="button" className={props.currentServerSection.jumpAssetId === asset.id ? "settings-asset-row settings-asset-row-active" : "settings-asset-row"} onClick={() => props.currentServerSection.onJumpAssetIdChange(asset.id)}>
                              <strong>{asset.name}</strong>
                              <span>{asset.address || asset.id}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="settings-note-box">
                      <strong>这台服务器不需要 JumpServer 搜索规则</strong>
                      <span>如果它本身就是堡垒机入口，通常直接打开终端后再进入目标机即可。</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="settings-note-box">
                  <strong>当前服务器按直连处理</strong>
                  <span>如果你希望它走堡垒机，请回到“服务器台账”把连接方式改成“经堡垒机目标机”。</span>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="settings-workspace-empty">
            <strong>还没有选中的服务器</strong>
            <span>先在左侧选择服务器，或者到“服务器台账”里新增一台。</span>
          </div>
        )
      ) : null}
    </section>
  );
}
