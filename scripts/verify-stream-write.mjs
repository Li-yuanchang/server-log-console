/**
 * 三段式流式落盘验证（2026-11-24）
 *
 * 批量下载不再把整份文件内容作为一条 IPC 消息传过来，而是
 * open → write* → close(keep|discard)。这里在真实文件系统上验证：
 *  1. 分片按序写入后，文件内容与源完全一致（不出错位/丢块）
 *  2. 多字节边界（含 UTF-8 中文）不会切坏字符
 *  3. keep=false 时半截文件被删除（取消不留坏文件）
 *  4. 同一相对路径重复下两次：第二次自动落到 "name (1)"
 *
 * 运行：node scripts/verify-stream-write.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

/* ---- 复刻 main.cjs 的落盘逻辑 ---- */
function resolveAvailablePath(dirPath, fileName) {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  let candidate = path.join(dirPath, fileName);
  let index = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dirPath, `${base} (${index})${ext}`);
    index += 1;
  }
  return candidate;
}

const handles = new Map();
let seq = 0;

function openDownloadFile(rootDir, relativePath) {
  const resolvedRoot = path.resolve(rootDir);
  const normalizedRelative = path.normalize(relativePath).replace(/^([/\\])+/, "");
  const targetPath = path.resolve(resolvedRoot, normalizedRelative);
  if (targetPath === resolvedRoot || !targetPath.startsWith(resolvedRoot + path.sep)) {
    return { ok: false, message: `非法的保存路径：${relativePath}` };
  }
  const targetDir = path.dirname(targetPath);
  fs.mkdirSync(targetDir, { recursive: true });
  const finalPath = resolveAvailablePath(targetDir, path.basename(targetPath));
  const fd = fs.openSync(finalPath, "w");
  seq += 1;
  const handleId = `dl-${seq}`;
  handles.set(handleId, { fd, filePath: finalPath, bytesWritten: 0 });
  return { ok: true, handleId, filePath: finalPath };
}

function writeDownloadFile(handleId, chunk) {
  const session = handles.get(handleId);
  if (!session) return { ok: false, message: "落盘句柄已失效" };
  const buf = Buffer.from(chunk);
  fs.writeSync(session.fd, buf);
  session.bytesWritten += buf.length;
  return { ok: true, bytesWritten: session.bytesWritten };
}

function closeDownloadFile(handleId, keep) {
  const session = handles.get(handleId);
  if (!session) return { ok: false, message: "落盘句柄已失效" };
  handles.delete(handleId);
  try { fs.closeSync(session.fd); } catch { /* 已关闭 */ }
  if (!keep) {
    try { fs.unlinkSync(session.filePath); } catch { /* 已删除 */ }
    return { ok: true, removed: true, filePath: session.filePath };
  }
  return { ok: true, filePath: session.filePath, bytesWritten: session.bytesWritten };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "slc-dl-"));
console.log(`临时落点：${root}\n`);

/* 1) 内容一致性：模拟 137KB 二进制 + 多片写入 */
{
  const source = Buffer.alloc(137 * 1024);
  for (let i = 0; i < source.length; i += 1) source[i] = i % 251;

  const opened = openDownloadFile(root, "Dao/Big.bin");
  check("多级目录被创建", fs.existsSync(path.dirname(opened.filePath)));
  for (let offset = 0; offset < source.length; offset += 16 * 1024) {
    writeDownloadFile(opened.handleId, source.subarray(offset, offset + 16 * 1024));
  }
  const closed = closeDownloadFile(opened.handleId, true);
  const written = fs.readFileSync(closed.filePath);
  check("分片写入字节数正确", written.length === source.length, `${written.length} vs ${source.length}`);
  check("内容完全一致（无错位/丢块）", written.equals(source));
}

/* 2) UTF-8 中文跨片不破损 */
{
  const text = "日志控制台批量下载验证\n".repeat(500);
  const source = Buffer.from(text, "utf8");
  const opened = openDownloadFile(root, "中文 目录/日志.log");
  /* 以 7 字节为片长，故意切断多字节字符 */
  for (let offset = 0; offset < source.length; offset += 7) {
    writeDownloadFile(opened.handleId, source.subarray(offset, offset + 7));
  }
  const closed = closeDownloadFile(opened.handleId, true);
  check("中文路径落盘成功", fs.existsSync(closed.filePath));
  check("UTF-8 内容未被切坏", fs.readFileSync(closed.filePath, "utf8") === text);
}

/* 3) 取消删残留 */
{
  const opened = openDownloadFile(root, "Dao/Canceled.bin");
  writeDownloadFile(opened.handleId, Buffer.from("half"));
  const targetFile = opened.filePath;
  check("中断时文件已存在", fs.existsSync(targetFile));
  closeDownloadFile(opened.handleId, false);
  check("keep=false 删除半截文件", !fs.existsSync(targetFile));
}

/* 4) 同名不覆盖 */
{
  const first = openDownloadFile(root, "Dao/Dup.class");
  closeDownloadFile(first.handleId, true);
  const second = openDownloadFile(root, "Dao/Dup.class");
  closeDownloadFile(second.handleId, true);
  check("第二次落到 name (1)", second.filePath.endsWith("Dup (1).class"));
  check("原文件仍在", fs.existsSync(first.filePath));
}

/* 5) 逃逸拒绝 */
{
  const bad = openDownloadFile(root, "../../escape.txt");
  check("逃逸路径被拒", bad.ok === false);
  check("逃逸未产生文件", !fs.existsSync(path.join(root, "..", "..", "escape.txt")));
}

fs.rmSync(root, { recursive: true, force: true });
console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);