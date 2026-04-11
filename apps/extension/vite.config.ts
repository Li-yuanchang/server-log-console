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
      input: {
        index: "index.html",
        popup: "popup.html"
      }
    }
  }
});
