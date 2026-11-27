/**
 * 递归目录树采集验证（2026-11-24）
 *
 * 覆盖两条新算法：
 *  1. 直连：解析 `find -printf "%y\t%P\t%s\t%p"` 的输出（含 awk 的树截断标记）
 *  2. 堡垒机：逐层 readdir 的 BFS 展开、截断、软链接环防护、子目录读失败跳过
 *
 * 运行：node scripts/verify-directory-tree.mjs
 */

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

/* ---- 复刻 direct-strategy.listDirectoryTree 的解析段 ---- */
function parseFindOutput(output, maxEntries = 20000) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const entries = [];
  let truncated = false;
  for (const line of lines) {
    if (line === "tree-truncated") { truncated = true; continue; }
    const [kindToken = "", relativePath = "", sizeToken = "", path = ""] = line.split("\t");
    if (!relativePath || !path) continue;
    const kind = kindToken === "d" ? "directory" : kindToken === "f" ? "file" : null;
    if (!kind) continue;
    entries.push({
      path,
      relativePath,
      kind,
      size: kind === "file" && /^\d+$/.test(sizeToken) ? Number(sizeToken) : undefined,
    });
  }
  return { entries, truncated };
}

console.log("直连输出解析");
{
  const out = [
    "d\tDao\t4096\t/usr/classes/com/sdjd/bgsh/Dao",
    "f\tDao/BgBmshDao.class\t44851\t/usr/classes/com/sdjd/bgsh/Dao/BgBmshDao.class",
    "f\tDao/BgshTaskSupport$1.class\t231\t/usr/classes/com/sdjd/bgsh/Dao/BgshTaskSupport$1.class",
  ].join("\n");
  const { entries, truncated } = parseFindOutput(out);
  check("目录项识别", entries[0].kind === "directory");
  check("目录项无 size", entries[0].size === undefined);
  check("文件项识别", entries[1].kind === "file");
  check("文件大小解析", entries[1].size === 44851);
  check("相对路径保留层级", entries[2].relativePath === "Dao/BgshTaskSupport$1.class");
  check("远端绝对路径完整", entries[2].path.startsWith("/usr/classes/"));
  check("文件名含 $ 不被切割", entries[2].relativePath.endsWith("BgshTaskSupport$1.class"));
  check("未截断", truncated === false);
}
{
  const out = ["f\ta\t1\t/root/a", "tree-truncated"].join("\n");
  const { entries, truncated } = parseFindOutput(out);
  check("截断标记被识别", truncated === true);
  check("截断标记不混入条目", entries.length === 1);
}
{
  const { entries } = parseFindOutput(["f\ta\t\t/root/a"].join("\n"));
  check("size 非数字时留空", entries[0].size === undefined);
}
{
  const { entries } = parseFindOutput(["l\tlink\t0\t/root/link", "", ""].join("\n"));
  check("非文件/目录类型被跳过", entries.length === 0);
}

/* ---- 复刻 bastion-sftp-strategy.listDirectoryTree 的 BFS ---- */
async function listTree(rootPath, listDir, maxEntries = 20000) {
  const root = rootPath.replace(/\/+$/, "") || "/";
  const entries = [];
  const visited = new Set([root]);
  let truncated = false;
  let queue = [{ dirPath: root, relativePrefix: "" }];
  while (queue.length > 0 && !truncated) {
    const next = [];
    for (const current of queue) {
      let children;
      try { children = await listDir(current.dirPath); } catch { continue; }
      for (const child of children) {
        if (entries.length >= maxEntries) { truncated = true; break; }
        if (child.kind === "directory" && visited.has(child.path)) continue;
        const relativePath = current.relativePrefix ? `${current.relativePrefix}/${child.name}` : child.name;
        entries.push({ path: child.path, relativePath, kind: child.kind, size: child.kind === "file" ? child.size : undefined });
        if (child.kind === "directory" && !visited.has(child.path)) {
          visited.add(child.path);
          next.push({ dirPath: child.path, relativePrefix: relativePath });
        }
      }
      if (truncated) break;
    }
    queue = next;
  }
  return { entries, truncated };
}

console.log("\n堡垒机 BFS 展开");
{
  const tree = {
    "/r": [
      { name: "Dao", path: "/r/Dao", kind: "directory" },
      { name: "top.class", path: "/r/top.class", kind: "file", size: 10 },
    ],
    "/r/Dao": [{ name: "A.class", path: "/r/Dao/A.class", kind: "file", size: 20 }],
  };
  const { entries } = await listTree("/r", async (p) => tree[p] || []);
  check("两层目录全覆盖", entries.length === 3);
  check("顶层文件相对路径", entries.some((e) => e.relativePath === "top.class"));
  check("嵌套文件相对路径", entries.some((e) => e.relativePath === "Dao/A.class"));
  check("嵌套文件大小", entries.find((e) => e.relativePath === "Dao/A.class").size === 20);
}
{
  const tree = {
    "/r": [{ name: "big", path: "/r/big", kind: "directory" }],
    "/r/big": Array.from({ length: 50 }, (_, i) => ({
      name: `f${i}`, path: `/r/big/f${i}`, kind: "file", size: 1,
    })),
  };
  const { entries, truncated } = await listTree("/r", async (p) => tree[p] || [], 10);
  check("上限生效", entries.length === 10);
  check("上限时标截断", truncated === true);
}
{
  const tree = {
    "/r": [{ name: "a", path: "/r/a", kind: "directory" }, { name: "b", path: "/r/b", kind: "directory" }],
    "/r/b": [{ name: "ok.class", path: "/r/b/ok.class", kind: "file", size: 5 }],
  };
  const { entries } = await listTree("/r", async (p) => {
    if (p === "/r/a") throw new Error("permission denied");
    return tree[p] || [];
  });
  check("单个子目录失败不终止整棵树", entries.some((e) => e.relativePath === "b/ok.class"));
}
{
  const tree = {
    "/r": [{ name: "loop", path: "/r/loop", kind: "directory" }],
    "/r/loop": [{ name: "loop", path: "/r/loop", kind: "directory" }],
  };
  const { entries } = await listTree("/r", async (p) => tree[p] || []);
  check("自引用环不死循环", entries.length === 1);
}
{
  const { entries } = await listTree("/r/", async () => []);
  check("根路径尾部斜杠被归一", entries.length === 0);
}

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);