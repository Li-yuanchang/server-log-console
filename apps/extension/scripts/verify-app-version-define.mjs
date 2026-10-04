/**
 * 验证 vite.config.ts 的 __APP_VERSION__ define 注入（构建辅助脚本，不写任何产物）。
 *
 * 原理：加载真实 vite.config.ts（含 define），用一个虚拟入口引用 __APP_VERSION__
 * 做一次内存构建（write: false），检查产物是否包含权威版本号字面量。
 *
 * 用法：node apps/extension/scripts/verify-app-version-define.mjs
 */
import { build } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const extensionDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedVersion = JSON.parse(
  readFileSync(path.resolve(extensionDir, "../electron/package.json"), "utf8")
).version;

const PROBE_ID = "\0virtual-version-probe.js";
const probePlugin = {
  name: "version-probe",
  resolveId(id) {
    if (id === PROBE_ID) return id;
  },
  load(id) {
    if (id === PROBE_ID) return "console.log(__APP_VERSION__);\n";
  },
};

const result = await build({
  root: extensionDir,
  configFile: path.resolve(extensionDir, "vite.config.ts"),
  logLevel: "silent",
  build: {
    write: false,
    rollupOptions: { input: PROBE_ID },
  },
  plugins: [probePlugin],
});

const code = result.output.map((chunk) => chunk.code ?? "").join("\n");
if (code.includes(JSON.stringify(expectedVersion))) {
  console.log(`[verify-app-version-define] OK: __APP_VERSION__ 已注入为 ${expectedVersion}`);
} else if (code.includes("__APP_VERSION__")) {
  console.error("[verify-app-version-define] FAIL: define 未生效，产物中仍是 __APP_VERSION__ 标识符");
  process.exit(1);
} else {
  console.error(`[verify-app-version-define] FAIL: 产物中无 ${expectedVersion}（探针模块被 tree-shake 或 define 未生效）`);
  process.exit(1);
}
