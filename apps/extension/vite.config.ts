import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// 版本唯一权威源：apps/electron/package.json（predist 由 bump-version.cjs 自动 +1 patch）。
// 渲染层可通过全局常量 __APP_VERSION__ 展示当前版本（如需 TS 类型，在 src 的 d.ts 里声明 declare const __APP_VERSION__: string）。
const electronPackageJson = JSON.parse(
  readFileSync(resolve(__dirname, "../electron/package.json"), "utf8")
) as { version?: string };
const appVersion = electronPackageJson.version ?? "0.0.0";

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    {
      name: "chrome-ext",
      transformIndexHtml(html) {
        return html.replace(/\s+crossorigin/g, "");
      },
      closeBundle() {
        // dist/manifest.json 由源 manifest.json 拷贝产生，这里注入权威版本后再写入 dist；
        // 只改写构建产物，不动源仓库里的 apps/extension/manifest.json。
        const manifest = JSON.parse(readFileSync(resolve(__dirname, "manifest.json"), "utf8")) as {
          version?: string;
        };
        manifest.version = appVersion;
        writeFileSync(
          resolve(__dirname, "dist", "manifest.json"),
          `${JSON.stringify(manifest, null, 2)}\n`
        );
        // Chrome 保留 "_" 开头的文件名（_locales/_metadata 等），包含即拒绝加载整个扩展；
        // public/__preview.html 仅供 vite dev 预览侧栏响应式，构建产物中必须剔除。
        rmSync(resolve(__dirname, "dist", "__preview.html"), { force: true });
      }
    }
  ],
  server: {
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("/react/") || id.includes("/react-dom/")) return "vendor-react";
          if (id.includes("/@codemirror/lang-")) {
            const match = id.match(/\/node_modules\/(@codemirror\/lang-[^/]+)/);
            return match ? `cm-${match[1].split("/")[1]}` : "vendor-codemirror-lang";
          }
          if (id.includes("/@codemirror/")) return "vendor-codemirror-core";
          if (id.includes("/@xterm/")) return "vendor-xterm";
          if (id.includes("/lucide-react/")) return "vendor-lucide";
          if (id.includes("/react-virtuoso/")) return "vendor-virtuoso";
          if (id.includes("/monaco-editor/") || id.includes("/@monaco-editor/")) return "vendor-monaco";
        }
      },
      input: {
        index: "index.html",
        popup: "popup.html"
      }
    }
  }
});
