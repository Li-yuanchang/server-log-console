import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "chrome-ext",
      transformIndexHtml(html) {
        return html.replace(/\s+crossorigin/g, "");
      },
      closeBundle() {
        copyFileSync(
          resolve(__dirname, "manifest.json"),
          resolve(__dirname, "dist", "manifest.json")
        );
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
        }
      },
      input: {
        index: "index.html",
        popup: "popup.html"
      }
    }
  }
});
