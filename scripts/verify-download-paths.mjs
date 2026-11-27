/**
 * 批量 / 目录下载落盘路径验证（2026-11-24）
 *
 * 验证 scripts 关注的三个不变量：
 *  1. 逃逸拦截：relativePath 里塞 ../ 或绝对路径，不能写到目标根之外
 *  2. 结构还原：a/b/c.class → 目标根/a/b/c.class
 *  3. 同名不覆盖：已有 foo.class 时落到 foo (1).class
 *
 * 运行：node scripts/verify-download-paths.mjs
 */
import path from "node:path";

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

/* 复刻 main.cjs download-file-open 里的 resolve 逻辑 */
function resolveTarget(rootDir, relativePath) {
  const resolvedRoot = path.resolve(rootDir);
  const normalizedRelative = path.normalize(relativePath).replace(/^([/\\])+/, "");
  const targetPath = path.resolve(resolvedRoot, normalizedRelative);
  const ok = targetPath !== resolvedRoot && targetPath.startsWith(resolvedRoot + path.sep);
  return { ok, targetPath };
}

/* 复刻 resolveAvailablePath */
function resolveAvailablePath(existingSet, dirPath, fileName) {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  let candidate = path.join(dirPath, fileName);
  let index = 1;
  while (existingSet.has(candidate)) {
    candidate = path.join(dirPath, `${base} (${index})${ext}`);
    index += 1;
  }
  return candidate;
}

const root = "/tmp/slc-download-root";

console.log("逃逸拦截");
check("普通相对路径放行", resolveTarget(root, "Dao/a.class").ok);
check("多级相对路径放行", resolveTarget(root, "Dao/sub/a.class").ok);
check(".. 逃逸被拒", !resolveTarget(root, "../../.ssh/authorized_keys").ok);
check("内嵌 .. 逃逸被拒", !resolveTarget(root, "Dao/../../../etc/passwd").ok);
check("回退到根被拒（会当目录写）", !resolveTarget(root, ".").ok);
check("空相对路径被拒", !resolveTarget(root, "").ok);
check("绝对路径被裁剪后不逃逸", (() => {
  const r = resolveTarget(root, "/etc/passwd");
  return r.ok && r.targetPath === path.join(root, "etc/passwd");
})());

console.log("\n结构还原");
check("目录名保留外层", resolveTarget(root, "Dao/com/sdjd/bgsh/a.class").targetPath
  === path.join(root, "Dao/com/sdjd/bgsh/a.class"));
check("中文与空格路径", resolveTarget(root, "日志 备份/2026-11/a.log").ok);

console.log("\n同名不覆盖");
check("无冲突原名", resolveAvailablePath(new Set(), root, "a.class") === path.join(root, "a.class"));
check("已存在加 (1)", resolveAvailablePath(new Set([path.join(root, "a.class")]), root, "a.class")
  === path.join(root, "a (1).class"));
check("连续占用递增", resolveAvailablePath(
  new Set([path.join(root, "a.class"), path.join(root, "a (1).class")]), root, "a.class")
  === path.join(root, "a (2).class"));
check("无扩展名文件", resolveAvailablePath(new Set([path.join(root, "Makefile")]), root, "Makefile")
  === path.join(root, "Makefile (1)"));

console.log("\n相对路径拼接（前端 collectBatchTargets）");
function joinRelative(...segments) {
  return segments.map((s) => String(s ?? "").replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
}
check("目录名 + 子树相对路径", joinRelative("Dao", "com/sdjd/a.class") === "Dao/com/sdjd/a.class");
check("顶层目录下的直接文件", joinRelative("Dao", "a.class") === "Dao/a.class");
check("不产生双斜杠", !joinRelative("Dao/", "/a.class").includes("//"));

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);