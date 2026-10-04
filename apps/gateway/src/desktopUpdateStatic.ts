import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express, { type RequestHandler } from "express";

/**
 * 桌面端更新源静态托管。
 * 目录解析：环境变量 SLC_DESKTOP_UPDATE_DIR → 网关本地数据目录下的 desktop-updates。
 * 目录不存在时返回 null（不挂载，开发环境零影响）。
 */
export function resolveDesktopUpdateDir(): string {
  const configured = process.env.SLC_DESKTOP_UPDATE_DIR?.trim();
  if (configured) return path.resolve(configured);
  const configHome = process.env.SERVER_LOG_CONFIG_HOME || path.join(os.homedir(), ".server-log-console");
  return path.join(configHome, "desktop-updates");
}

export function createDesktopUpdateStatic(): RequestHandler | null {
  const updateDir = resolveDesktopUpdateDir();
  if (!existsSync(updateDir) || !statSync(updateDir).isDirectory()) {
    return null;
  }

  return express.static(updateDir, {
    index: false,
    fallthrough: true,
    setHeaders: (res, filePath) => {
      // 清单类文件不缓存，安装包长期缓存（内容不可变）
      if (/\.(ya?ml|json|xml)$/i.test(filePath) || /SHA256SUMS$/i.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
      const contentType = desktopUpdateContentType(filePath);
      if (contentType) res.setHeader("Content-Type", contentType);
    },
  });
}

function desktopUpdateContentType(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".yml" || ext === ".yaml") return "text/yaml; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".xml") return "application/xml; charset=utf-8";
  if (ext === ".zip") return "application/zip";
  if (ext === ".dmg") return "application/x-apple-diskimage";
  if (ext === ".exe") return "application/vnd.microsoft.portable-executable";
  if (ext === ".gz") return "application/gzip";
  if (ext === ".blockmap") return "application/octet-stream";
  return undefined;
}
