/**
 * 验证「保存凭证后主界面卡在正在连接」的根因与修复（2026-11-27）
 *
 * 故障现象：连接失败 → 设置中心改密码 → 保存成功 → 回到主界面，
 * 一直停在「正在连接 xxx / 等待建立 SSH 连接」，没有请求在飞，也不会自己恢复。
 *
 * 根因：App.tsx 里那个「服务器切换重置」effect 的依赖是 [serverId, servers, ...]，
 * 而 fetchServers() 每次都 setServers(全新数组)，于是保存凭证 → fetchServers()
 * → effect 重跑 → 无条件 setConnectionTestStatus(null) + setFileEntries([])
 * → isConnectingWorkspace 恒为 true → 永久 loading。
 *
 * 本脚本把 effect 的判定与 isConnectingWorkspace 的推导抽成纯函数，逐场景断言。
 * 不依赖 React，跑的是与源码同构的判定逻辑。
 */

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` — 期望 ${expected}，实际 ${actual}`}`);
};

/* ---------- 与 App.tsx 同构的判定 ---------- */

/** 修复前的「服务器重置」effect：每次运行都清空连接结果 */
function resetEffectBefore({ serverIdChanged, isRestoringFromCache }) {
  void serverIdChanged;
  if (!isRestoringFromCache) {
    return { connectionTestStatus: null, fileEntriesCleared: true };
  }
  return { unchanged: true };
}

/** 修复后的版本：只在真的换了服务器时清空 */
function resetEffectAfter({ serverIdChanged, isRestoringFromCache }) {
  if (!isRestoringFromCache && serverIdChanged) {
    return { connectionTestStatus: null, fileEntriesCleared: true };
  }
  return { unchanged: true };
}

/** 主界面是否显示「正在连接」空态（与 App.tsx:isConnectingWorkspace 一致） */
function isConnectingWorkspace({ isFileMode, connectionTestStatus, fileEntries }) {
  const hasDirectoryConnectionError =
    isFileMode && connectionTestStatus !== null && !connectionTestStatus.connected;
  return (
    isFileMode &&
    !hasDirectoryConnectionError &&
    (!connectionTestStatus || (!connectionTestStatus.connected && !fileEntries.length))
  );
}

/* ---------- 场景 1：复现故障 ---------- */

console.log("\n场景 1：保存凭证后 fetchServers 触发 effect 重跑（修复前）");
{
  /* 保存前的稳定状态：已连接且有目录内容 */
  const before = { isFileMode: true, connectionTestStatus: { connected: true }, fileEntries: [1, 2, 3] };
  check("保存前不显示连接中", isConnectingWorkspace(before), false);

  /* fetchServers 给新数组 → effect 重跑，但 serverId 没变 */
  const afterReset = resetEffectBefore({ serverIdChanged: false, isRestoringFromCache: false });
  const after = {
    isFileMode: true,
    connectionTestStatus: afterReset.connectionTestStatus,
    fileEntries: [],  // 原实现同时 setFileEntries([])
  };
  check("修复前：保存后进入假连接态（复现 bug）", isConnectingWorkspace(after), true);
}

/* ---------- 场景 2：修复后 ---------- */

console.log("\n场景 2：同一场景，修复后");
{
  const before = { isFileMode: true, connectionTestStatus: { connected: true }, fileEntries: [1, 2, 3] };
  check("保存前不显示连接中", isConnectingWorkspace(before), false);

  const afterReset = resetEffectAfter({ serverIdChanged: false, isRestoringFromCache: false });
  check("刷新清单不再清空连接状态", afterReset.unchanged, true);

  const after = { ...before };  // 状态与目录都保留
  check("修复后：不再是假连接态", isConnectingWorkspace(after), false);
}

/* ---------- 场景 3：真切换服务器仍然要清 ---------- */

console.log("\n场景 3：真的切换服务器时，重置行为必须保留");
{
  const afterReset = resetEffectAfter({ serverIdChanged: true, isRestoringFromCache: false });
  check("切服务器仍然清空连接状态", afterReset.connectionTestStatus, null);
  const state = { isFileMode: true, connectionTestStatus: null, fileEntries: [] };
  check("切到新服务器后显示连接中（正确）", isConnectingWorkspace(state), true);
}

/* ---------- 场景 4：从缓存恢复工作区不应被清 ---------- */

console.log("\n场景 4：从缓存恢复工作区");
{
  const afterReset = resetEffectAfter({ serverIdChanged: true, isRestoringFromCache: true });
  check("从缓存恢复时不清空", afterReset.unchanged, true);
}

/* ---------- 场景 5：真失败仍然要落到失败态，不能变永久连接中 ---------- */

console.log("\n场景 5：真实连接失败后的状态推导");
{
  const state = {
    isFileMode: true,
    connectionTestStatus: { connected: false, message: "认证失败" },
    fileEntries: [],
  };
  check("失败态不算连接中（渲染失败占位）", isConnectingWorkspace(state), false);
}

console.log(`\n${failed === 0 ? "全部通过" : `${failed} 项失败`}`);
process.exit(failed === 0 ? 0 : 1);