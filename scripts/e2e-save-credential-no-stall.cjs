/**
 * A/B 对照验证（真实用户路径，最终版）
 *
 * 路径：选中可连通的服务器 → 连接成功 → 设置中心/连接管理 → 编辑凭证 →
 *       点「保存」→ 关闭设置中心 → 主界面是否卡回「正在连接」。
 *
 * 「保存凭证」内部会 await fetchServers()，而「服务器切换重置」effect 的依赖含
 * servers；修复前该 effect 无条件清空 connectionTestStatus → 永久 loading。
 *
 * 修复前：③ 应 FAIL；修复后：③ 应 PASS。
 */
const { app, BrowserWindow } = require("electron");

const TOKEN = process.env.SLC_TOKEN || "";
const SERVER_NAME = process.env.SLC_SERVER_NAME || "";
const WEB_URL = process.env.SLC_WEB_URL || "http://127.0.0.1:4040/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const READ_STATE = `(() => {
  const body = document.body.innerText || "";
  const titles = [...document.querySelectorAll('.lp3 .lp3-title')].map((e) => (e.textContent || '').trim());
  const connectingTitle = /^正在连接\\s+\\S/.test(titles[0] || '');
  const waitingChip = /等待建立 SSH 连接/.test(body);
  const failedPlaceholder = titles.some((t) => t === '连接失败');
  /* 工作区是否真实呈现内容：目录树列存在 + 有文件/目录行 */
  const hasTreeColumn = Boolean(document.querySelector('.file-browser-tree, [class*=tree-column]'));
  const rowCount = document.querySelectorAll('.file-browser-content tbody tr, .file-row, .browser-results-row').length;
  const hasDirTreeText = /目录树/.test(body);
  return JSON.stringify({
    connectingTitle, waitingChip, failedPlaceholder, titles,
    hasTreeColumn, rowCount, hasDirTreeText,
    workareaFilled: (hasTreeColumn || hasDirTreeText) && !connectingTitle,
  });
})()`;

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1500, height: 950, show: false,
    webPreferences: { webSecurity: false, contextIsolation: true, nodeIntegration: false },
  });
  const js = (code) => win.webContents.executeJavaScript(code);
  const read = async () => JSON.parse(await js(READ_STATE));

  console.log(`加载 ${WEB_URL}（目标：${SERVER_NAME}）`);
  await win.loadURL(`${WEB_URL}?token=${encodeURIComponent(TOKEN)}`);
  await sleep(3000);

  /* ① 选中并连接 */
  await js(`(() => {
    const name = ${JSON.stringify(SERVER_NAME)};
    const n = [...document.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && (el.textContent || '').trim() === name
    )[0];
    if (n) (n.closest('button, [role=button], li, a') || n).click();
  })()`);
  await sleep(7000);
  let state = await read();
  console.log(`   ① 连接后 connecting=${state.connectingTitle} failed=${state.failedPlaceholder}`);
  check("① 已连接成功且工作区有内容", !state.connectingTitle && !state.failedPlaceholder && state.workareaFilled, JSON.stringify(state));

  /* ② 设置中心 → 连接管理 → 编辑凭证 → 保存 */
  console.log("\n② 设置中心 → 连接管理 → 编辑凭证 → 保存");
  await js(`(() => {
    const b = [...document.querySelectorAll('button')].find(
      (x) => /设置/.test(x.getAttribute('title') || '') || /设置/.test(x.textContent || '')
    );
    if (b) b.click();
  })()`);
  await sleep(1500);
  await js(`(() => {
    const t = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '连接管理');
    if (t) t.click();
  })()`);
  await sleep(1500);

  /* 进「编辑凭证」 */
  const entered = await js(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '编辑凭证');
    if (!b) return 'no-edit-credential';
    b.click();
    return 'clicked';
  })()`);
  console.log(`   编辑凭证：${entered}`);
  await sleep(1500);

  /* 此时列出面板内按钮，找「保存」 */
  const credButtons = JSON.parse(await js(`(() => {
    const list = [...document.querySelectorAll('button')].map((b) => ({
      text: (b.textContent || '').trim().slice(0, 16),
      title: (b.getAttribute('title') || '').slice(0, 30),
    })).filter((b) => /保存|取消|测试|读取/.test(b.text));
    return JSON.stringify(list);
  })()`));
  console.log(`   凭证面板按钮：${JSON.stringify(credButtons)}`);

  const saved = await js(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /保存/.test((x.textContent || '').trim()));
    if (!b) return 'no-save';
    b.click();
    return 'saved:' + (b.textContent || '').trim().slice(0, 10);
  })()`);
  console.log(`   保存动作：${saved}`);
  check("② 点到了保存按钮", saved.startsWith("saved"), saved);

  /* 等保存 + 内部重连完成 */
  await sleep(8000);

  /* ③ 关闭设置中心 */
  console.log("\n③ 关闭设置中心，观察主界面");
  await js(`(() => {
    const c = document.querySelector('[aria-label="关闭"], .modal-close, .settings-modal-close');
    if (c) { c.click(); return; }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  })()`);
  await sleep(3000);

  state = await read();
  console.log(`   ③ 主界面 title=${JSON.stringify(state.titles[0] || "")} connecting=${state.connectingTitle} chip=${state.waitingChip} filled=${state.workareaFilled}`);

  check(
    "保存凭证后主界面未停在「正在连接 / 等待建立 SSH 连接」",
    !state.connectingTitle && !state.waitingChip,
    JSON.stringify(state)
  );
  check(
    "保存凭证后工作区仍有内容（不是空壳）",
    state.workareaFilled === true,
    JSON.stringify(state)
  );

  win.destroy();
  app.quit();
}

main()
  .catch((e) => { console.error(e && e.stack ? e.stack : e); failed += 1; })
  .finally(() => setTimeout(() => process.exit(failed === 0 ? 0 : 1), 200));