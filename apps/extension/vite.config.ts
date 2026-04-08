import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

function copyManifest() {
  return {
    name: "copy-manifest",
    closeBundle() {
      copyFileSync(
        resolve(__dirname, "manifest.json"),
        resolve(__dirname, "dist", "manifest.json")
      );
    }
  };
}

export default defineConfig({
  plugins: [react(), copyManifest()],
  server: {
    host: "127.0.0.1",
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: "index.html",
        popup: "popup.html"
      }
    }
  }
});
